import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readHqRecommendationStore, upsertHqRecommendation } from '@craft-agent/shared/hq-state/recommendation-storage'
import type { HqRecommendationCandidate } from '@craft-agent/shared/hq-state'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

const rootPath = mkdtempSync(join(tmpdir(), 'runneros-hq-state-rpc-'))
const workspace = { id: 'ws-1', name: 'Artist HQ', rootPath }

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => id === workspace.id ? workspace : undefined,
  getWorkspaces: () => [workspace],
  loadPreferences: () => ({}),
}))

type Handler = (...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()
const pushes: unknown[][] = []
const sentPrompts: string[] = []
const deletedSessions: string[] = []
let sendShouldFail = false
let sessionCounter = 0

beforeAll(async () => {
  const { registerHqStateHandlers } = await import('./hq-state')
  registerHqStateHandlers({
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  } as never, {
    wsServer: { push: (...args: unknown[]) => pushes.push(args) },
    sessionManager: {
      resolveAgentSessionOptions: async () => ({ permissionMode: 'safe' }),
      createSession: async () => ({ id: `session-${++sessionCounter}` }),
      sendMessage: async (_sessionId: string, prompt: string, ...args: unknown[]) => {
        if (sendShouldFail) throw new Error('dispatch failed')
        sentPrompts.push(prompt)
        const onAck = args.at(-1)
        if (typeof onAck === 'function') onAck('message-1')
      },
      deleteSession: async (sessionId: string) => { deletedSessions.push(sessionId) },
    },
  } as never)
  const { refreshHqStateContextDoc } = await import('../../hq-state/refresh')
  refreshHqStateContextDoc(rootPath)
})

afterAll(() => rmSync(rootPath, { recursive: true, force: true }))

describe('HQ state RPC handlers', () => {
  test('explicitly regenerates and broadcasts State of Play context', async () => {
    const pushesBefore = pushes.length

    const result = await invoke(RPC_CHANNELS.hqState.REFRESH, workspace.id) as { generatedAt: string }

    expect(Date.parse(result.generatedAt)).not.toBeNaN()
    expect(pushes.length).toBe(pushesBefore + 1)
    expect(pushes.at(-1)?.[0]).toBe(RPC_CHANNELS.workspaceContext.CHANGED)
    expect(pushes.at(-1)?.[2]).toBe(workspace.id)
  })

  test('lists and transitions a durable recommendation', async () => {
    const listed = await invoke(RPC_CHANNELS.hqState.LIST_RECOMMENDATIONS, workspace.id) as ReturnType<typeof readHqRecommendationStore>
    const recommendationId = listed.candidates[0]!.id

    const dismissed = await invoke(RPC_CHANNELS.hqState.TRANSITION_RECOMMENDATION, workspace.id, {
      recommendationId,
      to: 'dismissed',
      reason: 'Not relevant.',
    }) as { status: string }

    expect(dismissed.status).toBe('dismissed')
    expect(readHqRecommendationStore(rootPath).candidates.find((item) => item.id === recommendationId)?.status).toBe('dismissed')
    expect(pushes.length).toBeGreaterThan(0)
  })

  test('rejects an invalid snooze deadline', async () => {
    const recommendationId = readHqRecommendationStore(rootPath).candidates[0]!.id
    await expect(invoke(RPC_CHANNELS.hqState.TRANSITION_RECOMMENDATION, workspace.id, {
      recommendationId,
      to: 'snoozed',
      snoozedUntil: '2020-01-01T00:00:00.000Z',
    })).rejects.toThrow('future')
  })

  test('does not expose internal completion transitions to the client', async () => {
    const recommendationId = readHqRecommendationStore(rootPath).candidates[0]!.id
    await expect(invoke(RPC_CHANNELS.hqState.TRANSITION_RECOMMENDATION, workspace.id, {
      recommendationId,
      to: 'completed',
    })).rejects.toThrow('not user-accessible')
  })

  test('creates, links, and dispatches a recommendation entirely on the server', async () => {
    upsertHqRecommendation(rootPath, launchCandidate('sop_launch'))

    const result = await invoke(RPC_CHANNELS.hqState.LAUNCH_RECOMMENDATION, workspace.id, {
      recommendationId: 'sop_launch',
    }) as { sessionId: string; recommendation: HqRecommendationCandidate }

    expect(result.sessionId).toStartWith('session-')
    expect(result.recommendation.status).toBe('launched')
    expect(result.recommendation.executionRefs).toContainEqual(expect.objectContaining({ kind: 'session', id: result.sessionId }))
    expect(sentPrompts.at(-1)).toContain('hq-recommendation:sop_launch')
  })

  test('marks failed dispatch and removes the orphan session', async () => {
    upsertHqRecommendation(rootPath, launchCandidate('sop_dispatch_failure'))
    sendShouldFail = true
    try {
      await expect(invoke(RPC_CHANNELS.hqState.LAUNCH_RECOMMENDATION, workspace.id, {
        recommendationId: 'sop_dispatch_failure',
      })).rejects.toThrow('dispatch failed')
    } finally {
      sendShouldFail = false
    }

    const failed = readHqRecommendationStore(rootPath).candidates.find((item) => item.id === 'sop_dispatch_failure')
    expect(failed?.status).toBe('failed')
    const linkedSessionId = failed?.executionRefs.find((ref) => ref.kind === 'session')?.id
    expect(linkedSessionId).toBeDefined()
    expect(deletedSessions).toContain(linkedSessionId!)
  })

  test('serializes concurrent launch attempts into exactly one session', async () => {
    upsertHqRecommendation(rootPath, launchCandidate('sop_concurrent_launch'))
    const sessionsBefore = sessionCounter

    const results = await Promise.allSettled([
      invoke(RPC_CHANNELS.hqState.LAUNCH_RECOMMENDATION, workspace.id, { recommendationId: 'sop_concurrent_launch' }),
      invoke(RPC_CHANNELS.hqState.LAUNCH_RECOMMENDATION, workspace.id, { recommendationId: 'sop_concurrent_launch' }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(sessionCounter - sessionsBefore).toBe(1)
    expect(readHqRecommendationStore(rootPath).candidates.find((item) => item.id === 'sop_concurrent_launch')?.status).toBe('launched')
  })

  test('returns lifecycle history and stores usefulness without changing status', async () => {
    upsertHqRecommendation(rootPath, launchCandidate('sop_feedback'))
    const outcome = await invoke(RPC_CHANNELS.hqState.SET_RECOMMENDATION_USEFULNESS, workspace.id, {
      recommendationId: 'sop_feedback', usefulness: 'useful',
    }) as { userUsefulness?: string }
    const detail = await invoke(RPC_CHANNELS.hqState.GET_RECOMMENDATION_DETAIL, workspace.id, 'sop_feedback') as {
      candidate: HqRecommendationCandidate; events: unknown[]; outcome?: { userUsefulness?: string }
    }

    expect(outcome.userUsefulness).toBe('useful')
    expect(detail.candidate.status).toBe('proposed')
    expect(detail.events).toHaveLength(1)
    expect(detail.outcome?.userUsefulness).toBe('useful')
  })
})

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler({}, ...args)
}

function launchCandidate(id: string): HqRecommendationCandidate {
  return {
    version: 1,
    id,
    fingerprint: `v1:hq:concierge:${id}`,
    scope: { type: 'hq' },
    title: 'Create campaign brief',
    reason: 'Campaign needs a brief.',
    desiredOutcome: 'A completed brief.',
    completionContract: { type: 'output', requiredTag: `hq-recommendation:${id}`, expectedAgentSlug: 'concierge' },
    status: 'proposed',
    route: {
      target: 'agent',
      action: 'draft',
      prompt: 'Create the campaign brief.',
      confidence: 'high',
      agentSlug: 'concierge',
      contextDocSlugs: [],
    },
    executionRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastProposedAt: new Date().toISOString(),
  }
}

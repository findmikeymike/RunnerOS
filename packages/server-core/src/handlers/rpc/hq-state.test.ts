import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readHqRecommendationStore } from '@craft-agent/shared/hq-state/recommendation-storage'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

const rootPath = mkdtempSync(join(tmpdir(), 'runneros-hq-state-rpc-'))
const workspace = { id: 'ws-1', name: 'Artist HQ', rootPath }

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => id === workspace.id ? workspace : undefined,
}))

type Handler = (...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()
const pushes: unknown[][] = []

beforeAll(async () => {
  const { registerHqStateHandlers } = await import('./hq-state')
  registerHqStateHandlers({
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  } as never, {
    wsServer: { push: (...args: unknown[]) => pushes.push(args) },
  } as never)
  const { refreshHqStateContextDoc } = await import('../../hq-state/refresh')
  refreshHqStateContextDoc(rootPath)
})

afterAll(() => rmSync(rootPath, { recursive: true, force: true }))

describe('HQ state RPC handlers', () => {
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
})

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler({}, ...args)
}

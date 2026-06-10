import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import * as runStorage from '../../../../shared/src/teams/run-storage.ts'
import type { HandlerFn, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

let workspaceRoot = ''

const loadGlobalTeam = mock((slug: string) => (slug === 'engineering-ship-team'
  ? {
      slug,
      metadata: {
        name: 'Engineering Ship Team',
        description: 'Ships features',
        lead: 'system-architect',
        members: [
          { slug: 'coder', role: 'Implementation' },
          { slug: 'reviewer', role: 'Review' },
        ],
        permissionMode: 'ask',
      },
      body: '# Team',
      path: `/tmp/${slug}`,
      source: 'global',
    }
  : null))

mock.module('@craft-agent/shared/teams', () => ({
  ...runStorage,
  loadGlobalTeam,
}))

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const pushCalls: Array<{ channel: string; target: any; args: any[] }> = []

  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, target, ...args) {
      pushCalls.push({ channel, target, args })
    },
    async invokeClient() {
      return undefined
    },
  }

  const sessionManager = {
    getWorkspaces: mock(() => [{ id: 'workspace-1', name: 'Workspace', rootPath: workspaceRoot }]),
    resolveAgentSessionOptions: mock(async () => ({ agentSkillSlugs: ['lead-skill'] })),
    createSession: mock(async () => ({ id: 'lead-session-1' })),
    sendMessage: mock(async () => undefined),
  }

  const deps = {
    sessionManager,
    oauthFlowStore: {},
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
    wsServer: {
      push(channel: string, target: any, ...args: any[]) {
        pushCalls.push({ channel, target, args })
      },
    },
  } as unknown as HandlerDeps

  return { deps, handlers, pushCalls, server, sessionManager }
}

describe('team run RPC handlers', () => {
  beforeEach(() => {
    if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = mkdtempSync(join(tmpdir(), 'team-rpc-'))
    loadGlobalTeam.mockClear()
  })

  it('registers declared channels', async () => {
    const { handlers, server, deps } = createHarness()
    const { HANDLED_CHANNELS, registerTeamRunsHandlers } = await import('./team-runs')
    registerTeamRunsHandlers(server, deps)

    for (const channel of HANDLED_CHANNELS) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('starts a team run with a lead session and initial prompt', async () => {
    const { handlers, server, deps, pushCalls, sessionManager } = createHarness()
    const { registerTeamRunsHandlers } = await import('./team-runs')
    registerTeamRunsHandlers(server, deps)

    const detail = await handlers.get(RPC_CHANNELS.teamRuns.START)!({} as any, 'workspace-1', {
      teamSlug: 'engineering-ship-team',
      userRequest: 'Ship Teams runtime.',
    })

    expect(detail.teamSlug).toBe('engineering-ship-team')
    expect(detail.state).toBe('running')
    expect(detail.leadSessionId).toBe('lead-session-1')
    expect(detail.events.map((event: any) => event.kind)).toContain('run.created')
    expect(detail.events.map((event: any) => event.kind)).toContain('session.linked')
    expect(sessionManager.createSession).toHaveBeenCalled()
    const sendMessageCalls = sessionManager.sendMessage.mock.calls as unknown as Array<[string, string]>
    expect(sendMessageCalls[0]![0]).toBe('lead-session-1')
    expect(sendMessageCalls[0]![1]).toContain('Team run id:')
    expect(pushCalls.at(-1)?.channel).toBe(RPC_CHANNELS.teamRuns.UPDATED)
  })

  it('creates and updates tasks through run detail responses', async () => {
    const { handlers, server, deps } = createHarness()
    const { registerTeamRunsHandlers } = await import('./team-runs')
    registerTeamRunsHandlers(server, deps)

    const started = await handlers.get(RPC_CHANNELS.teamRuns.START)!({} as any, 'workspace-1', {
      teamSlug: 'engineering-ship-team',
      userRequest: 'Build a thing.',
    })

    const withTask = await handlers.get(RPC_CHANNELS.teamRuns.CREATE_TASK)!({} as any, 'workspace-1', started.id, {
      title: 'Implement',
      description: 'Code it',
      ownerAgentSlug: 'coder',
    })
    expect(withTask.tasks).toHaveLength(1)

    const completed = await handlers.get(RPC_CHANNELS.teamRuns.UPDATE_TASK)!({} as any, 'workspace-1', started.id, withTask.tasks[0]!.id, {
      status: 'done',
      output: 'Done',
    })
    expect(completed.state).toBe('done')
    expect(completed.tasks[0]!.output).toBe('Done')
  })

  it('marks team messages read and broadcasts the updated detail', async () => {
    const { handlers, server, deps, pushCalls } = createHarness()
    const { registerTeamRunsHandlers } = await import('./team-runs')
    registerTeamRunsHandlers(server, deps)

    const started = await handlers.get(RPC_CHANNELS.teamRuns.START)!({} as any, 'workspace-1', {
      teamSlug: 'engineering-ship-team',
      userRequest: 'Coordinate work.',
    })
    await handlers.get(RPC_CHANNELS.teamRuns.SEND_MESSAGE)!({} as any, 'workspace-1', started.id, {
      fromAgentSlug: 'system-architect',
      toAgentSlug: 'coder',
      kind: 'assignment',
      body: 'Take this task.',
    })

    const updated = await handlers.get(RPC_CHANNELS.teamRuns.MARK_MESSAGES_READ)!({} as any, 'workspace-1', started.id, 'coder')
    expect(updated.messages[0]!.readAt).toBeString()
    expect(pushCalls.at(-1)?.channel).toBe(RPC_CHANNELS.teamRuns.UPDATED)
    expect(pushCalls.at(-1)?.args[2]).toBe('updated')
  })
})

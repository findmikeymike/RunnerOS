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

  it('blocks raw task work but allows user approval decisions', async () => {
    const { handlers, server, deps } = createHarness()
    const { registerTeamRunsHandlers } = await import('./team-runs')
    registerTeamRunsHandlers(server, deps)

    const started = await handlers.get(RPC_CHANNELS.teamRuns.START)!({} as any, 'workspace-1', {
      teamSlug: 'engineering-ship-team',
      userRequest: 'Build a thing.',
    })

    await expect(handlers.get(RPC_CHANNELS.teamRuns.CREATE_TASK)!({} as any, 'workspace-1', started.id, {
      title: 'Implement',
      description: 'Code it',
      ownerAgentSlug: 'coder',
    })).rejects.toThrow('Team tasks must be created by the lead')

    const task = runStorage.createTeamTask(workspaceRoot, started.id, {
      title: 'Publish',
      description: 'Publish customer-facing update',
      ownerAgentSlug: 'coder',
      approvalRequired: true,
    })
    runStorage.updateTeamTask(workspaceRoot, started.id, task.id, {
      status: 'blocked',
      approval: {
        requestedAt: '2026-01-01T00:00:00.000Z',
        requestedByAgentSlug: 'coder',
        reason: 'Publish customer-facing update',
        status: 'requested',
      },
      blockedReason: 'Awaiting approval',
    })

    await expect(handlers.get(RPC_CHANNELS.teamRuns.UPDATE_TASK)!({} as any, 'workspace-1', started.id, task.id, {
      status: 'done',
      output: 'Done',
    })).rejects.toThrow('Teams UI can only decide user approval requests')

    const approved = await handlers.get(RPC_CHANNELS.teamRuns.UPDATE_TASK)!({} as any, 'workspace-1', started.id, task.id, {
      status: 'in_progress',
      approval: {
        requestedAt: '2026-01-01T00:00:00.000Z',
        requestedByAgentSlug: 'coder',
        reason: 'Publish customer-facing update',
        status: 'approved',
        decidedAt: '2026-01-01T00:01:00.000Z',
      },
    })
    expect(approved.tasks[0]!.approval?.status).toBe('approved')
  })

  it('blocks raw internal message spoofing from the UI RPC surface', async () => {
    const { handlers, server, deps } = createHarness()
    const { registerTeamRunsHandlers } = await import('./team-runs')
    registerTeamRunsHandlers(server, deps)

    const started = await handlers.get(RPC_CHANNELS.teamRuns.START)!({} as any, 'workspace-1', {
      teamSlug: 'engineering-ship-team',
      userRequest: 'Coordinate work.',
    })

    await expect(handlers.get(RPC_CHANNELS.teamRuns.SEND_MESSAGE)!({} as any, 'workspace-1', started.id, {
      fromAgentSlug: 'system-architect',
      toAgentSlug: 'coder',
      kind: 'assignment',
      body: 'Take this task.',
    })).rejects.toThrow('Team messages are internal')

    await expect(handlers.get(RPC_CHANNELS.teamRuns.MARK_MESSAGES_READ)!({} as any, 'workspace-1', started.id, 'coder'))
      .rejects.toThrow('read state belongs to team agents')
  })
})

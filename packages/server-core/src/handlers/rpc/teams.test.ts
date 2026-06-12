import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import * as runStorage from '../../../../shared/src/teams/run-storage.ts'
import type { HandlerFn, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const loadAllGlobalTeams = mock(() => [])
const loadGlobalTeam = mock((slug: string) => (slug === 'commerce-launch-team'
  ? {
      slug,
      metadata: {
        name: 'Commerce Launch Team',
        description: 'Launch products with checks.',
        lead: 'head-of-biz',
        members: [{ slug: 'reviewer', role: 'Review' }],
      },
      body: '# Team',
      path: `/tmp/${slug}`,
      source: 'global',
    }
  : null))
const writeGlobalTeam = mock((input: any) => ({
  slug: input.slug,
  metadata: input.metadata,
  body: input.body,
  path: `/tmp/${input.slug}`,
  source: 'global',
}))
const deleteGlobalTeam = mock((slug: string) => slug === 'commerce-launch-team')
let workspaceRoot = ''

mock.module('@craft-agent/shared/teams', () => ({
  ...runStorage,
  deleteGlobalTeam,
  loadAllGlobalTeams,
  loadGlobalTeam,
  writeGlobalTeam,
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

  return { handlers, pushCalls, server }
}

const deps = {
  sessionManager: {
    getWorkspaces: () => [{ id: 'workspace-1', name: 'Workspace', rootPath: workspaceRoot }],
  },
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
    push() {},
  },
} as unknown as HandlerDeps

describe('teams RPC handlers', () => {
  beforeEach(() => {
    if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = mkdtempSync(join(tmpdir(), 'teams-rpc-'))
    loadAllGlobalTeams.mockClear()
    loadGlobalTeam.mockClear()
    writeGlobalTeam.mockClear()
    deleteGlobalTeam.mockClear()
  })

  it('registers declared channels', async () => {
    const { handlers, server } = createHarness()
    const { HANDLED_CHANNELS, registerTeamsHandlers } = await import('./teams')
    registerTeamsHandlers(server, deps)

    for (const channel of HANDLED_CHANNELS) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('lists and gets teams', async () => {
    const { handlers, server } = createHarness()
    const { registerTeamsHandlers } = await import('./teams')
    registerTeamsHandlers(server, deps)

    await handlers.get(RPC_CHANNELS.teams.LIST_ALL)!({} as any)
    expect(loadAllGlobalTeams).toHaveBeenCalled()

    const got = await handlers.get(RPC_CHANNELS.teams.GET)!({} as any, 'commerce-launch-team')
    expect(got?.slug).toBe('commerce-launch-team')
  })

  it('upserts and deletes teams with change broadcast', async () => {
    const { handlers, server } = createHarness()
    const pushed: any[] = []
    const localDeps = {
      ...deps,
      wsServer: { push: (...args: any[]) => pushed.push(args) },
    } as unknown as HandlerDeps
    const { registerTeamsHandlers } = await import('./teams')
    registerTeamsHandlers(server, localDeps)

    const upserted = await handlers.get(RPC_CHANNELS.teams.UPSERT)!({} as any, {
      slug: 'commerce-launch-team',
      metadata: {
        name: 'Commerce Launch Team',
        description: 'Launch products with checks.',
        lead: 'head-of-biz',
        members: [{ slug: 'reviewer', role: 'Review' }],
      },
      body: '# Team',
    })

    expect(upserted.slug).toBe('commerce-launch-team')
    expect(writeGlobalTeam).toHaveBeenCalled()
    expect(pushed[0]?.[0]).toBe(RPC_CHANNELS.teams.CHANGED)

    const deleted = await handlers.get(RPC_CHANNELS.teams.DELETE)!({} as any, 'commerce-launch-team')
    expect(deleted).toBe(true)
    expect(deleteGlobalTeam).toHaveBeenCalledWith('commerce-launch-team')
    expect(pushed[1]?.[0]).toBe(RPC_CHANNELS.teams.CHANGED)
  })

  it('blocks deleting a team with active runs', async () => {
    const { handlers, server } = createHarness()
    const { registerTeamsHandlers } = await import('./teams')
    registerTeamsHandlers(server, deps)
    runStorage.writeTeamRun(workspaceRoot, {
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: 'workspace-1',
      teamSlug: 'commerce-launch-team',
      state: 'running',
      userRequest: 'Keep working.',
      teamSnapshot: {
        metadata: {
          name: 'Commerce Launch Team',
          description: 'Launch products with checks.',
          lead: 'head-of-biz',
          members: [{ slug: 'reviewer', role: 'Review' }],
        },
        body: '# Team',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    await expect(handlers.get(RPC_CHANNELS.teams.DELETE)!({} as any, 'commerce-launch-team'))
      .rejects.toThrow('Cannot delete team')
    expect(deleteGlobalTeam).not.toHaveBeenCalled()
  })
})

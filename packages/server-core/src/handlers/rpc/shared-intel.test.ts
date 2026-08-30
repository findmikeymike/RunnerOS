import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

const loadAllContextDocs = mock(() => [])
const upsertContextDoc = mock(() => undefined)
const loadAllGlobalAgents = mock(() => [
  {
    slug: 'branding-agent',
    metadata: {
      name: 'Branding Agent',
      description: 'Build artist brand DNA, mythology, narrative, tensions, and public expression.',
      tags: ['branding', 'narrative'],
    },
  },
  {
    slug: 'art-director',
    metadata: {
      name: 'Art Director',
      description: 'Cover art, visual world, typography, merch design, photos, and campaign visuals.',
      tags: ['visual-world', 'design'],
      visualAgent: true,
    },
  },
])
const loadActivatedAgents = mock(() => [])
const getWorkspaceByNameOrId = mock(() => ({ id: 'ws-1', name: 'Workspace', rootPath: '/tmp/ws-1' }))
const refreshArtistManagerStateForWorkspaceBestEffort = mock(() => ({ hq: null, campaigns: [] }))

mock.module('@craft-agent/shared/workspace-context', () => ({
  loadAllContextDocs,
  upsertContextDoc,
}))

mock.module('@craft-agent/shared/agent-definitions', () => ({
  loadAllGlobalAgents,
  loadActivatedAgents,
}))

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId,
}))

mock.module('../../hq-state/refresh', () => ({
  refreshArtistManagerStateForWorkspaceBestEffort,
}))

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const pushCalls: Array<{ channel: string; target: unknown; args: unknown[] }> = []

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

function ctx(): RequestContext {
  return {
    clientId: 'c1',
    workspaceId: 'ws-1',
    webContentsId: 1,
  }
}

beforeEach(() => {
  loadAllContextDocs.mockClear()
  upsertContextDoc.mockClear()
  loadAllGlobalAgents.mockClear()
  loadActivatedAgents.mockClear()
  getWorkspaceByNameOrId.mockClear()
  refreshArtistManagerStateForWorkspaceBestEffort.mockClear()
})

describe('shared intel RPC handler', () => {
  it('returns audit counts and route reasons for saved intel', async () => {
    const { handlers, server } = createHarness()
    const { registerSharedIntelHandlers } = await import('./shared-intel')
    const deps = {
      sessionManager: {
        async getSession() {
          return {
            id: 's1',
            workspaceId: 'ws-1',
            messages: [
              { id: 'm1', role: 'user', content: 'Save this campaign visual rule.', timestamp: 1 },
              {
                id: 'm2',
                role: 'assistant',
                content: 'The brand rollout should use premium restraint: stark black-and-white cover art, severe typography, and one recurring visual symbol across campaign assets.',
                timestamp: 2,
              },
            ],
            spawnedFromAgent: { agentSlug: 'legendary-minds', agentName: 'Legendary Minds' },
          }
        },
      },
    } as unknown as HandlerDeps

    registerSharedIntelHandlers(server, deps)
    const share = handlers.get(RPC_CHANNELS.sharedIntel.SHARE)
    if (!share) throw new Error('shared intel handler not registered')

    const result = await share(ctx(), {
      workspaceId: 'ws-1',
      sessionId: 's1',
      agentCatalog: [
        { slug: 'branding-agent', name: 'Branding Agent', tags: ['branding'], active: true },
        { slug: 'art-director', name: 'Art Director', tags: ['visual-world'], visualAgent: true, active: true },
      ],
    })

    expect(result.status).toBe('shared')
    expect(result.audit).toEqual({
      sourceSessionId: 's1',
      sourceAgentSlug: 'legendary-minds',
      created: 1,
      updated: 0,
      skipped: 0,
    })
    expect(result.notes[0]?.routeReasons?.length).toBeGreaterThan(0)
    expect(upsertContextDoc).toHaveBeenCalledTimes(1)
    expect(refreshArtistManagerStateForWorkspaceBestEffort).toHaveBeenCalledWith('/tmp/ws-1')
  })
})

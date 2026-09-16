import { afterEach, expect, mock, test } from 'bun:test'
import { OAuthFlowStore, createPendingFlow } from '@craft-agent/shared/auth'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import * as config from '@craft-agent/shared/config'
import * as sources from '@craft-agent/shared/sources'
import * as workspaces from '@craft-agent/shared/workspaces'

const source = { config: { slug: 'fixture', provider: 'generic' }, workspaceId: 'fixture', folderPath: '/tmp/oauth-fixture' } as any
const monidBuiltin = { config: { slug: 'monid', provider: 'monid', type: 'mcp', mcp: { authType: 'oauth', url: 'https://mcp.monid.ai/v1' } }, workspaceId: 'fixture', folderPath: '', isBuiltin: true, tier: 'project' } as any
const monidGlobal = { ...monidBuiltin, workspaceId: '__global__', folderPath: '/tmp/global/monid', isBuiltin: undefined, tier: 'global' } as any
let globalMonidInstalled = false
const registeredWorkspaces: Array<{ id: string; rootPath: string }> = []
const exchangeAndStore = mock(async (..._args: any[]) => ({ success: true }))
const cancelAuthentication = mock(async (..._args: any[]) => true)
const beginAuthentication = mock(async (..._args: any[]) => { order.push('begin'); return 7 })
const order: string[] = []
const manager = {
  beginAuthentication,
  prepareOAuth: async () => { order.push('prepare'); return { state: 'state', provider: 'generic', authUrl: 'https://example.invalid' } },
  exchangeAndStore,
  cancelAuthentication,
  load: async () => ({ value: 'old-token' }),
  delete: async () => { order.push('delete'); return true },
  disconnectForRevoke: async () => { order.push('delete'); return { superseded: false, deleted: true, credentials: [{ value: 'old-token' }] } },
  markSourceNeedsReauthIfDisconnected: async () => { order.push('status'); return true },
  revokeRemote: async (..._args: any[]) => { order.push('remote') },
}
mock.module('@craft-agent/shared/config', () => ({ ...config,
  getWorkspaceByNameOrId: () => ({ id: 'fixture', rootPath: '/tmp/oauth-fixture' }),
  getWorkspaces: () => registeredWorkspaces,
}))
mock.module('@craft-agent/shared/sources', () => ({ ...sources,
  getSourcesBySlugs: (_root: string, slugs: string[]) => slugs[0] === 'monid' ? [globalMonidInstalled ? monidGlobal : monidBuiltin] : [source],
  loadGlobalSource: (slug: string) => slug === 'monid' && globalMonidInstalled ? monidGlobal : null,
  materializeBuiltinGlobalSource: () => { globalMonidInstalled = true; return monidGlobal },
  loadAllSources: () => [source], getSourceCredentialManager: () => manager,
}))
mock.module('@craft-agent/shared/workspaces', () => ({ ...workspaces, assertTeamPermission: () => {} }))
mock.module('@craft-agent/server-core/transport', () => ({ pushTyped: () => {} }))
const { completeOAuthFlow, registerOAuthHandlers } = await import('./oauth')
const stores: OAuthFlowStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); exchangeAndStore.mockClear(); cancelAuthentication.mockClear(); beginAuthentication.mockClear(); globalMonidInstalled = false; registeredWorkspaces.length = 0; order.length = 0 })

function setup() {
  const store = new OAuthFlowStore(); stores.push(store)
  const handlers = new Map<string, any>()
  const logger = { info() {}, error() {} }
  registerOAuthHandlers({ handle: (name: string, handler: any) => handlers.set(name, handler) } as any,
    { oauthFlowStore: store, platform: { logger }, sessionManager: { reloadSourcesForWorkspace: async () => { order.push('reload') } } } as any)
  return { store, handlers, logger }
}

test('OAuth start records the server sign-in intent before provider preparation', async () => {
  const { store, handlers } = setup()
  await handlers.get(RPC_CHANNELS.oauth.START)({ workspaceId: 'fixture', clientId: 'owner' }, { sourceSlug: 'fixture', authIntentRevision: 99 })
  expect(order).toEqual(['begin', 'prepare'])
  expect(store.getByState('state')?.authIntentRevision).toBe(7)
})

test('Monid OAuth defaults to one global source and credential owner', async () => {
  const { store, handlers } = setup()
  await handlers.get(RPC_CHANNELS.oauth.START)({ workspaceId: 'fixture', clientId: 'owner' }, { sourceSlug: 'monid' })
  expect(globalMonidInstalled).toBe(true)
  expect(beginAuthentication).toHaveBeenCalledWith(monidGlobal)
  expect(store.getByState('state')?.source).toBe(monidGlobal)
  expect(store.getByState('state')?.credentialScope).toBe('global')
})

test('an exchanging OAuth flow stays cancellable without allowing callback replay', async () => {
  const { store, handlers, logger } = setup()
  store.store(createPendingFlow({ flowId: 'flow', state: 'state', source, ownerClientId: 'owner', workspaceId: 'fixture',
    sourceSlug: 'fixture', provider: 'generic', codeVerifier: 'v', redirectUri: 'http://localhost', clientId: 'client',
    tokenEndpoint: 'https://example.invalid/token', authIntentRevision: 7 }))
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  exchangeAndStore.mockImplementationOnce(async () => { started(); await new Promise<void>(resolve => { release = resolve }); return { success: true } })
  const opts = { code: 'code', state: 'state', flowStore: store, credManager: manager,
    sessionManager: { completeAuthRequest: async () => {} }, pushSourcesChanged() {}, logger }
  const completing = completeOAuthFlow(opts)
  try {
    await entered
    expect(exchangeAndStore.mock.calls[0]?.[3]).toEqual({ override: false, authIntentRevision: 7 })
    expect(store.getByState('state')).toBeNull()
    await expect(completeOAuthFlow(opts)).rejects.toThrow('Unknown or expired')
    await handlers.get(RPC_CHANNELS.oauth.CANCEL)({ clientId: 'other' }, { flowId: 'flow', state: 'state' })
    expect(cancelAuthentication).not.toHaveBeenCalled()
    await handlers.get(RPC_CHANNELS.oauth.CANCEL)({ clientId: 'owner' }, { flowId: 'flow', state: 'state' })
    expect(cancelAuthentication).toHaveBeenCalledWith(source, 7)
    expect(store.getForCancellation('state')).toBeNull()
  } finally { release(); await completing }
})


test('revoke detaches runtime before waiting for remote revocation', async () => {
  const { handlers } = setup()
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  const original = manager.revokeRemote
  manager.revokeRemote = async () => { order.push('remote'); started(); await new Promise<void>(resolve => { release = resolve }) }
  const revoking = handlers.get(RPC_CHANNELS.oauth.REVOKE)({ workspaceId: 'fixture' }, 'fixture')
  try {
    await entered
    expect(order).toEqual(['delete', 'status', 'reload', 'remote'])
    order.push('new-sign-in')
    release()
    await revoking
    expect(order.at(-1)).toBe('new-sign-in')
  } finally { release?.(); await revoking; manager.revokeRemote = original }
})

test('Monid revoke targets the global account and reloads every workspace', async () => {
  const { handlers } = setup()
  globalMonidInstalled = true
  registeredWorkspaces.push({ id: 'campaign', rootPath: '/tmp/campaign' })
  let revokedSource: unknown
  const original = manager.disconnectForRevoke
  manager.disconnectForRevoke = async (target?: unknown) => {
    revokedSource = target
    order.push('delete')
    return { superseded: false, deleted: true, credentials: [{ value: 'old-token' }] }
  }
  try {
    await handlers.get(RPC_CHANNELS.oauth.REVOKE)({ workspaceId: 'fixture' }, 'monid')
    expect(revokedSource).toBe(monidGlobal)
    expect(order.filter(step => step === 'reload')).toHaveLength(2)
  } finally {
    manager.disconnectForRevoke = original
  }
})


test('superseded revoke preserves the newer sign-in without claiming disconnect', async () => {
  const { handlers } = setup()
  const original = manager.disconnectForRevoke
  manager.disconnectForRevoke = async () => ({ superseded: true, deleted: false, credentials: [] })
  try {
    const result = await handlers.get(RPC_CHANNELS.oauth.REVOKE)({ workspaceId: 'fixture' }, 'fixture')
    expect(result.success).toBe(false)
    expect(result.error).toContain('newer sign-in was kept')
    expect(order).toEqual([])
  } finally { manager.disconnectForRevoke = original }
})

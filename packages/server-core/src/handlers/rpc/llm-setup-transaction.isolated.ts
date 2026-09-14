import { beforeEach, expect, mock, test } from 'bun:test'
import * as config from '@craft-agent/shared/config'
import * as storage from '@craft-agent/shared/config/storage'
import { getCredentialManager, credentialIdToAccount, type CredentialId, type StoredCredential } from '@craft-agent/shared/credentials'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

let connection: config.LlmConnection
let updateFails = false
let conciergeHandler: (input: any, workspaceId: string, sessionId: string) => Promise<any>
const pushes: any[][] = []
let beforeWrite: (id: CredentialId, value: StoredCredential) => Promise<void> = async () => {}
const records = new Map<string, StoredCredential>()
const manager = getCredentialManager()
const backend = {
  name: 'fixture',
  get: async (id: CredentialId) => records.get(credentialIdToAccount(id)) ?? null,
  set: async (id: CredentialId, value: StoredCredential) => { await beforeWrite(id, value); records.set(credentialIdToAccount(id), value) },
  delete: async (id: CredentialId) => records.delete(credentialIdToAccount(id)),
  list: async () => [],
}
Object.assign(manager, { initialized: true, backends: [backend], writeBackend: backend })
mock.module('@craft-agent/shared/config', () => ({ ...config,
  getLlmConnection: (slug: string) => connection?.slug === slug ? { ...connection } : null,
  getDefaultLlmConnection: () => 'other',
  updateLlmConnection: (_slug: string, updates: Partial<config.LlmConnection>) => {
    if (updateFails) return false
    connection = { ...connection, ...updates }; return true
  },
  addLlmConnection: (next: config.LlmConnection) => { if (updateFails) return false; connection = next; return true },
}))
mock.module('@craft-agent/shared/config/storage', () => ({ ...storage, setSetupDeferred() {} }))
const { registerLlmConnectionsHandlers } = await import('./llm-connections')
function handlers() {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  registerLlmConnectionsHandlers({ handle: (name: string, handler: any) => handlers.set(name, handler), push(...args: any[]) { pushes.push(args) } } as any,
    { platform: { logger: { info() {}, warn() {}, error() {} } }, sessionManager: {
      setLlmConnectionSetupHandler(handler: typeof conciergeHandler) { conciergeHandler = handler },
      reinitializeAuth: async () => config.readStableLlmConnection('fixture', async () => connection),
    } } as any)
  return handlers
}
const id: CredentialId = { type: 'llm_api_key', connectionSlug: 'fixture' }
beforeEach(async () => {
  records.clear(); pushes.length = 0; updateFails = false; beforeWrite = async () => {}
  connection = { slug: 'fixture', name: 'Fixture', providerType: 'pi', piAuthProvider: 'openai', authType: 'api_key', baseUrl: 'https://old.invalid', models: ['pi/model'], defaultModel: 'pi/model', createdAt: 1, modelSelectionMode: 'userDefined3Tier' }
  await manager.set(id, { value: 'old-key' })
})
function setup(extra: object = {}) { return handlers().get(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION)!({}, { slug: 'fixture', credential: 'new-key', baseUrl: 'https://new.invalid', ...extra }) }
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

test('credential storage failure preserves previous endpoint and key', async () => {
  beforeWrite = async (_id, value) => { if (value.value === 'new-key') throw new Error('fixture storage failure') }
  expect((await setup()).success).toBe(false)
  expect(connection.baseUrl).toBe('https://old.invalid')
  expect((await manager.get(id))?.value).toBe('old-key')
})
test('config failure rolls back staged credential', async () => {
  updateFails = true
  expect((await setup()).success).toBe(false)
  expect(connection.baseUrl).toBe('https://old.invalid')
  expect((await manager.get(id))?.value).toBe('old-key')
})
test('second credential failure rolls back first credential', async () => {
  beforeWrite = async (id) => { if (id.type === 'llm_iam') throw new Error('fixture IAM failure') }
  expect((await setup({ iamCredentials: { accessKeyId: 'access', secretAccessKey: 'secret' } })).success).toBe(false)
  expect(connection.baseUrl).toBe('https://old.invalid')
  expect((await manager.get(id))?.value).toBe('old-key')
})
test('rollback cannot replace a newer independent authentication', async () => {
  const entered = gate(), finish = gate()
  beforeWrite = async (id) => { if (id.type === 'llm_iam') { entered.resolve(); await finish.promise; throw new Error('fixture IAM failure') } }
  const pending = setup({ iamCredentials: { accessKeyId: 'access', secretAccessKey: 'secret' } })
  await entered.promise
  await manager.set(id, { value: 'newer-login' })
  finish.resolve()
  expect((await pending).success).toBe(false)
  expect((await manager.get(id))?.value).toBe('newer-login')
})
test('successful setup releases writer before stable auth reads', async () => {
  expect((await setup()).success).toBe(true)
  expect(connection.baseUrl).toBe('https://new.invalid')
  expect((await manager.get(id))?.value).toBe('new-key')
})
test('later setup waits for failed setup rollback then publishes coherent tuple', async () => {
  const entered = gate(), finish = gate()
  beforeWrite = async (id) => { if (id.type === 'llm_iam') { entered.resolve(); await finish.promise; throw new Error('fixture IAM failure') } }
  const first = setup({ iamCredentials: { accessKeyId: 'access', secretAccessKey: 'secret' } })
  await entered.promise
  const second = setup({ credential: 'later-key', baseUrl: 'https://later.invalid' })
  finish.resolve()
  expect((await first).success).toBe(false)
  expect((await second).success).toBe(true)
  expect(connection.baseUrl).toBe('https://later.invalid')
  expect((await manager.get(id))?.value).toBe('later-key')
})

test('SAVE waits for pending credential setup before changing config', async () => {
  const entered = gate(), finish = gate()
  beforeWrite = async (_id, value) => { if (value.value === 'new-key') { entered.resolve(); await finish.promise } }
  const pending = setup()
  await entered.promise
  const saved = handlers().get(RPC_CHANNELS.llmConnections.SAVE)!({}, { ...connection, name: 'Later edit', baseUrl: 'https://later.invalid' })
  expect(connection.name).toBe('Fixture')
  finish.resolve()
  expect((await pending).success).toBe(true)
  expect((await saved).success).toBe(true)
  expect(connection.name).toBe('Later edit')
  expect(connection.baseUrl).toBe('https://later.invalid')
})

test('failed config save removes newly staged credentials when none existed', async () => {
  await manager.delete(id)
  updateFails = true
  expect((await setup()).success).toBe(false)
  expect(await manager.get(id)).toBeNull()
  expect(connection.baseUrl).toBe('https://old.invalid')
})


test('concierge opens existing secure wizard only in originating workspace without claiming success', async () => {
  handlers()
  const result = await conciergeHandler({ action: 'open', slug: 'fixture' }, 'artist-workspace', 'setup-chat')
  expect(result.status).toBe('needs_user_input')
  expect(pushes).toHaveLength(1)
  expect(pushes[0][0]).toBe(RPC_CHANNELS.deeplink.NAVIGATE)
  expect(pushes[0][1]).toEqual({ to: 'workspace', workspaceId: 'artist-workspace' })
  expect(pushes[0][2]).toMatchObject({ view: 'settings/ai', llmSetup: { sessionId: 'setup-chat', slug: 'fixture' } })
  expect(JSON.stringify(pushes)).not.toContain('old-key')
  expect(connection.baseUrl).toBe('https://old.invalid')
})

test('secure setup broadcasts refresh only after committing configuration', async () => {
  expect((await setup()).success).toBe(true)
  expect(pushes.some(args => args[0] === RPC_CHANNELS.llmConnections.CHANGED)).toBe(true)
  pushes.length = 0
  updateFails = true
  expect((await setup()).success).toBe(false)
  expect(pushes.some(args => args[0] === RPC_CHANNELS.llmConnections.CHANGED)).toBe(false)
})


test('concierge reauthentication refuses missing connection instead of creating a duplicate', async () => {
  handlers()
  await expect(conciergeHandler({ action: 'open', slug: 'deleted' }, 'artist-workspace', 'setup-chat')).rejects.toThrow('Connection not found')
  expect(pushes).toHaveLength(0)
})

test('concierge default changes require explicit scope before a provider test or mutation', async () => {
  handlers()
  await expect(conciergeHandler({ action: 'set-default', slug: 'fixture' }, 'artist-workspace', 'setup-chat')).rejects.toThrow('scope explicitly')
  expect(pushes).toHaveLength(0)
  expect(connection.baseUrl).toBe('https://old.invalid')
})

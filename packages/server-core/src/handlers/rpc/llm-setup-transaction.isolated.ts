import { beforeEach, expect, mock, test } from 'bun:test'
import * as config from '@craft-agent/shared/config'
import * as storage from '@craft-agent/shared/config/storage'
import { getCredentialManager, credentialIdToAccount, type CredentialId, type StoredCredential } from '@craft-agent/shared/credentials'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

let connection: config.LlmConnection
let updateFails = false
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
  getLlmConnection: () => connection && { ...connection },
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
  registerLlmConnectionsHandlers({ handle: (name: string, handler: any) => handlers.set(name, handler) } as any,
    { platform: { logger: { info() {}, warn() {}, error() {} } }, sessionManager: {
      reinitializeAuth: async () => config.readStableLlmConnection('fixture', async () => connection),
    } } as any)
  return handlers
}
const id: CredentialId = { type: 'llm_api_key', connectionSlug: 'fixture' }
beforeEach(async () => {
  records.clear(); updateFails = false; beforeWrite = async () => {}
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

import { afterEach, expect, mock, test } from 'bun:test'
import { getCredentialManager, credentialIdToAccount, type CredentialId, type StoredCredential } from '@craft-agent/shared/credentials'
import * as auth from '@craft-agent/shared/auth'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

const records = new Map<string, { id: CredentialId; value: StoredCredential }>()
const backend = {
  name: 'fixture',
  get: async (id: CredentialId) => records.get(credentialIdToAccount(id))?.value ?? null,
  set: async (id: CredentialId, value: StoredCredential) => { records.set(credentialIdToAccount(id), { id, value }) },
  delete: async (id: CredentialId) => records.delete(credentialIdToAccount(id)),
  list: async (filter: Partial<CredentialId>) => [...records.values()].map(item => item.id)
    .filter(id => Object.entries(filter).every(([key, value]) => id[key as keyof CredentialId] === value)),
}
Object.assign(getCredentialManager(), { initialized: true, backends: [backend], writeBackend: backend })
let nextState = 0
let exchange = async () => ({ accessToken: 'fixture', refreshToken: 'refresh', idToken: 'id', expiresAt: 9999999999999 })
let login = async () => ({ access: 'fixture', refresh: 'refresh', expires: 9999999999999 })
mock.module('@craft-agent/shared/auth', () => ({ ...auth,
  prepareChatGptOAuth: () => ({ state: `state-${++nextState}`, codeVerifier: 'fixture', authUrl: 'https://example.invalid' }),
  exchangeChatGptTokens: () => exchange(),
}))
mock.module('@earendil-works/pi-ai/providers/github-copilot', () => ({ githubCopilotProvider: () => ({ auth: { oauth: { login: () => login() } } }) }))
mock.module('@craft-agent/server-core/transport', () => ({ pushTyped() {}, CLIENT_OPEN_EXTERNAL: 'open' }))
const { registerLlmConnectionsHandlers } = await import('./llm-connections')
afterEach(() => records.clear())
function setup() {
  const handlers = new Map<string, any>()
  registerLlmConnectionsHandlers({ handle: (name: string, handler: any) => handlers.set(name, handler) } as any,
    { platform: { logger: { info() {}, warn() {}, error() {} } }, sessionManager: {} } as any)
  return handlers
}
function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

for (const action of ['logout', 'cancel', 'new-sign-in'] as const) {
  test(`ChatGPT callback cannot replay or undo ${action}`, async () => {
    const handlers = setup(), started = gate(), finish = gate()
    const context = { clientId: 'owner' }
    const slug = `chatgpt-${action}`
    exchange = async () => { started.resolve(); await finish.promise; return { accessToken: 'old', refreshToken: 'old-refresh', idToken: 'id', expiresAt: 9999999999999 } }
    const flow = await handlers.get(RPC_CHANNELS.chatgpt.START_OAUTH)(context, slug)
    const args = { ...flow, code: 'fixture' }
    const completing = handlers.get(RPC_CHANNELS.chatgpt.COMPLETE_OAUTH)(context, args)
    try {
      await started.promise
      await expect(handlers.get(RPC_CHANNELS.chatgpt.COMPLETE_OAUTH)(context, args)).rejects.toThrow('Unknown or expired')
      if (action === 'logout') await handlers.get(RPC_CHANNELS.chatgpt.LOGOUT)(context, slug)
      else if (action === 'cancel') await handlers.get(RPC_CHANNELS.chatgpt.CANCEL_OAUTH)(context, { state: flow.state })
      else await handlers.get(RPC_CHANNELS.chatgpt.START_OAUTH)(context, slug)
      finish.resolve()
      expect((await completing).success).toBe(false)
      expect(await getCredentialManager().getLlmOAuth(slug)).toBeNull()
    } finally { finish.resolve(); await completing }
  })
}

for (const action of ['cancel', 'logout'] as const) {
  test(`Copilot completion cannot undo ${action} even if provider ignores abort`, async () => {
    const handlers = setup(), started = gate(), finish = gate()
    const context = { clientId: 'owner' }, slug = `copilot-${action}`
    login = async () => { started.resolve(); await finish.promise; return { access: 'old', refresh: 'old-refresh', expires: 9999999999999 } }
    const completing = handlers.get(RPC_CHANNELS.copilot.START_OAUTH)(context, slug)
    try {
      await started.promise
      await handlers.get(action === 'cancel' ? RPC_CHANNELS.copilot.CANCEL_OAUTH : RPC_CHANNELS.copilot.LOGOUT)(context, slug)
      finish.resolve()
      expect((await completing).success).toBe(false)
      expect(await getCredentialManager().getLlmOAuth(slug)).toBeNull()
    } finally { finish.resolve(); await completing }
  })
}

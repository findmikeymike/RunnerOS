import { afterEach, expect, mock, test } from 'bun:test'
import { getCredentialManager, credentialIdToAccount, type CredentialId, type StoredCredential } from '@craft-agent/shared/credentials'
import * as auth from '@craft-agent/shared/auth'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

// Run in isolation: exercises the real onboarding Claude exchange handler and
// the real CredentialManager revision machinery against a fixture backend.
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
let exchange = async () => ({ accessToken: 'exchanged-access', refreshToken: 'exchanged-refresh', expiresAt: Date.now() + 3_600_000, scopes: [] as string[] })
mock.module('@craft-agent/shared/auth', () => ({
  ...auth,
  hasValidOAuthState: () => true,
  exchangeClaudeCode: () => exchange(),
}))
const { registerOnboardingHandlers } = await import('./onboarding.ts')
afterEach(() => records.clear())

function setup() {
  const handlers = new Map<string, any>()
  registerOnboardingHandlers({ handle: (name: string, handler: any) => handlers.set(name, handler) } as any,
    { platform: { logger: { info() {}, warn() {}, error() {} } } } as any)
  return handlers
}

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('a successful exchange commits both records as an admitted sign-in', async () => {
  const handlers = setup()
  const manager = getCredentialManager()
  const slug = 'claude-max'
  const before = await manager.captureSnapshot({ type: 'llm_oauth', connectionSlug: slug })
  const result = await handlers.get(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE)({}, 'code', slug)
  expect(result.success).toBe(true)
  expect((await manager.getLlmOAuth(slug))?.accessToken).toBe('exchanged-access')
  expect((await manager.getClaudeOAuthCredentials())?.accessToken).toBe('exchanged-access')
  const after = await manager.captureSnapshot({ type: 'llm_oauth', connectionSlug: slug })
  expect(after.authRevision).toBeGreaterThan(before.authRevision)
})

test('a delayed exchange cannot clobber a newer sign-in', async () => {
  const handlers = setup()
  const manager = getCredentialManager()
  const slug = 'claude-max'
  const started = gate(), release = gate()
  exchange = async () => { started.resolve(); await release.promise; return { accessToken: 'delayed-access', refreshToken: 'delayed-refresh', expiresAt: Date.now() + 3_600_000, scopes: [] } }
  const exchanging = handlers.get(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE)({}, 'code', slug)
  await started.promise
  await manager.setLlmOAuth(slug, { accessToken: 'newer-sign-in', refreshToken: 'newer-refresh', expiresAt: Date.now() + 3_600_000 })
  release.resolve()
  const result = await exchanging
  expect(result.success).toBe(false)
  expect((await manager.getLlmOAuth(slug))?.accessToken).toBe('newer-sign-in')
  expect(await manager.getClaudeOAuthCredentials()).toBeNull()
})

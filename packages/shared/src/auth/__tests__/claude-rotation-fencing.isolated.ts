import { afterEach, expect, mock, test } from 'bun:test'
import { getCredentialManager, credentialIdToAccount, type CredentialId, type StoredCredential } from '../../credentials/index.ts'
import * as claudeToken from '../claude-token.ts'

// Run in isolation: exercises the real CredentialManager revision machinery and
// the real rotation fencing in auth/state.ts against a fixture backend.
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

let refresh: () => Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> = async () => ({
  accessToken: 'rotated-access', refreshToken: 'rotated-refresh', expiresAt: Date.now() + 3_600_000,
})
mock.module('../claude-token.ts', () => ({ ...claudeToken, refreshClaudeToken: () => refresh() }))
const { getValidClaudeOAuthToken, performTokenRefresh } = await import('../state.ts')

afterEach(() => records.clear())

function seed() {
  const manager = getCredentialManager()
  const slug = 'claude-max'
  void manager.setClaudeOAuthCredentials({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, source: 'native' })
  void manager.setLlmOAuth(slug, { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1 })
  return { manager, slug }
}

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('a routine rotation applies while ownership is unchanged and never reclassifies the sign-in', async () => {
  const { manager, slug } = seed()
  const before = await manager.captureSnapshot({ type: 'llm_oauth', connectionSlug: slug })
  const result = await getValidClaudeOAuthToken(slug)
  expect(result.accessToken).toBe('rotated-access')
  const stored = await manager.getLlmOAuth(slug)
  expect(stored?.accessToken).toBe('rotated-access')
  const global = await manager.getClaudeOAuthCredentials()
  expect(global?.accessToken).toBe('rotated-access')
  // A rotation must not bump the auth revision: disconnect logic distinguishes
  // newer sign-ins from routine rotation through that revision.
  const after = await manager.captureSnapshot({ type: 'llm_oauth', connectionSlug: slug })
  expect(after.authRevision).toBe(before.authRevision)
})

test('a newer sign-in that lands during a delayed refresh is not clobbered', async () => {
  const { manager, slug } = seed()
  const started = gate(), release = gate()
  refresh = async () => { started.resolve(); await release.promise; return { accessToken: 'rotated-access', refreshToken: 'rotated-refresh', expiresAt: Date.now() + 3_600_000 } }
  const refreshing = getValidClaudeOAuthToken(slug)
  await started.promise
  await manager.setLlmOAuth(slug, { accessToken: 'newer-sign-in', refreshToken: 'newer-refresh', expiresAt: Date.now() + 3_600_000 })
  release.resolve()
  // The admitted request keeps its refreshed token; storage keeps the newer sign-in.
  expect((await refreshing).accessToken).toBe('rotated-access')
  expect((await manager.getLlmOAuth(slug))?.accessToken).toBe('newer-sign-in')
})

test('an incompatible refresh does not clear credentials a newer sign-in replaced', async () => {
  const { manager, slug } = seed()
  const expectedGlobal = await manager.getClaudeOAuthCredentials()
  const expectedConnection = await manager.getLlmOAuth(slug)
  await manager.setLlmOAuth(slug, { accessToken: 'newer-sign-in', refreshToken: 'newer-refresh', expiresAt: Date.now() + 3_600_000 })
  refresh = async () => { throw new Error('invalid_grant') }
  const result = await performTokenRefresh(manager, 'old-refresh', 'native', slug, expectedGlobal!, expectedConnection)
  expect(result.accessToken).toBeNull()
  expect((await manager.getLlmOAuth(slug))?.accessToken).toBe('newer-sign-in')
})

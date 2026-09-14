import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Real encrypted storage; no provider requests, real keys, or app startup.
const root = mkdtempSync(join(tmpdir(), 'artist-concierge-connection-'))
const previousConfig = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = root
const { SessionManager } = await import('./SessionManager')
const { getSourcesBySlugs, SourceCredentialManager } = await import('@craft-agent/shared/sources')
const { saveSourceCredential } = await import('../handlers/rpc/save-source-credential')
const { createWorkspaceAtPath } = await import('@craft-agent/shared/workspaces')
const workspaceRoot = join(root, 'workspace')
const workspaceConfig = createWorkspaceAtPath(workspaceRoot, 'Concierge Test')
const workspace = { id: workspaceConfig.id, rootPath: workspaceRoot }

function fixture(slug: string) {
  const manager = new SessionManager()
  const runtime = manager as any
  const results: any[] = []
  const changed: string[] = []
  const managed = { id: 'setup', workspace, pendingAuthRequest: {
    type: 'credential', requestId: 'request', sourceSlug: slug, mode: 'bearer',
  } }
  runtime.sessions.set(managed.id, managed)
  runtime.reloadSourcesForWorkspace = async () => { changed.push('reload') }
  runtime.broadcastSourcesChanged = (id: string) => { changed.push(id) }
  runtime.broadcastSecretsChanged = () => { changed.push('secrets') }
  runtime.completeAuthRequest = async (_id: string, result: unknown) => { results.push(result) }
  return { manager, runtime, results, changed, managed }
}

afterAll(() => {
  if (previousConfig === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousConfig
  rmSync(root, { recursive: true, force: true })
})

for (const slug of ['trypost', 'postiz']) {
  test(`${slug}: chat secure entry and Settings share a persistent encrypted credential`, async () => {
    const f = fixture(slug)
    const value = `FAKE_TEST_ONLY_${slug}`
    await f.manager.handleCredentialInput('setup', 'request', { type: 'credential', cancelled: false, value })
    expect(f.results[0]).toMatchObject({ success: true, sourceSlug: slug })
    expect(f.changed).toEqual(['reload', workspace.id, 'secrets'])
    const source = getSourcesBySlugs(workspace.rootPath, [slug])[0]!
    // A fresh credential facade resolves the exact value Settings sees.
    expect((await new SourceCredentialManager().loadEffective(source))?.value).toBe(value)
    await saveSourceCredential(workspace.rootPath, source, `${value}_SETTINGS`)
    expect((await new SourceCredentialManager().loadEffective(source))?.value).toBe(`${value}_SETTINGS`)
    expect(JSON.stringify(f.results)).not.toContain(value)
    expect(readFileSync(join(root, 'credentials.enc')).includes(Buffer.from(value))).toBe(false)
  })
}

test('cancelled or stale forms do not replace the saved credential', async () => {
  const source = getSourcesBySlugs(workspace.rootPath, ['trypost'])[0]!
  await saveSourceCredential(workspace.rootPath, source, 'FAKE_KEEP')
  const f = fixture('trypost')
  await f.manager.handleCredentialInput('setup', 'old-request', { type: 'credential', cancelled: false, value: 'FAKE_REPLACE' })
  expect(f.results).toHaveLength(0)
  await f.manager.handleCredentialInput('setup', 'request', { type: 'credential', cancelled: true })
  expect(f.results[0]).toMatchObject({ cancelled: true, success: false })
  expect(f.changed).toEqual([])
  expect((await new SourceCredentialManager().loadEffective(source))?.value).toBe('FAKE_KEEP')
})

test('empty credentials and missing sources fail without a success broadcast', async () => {
  for (const [slug, value] of [['trypost', ''], ['missing-setup-source', 'FAKE']]) {
    const f = fixture(slug!)
    await f.manager.handleCredentialInput('setup', 'request', { type: 'credential', cancelled: false, value })
    expect(f.results[0]).toMatchObject({ success: false })
    expect(f.changed).toEqual([])
  }
})

test('saved credential feedback does not claim the provider was authenticated', () => {
  const f = fixture('trypost')
  expect(f.runtime.formatAuthResultMessage({ success: true, sourceSlug: 'trypost' }, true)).toContain('Run source_test')
  expect(f.runtime.formatAuthResultMessage({ success: true, sourceSlug: 'trypost' }, true)).not.toContain('Authentication completed')
})

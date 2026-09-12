import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: exercises real SessionManager source methods and disk source
// selection with only transport construction deferred. No providers or app startup.
const root = mkdtempSync(join(tmpdir(), 'artist-source-lifecycle-'))
const previousConfig = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = root
const { SessionManager } = await import('./SessionManager.ts')
const { createSource, deleteSource, getSourceServerBuilder } = await import('@craft-agent/shared/sources')
const { McpClientPool } = await import('@craft-agent/shared/mcp/mcp-pool')
const builder = getSourceServerBuilder()
let buildSpy: ReturnType<typeof spyOn> | undefined
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const response = (slugs: string[]) => ({
  mcpServers: Object.fromEntries(slugs.map(slug => [slug, { type: 'http', url: `https://${slug}.invalid` }])),
  apiServers: {}, errors: [],
})
let sequence = 0
async function fixture() {
  const workspace = { id: `workspace-${++sequence}`, rootPath: join(root, `workspace-${sequence}`) }
  mkdirSync(workspace.rootPath)
  const source = await createSource(workspace.rootPath, {
    name: 'Service', type: 'mcp', provider: 'custom', enabled: true,
    mcp: { transport: 'http', url: 'https://example.invalid', authType: 'none' },
  })
  const applied: string[][] = []
  const events: unknown[] = []
  const agent = {
    getSummarizeCallback: () => undefined,
    setAllSources: () => {},
    setSourceServers: async (servers: Record<string, unknown>) => { applied.push(Object.keys(servers)) },
    applyBridgeUpdates: async () => {},
  }
  const managed = { id: `session-${sequence}`, workspace, agent, enabledSourceSlugs: [source.slug], isProcessing: true }
  const manager = new SessionManager()
  const runtime = manager as any
  runtime.sessions.set(managed.id, managed)
  runtime.persistSession = () => {}
  runtime.sendEvent = (event: unknown) => { events.push(event) }
  return { manager, runtime, managed, source, applied, events }
}
afterEach(() => buildSpy?.mockRestore())
afterAll(() => {
  if (previousConfig === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousConfig
  rmSync(root, { recursive: true, force: true })
})

test('a delayed selection build cannot restore a newer disabled selection or emit stale success', async () => {
  const f = await fixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  buildSpy = spyOn(builder, 'buildAll').mockImplementation(async sources => {
    const slugs = sources.map(entry => entry.source.config.slug)
    if (slugs.length) { entered.resolve(); await release.promise }
    return response(slugs) as any
  })
  const older = f.manager.setSessionSources(f.managed.id, [f.source.slug])
  await entered.promise
  await f.manager.setSessionSources(f.managed.id, [])
  release.resolve()
  await older
  expect(f.managed.enabledSourceSlugs).toEqual([])
  expect(f.applied).toEqual([[]])
  expect(f.events).toHaveLength(1)
})

test('workspace reload includes a processing session and a late older reload cannot revive a deleted source', async () => {
  const f = await fixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  buildSpy = spyOn(builder, 'buildAll').mockImplementation(async sources => {
    const slugs = sources.map(entry => entry.source.config.slug)
    if (slugs.length) { entered.resolve(); await release.promise }
    return response(slugs) as any
  })
  const older = f.runtime.reloadSourcesForWorkspace(f.managed.workspace.rootPath)
  await entered.promise
  deleteSource(f.managed.workspace.rootPath, f.source.slug)
  await f.runtime.reloadSourcesForWorkspace(f.managed.workspace.rootPath)
  release.resolve()
  await older
  expect(f.applied).toEqual([[]])
})

test('disconnect detaches a processing session immediately while its admitted request returns the original receipt', async () => {
  const f = await fixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  let closed = 0
  class Pool extends McpClientPool {
    async seed() {
      await this.registerClient(f.source.slug, {
        listTools: async () => [{ name: 'send', inputSchema: { type: 'object' } }],
        callTool: async () => { entered.resolve(); await release.promise; return { content: [{ type: 'text', text: 'original receipt' }] } },
        close: async () => { closed++ },
      })
    }
  }
  const pool = new Pool()
  ;(f.managed as any).mcpPool = pool
  await pool.seed()
  buildSpy = spyOn(builder, 'buildAll').mockImplementation(async sources => response(sources.map(entry => entry.source.config.slug)) as any)
  const call = pool.callTool(`mcp__${f.source.slug}__send`, {})
  await entered.promise
  deleteSource(f.managed.workspace.rootPath, f.source.slug)
  await f.runtime.reloadSourcesForWorkspace(f.managed.workspace.rootPath)
  expect(pool.getConnectedSlugs()).toEqual([])
  expect(closed).toBe(0)
  expect((await pool.callTool(`mcp__${f.source.slug}__send`, {})).isError).toBe(true)
  release.resolve()
  expect((await call).content).toBe('original receipt')
  expect(closed).toBe(1)
})

test('a failed older build cannot roll back a newer selection', async () => {
  const f = await fixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  buildSpy = spyOn(builder, 'buildAll').mockImplementation(async sources => {
    if (sources.length) {
      entered.resolve()
      await release.promise
      return { ...response([]), errors: [{ sourceSlug: f.source.slug, error: 'Transport unavailable' }] } as any
    }
    return response([]) as any
  })
  const older = f.manager.setSessionSources(f.managed.id, [f.source.slug])
  await entered.promise
  await f.manager.setSessionSources(f.managed.id, [])
  release.resolve()
  await older
  expect(f.managed.enabledSourceSlugs).toEqual([])
  expect(f.events).toHaveLength(1)
  expect(f.applied).toEqual([[]])
})

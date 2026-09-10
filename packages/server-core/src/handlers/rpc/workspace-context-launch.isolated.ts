import { afterAll, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { upsertContextDoc } from '@craft-agent/shared/workspace-context'

const root = mkdtempSync(join(tmpdir(), 'launch-rpc-'))
const workspace = { id: 'launch-rpc-fixture', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' as const }
const config = await import('@craft-agent/shared/config')
const realLookup = config.getWorkspaceByNameOrId
mock.module('@craft-agent/shared/config', () => ({
  ...config,
  getWorkspaceByNameOrId: (id: string) => id === workspace.id ? workspace : realLookup(id),
}))
const { registerWorkspaceContextHandlers } = await import('./workspace-context')
const handlers = new Map<string, (...args: any[]) => any>()
registerWorkspaceContextHandlers({ handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as any, {} as any)
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('chat launch refreshes stale verified documents before returning context', async () => {
  for (const slug of ['mission-assets', 'release-kit']) {
    upsertContextDoc(root, { slug, metadata: { name: slug, enabled: true, delivery: 'always', routing: { mode: 'broadcast' } }, body: `STALE-CANON-${slug}` })
  }
  const docs = await handlers.get(RPC_CHANNELS.workspaceContext.LIST_FOR_AGENT)!({}, workspace.id, 'writer')
  expect(JSON.stringify(docs)).not.toContain('STALE-CANON')
})

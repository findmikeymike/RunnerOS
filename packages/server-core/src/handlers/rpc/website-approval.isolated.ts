import { afterAll, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
const profile = mkdtempSync(join(tmpdir(), 'website-approval-rpc-'))
process.env.CRAFT_CONFIG_DIR = profile
const root = join(profile, 'workspace')
const config = await import('@craft-agent/shared/config')
const teams = await import('@craft-agent/shared/workspaces')
const { defaultWebsiteManifest, saveWebsiteManifest, loadWebsiteManifest } = await import('@craft-agent/shared/website')
const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol')
mock.module('@craft-agent/shared/config', () => ({ ...config, getWorkspaceByNameOrId: () => ({ id: 'hq', rootPath: root }) }))
mock.module('@craft-agent/shared/workspaces', () => ({ ...teams, getTeamModeStatus: () => ({ machine: { machineId: 'owner' } }) }))
const { WebsiteService } = await import('../../website/WebsiteService')
const { approveWebsiteBuild } = await import('../../website/publish')
const { registerWebsiteHandlers } = await import('./website')
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
registerWebsiteHandlers({ handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as RpcServer, {} as HandlerDeps)
afterAll(() => { rmSync(profile, { recursive: true, force: true }) })

test('a refused older RPC preserves newer approval and passes its full issued binding', async () => {
  saveWebsiteManifest(root, defaultWebsiteManifest())
  let captured: unknown
  let replacement: ReturnType<typeof loadWebsiteManifest>
  const deploy = spyOn(WebsiteService.prototype, 'deploy').mockImplementation(async (_root, _input, context) => {
    captured = context.approval
    expect(context.approval).toEqual(loadWebsiteManifest(root)!.pendingApproval)
    expect(context.approval?.expiresAt).toBeDefined()
    replacement = approveWebsiteBuild(root, 'hash-a', { now: '2099-01-01T00:00:00.000Z' })
    return { ok: false, error: 'Older publish refused' }
  })
  try {
    const result = await handlers.get(RPC_CHANNELS.website.PUBLISH)!({}, 'hq', { buildHash: 'hash-a' })
    expect(result).toMatchObject({ ok: false })
    expect(captured).toBeDefined()
    expect(loadWebsiteManifest(root)!.pendingApproval).toEqual(replacement!.pendingApproval)
  } finally { deploy.mockRestore() }
})

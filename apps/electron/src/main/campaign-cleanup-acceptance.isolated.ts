import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Workspace } from '@craft-agent/core/types'

// This file runs in its own Bun process: config constants must capture only this profile.
const root = mkdtempSync(join(realpathSync(tmpdir()), 'campaign-cleanup-acceptance-'))
const previousConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = join(root, 'profile')
mkdirSync(process.env.CRAFT_CONFIG_DIR)
const config = await import('@craft-agent/shared/config')
const { createCampaignCleanupController } = await import('./campaign-cleanup')
const { emptyArtistVaultManifest, loadArtistVaultManifest } = await import('@craft-agent/shared/artist-vault')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir
})

function write(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

test('real confirmed cleanup preserves binary media and cross-vault links before removing registration and journal', async () => {
  expect(config.CONFIG_DIR).toBe(join(root, 'profile'))
  const makeWorkspace = (id: string, scope: Workspace['artistWorkspaceScope']): Workspace => {
    const rootPath = join(root, id)
    write(join(rootPath, 'config.json'), JSON.stringify({ id, name: id, createdAt: 1, storage: { mode: 'solo', portabilityVersion: 1 } }))
    return { id, slug: id, name: id, rootPath, artistWorkspaceScope: scope, createdAt: 1 }
  }
  const campaign = makeWorkspace('acceptance-campaign', 'campaign')
  const hq = makeWorkspace('acceptance-hq', 'hq')
  const lab = makeWorkspace('acceptance-lab', 'lab')
  config.saveConfig({ workspaces: [campaign, hq, lab], activeWorkspaceId: campaign.id, activeSessionId: null })
  const media = Buffer.alloc(4 * 1024 * 1024 + 333)
  for (let index = 0; index < media.length; index++) media[index] = index % 251
  const masterPath = join(campaign.rootPath, 'sessions/one/attachments/master.wav')
  write(masterPath, media)
  write(join(campaign.rootPath, 'sessions/one/disposable.txt'), 'working notes')
  write(join(hq.rootPath, 'sentinel.txt'), 'HQ untouched')
  write(join(lab.rootPath, 'sentinel.txt'), 'Lab untouched')
  const external = join(root, 'external', 'original.wav')
  write(external, Buffer.from([0, 255, 8, 13]))
  write(join(campaign.rootPath, 'assets/manifest.json'), JSON.stringify({
    version: 1, workspaceId: campaign.id, files: [{ absolutePath: external }],
  }))
  const bundlePath = join(campaign.rootPath, 'project')
  write(join(bundlePath, 'index.html'), '<link rel="stylesheet" href="styles.css"><h1>Release</h1>')
  write(join(bundlePath, 'styles.css'), 'h1 { color: red }')
  for (const workspace of [hq, lab]) {
    const manifest = emptyArtistVaultManifest(workspace.id)
    manifest.assets.push({
      id: 'master', label: 'Private master', category: 'music', kind: 'master-final',
      absolutePath: masterPath, source: 'linked-file', status: 'approved', rightsStatus: 'private',
      usableByAgents: false, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    })
    if (workspace.id === lab.id) manifest.assets.push({
      id: 'site', label: 'Release website', category: 'campaigns', kind: 'release-asset',
      absolutePath: bundlePath, source: 'linked-folder', status: 'approved', rightsStatus: 'private',
      usableByAgents: false, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    })
    write(join(workspace.rootPath, 'vault/manifest.json'), JSON.stringify(manifest))
  }
  const calls: string[] = []
  const controller = createCampaignCleanupController({
    runtime: {
      quiesceCampaignForDeletion: async workspaceId => {
        calls.push('quiesce')
        return { workspaceId, sourceRootPath: campaign.rootPath, released: false }
      },
      resumeWorkspaceAfterMigration: async () => { calls.push('resume') },
      disposeCampaignSessions: async () => { calls.push('dispose') },
      finishCampaignDeletion: () => { calls.push('finish') },
    },
    stopMessaging: async () => { calls.push('stop-messaging') },
    resumeMessaging: async () => { calls.push('resume-messaging') },
    clearPrivateState: async () => { calls.push('clear-private') },
    onDeleted: () => { calls.push('notify') },
  })
  const preview = await controller.preview(campaign.id)
  expect(preview.retainedBytes).toBeGreaterThan(media.length)
  expect(preview.retainedFiles.some(file => file.relativePath.endsWith('master.wav'))).toBe(true)
  const result = await controller.delete(campaign.id, preview.previewToken)
  expect(result.warnings).toEqual([])
  expect(calls).toEqual(['quiesce', 'stop-messaging', 'dispose', 'finish', 'clear-private', 'notify'])
  expect(existsSync(campaign.rootPath)).toBe(false)
  const stored = config.loadStoredConfig()!
  expect(stored.workspaces.map(workspace => workspace.id)).toEqual([hq.id, lab.id])
  expect(stored.activeWorkspaceId).toBe(hq.id)
  expect(readdirSync(join(config.CONFIG_DIR, 'campaign-cleanup-transactions'))).toEqual([])
  expect(readdirSync(root).some(name => name.includes('.artist-os-delete-'))).toBe(false)
  const hqMaster = loadArtistVaultManifest(hq.rootPath, hq.id).assets.find(asset => asset.id === 'master')!
  expect(readFileSync(join(hq.rootPath, hqMaster.relativePath!))).toEqual(media)
  const labVault = loadArtistVaultManifest(lab.rootPath, lab.id)
  const labMaster = labVault.assets.find(asset => asset.id === 'master')!
  expect(readFileSync(labMaster.absolutePath!)).toEqual(media)
  expect(labMaster.rightsStatus).toBe('private')
  expect(labMaster.usableByAgents).toBe(false)
  const site = labVault.assets.find(asset => asset.id === 'site')!
  expect(readFileSync(join(site.absolutePath!, 'index.html'), 'utf8')).toContain('href="styles.css"')
  expect(readFileSync(join(site.absolutePath!, 'styles.css'), 'utf8')).toBe('h1 { color: red }')
  expect(readFileSync(join(hq.rootPath, 'sentinel.txt'), 'utf8')).toBe('HQ untouched')
  expect(readFileSync(join(lab.rootPath, 'sentinel.txt'), 'utf8')).toBe('Lab untouched')
  expect(readFileSync(external)).toEqual(Buffer.from([0, 255, 8, 13]))
})

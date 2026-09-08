import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Workspace } from '@craft-agent/core/types'
import { createCampaignCleanupController, resolveCampaignCleanup } from './campaign-cleanup'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'campaign-delete-'))
  roots.push(root)
  const make = (id: string, scope: 'campaign' | 'hq', path = join(root, id)): Workspace => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'config.json'), JSON.stringify({ id, name: id, createdAt: 1, storage: { mode: 'solo', portabilityVersion: 1 } }))
    return { id, slug: id, name: id, rootPath: path, artistWorkspaceScope: scope, createdAt: 1 }
  }
  const campaign = make('campaign', 'campaign')
  const hq = make('hq', 'hq')
  return { root, campaign, hq, make }
}
function setup(overrides: Record<string, unknown> = {}) {
  const { root, campaign, hq } = fixture()
  const calls: string[] = []
  const lease = { workspaceId: campaign.id, sourceRootPath: campaign.rootPath, released: false }
  const result = { workspaceId: campaign.id, hqWorkspaceId: hq.id, retainedFileCount: 2, retainedMemoryCount: 1, pastReleaseLabel: 'Past Releases / campaign' }
  const deps = {
    workspaces: () => [campaign, hq],
    runtime: {
      quiesceCampaignForDeletion: async () => { calls.push('quiesce'); return lease },
      resumeWorkspaceAfterMigration: async () => { calls.push('resume') },
      disposeCampaignSessions: async () => { calls.push('dispose-sessions') },
      finishCampaignDeletion: () => { calls.push('finish') },
    },
    stopMessaging: async () => { calls.push('stop-messaging') },
    resumeMessaging: async () => { calls.push('resume-messaging') },
    preserve: async () => { calls.push('preserve'); return result },
    preview: () => ({ workspaceId: campaign.id, campaignName: campaign.name, previewToken: 'fresh', retainedFileCount: 2, retainedBytes: 100, retainedMemoryCount: 1, retainedFiles: [], deletedFileCount: 4, warnings: [] }),
    clearPrivateState: async () => { calls.push('clear-private') },
    removeFilesAndRegistration: () => { calls.push('remove') },
    onDeleted: () => { calls.push('notify') },
    ...overrides,
  }
  return { root, campaign, hq, calls, deps, controller: createCampaignCleanupController(deps) }
}

describe('campaign cleanup boundary', () => {
  test('preserves before any destructive cleanup and notifies after successful removal', async () => {
    const { controller, calls } = setup()
    expect(await controller.delete('campaign', 'fresh')).toMatchObject({ hqWorkspaceId: 'hq', retainedFileCount: 2 })
    expect(calls).toEqual(['quiesce', 'stop-messaging', 'preserve', 'clear-private', 'dispose-sessions', 'remove', 'finish', 'notify'])
  })
  test('stale preview/preservation failure resumes runtime without deleting data', async () => {
    const { controller, calls, campaign } = setup({ preserve: async () => { throw new Error('Campaign changed. Review again.') } })
    await expect(controller.delete('campaign', 'stale')).rejects.toThrow('Campaign changed')
    expect(calls).toEqual(['quiesce', 'stop-messaging', 'resume', 'resume-messaging'])
    expect(existsSync(campaign.rootPath)).toBe(true)
  })
  test('late source changes reject before deleting and release the request fence', async () => {
    const events: string[] = []
    const { controller, calls } = setup({
      acquireRequestFence: () => { events.push('fence'); return () => { events.push('release') } },
      preview: () => ({ workspaceId: 'campaign', campaignName: 'campaign', previewToken: 'changed', retainedFileCount: 2, retainedBytes: 100, retainedMemoryCount: 1, retainedFiles: [], deletedFileCount: 4, warnings: [] }),
    })
    await expect(controller.delete('campaign', 'fresh')).rejects.toThrow('Campaign changed during cleanup')
    expect(calls).not.toContain('remove')
    expect(calls).toContain('resume')
    expect(events).toEqual(['fence', 'release'])
  })
  test('private cleanup failure never reaches folder deletion', async () => {
    const { controller, calls } = setup({ clearPrivateState: async () => { throw new Error('Credentials locked') } })
    await expect(controller.delete('campaign', 'fresh')).rejects.toThrow('Credentials locked')
    expect(calls).not.toContain('remove')
    expect(calls).not.toContain('notify')
    expect(calls).toContain('resume')
  })
  test('busy runtime rejects before preservation', async () => {
    const { controller, calls } = setup({ runtime: { quiesceCampaignForDeletion: async () => { throw new Error('Stop active work') } } })
    await expect(controller.delete('campaign', 'fresh')).rejects.toThrow('Stop active work')
    expect(calls).toEqual([])
  })
  test('requires a confirmation token and warns external schedules are unaffected', async () => {
    const { controller, calls } = setup()
    await expect(controller.delete('campaign', '')).rejects.toThrow('Review')
    expect(calls).toEqual([])
    expect((await controller.preview('campaign')).warnings.join(' ')).toContain('not canceled')
  })
  test('blocks concurrent deletion attempts', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const { controller } = setup({ preserve: async () => { await pending; return { retainedFileCount: 0, retainedMemoryCount: 0, pastReleaseLabel: 'campaign' } } })
    const first = controller.delete('campaign', 'fresh')
    await expect(controller.delete('campaign', 'fresh')).rejects.toThrow('already')
    release()
    await first
  })
})

describe('campaign folder eligibility', () => {
  test('rejects HQ, remote, shared, git and linked roots', () => {
    const { root, campaign, hq } = fixture()
    expect(() => resolveCampaignCleanup([campaign, hq], hq.id)).toThrow('Only campaign')
    expect(() => resolveCampaignCleanup([{ ...campaign, remoteServer: { url: 'https://example.com', token: '', remoteWorkspaceId: 'c' } }, hq], campaign.id)).toThrow('Remote')
    writeFileSync(join(campaign.rootPath, 'config.json'), JSON.stringify({ id: campaign.id, name: campaign.name, storage: { mode: 'shared-folder' } }))
    expect(() => resolveCampaignCleanup([campaign, hq], campaign.id)).toThrow('Shared')
    writeFileSync(join(campaign.rootPath, 'config.json'), JSON.stringify({ id: campaign.id, name: campaign.name }))
    mkdirSync(join(campaign.rootPath, '.git'))
    expect(() => resolveCampaignCleanup([campaign, hq], campaign.id)).toThrow('Git')
    rmSync(join(campaign.rootPath, '.git'), { recursive: true })
    const link = join(root, 'linked-campaign')
    symlinkSync(campaign.rootPath, link)
    expect(() => resolveCampaignCleanup([{ ...campaign, rootPath: link }, hq], campaign.id)).toThrow('linked')
  })
  test('rejects overlapping registered roots before preservation', () => {
    const { campaign, hq, make } = fixture()
    const nested = make('nested', 'campaign', join(campaign.rootPath, 'nested'))
    expect(() => resolveCampaignCleanup([campaign, hq, nested], campaign.id)).toThrow('overlaps')
  })
  test('requires a separate local HQ', () => {
    const { campaign } = fixture()
    expect(() => resolveCampaignCleanup([campaign], campaign.id)).toThrow('local Artist HQ')
  })
})

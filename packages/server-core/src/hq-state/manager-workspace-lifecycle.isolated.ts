import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testRoot = mkdtempSync(join(tmpdir(), 'artist-manager-lifecycle-'))
const previousConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = join(testRoot, 'config')

let config: typeof import('@craft-agent/shared/config')
let context: typeof import('@craft-agent/shared/workspace-context')
let hqState: typeof import('@craft-agent/shared/hq-state')
let refresh: typeof import('./refresh.ts')
let managerTools: typeof import('./manager-tools.ts')
let snapshot: typeof import('./snapshot.ts')

beforeAll(async () => {
  config = await import('@craft-agent/shared/config')
  context = await import('@craft-agent/shared/workspace-context')
  hqState = await import('@craft-agent/shared/hq-state')
  refresh = await import('./refresh.ts')
  managerTools = await import('./manager-tools.ts')
  snapshot = await import('./snapshot.ts')
  config.saveConfig({
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
  })
})

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir
  rmSync(testRoot, { recursive: true, force: true })
})

describe('Campaign deletion storage journey', () => {
  test('saves verified media in HQ then removes the actual root and registration while keeping other work', async () => {
    const { createCampaignCleanupController } = await import('../../../../apps/electron/src/main/campaign-cleanup.ts')
    const { emptyArtistVaultManifest, loadArtistVaultManifest } = await import('@craft-agent/shared/artist-vault')
    const hq = config.addWorkspace({ name: 'Cleanup HQ', rootPath: join(testRoot, 'cleanup-hq'), artistWorkspaceScope: 'hq' })
    const campaign = config.addWorkspace({ name: 'Finished Release', rootPath: join(testRoot, 'finished-release'), artistWorkspaceScope: 'campaign' })
    const other = config.addWorkspace({ name: 'Next Release', rootPath: join(testRoot, 'next-release'), artistWorkspaceScope: 'campaign' })
    const media = Buffer.from('original release master bytes')
    writeFileSync(join(campaign.rootPath, 'master.wav'), media)
    mkdirSync(join(campaign.rootPath, 'sessions', 'old-chat'), { recursive: true })
    writeFileSync(join(campaign.rootPath, 'sessions', 'old-chat', 'chat.txt'), 'Disposable old chat text')
    writeFileSync(join(other.rootPath, 'keep.txt'), 'Current campaign survives')
    const otherVault = emptyArtistVaultManifest(other.id)
    otherVault.assets.push({
      id: 'linked-master', label: 'Finished master', category: 'music', kind: 'master-final',
      absolutePath: join(campaign.rootPath, 'master.wav'), source: 'linked-file', status: 'final',
      rightsStatus: 'private', usableByAgents: false, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    })
    mkdirSync(join(other.rootPath, 'vault'), { recursive: true })
    writeFileSync(join(other.rootPath, 'vault', 'manifest.json'), JSON.stringify(otherVault, null, 2))
    const memory = join(testRoot, 'global-memory.md')
    writeFileSync(memory, 'Artist prefers intimate acoustic arrangements.')
    const lease = { workspaceId: campaign.id, sourceRootPath: campaign.rootPath, released: false }
    let notified = false
    const controller = createCampaignCleanupController({
      runtime: {
        quiesceCampaignForDeletion: async () => lease,
        resumeWorkspaceAfterMigration: async () => {},
        disposeCampaignSessions: async () => {},
        finishCampaignDeletion: () => { lease.released = true },
      },
      stopMessaging: async () => {}, resumeMessaging: async () => {},
      clearPrivateState: async () => {},
      onDeleted: () => { notified = true },
    })
    const preview = await controller.preview(campaign.id)
    expect(preview.retainedFiles.map(file => file.relativePath)).toContain('master.wav')
    const result = await controller.delete(campaign.id, preview.previewToken)
    expect(result.hqWorkspaceId).toBe(hq.id)
    expect(existsSync(campaign.rootPath)).toBe(false)
    expect(config.getWorkspaces().some(workspace => workspace.id === campaign.id)).toBe(false)
    const saved = loadArtistVaultManifest(hq.rootPath).assets.find(asset => asset.label === 'master.wav')
    expect(saved).toBeDefined()
    expect(readFileSync(join(hq.rootPath, saved!.relativePath!))).toEqual(media)
    expect(readFileSync(join(other.rootPath, 'keep.txt'), 'utf-8')).toBe('Current campaign survives')
    const repairedLink = loadArtistVaultManifest(other.rootPath, other.id).assets.find(asset => asset.id === 'linked-master')
    expect(realpathSync(repairedLink!.absolutePath!).startsWith(realpathSync(hq.rootPath))).toBe(true)
    expect(readFileSync(repairedLink!.absolutePath!)).toEqual(media)
    expect(readFileSync(memory, 'utf-8')).toBe('Artist prefers intimate acoustic arrangements.')
    expect(notified).toBe(true)
    await config.removeWorkspace(hq.id)
    await config.removeWorkspace(other.id)
  })
})

describe('Campaign deletion runtime', () => {
  test('blocks active workflows, then freezes idle campaign runtime without deleting source data', async () => {
    const { SessionManager } = await import('../sessions/SessionManager.ts')
    const campaignRoot = join(testRoot, 'cleanup-runtime')
    const campaign = config.addWorkspace({ name: 'Cleanup Runtime', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' })
    context.upsertContextDoc(campaignRoot, { slug: 'mission-brief', metadata: { name: 'Brief', enabled: true, routing: { mode: 'broadcast' } }, body: 'Keep source data until preservation succeeds.' })
    const manager = new SessionManager()
    const internals = manager as any
    let active = true
    let stopped = false
    let disposed = false
    internals.workflowRunner = { getActiveRuns: () => active ? [{ state: 'running' }] : [] }
    internals.configWatchers.set(campaignRoot, { stop: () => { stopped = true } })
    internals.automationSystems.set(campaignRoot, { hasPendingExecutions: () => false, dispose: async () => { disposed = true } })
    await expect(manager.quiesceCampaignForDeletion(campaign.id)).rejects.toThrow('Stop active campaign')
    expect(stopped).toBe(false)
    active = false
    const lease = await manager.quiesceCampaignForDeletion(campaign.id)
    expect(stopped).toBe(true)
    expect(disposed).toBe(true)
    await expect(manager.createSession(campaign.id)).rejects.toThrow('migration')
    await manager.disposeCampaignSessions(lease)
    expect(context.loadContextDoc(campaignRoot, 'mission-brief')?.body).toContain('Keep source data')
    manager.finishCampaignDeletion(lease)
    expect(lease.released).toBe(true)
    expect(manager.isWorkspaceRootRetired(campaignRoot)).toBe(true)
    await config.removeWorkspace(campaign.id)
  })
})

describe('Artist Manager workspace lifecycle', () => {
  test('campaign source health becomes stale after its source-specific freshness window', async () => {
    const campaignRoot = join(testRoot, 'staleness-campaign')
    mkdirSync(campaignRoot, { recursive: true })
    const campaign = config.addWorkspace({ name: 'Staleness Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' })
    context.upsertContextDoc(campaignRoot, {
      slug: 'mission-brief',
      metadata: { name: 'Mission Brief', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({
        version: 1,
        id: 'mission-brief',
        workspaceId: campaign.id,
        status: 'full',
        completeness: 100,
        title: 'Stale Campaign',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    })

    const stale = snapshot.buildManagerCampaignSnapshot(campaign, true, new Date('2026-08-29T00:00:00.000Z'))
    expect(stale.sourceHealth).toContainEqual(expect.objectContaining({
      source: `${campaign.id}:mission-brief`,
      status: 'stale',
      staleAfter: '2026-07-01T00:00:00.000Z',
    }))
    expect(stale.sourceHealth).toContainEqual({
      source: `${campaign.id}:outputs`,
      status: 'fresh',
    })

    context.upsertContextDoc(campaignRoot, {
      slug: 'mission-brief',
      metadata: { name: 'Mission Brief', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({
        version: 1,
        id: 'mission-brief',
        workspaceId: campaign.id,
        status: 'full',
        completeness: 100,
        title: 'Fresh Campaign',
        updatedAt: '2026-08-20T00:00:00.000Z',
      }),
    })
    const fresh = snapshot.buildManagerCampaignSnapshot(campaign, true, new Date('2026-08-29T00:00:00.000Z'))
    expect(fresh.sourceHealth).toContainEqual(expect.objectContaining({
      source: `${campaign.id}:mission-brief`,
      status: 'fresh',
      staleAfter: '2026-09-19T00:00:00.000Z',
    }))
    expect(await config.removeWorkspace(campaign.id)).toBe(true)
  })

  test('upcoming campaign dates keep priority while the most recent overdue work remains visible', async () => {
    const campaignRoot = join(testRoot, 'highlight-order-campaign')
    mkdirSync(campaignRoot, { recursive: true })
    const campaign = config.addWorkspace({ name: 'Highlight Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' })
    const calendarItems = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `past-${index}`, date: `2026-08-${String(10 + index).padStart(2, '0')}`, title: `Past ${index + 1}` })),
      ...Array.from({ length: 5 }, (_, index) => ({ id: `future-${index}`, date: `2026-09-${String(index + 1).padStart(2, '0')}`, title: `Future ${index + 1}` })),
    ]
    context.upsertContextDoc(campaignRoot, {
      slug: 'campaign-calendar',
      metadata: { name: 'Campaign Calendar', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({ version: 1, campaignId: campaign.id, items: calendarItems, updatedAt: '2026-08-29T00:00:00.000Z' }),
    })
    const workItems = [
      ...Array.from({ length: 6 }, (_, index) => scheduledReview(campaign.id, `past-work-${index}`, `Past work ${index + 1}`, `2026-08-${String(10 + index).padStart(2, '0')}T12:00:00.000Z`)),
      ...Array.from({ length: 5 }, (_, index) => scheduledReview(campaign.id, `future-work-${index}`, `Future work ${index + 1}`, `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`)),
    ]
    context.upsertContextDoc(campaignRoot, {
      slug: 'scheduled-work',
      metadata: { name: 'Scheduled Work', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({ version: 1, workspaceId: campaign.id, items: workItems, updatedAt: '2026-08-29T00:00:00.000Z' }),
    })

    const result = snapshot.buildManagerCampaignSnapshot(campaign, true, new Date('2026-08-29T00:00:00.000Z'))
    expect(result.calendarHighlights?.map((item) => item.title)).toEqual(['Future 1', 'Future 2', 'Future 3', 'Future 4', 'Past 6'])
    expect(result.calendarHighlights?.map((item) => item.timing)).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming', 'overdue'])
    expect(result.workHighlights?.map((item) => item.title)).toEqual(['Future work 1', 'Future work 2', 'Future work 3', 'Future work 4', 'Past work 6'])
    expect(result.workHighlights?.map((item) => item.timing)).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming', 'overdue'])
    expect(await config.removeWorkspace(campaign.id)).toBe(true)
  })

  test('campaign changes refresh the related HQ and deletion removes stale campaign detail', async () => {
    const hqRoot = join(testRoot, 'artist-hq')
    const campaignRoot = join(testRoot, 'campaign')
    mkdirSync(hqRoot, { recursive: true })
    mkdirSync(campaignRoot, { recursive: true })
    const hq = config.addWorkspace({ name: 'Artist HQ', rootPath: hqRoot, artistWorkspaceScope: 'hq' })
    const campaign = config.addWorkspace({ name: 'September Single', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' })

    context.upsertContextDoc(campaignRoot, {
      slug: 'mission-brief',
      metadata: { name: 'Mission Brief', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({
        version: 1,
        id: 'mission-brief',
        workspaceId: campaign.id,
        status: 'full',
        completeness: 100,
        missionType: 'single',
        title: 'September Single',
        goal: 'Build owned audience.',
        releaseDate: '2026-09-12',
        updatedAt: '2026-08-29T00:00:00.000Z',
      }),
    })

    refresh.scheduleHqStateContextRefresh(campaignRoot)
    await Bun.sleep(150)
    const first = hqState.parseHqStateOfPlay(context.loadContextDoc(hqRoot, hqState.HQ_STATE_CONTEXT_SLUG)?.body ?? '')
    const campaignBrief = hqState.parseCampaignManagerBrief(
      context.loadContextDoc(campaignRoot, hqState.CAMPAIGN_STATE_CONTEXT_SLUG)?.body ?? '',
    )
    expect(first?.version).toBe(2)
    expect(first?.version === 2 ? first.managerBrief.campaignFocus?.workspaceId : undefined).toBe(campaign.id)
    expect(campaignBrief?.workspaceId).toBe(campaign.id)
    expect(campaignBrief?.artistWorkspaceId).toBe(hq.id)
    expect(campaignBrief?.campaign.name).toBe('September Single')
    expect(managerTools.getLiveCampaignBrief(campaignRoot, { knownRevision: campaignBrief!.revision }))
      .toEqual(expect.objectContaining({ ok: true, live: true, changed: false }))

    context.upsertContextDoc(campaignRoot, {
      slug: 'mission-brief',
      metadata: { name: 'Mission Brief', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({
        version: 1,
        id: 'mission-brief',
        workspaceId: campaign.id,
        status: 'full',
        completeness: 100,
        missionType: 'single',
        title: 'September Single',
        goal: 'Convert release attention into repeat listeners.',
        releaseDate: '2026-09-12',
        updatedAt: '2026-08-29T01:00:00.000Z',
      }),
    })
    const fanout = refresh.refreshArtistManagerStateForWorkspaceBestEffort(campaignRoot)
    const refreshedCampaignBrief = hqState.parseCampaignManagerBrief(
      context.loadContextDoc(campaignRoot, hqState.CAMPAIGN_STATE_CONTEXT_SLUG)?.body ?? '',
    )
    expect(fanout.hq).not.toBeNull()
    expect(fanout.campaigns).toHaveLength(1)
    expect(refreshedCampaignBrief?.revision).not.toBe(campaignBrief?.revision)
    expect(refresh.getCampaignStateRefreshDiagnostic(campaignRoot)).toEqual(expect.objectContaining({
      status: 'success',
      revision: refreshedCampaignBrief?.revision,
    }))

    const anotherRoot = join(testRoot, 'another-campaign')
    mkdirSync(anotherRoot, { recursive: true })
    const another = config.addWorkspace({ name: 'Closer Campaign', rootPath: anotherRoot, artistWorkspaceScope: 'campaign' })
    context.upsertContextDoc(anotherRoot, {
      slug: 'mission-brief',
      metadata: { name: 'Mission Brief', routing: { mode: 'broadcast' }, enabled: true },
      body: jsonBody({ version: 1, id: 'mission-brief', workspaceId: another.id, status: 'full', completeness: 100, title: 'Closer Campaign', releaseDate: '2026-08-30', updatedAt: '2026-08-29T00:00:00.000Z' }),
    })
    expect(managerTools.getCampaignContextDetail({ select: 'focus' }, new Date('2026-08-29T00:00:00.000Z'), campaign.id))
      .toEqual(expect.objectContaining({ selection: expect.objectContaining({ workspaceId: campaign.id, reason: 'Current open campaign workspace.' }) }))

    expect(await config.removeWorkspace(campaign.id)).toBe(true)
    expect(await config.removeWorkspace(another.id)).toBe(true)
    refresh.scheduleHqStateContextRefresh(hqRoot)
    await Bun.sleep(150)
    const second = hqState.parseHqStateOfPlay(context.loadContextDoc(hqRoot, hqState.HQ_STATE_CONTEXT_SLUG)?.body ?? '')
    expect(second?.version === 2 ? second.managerBrief.campaignFocus : undefined).toBeUndefined()
    expect(managerTools.getCampaignContextDetail({ select: 'by-id', campaignId: campaign.id })).toEqual({
      ok: false,
      error: 'No campaign workspaces are configured.',
    })
    expect(config.getWorkspaceByNameOrId(hq.id)?.rootPath).toBe(hqRoot)
  })
})

function jsonBody(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

function scheduledReview(workspaceId: string, id: string, title: string, startAt: string) {
  return {
    version: 1,
    id,
    owner: { scope: 'campaign', workspaceId, campaignId: workspaceId },
    calendarLink: { calendar: 'campaign', itemId: `calendar-${id}` },
    title,
    type: 'review',
    status: 'scheduled',
    startAt,
    timezone: 'UTC',
    execution: { type: 'review', reviewerType: 'user' },
    inputRefs: [],
    approvals: [],
    runs: [],
    executionKey: { payloadDigest: `payload-${id}`, idempotencyKey: `work-${id}` },
    createdAt: startAt,
    updatedAt: startAt,
  }
}

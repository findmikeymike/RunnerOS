import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
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

beforeAll(async () => {
  config = await import('@craft-agent/shared/config')
  context = await import('@craft-agent/shared/workspace-context')
  hqState = await import('@craft-agent/shared/hq-state')
  refresh = await import('./refresh.ts')
  managerTools = await import('./manager-tools.ts')
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

describe('Artist Manager workspace lifecycle', () => {
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

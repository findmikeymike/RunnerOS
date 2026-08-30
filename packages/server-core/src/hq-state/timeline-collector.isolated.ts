import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testRoot = mkdtempSync(join(tmpdir(), 'artist-timeline-collector-'))
const previousConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = join(testRoot, 'config')

let config: typeof import('@craft-agent/shared/config')
let context: typeof import('@craft-agent/shared/workspace-context')
let managerTools: typeof import('./manager-tools.ts')
let collector: typeof import('./timeline-collector.ts')

let hqRoot: string
let campaignRoot: string
let campaignId: string

const NOW = new Date('2026-08-29T12:00:00.000Z')

beforeAll(async () => {
  config = await import('@craft-agent/shared/config')
  context = await import('@craft-agent/shared/workspace-context')
  managerTools = await import('./manager-tools.ts')
  collector = await import('./timeline-collector.ts')
  config.saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })

  hqRoot = join(testRoot, 'artist-hq')
  campaignRoot = join(testRoot, 'campaign')
  mkdirSync(hqRoot, { recursive: true })
  mkdirSync(campaignRoot, { recursive: true })
  config.addWorkspace({ name: 'Artist HQ', rootPath: hqRoot, artistWorkspaceScope: 'hq' })
  const campaign = config.addWorkspace({ name: 'Autumn Single', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' })
  campaignId = campaign.id

  context.upsertContextDoc(hqRoot, {
    slug: 'artist-calendar',
    metadata: { name: 'Artist Calendar', routing: { mode: 'broadcast' }, enabled: true },
    body: jsonBody({
      version: 1,
      updatedAt: '2026-08-29T00:00:00.000Z',
      events: [
        { id: 'meet-1', date: '2026-09-20', title: 'Label meeting', workspaceLinks: [], relatedPersonIds: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      ],
    }),
  })
  context.upsertContextDoc(hqRoot, {
    slug: 'listeners-goal',
    metadata: { name: 'Hit 10k listeners', routing: { mode: 'broadcast' }, enabled: true, status: 'active', priority: 'high', deadline: '2026-10-15' },
    body: 'Grow monthly listeners to 10k.',
  })
  // A bare deadline on a non-goal doc must contribute nothing.
  context.upsertContextDoc(hqRoot, {
    slug: 'not-a-goal',
    metadata: { name: 'Notes', routing: { mode: 'broadcast' }, enabled: true, deadline: '2026-10-20' },
    body: 'Just notes.',
  })

  context.upsertContextDoc(campaignRoot, {
    slug: 'mission-brief',
    metadata: { name: 'Mission Brief', routing: { mode: 'broadcast' }, enabled: true },
    body: jsonBody({
      version: 1,
      id: 'mission-brief',
      workspaceId: campaignId,
      status: 'full',
      completeness: 100,
      missionType: 'single',
      title: 'Autumn Single',
      goal: 'Own the audience.',
      releaseDate: '2026-10-02',
      updatedAt: '2026-08-29T00:00:00.000Z',
    }),
  })
  context.upsertContextDoc(campaignRoot, {
    slug: 'campaign-calendar',
    metadata: { name: 'Campaign Calendar', routing: { mode: 'broadcast' }, enabled: true },
    body: jsonBody({
      version: 1,
      campaignId,
      updatedAt: '2026-08-29T00:00:00.000Z',
      items: [
        {
          id: 'task-1', date: '2026-09-05', timezone: 'UTC', title: 'Post teaser', kind: 'manual',
          status: 'scheduled', source: 'user', assetRefs: [], finalRefs: [], outputRefs: [], personIds: [],
          runHistory: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'deadline-1', date: '2026-09-25', timezone: 'UTC', title: 'Master due', kind: 'deadline',
          status: 'scheduled', source: 'user', assetRefs: [], finalRefs: [], outputRefs: [], personIds: [],
          runHistory: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    }),
  })
})

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir
  rmSync(testRoot, { recursive: true, force: true })
})

describe('Artist Timeline collector', () => {
  test('merges HQ events, campaign dates, releases, and goals into one sorted timeline', () => {
    const timeline = collector.collectArtistTimeline({ from: '2026-08-29', to: '2026-11-27' }, NOW)

    const ids = timeline.entries.map((entry) => entry.id)
    expect(ids).toContain('hq-event:meet-1')
    expect(ids).toContain('goal:listeners-goal')
    expect(ids).toContain(`release:${campaignId}`)
    expect(ids).toContain('campaign-item:deadline-1')
    // The operational task is listed AND counted in the campaign roll-up.
    expect(ids).toContain('campaign-item:task-1')
    expect(timeline.rollups).toEqual([
      expect.objectContaining({ workspaceId: campaignId, label: 'Autumn Single', counts: { total: 1, needsAttention: 0 } }),
    ])
    // A bare deadline on a non-goal doc contributes nothing.
    expect(ids).not.toContain('goal:not-a-goal')

    const sorted = [...timeline.entries].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    expect(timeline.entries).toEqual(sorted)
    expect(timeline.warnings).toEqual([])
  })

  test('strategic tier filter keeps the roll-up while dropping operational entries', () => {
    const timeline = collector.collectArtistTimeline(
      { from: '2026-08-29', to: '2026-11-27', tier: 'strategic' },
      NOW,
    )

    expect(timeline.entries.every((entry) => entry.tier === 'strategic')).toBe(true)
    expect(timeline.entries.map((entry) => entry.id)).not.toContain('campaign-item:task-1')
    expect(timeline.rollups[0]?.counts.total).toBe(1)
  })

  test('beyondWindow reports strategic dates past the window', () => {
    const timeline = collector.collectArtistTimeline({ from: '2026-08-29', to: '2026-09-10' }, NOW)

    expect(timeline.beyondWindow.strategic).toBeGreaterThanOrEqual(2)
    expect(timeline.beyondWindow.nextDate).toBe('2026-09-20')
  })

  test('defaults the window to 90 days from today', () => {
    const timeline = collector.collectArtistTimeline({}, NOW)
    expect(timeline.from <= '2026-08-30').toBe(true)
    expect(collector.addDaysToDateKey(timeline.from, 90)).toBe(timeline.to)
  })

  test('is exposed through the get_artist_context timeline topic', () => {
    const result = managerTools.getArtistContextDetail(
      hqRoot,
      'concierge',
      { topic: 'timeline', from: '2026-08-29', to: '2026-11-27' },
      NOW,
    ) as { ok: boolean; topic?: string; data?: { entries?: unknown[] } }

    expect(result.ok).toBe(true)
    expect(result.topic).toBe('timeline')
    expect((result.data?.entries ?? []).length).toBeGreaterThanOrEqual(4)
    expect(JSON.stringify(result).length).toBeLessThan(12_000)
  })

  test('a malformed campaign calendar becomes a warning, not an abort', () => {
    const brokenRoot = join(testRoot, 'broken-campaign')
    mkdirSync(brokenRoot, { recursive: true })
    const broken = config.addWorkspace({ name: 'Broken Campaign', rootPath: brokenRoot, artistWorkspaceScope: 'campaign' })
    context.upsertContextDoc(brokenRoot, {
      slug: 'campaign-calendar',
      metadata: { name: 'Campaign Calendar', routing: { mode: 'broadcast' }, enabled: true },
      body: '```json\n{not json\n```',
    })

    const timeline = collector.collectArtistTimeline({ from: '2026-08-29', to: '2026-11-27' }, NOW)

    expect(timeline.warnings.some((warning) => warning.workspaceId === broken.id && warning.source === 'campaign-calendar')).toBe(true)
    // The healthy campaign's entries are still present.
    expect(timeline.entries.map((entry) => entry.id)).toContain('campaign-item:deadline-1')
  })
})

function jsonBody(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

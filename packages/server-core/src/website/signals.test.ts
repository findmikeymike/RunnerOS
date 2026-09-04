import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultWebsiteManifest, saveWebsiteManifest, websiteRoot } from '@craft-agent/shared/website'
import { mkdirSync, writeFileSync } from 'node:fs'
import { collectRoutineSignals, mapPostedContent, mapTimelineEntries } from './signals'
import type { TimelineEntry } from '@craft-agent/shared/hq-state'

function entry(overrides: Partial<TimelineEntry> & { title: string }): TimelineEntry {
  return {
    id: overrides.id ?? 'e1',
    date: overrides.date ?? '2026-10-02',
    timezone: 'UTC',
    sortKey: `${overrides.date ?? '2026-10-02'}T00:00`,
    tier: 'operational',
    category: 'event',
    needsAttention: false,
    origin: { kind: 'hq-event', workspaceId: 'hq' },
    ...overrides,
  } as TimelineEntry
}

describe('reading releases off the timeline', () => {
  test('release type is inferred from the title and defaults to single', () => {
    const { releases } = mapTimelineEntries([
      entry({ id: 'r1', category: 'release', title: 'Low Tide', date: '2026-10-10' }),
      entry({ id: 'r2', category: 'release', title: 'Nightwork EP', date: '2026-11-01' }),
      entry({ id: 'r3', category: 'release', title: 'Long Winter (album)', date: '2026-12-01' }),
    ])

    expect(releases.map(release => [release.title, release.type])).toEqual([
      ['Low Tide', 'single'],
      ['Nightwork EP', 'ep'],
      ['Long Winter (album)', 'album'],
    ])
  })

  test('a trailing "release" word is trimmed from the title', () => {
    const { releases } = mapTimelineEntries([
      entry({ id: 'r1', category: 'release', title: 'Low Tide release', date: '2026-10-10' }),
    ])
    expect(releases[0]!.title).toBe('Low Tide')
  })

  test('categories the site does not care about are ignored', () => {
    const { releases } = mapTimelineEntries([
      entry({ category: 'deadline', title: 'Master due' }),
      entry({ category: 'approval', title: 'Approve artwork' }),
      entry({ category: 'task', title: 'Post teaser' }),
    ])
    expect(releases).toHaveLength(0)
  })

  test('calendar entries are counted but never parsed into shows', () => {
    const { upcomingEvents } = mapTimelineEntries([
      entry({ id: 'e1', title: 'Denver — Bluebird' }),
      entry({ id: 'e2', title: 'Dentist' }),
    ])
    // Both are just dated entries. Neither becomes a show.
    expect(upcomingEvents.map(item => item.id)).toEqual(['e1', 'e2'])
  })
})

describe('reading posts the artist already published', () => {
  test('only a posted candidate with a receipt counts', () => {
    const posted = mapPostedContent([
      { id: 'a', text: 'Out now', status: 'posted', postedAt: '2026-09-14T10:00:00.000Z' },
      { id: 'b', text: 'Draft', status: 'approved', postedAt: undefined },
      { id: 'c', text: 'Queued', status: 'scheduled', postedAt: '2026-09-20T10:00:00.000Z' },
      { id: 'd', text: 'No receipt', status: 'posted' },
    ], '2026-09-01')

    // Announcing something the artist has not actually said would be worse
    // than missing it.
    expect(posted.map(item => item.id)).toEqual(['a'])
    expect(posted[0]!.platform).toBe('x')
  })

  test('posts older than the window are left alone', () => {
    const posted = mapPostedContent([
      { id: 'old', text: 'Last year', status: 'posted', postedAt: '2025-01-01T10:00:00.000Z' },
    ], '2026-09-01')
    expect(posted).toHaveLength(0)
  })

  test('an empty post is skipped', () => {
    const posted = mapPostedContent([
      { id: 'e', text: '   ', status: 'posted', postedAt: '2026-09-14T10:00:00.000Z' },
    ], '2026-09-01')
    expect(posted).toHaveLength(0)
  })
})

/**
 * The collector reads the artist timeline, which needs a configured HQ. With
 * none present it must degrade to "nothing to report" rather than throw and
 * take the whole routine down.
 */
describe('signal collection without an HQ', () => {
  test('returns empty signals instead of throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'website-signals-'))
    try {
      mkdirSync(websiteRoot(root), { recursive: true })
      writeFileSync(join(websiteRoot(root), 'placeholder'), '', 'utf8')
      saveWebsiteManifest(root, {
        ...defaultWebsiteManifest(),
        lastBuild: { at: '2026-09-01T00:00:00.000Z', hash: 'h', auditScore: 71, warnings: 2, fileCount: 3, bytes: 10 },
      })

      const signals = collectRoutineSignals(root, 'hq')
      expect(signals.releases).toEqual([])
      expect(signals.posted).toEqual([])
      expect(signals.upcomingEvents).toEqual([])
      // The audit score comes from the manifest, so it survives a missing HQ.
      expect(signals.auditScore).toBe(71)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultWebsiteManifest, saveWebsiteManifest, websiteRoot } from '@craft-agent/shared/website'
import { mkdirSync, writeFileSync } from 'node:fs'
import { collectRoutineSignals, mapTimelineEntries } from './signals'
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

describe('reading shows off the calendar', () => {
  test('common title shapes split into city and venue', () => {
    const { shows } = mapTimelineEntries([
      entry({ id: 'a', title: 'Denver — Bluebird Theater' }),
      entry({ id: 'b', title: 'Austin - Mohawk' }),
      entry({ id: 'c', title: 'Portland, Doug Fir Lounge' }),
    ])

    expect(shows.map(show => [show.city, show.venue])).toEqual([
      ['Denver', 'Bluebird Theater'],
      ['Austin', 'Mohawk'],
      ['Portland', 'Doug Fir Lounge'],
    ])
    expect(shows[0]!.calendarEventId).toBe('a')
  })

  test('decoration around the title is stripped', () => {
    const { shows } = mapTimelineEntries([
      entry({ title: 'Show: Denver — Bluebird (sold out)' }),
    ])
    expect(shows[0]).toMatchObject({ city: 'Denver', venue: 'Bluebird' })
  })

  test('a show-like entry with no venue is reported, never guessed at', () => {
    const { shows, unmappedEvents } = mapTimelineEntries([
      entry({ id: 'x', title: 'Tour kickoff' }),
    ])
    // Putting a wrong venue on a public site is worse than leaving it off.
    expect(shows).toHaveLength(0)
    expect(unmappedEvents).toEqual([{ id: 'x', date: '2026-10-02', title: 'Tour kickoff' }])
  })

  test('an ordinary calendar entry is neither a show nor a complaint', () => {
    const { shows, unmappedEvents } = mapTimelineEntries([
      entry({ title: 'Dentist' }),
      entry({ title: 'Call manager' }),
    ])
    expect(shows).toHaveLength(0)
    expect(unmappedEvents).toHaveLength(0)
  })
})

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
    const { releases, shows } = mapTimelineEntries([
      entry({ category: 'deadline', title: 'Master due' }),
      entry({ category: 'approval', title: 'Approve artwork' }),
      entry({ category: 'task', title: 'Post teaser' }),
    ])
    expect(releases).toHaveLength(0)
    expect(shows).toHaveLength(0)
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

      const signals = collectRoutineSignals(root)
      expect(signals.releases).toEqual([])
      expect(signals.shows).toEqual([])
      expect(signals.unmappedEvents).toEqual([])
      // The audit score comes from the manifest, so it survives a missing HQ.
      expect(signals.auditScore).toBe(71)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

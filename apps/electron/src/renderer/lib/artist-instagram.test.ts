import { describe, expect, test } from 'bun:test'
import {
  buildArtistInstagramGrowthHistory,
  parseArtistInstagramSnapshotJsonResult,
  type ArtistInstagramSnapshot,
} from './artist-instagram'

describe('artist Instagram snapshot', () => {
  test('parses visible Instagram Insights metrics without inventing missing values', () => {
    const result = parseArtistInstagramSnapshotJsonResult(JSON.stringify({
      version: 1,
      dataSource: 'instagram-insights-browser',
      snapshotDate: '2026-08-28',
      windowDays: 14,
      profile: { profile: 'main', handle: '@artist' },
      metrics: { followers: 4200, followerDelta: -12, accountsReached: 1800, comments: null },
      partial: true,
      errors: ['Comments were not visible.'],
      updatedAt: '2026-08-28T10:00:00.000Z',
    }))

    expect(result.ok).toBe(true)
    if (!result.ok || !result.snapshot) return
    expect(result.snapshot.metrics).toMatchObject({ followers: 4200, followerDelta: -12, accountsReached: 1800 })
    expect(result.snapshot.metrics.comments).toBeUndefined()
    expect(result.snapshot.partial).toBe(true)
  })

  test('rejects snapshots without an exact saved profile', () => {
    const result = parseArtistInstagramSnapshotJsonResult(JSON.stringify({
      snapshotDate: '2026-08-28',
      profile: {},
      metrics: { followerDelta: 4 },
    }))
    expect(result.ok).toBe(false)
  })

  test('builds history only from the latest profile and reporting window', () => {
    const snapshots = [
      snapshot('2026-08-07', 'main', 14, 5),
      snapshot('2026-08-14', 'other', 14, 99),
      snapshot('2026-08-21', 'main', 7, 7),
      snapshot('2026-08-28', 'main', 14, -3),
    ]
    expect(buildArtistInstagramGrowthHistory(snapshots)).toEqual([
      { date: '2026-08-07', followerDelta: 5 },
      { date: '2026-08-28', followerDelta: -3 },
    ])
  })
})

function snapshot(date: string, profile: string, windowDays: number, followerDelta: number): ArtistInstagramSnapshot {
  return {
    version: 1,
    dataSource: 'instagram-insights-browser',
    snapshotDate: date,
    windowDays,
    profile: { profile },
    metrics: { followerDelta },
    partial: false,
    errors: [],
    updatedAt: `${date}T10:00:00.000Z`,
  }
}

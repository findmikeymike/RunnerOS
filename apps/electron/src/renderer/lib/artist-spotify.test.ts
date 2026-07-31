import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import {
  buildArtistSpotifyStreamHistory,
  parseArtistSpotifySnapshotDocResult,
  parseArtistSpotifySnapshotJsonResult,
} from './artist-spotify'

function makeDoc(body: string): ContextDocDTO {
  return {
    slug: 'artist-spotify-snapshot',
    metadata: {
      name: 'Artist Spotify Snapshot',
      routing: { mode: 'broadcast' },
      enabled: true,
    },
    body,
    path: '/tmp/context/artist-spotify-snapshot',
    workspaceRootPath: '/tmp',
  } as ContextDocDTO
}

describe('parseArtistSpotifySnapshotDocResult', () => {
  test('parses public Spotify Web API snapshots', () => {
    const result = parseArtistSpotifySnapshotDocResult(makeDoc([
      '```json',
      JSON.stringify({
        version: 1,
        dataSource: 'spotify-web-api',
        snapshotDate: '2026-06-30',
        windowDays: 0,
        artist: {
          name: 'Test Artist',
          spotifyArtistId: 'abc123',
          spotifyUrl: 'https://open.spotify.com/artist/abc123',
          genres: ['alt pop'],
        },
        metrics: {
          followers: 1200,
          popularity: 42,
        },
        tracks: [{ id: 'track1', name: 'Lead Song', popularity: 55 }],
      }),
      '```',
    ].join('\n')))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot?.dataSource).toBe('spotify-web-api')
    expect(result.snapshot?.metrics.followers).toBe(1200)
    expect(result.snapshot?.metrics.popularity).toBe(42)
    expect(result.snapshot?.artist.genres).toEqual(['alt pop'])
    expect(result.snapshot?.tracks?.[0]?.name).toBe('Lead Song')
  })

  test('parses immutable Spotify for Artists snapshot files without inventing a window', () => {
    const result = parseArtistSpotifySnapshotJsonResult(JSON.stringify({
      snapshotDate: '2026-07-30',
      dataSource: 'spotify-for-artists-browser',
      windowDays: null,
      artist: { name: 'Test Artist' },
      metrics: { streams: 900, saves: 12 },
      partial: true,
      errors: ['Reporting window unavailable.'],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot?.dataSource).toBe('spotify-for-artists-browser')
    expect(result.snapshot?.windowDays).toBeUndefined()
    expect(result.snapshot?.metrics.saves).toBe(12)
  })

  test('builds a dated stream trend from only comparable historical snapshots', () => {
    const snapshot = (
      snapshotDate: string,
      streams: number,
      dataSource: 'spotify-for-artists-browser' | 'spotify-web-api' = 'spotify-for-artists-browser',
      windowDays: number | undefined = 28,
    ) => ({
      version: 1 as const,
      snapshotDate,
      dataSource,
      windowDays,
      artist: {},
      metrics: { streams },
      updatedAt: `${snapshotDate}T12:00:00.000Z`,
    })

    expect(buildArtistSpotifyStreamHistory([
      snapshot('2026-07-01', 100),
      snapshot('2026-07-08', 140),
      snapshot('2026-07-15', 999, 'spotify-web-api', 0),
      snapshot('2026-07-22', 180),
    ])).toEqual([
      { date: '2026-07-01', streams: 100 },
      { date: '2026-07-08', streams: 140 },
      { date: '2026-07-22', streams: 180 },
    ])
  })
})

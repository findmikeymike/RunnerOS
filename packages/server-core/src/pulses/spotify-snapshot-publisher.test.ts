import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadContextDoc } from '@craft-agent/shared/workspace-context'
import {
  ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG,
  publishLatestSpotifySnapshotContext,
} from './spotify-snapshot-publisher'

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'spotify-publisher-'))
}

function writeSnapshot(root: string, snapshot: Record<string, unknown>): string {
  const dir = join(root, 'data', 'spotify', 'snapshots')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${snapshot.snapshotDate}-s4a.json`)
  writeFileSync(file, `${JSON.stringify(snapshot)}\n`)
  return file
}

describe('publishLatestSpotifySnapshotContext', () => {
  test('publishes a normalized snapshot into Artist HQ context', () => {
    const root = workspace()
    writeSnapshot(root, {
      version: 1,
      dataSource: 'spotify-for-artists-browser',
      snapshotDate: '2026-08-28',
      metrics: { streams: 180512, listeners: 81546 },
      updatedAt: '2026-08-28T18:09:40.348Z',
    })

    const result = publishLatestSpotifySnapshotContext(root)
    const doc = loadContextDoc(root, ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG)

    expect(result.published).toBe(true)
    expect(doc?.body).toContain('"streams": 180512')
    expect(doc?.metadata.routing).toEqual({ mode: 'broadcast' })
  })

  test('does not publish an old snapshot for a new failed run', () => {
    const root = workspace()
    writeSnapshot(root, {
      snapshotDate: '2026-08-27',
      metrics: { streams: 1 },
    })

    const result = publishLatestSpotifySnapshotContext(root, { minimumModifiedAt: Date.now() + 5_000 })

    expect(result).toMatchObject({ published: false, reason: 'stale' })
    expect(loadContextDoc(root, ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG)).toBeNull()
  })

  test('rejects malformed snapshot data', () => {
    const root = workspace()
    writeSnapshot(root, { snapshotDate: '2026-08-28', metrics: null })

    expect(publishLatestSpotifySnapshotContext(root)).toMatchObject({ published: false, reason: 'invalid' })
  })
})

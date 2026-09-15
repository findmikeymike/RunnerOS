import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArtistInstagramSnapshotDocResult } from '@craft-agent/shared/artist-context'
import { loadContextDoc } from '@craft-agent/shared/workspace-context'
import {
  ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG,
  listInstagramSnapshotPaths,
  publishLatestInstagramSnapshotContext,
} from './instagram-snapshot-publisher'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'instagram-publisher-'))
  roots.push(root)
  return root
}
function writeSnapshot(root: string, metrics: Record<string, unknown>, suffix = crypto.randomUUID()) {
  const dir = join(root, 'data', 'instagram', 'snapshots')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `2026-09-15-insights-${suffix}.json`)
  writeFileSync(path, JSON.stringify({
    version: 1, dataSource: 'instagram-insights-browser', snapshotDate: '2026-09-15',
    windowDays: 30, profile: { profile: 'main', handle: '@artist' }, metrics,
    partial: true, errors: ['Reach unavailable'], updatedAt: '2026-09-15T19:00:00.000Z',
  }))
  return path
}
const context = (root: string) => loadContextDoc(root, ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG)

describe('Instagram snapshot publication', () => {
  test('publishes usable context that the widget parser can consume; repeated publication is unchanged', () => {
    const root = workspace()
    const file = writeSnapshot(root, { followers: 4200, views: 12345, followerDelta: -4 })
    expect(publishLatestInstagramSnapshotContext(root)).toMatchObject({ published: true, snapshotPath: file })
    expect(context(root)?.metadata.routing).toEqual({ mode: 'broadcast' })
    expect(parseArtistInstagramSnapshotDocResult(context(root)!)).toMatchObject({
      ok: true, snapshot: { windowDays: 30, metrics: { views: 12345, followerDelta: -4 }, partial: true },
    })
    expect(publishLatestInstagramSnapshotContext(root)).toMatchObject({ published: false, reason: 'unchanged' })
  })

  test('same-day UUID rerun publishes only new files, retaining previous snapshots', () => {
    const root = workspace()
    const previous = writeSnapshot(root, { followers: 42 })
    publishLatestInstagramSnapshotContext(root)
    const baseline = listInstagramSnapshotPaths(root)
    const fresh = writeSnapshot(root, { followers: 43 })
    expect(publishLatestInstagramSnapshotContext(root, { excludePaths: baseline })).toMatchObject({ published: true, snapshotPath: fresh })
    expect(listInstagramSnapshotPaths(root)).toEqual(expect.arrayContaining([previous, fresh]))
    expect(publishLatestInstagramSnapshotContext(root, { excludePaths: listInstagramSnapshotPaths(root) })).toMatchObject({ published: false, reason: 'missing' })
    expect(context(root)?.body).toContain('"followers": 43')
  })

  test('a failed or stale run preserves previously published context', () => {
    const root = workspace()
    writeSnapshot(root, { followers: 42 })
    publishLatestInstagramSnapshotContext(root)
    const oldBody = context(root)?.body
    expect(publishLatestInstagramSnapshotContext(root, { minimumModifiedAt: Date.now() + 5000 }).reason).toBe('stale')
    const baseline = listInstagramSnapshotPaths(root)
    writeSnapshot(root, { followers: null, views: null, interactions: null })
    expect(publishLatestInstagramSnapshotContext(root, { excludePaths: baseline }).reason).toBe('invalid')
    expect(context(root)?.body).toBe(oldBody)
  })

  test('skips malformed newest capture, publishes fresh valid earlier one', () => {
    const root = workspace()
    const good = writeSnapshot(root, { interactions: 0 })
    const bad = writeSnapshot(root, { followers: 1 })
    writeFileSync(bad, '{')
    const later = new Date(Date.now() + 1000)
    utimesSync(bad, later, later)
    expect(publishLatestInstagramSnapshotContext(root)).toMatchObject({ published: true, snapshotPath: good })
  })

  test.each([
    { metrics: { followers: -1 } },
    { metrics: { followers: '42' } },
    { metrics: { unknown: 42 } },
    { profile: {}, metrics: { followers: 42 } },
    { snapshotDate: 'bad-date', metrics: { followers: 42 } },
  ])('rejects unusable snapshot %#', (override) => {
    const root = workspace()
    const file = writeSnapshot(root, {})
    writeFileSync(file, JSON.stringify({ snapshotDate: '2026-09-15', profile: { profile: 'main' }, ...override }))
    expect(publishLatestInstagramSnapshotContext(root).reason).toBe('invalid')
    expect(context(root)).toBeNull()
  })

  test('missing directory is harmless', () => {
    const root = workspace()
    expect(listInstagramSnapshotPaths(root)).toEqual([])
    expect(publishLatestInstagramSnapshotContext(root).reason).toBe('missing')
  })
})

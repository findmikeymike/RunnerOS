import { expect, test } from 'bun:test'
import { normalizeInstagramCapture } from './instagram-normalize'
import { parseArtistInstagramSnapshotJsonResult } from './instagram'

test('native normalized views survive shared context parsing without becoming reach', () => {
  const normalized = normalizeInstagramCapture({ snapshotDate: '2026-09-15', windowDays: 30,
    profile: { profile: 'main', handle: '@artist' }, metrics: { views: 12345, interactions: 12 } })
  const result = parseArtistInstagramSnapshotJsonResult(JSON.stringify(normalized))
  expect(result.ok).toBe(true)
  if (!result.ok || !result.snapshot) throw new Error('Expected parsed native snapshot')
  expect(result.snapshot.metrics.views).toBe(12345)
  expect(result.snapshot.metrics.accountsReached).toBeUndefined()
  expect(result.snapshot.metrics.interactions).toBe(12)
  expect(result.snapshot.partial).toBe(false)
})

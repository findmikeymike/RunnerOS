import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeInstagramCapture } from './normalize-snapshot'

const script = path.join(import.meta.dir, 'normalize-snapshot.ts')

describe('Instagram snapshot normalizer', () => {
  test('preserves signed follower movement without requiring optional metrics', () => {
    const snapshot = normalizeInstagramCapture({
      snapshotDate: '2026-08-28',
      windowDays: 14,
      profile: { profile: 'main', handle: '@artist' },
      metrics: { followers: 1000, followerDelta: -9, accountsReached: 250 },
      monthlyFollowers: [
        { month: '2026-07', followers: 975, net: 12 },
        { month: '2026-08', net: -9 },
      ],
    }, new Date('2026-08-28T12:00:00.000Z'))

    expect(snapshot.metrics.followerDelta).toBe(-9)
    expect(snapshot.metrics.interactions).toBeNull()
    expect(snapshot.monthlyFollowers).toEqual([
      { month: '2026-07', followers: 975, net: 12 },
      { month: '2026-08', net: -9 },
    ])
    expect(snapshot.partial).toBe(false)
    expect(snapshot.errors).toEqual([])
  })

  test('native views remain views and a core-only capture is complete', () => {
    const snapshot = normalizeInstagramCapture({ snapshotDate: '2026-09-15', windowDays: 30,
      profile: { profile: 'main' }, metrics: { views: 12345, followers: 0 }, monthlyFollowers: [] })
    expect(snapshot.metrics.views).toBe(12345)
    expect(snapshot.metrics.accountsReached).toBeNull()
    expect(snapshot.metrics.followers).toBe(0)
    expect(snapshot.partial).toBe(false)
    expect(snapshot.errors).toEqual([])
  })

  test('rejects invalid dates, missing window, empty metrics, rounded strings and fractional counts', () => {
    const capture = { snapshotDate: '2026-09-15', windowDays: 30, profile: { profile: 'main' }, metrics: { views: 2 } }
    for (const patch of [{ snapshotDate: '2026-02-30' }, { windowDays: null }, { metrics: {} }, { metrics: { views: '12K' } }, { metrics: { views: 1.5 } }, { metrics: { views: Infinity } }]) {
      expect(() => normalizeInstagramCapture({ ...capture, ...patch })).toThrow()
    }
  })

  test('requires an exact profile and capture date', () => {
    expect(() => normalizeInstagramCapture({ profile: {}, metrics: {} })).toThrow()
  })

  test('normalizes signed monthly history without inventing missing totals', () => {
    const snapshot = normalizeInstagramCapture({
      snapshotDate: '2026-09-09',
      windowDays: 30,
      profile: { profile: 'main' },
      metrics: { followers: 100 },
      monthlyFollowers: [
        { month: '2026-08', net: -4 },
        { month: '2026-07', followers: 100 },
        { month: '2026-08', net: -3 },
        { month: 'bad', net: 9 },
      ],
    })

    expect(snapshot.monthlyFollowers).toEqual([
      { month: '2026-07', followers: 100 },
      { month: '2026-08', net: -3 },
    ])
    expect(snapshot.errors.join(' ')).toContain('Invalid monthlyFollowers')
  })

  test('allows same-day refreshes but refuses explicit overwrite and path escape', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'instagram-snapshot-'))
    const captureDir = path.join(workspace, 'data/instagram/captures')
    mkdirSync(captureDir, { recursive: true })
    const capture = path.join(captureDir, '2026-08-28.json')
    writeFileSync(capture, JSON.stringify({
      snapshotDate: '2026-08-28',
      windowDays: 14,
      profile: { profile: 'main' },
      metrics: { followers: 1000, followerDelta: 8 },
      monthlyFollowers: [
        { month: '2026-07', net: 5 },
        { month: '2026-08', net: 8 },
      ],
    }))

    const args = [process.execPath, script, '--capture', capture, '--workspace', workspace]
    const first = JSON.parse(Bun.spawnSync(args).stdout.toString())
    const second = JSON.parse(Bun.spawnSync(args).stdout.toString())
    expect(first.outPath).not.toBe(second.outPath)
    expect(JSON.parse(readFileSync(first.outPath, 'utf8')).metrics.followers).toBe(1000)
    expect(Bun.spawnSync([...args, '--out', first.outPath]).exitCode).not.toBe(0)
    const outside = mkdtempSync(path.join(tmpdir(), 'instagram-outside-'))
    symlinkSync(outside, path.join(workspace, 'escape'))
    expect(Bun.spawnSync([...args, '--out', 'escape/nested/snapshot.json']).exitCode).not.toBe(0)
    const outsideCapture = path.join(outside, 'capture.json')
    writeFileSync(outsideCapture, readFileSync(capture))
    expect(Bun.spawnSync([process.execPath, script, '--workspace', workspace, '--capture', path.join(workspace, 'escape/capture.json')]).exitCode).not.toBe(0)
    expect(Bun.spawnSync([...args, '--out', '../escaped.json']).exitCode).not.toBe(0)
  })
})

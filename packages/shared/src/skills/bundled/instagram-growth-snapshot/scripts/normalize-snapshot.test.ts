import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeInstagramCapture } from './normalize-snapshot'

const script = path.join(import.meta.dir, 'normalize-snapshot.ts')

describe('Instagram snapshot normalizer', () => {
  test('preserves signed follower movement and marks missing metrics partial', () => {
    const snapshot = normalizeInstagramCapture({
      snapshotDate: '2026-08-28',
      windowDays: 14,
      profile: { profile: 'main', handle: '@artist' },
      metrics: { followers: 1000, followerDelta: -9, accountsReached: 250 },
    }, new Date('2026-08-28T12:00:00.000Z'))

    expect(snapshot.metrics.followerDelta).toBe(-9)
    expect(snapshot.metrics.interactions).toBeNull()
    expect(snapshot.partial).toBe(true)
    expect(snapshot.errors.join(' ')).toContain('interactions')
  })

  test('requires an exact profile and capture date', () => {
    expect(() => normalizeInstagramCapture({ profile: {}, metrics: {} })).toThrow()
  })

  test('writes inside the workspace once and refuses overwrite or path escape', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'instagram-snapshot-'))
    const captureDir = path.join(workspace, 'data/instagram/captures')
    mkdirSync(captureDir, { recursive: true })
    const capture = path.join(captureDir, '2026-08-28.json')
    writeFileSync(capture, JSON.stringify({
      snapshotDate: '2026-08-28',
      windowDays: 14,
      profile: { profile: 'main' },
      metrics: { followers: 1000, followerDelta: 8 },
    }))

    const args = [process.execPath, script, '--capture', capture, '--workspace', workspace]
    expect(Bun.spawnSync(args).exitCode).toBe(0)
    expect(Bun.spawnSync(args).exitCode).not.toBe(0)
    expect(Bun.spawnSync([...args, '--out', '../escaped.json']).exitCode).not.toBe(0)
  })
})

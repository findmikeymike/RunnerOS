import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashBuildDirectory, snapshotBuild, withWebsiteLock } from './build-snapshot'

test('snapshots bind nested assets and worker code and reject symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'site-snapshot-test-'))
  try {
    const dist = join(root, 'dist')
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), 'site')
    writeFileSync(join(dist, 'assets/image.png'), 'image')
    writeFileSync(join(dist, '_worker.js'), 'worker')
    const hash = hashBuildDirectory(dist)
    const snapshot = snapshotBuild(dist, hash)
    expect(hashBuildDirectory(snapshot.path)).toBe(hash)
    snapshot.dispose()
    expect(existsSync(snapshot.path)).toBe(false)
    writeFileSync(join(dist, '_worker.js'), 'changed worker')
    expect(() => snapshotBuild(dist, hash)).toThrow('Build files changed')
    symlinkSync(join(dist, 'index.html'), join(dist, 'link.html'))
    expect(() => hashBuildDirectory(dist)).toThrow('symlink')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the shared queue survives failure and canonicalizes workspace aliases', async () => {
  const root = mkdtempSync(join(tmpdir(), 'site-lock-test-'))
  try {
    const real = join(root, 'real')
    const alias = join(root, 'alias')
    mkdirSync(real)
    symlinkSync(real, alias)
    const order: number[] = []
    let release!: () => void
    let start!: () => void
    const started = new Promise<void>(resolve => { start = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = withWebsiteLock(real, async () => { order.push(1); start(); await gate; throw new Error('failed') }).catch(() => undefined)
    const next = withWebsiteLock(alias, async () => { order.push(2) })
    await started
    expect(order).toEqual([1])
    release()
    await Promise.all([first, next])
    expect(order).toEqual([1, 2])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

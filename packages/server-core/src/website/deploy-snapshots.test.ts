import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deploySnapshotDir, deploySnapshotsRoot, hasDeploySnapshot, retainDeploySnapshot } from './deploy-snapshots'

test('a partial copy is never exposed as a usable rollback, and an existing version survives failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'site-retention-test-'))
  try {
    const dist = join(root, 'dist')
    mkdirSync(dist)
    writeFileSync(join(dist, 'index.html'), 'complete site')
    writeFileSync(join(dist, 'app.js'), 'required code')
    retainDeploySnapshot(root, 'existing', dist)
    const fail = { copy: (_source: unknown, target: unknown) => {
      mkdirSync(String(target), { recursive: true })
      writeFileSync(join(String(target), 'index.html'), 'partial')
      throw new Error('Copy failed halfway')
    } }
    expect(() => retainDeploySnapshot(root, 'new', dist, fail)).toThrow('halfway')
    expect(hasDeploySnapshot(root, 'new')).toBe(false)
    expect(() => retainDeploySnapshot(root, 'existing', dist, fail)).toThrow('halfway')
    expect(readFileSync(join(deploySnapshotDir(root, 'existing'), 'app.js'), 'utf8')).toBe('required code')
    expect(readdirSync(deploySnapshotsRoot(root))).toEqual(['existing'])
    expect(() => retainDeploySnapshot(root, 'incomplete', dist, { copy: (_source, target) => {
      mkdirSync(String(target), { recursive: true })
      writeFileSync(join(String(target), 'index.html'), 'complete site')
    } })).toThrow('incomplete')
    expect(hasDeploySnapshot(root, 'incomplete')).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

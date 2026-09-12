import { afterEach, expect, mock, test } from 'bun:test'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const realRename = fs.renameSync, realWrite = fs.writeFileSync
let failRename: string | undefined
let failWrite: string | undefined
mock.module('node:fs', () => ({ ...fs,
  renameSync: (...args: Parameters<typeof fs.renameSync>) => {
    if (String(args[1]) === failRename) throw new Error('injected rename failure')
    return realRename(...args)
  },
  writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
    if (failWrite && String(args[0]).startsWith(failWrite) && String(args[0]).endsWith('.tmp')) {
      realWrite(args[0], 'partial bytes')
      throw new Error('injected write failure')
    }
    return realWrite(...args)
  },
}))
const storage = await import('./recommendation-storage')
const roots: string[] = []
afterEach(() => {
  failRename = undefined; failWrite = undefined
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture(kind: 'recommendations' | 'outcomes') {
  const root = fs.mkdtempSync(join(tmpdir(), 'hq-recovery-fixture-')); roots.push(root)
  const dir = join(root, '.state-of-play'); fs.mkdirSync(dir)
  const primary = join(dir, `${kind}.json`), backup = join(dir, `${kind}.backup.json`)
  const bytes = kind === 'recommendations'
    ? JSON.stringify({ version: 1, candidates: [{ id: 'retained', status: 'accepted' }], updatedAt: 'before' })
    : JSON.stringify({ version: 1, outcomes: [{ version: 1, recommendationId: 'retained', status: 'successful', evaluatedAt: 'before', evidence: [], userUsefulness: 'useful' }] })
  const read = () => kind === 'recommendations' ? storage.readHqRecommendationStore(root) : storage.readHqRecommendationOutcomes(root)
  const update = () => kind === 'recommendations'
    ? storage.writeHqRecommendationStore(root, { ...storage.readHqRecommendationStore(root), updatedAt: 'new' })
    : storage.upsertHqRecommendationOutcome(root, { version: 1, recommendationId: 'second', status: 'unknown', evaluatedAt: 'new', evidence: [] })
  return { root, dir, primary, backup, bytes, read, update }
}

for (const kind of ['recommendations', 'outcomes'] as const) {
  test(`${kind}: missing primary recovers backup before the next update`, () => {
    const f = fixture(kind); realWrite(f.backup, f.bytes)
    expect(JSON.stringify(f.read())).toContain('retained')
    expect(fs.readFileSync(f.primary, 'utf8')).toBe(f.bytes)
    f.update()
    expect(JSON.stringify(f.read())).toContain('retained')
  })
  test(`${kind}: both corrupt copies are preserved and cannot become empty state`, () => {
    const f = fixture(kind); realWrite(f.primary, '{primary broken'); realWrite(f.backup, '{backup broken')
    expect(f.read).toThrow('is corrupt')
    expect(f.update).toThrow('is corrupt')
    expect(fs.readFileSync(f.primary, 'utf8')).toBe('{primary broken')
    expect(fs.readFileSync(f.backup, 'utf8')).toBe('{backup broken')
  })
  test(`${kind}: missing primary and corrupt backup still reject`, () => {
    const f = fixture(kind); realWrite(f.backup, '{backup broken')
    expect(f.read).toThrow('is corrupt')
    expect(fs.existsSync(f.primary)).toBe(false)
  })
  test(`${kind}: failed restoration retains corrupt primary, good backup, and evidence`, () => {
    const f = fixture(kind); realWrite(f.primary, '{primary broken'); realWrite(f.backup, f.bytes)
    failRename = f.primary
    expect(f.read).toThrow('injected rename failure')
    expect(fs.readFileSync(f.primary, 'utf8')).toBe('{primary broken')
    expect(fs.readFileSync(f.backup, 'utf8')).toBe(f.bytes)
    const evidence = fs.readdirSync(f.dir).find(name => name.startsWith(`${kind}.json.corrupt-`))!
    expect(fs.readFileSync(join(f.dir, evidence), 'utf8')).toBe('{primary broken')
    failRename = undefined
    expect(JSON.stringify(f.read())).toContain('retained')
  })
  test(`${kind}: failed backup write does not damage either last-good copy`, () => {
    const f = fixture(kind); realWrite(f.primary, f.bytes); realWrite(f.backup, f.bytes)
    failWrite = f.backup
    expect(f.update).toThrow('injected write failure')
    expect(fs.readFileSync(f.primary, 'utf8')).toBe(f.bytes)
    expect(fs.readFileSync(f.backup, 'utf8')).toBe(f.bytes)
    expect(fs.readdirSync(f.dir).some(name => name.endsWith('.tmp'))).toBe(false)
  })
  test(`${kind}: failed primary publication retains the current and backup copies`, () => {
    const f = fixture(kind); realWrite(f.primary, f.bytes); realWrite(f.backup, f.bytes)
    failRename = f.primary
    expect(f.update).toThrow('injected rename failure')
    expect(fs.readFileSync(f.primary, 'utf8')).toBe(f.bytes)
    expect(fs.readFileSync(f.backup, 'utf8')).toBe(f.bytes)
    expect(fs.readdirSync(f.dir).some(name => name.endsWith('.tmp'))).toBe(false)
  })
}

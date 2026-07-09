import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const skillRoot = join(import.meta.dir, '..', 'bundled', 'college-radio-matcher')
const matcherPath = join(skillRoot, 'match.py')
const fixturePath = join(import.meta.dir, 'fixtures', 'college-radio-stations.json')

function spawnMatcher(...args: string[]) {
  return Bun.spawnSync(['python3', matcherPath, '--data', fixturePath, ...args])
}

function runMatcher(...args: string[]): Record<string, unknown>[] {
  const result = spawnMatcher(...args, '--format', 'json')
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout.toString())
}

describe('college-radio-matcher bundle', () => {
  test('ships and uses the bundled personal station directory by default', () => {
    const raw = JSON.parse(readFileSync(join(skillRoot, 'data', 'stations.json'), 'utf8')) as unknown[]
    expect(raw).toHaveLength(426)

    const result = Bun.spawnSync(['python3', matcherPath, '--limit', '500', '--format', 'json'], {
      env: { ...process.env, COLLEGE_RADIO_DIRECTORY: '' },
    })
    expect(result.exitCode).toBe(0)
    const matched = JSON.parse(result.stdout.toString()) as Record<string, unknown>[]
    expect(matched).toHaveLength(424)
    expect(result.stderr.toString()).toContain('skipped invalid station record')
  })

  test('deduplicates canonical station identities and ranks hometown city first', () => {
    const stations = runMatcher('--home-state', 'CA', '--home-city', 'Los Angeles', '--market-cities', 'Portland', '--limit', '20')
    expect(stations.filter(station => String(station.station).startsWith('KHOME'))).toHaveLength(1)
    expect(stations[0]?.station).toBe('KHOME 90.1')
    expect(stations[0]?.emails).toEqual(['music@khome.test', 'duplicate@khome.test'])
    expect((stations[0]?._match as { rationale: string[] }).rationale).toContain('hometown city')
    expect((stations[0]?._match as { directoryWarnings: string[] }).directoryWarnings[0]).toContain('S001-DUP')
  })

  test('enforces explicit single and specialist mismatch rules', () => {
    const stations = runMatcher('--genre', 'hip-hop', '--release', 'single', '--explicit', '--limit', '20')
    const ids = stations.map(station => station.id)
    expect(ids).not.toContain('S004')
    expect(ids).not.toContain('S005')
    expect(ids).not.toContain('S006')
  })

  test('links-only requires a real digital submission path', () => {
    const stations = runMatcher('--links-only', '--limit', '20')
    const ids = stations.map(station => station.id)
    expect(ids).not.toContain('S007')
    expect(ids).not.toContain('S008')
    expect(ids).not.toContain('S003')
    expect(stations.every(station => (station._match as { submissionPath: string }).submissionPath !== 'unknown')).toBe(true)
  })

  test('rejects malformed directory field types before matching', () => {
    const root = mkdtempSync(join(tmpdir(), 'college-radio-malformed-'))
    const file = join(root, 'stations.json')
    writeFileSync(file, JSON.stringify([{
      id: 'BAD1', station: 'KBAD 90.1', country: 'USA', state: 'CA', city: 'Test',
      emails: 'music@example.com', flags: [], genre_hints: [], submission_methods: [],
    }]))
    const result = Bun.spawnSync(['python3', matcherPath, '--data', file, '--format', 'json'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('expected an array of strings')

    const requiredFile = join(root, 'invalid-required.json')
    writeFileSync(requiredFile, JSON.stringify([{
      id: 123, station: ['KBAD'], country: 'USA', state: 'CA', city: 'Test',
    }]))
    const requiredResult = Bun.spawnSync(['python3', matcherPath, '--data', requiredFile, '--format', 'json'])
    expect(requiredResult.exitCode).not.toBe(0)
    expect(requiredResult.stderr.toString()).toContain('No valid station records')
  })

  test('normalizes country aliases and labels output as directory-only', () => {
    const stations = runMatcher('--country', 'CA', '--limit', '20')
    expect(stations.length).toBeGreaterThan(0)
    expect(stations.every(station => station.country === 'Canada')).toBe(true)
    expect(stations.every(station => (station._match as { verificationStatus: string }).verificationStatus === 'directory_only')).toBe(true)
  })

  test('rejects invalid and dependent arguments', () => {
    for (const args of [
      ['--ease', 'instant'],
      ['--country', 'Mexico'],
      ['--limit', '0'],
      ['--limit', '-1'],
      ['--require-genre'],
      ['--clean-edit'],
      ['--home-state', 'California'],
      ['--states', 'CAX'],
      ['--market-states', '12'],
    ]) {
      expect(spawnMatcher(...args).exitCode).not.toBe(0)
    }
  })
})

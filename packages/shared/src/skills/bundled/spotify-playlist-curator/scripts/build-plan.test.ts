import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = join(import.meta.dir, 'build-plan.ts')
const ids = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(22, '0'))

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

describe('spotify playlist deterministic planner', () => {
  test('keeps an anchor in slot 1, strongest artist song in slot 2, and never repeats artist tracks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'playlist-plan-'))
    const comparablePath = join(dir, 'comparable.json')
    const oursPath = join(dir, 'ours.json')
    const out = join(dir, 'plan.json')
    writeFileSync(comparablePath, JSON.stringify({ comparableTracks: [
      { spotifyArtistId: 'a', artistName: 'Peer A', tier: 'peer', tracks: [{ id: ids[0], name: 'A', popularity: 20, bpm: 100, energy: 0.5 }] },
      { spotifyArtistId: 'b', artistName: 'Anchor', tier: 'anchor', tracks: [{ id: ids[1], name: 'B', popularity: 80, bpm: 104, energy: 0.55 }] },
      { spotifyArtistId: 'c', artistName: 'Peer C', tier: 'peer', tracks: [{ id: ids[2], name: 'C', popularity: 30, bpm: 108, energy: 0.6 }] },
      { spotifyArtistId: 'd', artistName: 'Peer D', tier: 'peer', tracks: ids.slice(3, 13).map((id, index) => ({ id, name: `D${index}`, bpm: 110 + index, energy: 0.6 })) },
    ] }))
    writeFileSync(oursPath, JSON.stringify({ ourTracks: [
      { id: ids[13], name: 'Secondary', preferredFeatureWeight: 1 },
      { id: ids[14], name: 'Strongest', preferredFeatureWeight: 10 },
      { id: ids[15], name: 'Third', preferredFeatureWeight: 2 },
    ] }))

    const result = run([
      '--comparable-tracks', comparablePath, '--our-tracks', oursPath,
      '--theme', 'Night Drive', '--target-length', '12', '--our-ratio', '0.25',
      '--our-artist-name', 'Our Artist', '--out', out,
    ])
    expect(result.status).toBe(0)
    const plan = JSON.parse(readFileSync(out, 'utf8'))
    expect(plan.slots).toHaveLength(12)
    expect(plan.slots[0]).toMatchObject({ kind: 'comparable', artistName: 'Anchor' })
    expect(plan.slots[1]).toMatchObject({ kind: 'ours', trackName: 'Strongest' })
    const ownIds = plan.slots.filter((slot: { kind: string }) => slot.kind === 'ours').map((slot: { trackId: string }) => slot.trackId)
    expect(new Set(ownIds).size).toBe(ownIds.length)
  })

  test('rejects malformed Spotify track ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'playlist-plan-invalid-'))
    const comparablePath = join(dir, 'comparable.json')
    const oursPath = join(dir, 'ours.json')
    writeFileSync(comparablePath, JSON.stringify({ comparableTracks: [
      { spotifyArtistId: 'a', artistName: 'A', tracks: [{ id: ids[0], name: 'A' }] },
      { spotifyArtistId: 'b', artistName: 'B', tracks: [{ id: ids[1], name: 'B' }] },
      { spotifyArtistId: 'c', artistName: 'C', tracks: [{ id: ids[2], name: 'C' }] },
    ] }))
    writeFileSync(oursPath, JSON.stringify({ ourTracks: [{ id: 'not-a-track-id', name: 'Bad' }] }))
    const result = run(['--comparable-tracks', comparablePath, '--our-tracks', oursPath, '--theme', 'Mood'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('invalid Spotify track ID')
  })
})

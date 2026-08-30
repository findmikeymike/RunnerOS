import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLabSong, loadLabSongs, loadLabState, saveLabLyrics, saveLabState } from './songs.ts'

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'lab-songs-test-'))
}

describe('Lab song storage', () => {
  test('creates a song with exact selected captures', () => {
    const root = tmpWorkspace()
    try {
      const song = createLabSong(root, {
        title: 'I Hope It Holds',
        captures: [{
          text: 'I hope it holds',
          selectionLabel: 'option 2',
          destination: 'section',
          sectionId: 'chorus',
          sectionLabel: 'Chorus',
        }],
      })

      expect(song.title).toBe('I Hope It Holds')
      expect(song.sections.find((section) => section.id === 'chorus')?.text).toBe('I hope it holds')
      expect(song.captures[0]?.selectionLabel).toBe('option 2')
      expect(loadLabSongs(root)).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('saves multiple precise excerpts to different destinations', () => {
    const root = tmpWorkspace()
    try {
      const song = createLabSong(root, { title: 'Pretty Trouble' })
      const updated = saveLabLyrics(root, {
        songId: song.id,
        captures: [
          { text: 'Pretty trouble, dressed like I meant it', selectionLabel: 'chorus option 1', destination: 'section', sectionId: 'chorus' },
          { text: 'Luxury as armor', selectionLabel: 'image line', destination: 'remember' },
        ],
      })

      expect(updated.sections.find((section) => section.id === 'chorus')?.text).toContain('Pretty trouble')
      expect(updated.rememberText).toBe('Luxury as armor')
      expect(updated.captures.map((capture) => capture.selectionLabel)).toEqual(['chorus option 1', 'image line'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('preserves project sequence state when a song tool writes lyrics', () => {
    const root = tmpWorkspace()
    try {
      const song = createLabSong(root, { title: 'Sequence Song' })
      const current = loadLabState(root)
      saveLabState(root, {
        ...current,
        projects: {
          poolOrder: [],
          sequencePages: [{ id: 'ep-one', title: 'EP One', songIds: [song.id] }],
          activeSequenceId: 'ep-one',
          selectedSongId: song.id,
        },
      })

      saveLabLyrics(root, { songId: song.id, captures: [{ text: 'Exact line', destination: 'rough_pad' }] })
      expect(loadLabState(root).projects.sequencePages[0]?.songIds).toEqual([song.id])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('quarantines malformed state instead of overwriting it silently', () => {
    const root = tmpWorkspace()
    try {
      const labDir = join(root, 'lab')
      mkdirSync(labDir, { recursive: true })
      writeFileSync(join(labDir, 'songs.json'), '{not-json', 'utf8')
      expect(loadLabState(root).songs).toEqual([])
      expect(existsSync(join(labDir, 'songs.json'))).toBe(false)
      expect(readdirSync(labDir).some((name) => name.startsWith('songs.json.corrupt-'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('drops malformed nested state instead of returning unsafe renderer shapes', () => {
    const root = tmpWorkspace()
    try {
      const labDir = join(root, 'lab')
      mkdirSync(labDir, { recursive: true })
      writeFileSync(join(labDir, 'songs.json'), JSON.stringify({
        version: 2,
        songs: [{
          id: 'safe-song',
          title: 'Safe Song',
          sections: [{ id: 'verse', label: 'Verse', text: 'line' }, null, { id: 3 }],
          captures: [{ id: 'capture', text: 'line', destination: 'section' }, { id: 'bad' }],
        }],
        projects: {
          poolOrder: ['safe-song', 4],
          sequencePages: [{ id: 'sequence', title: 'Sequence', songIds: ['safe-song', false] }, { id: 2 }],
          activeSequenceId: 'sequence',
          selectedSongId: 'missing-song',
        },
      }), 'utf8')

      const state = loadLabState(root)
      expect(state.songs[0]?.sections).toEqual([{ id: 'verse', label: 'Verse', text: 'line', optional: undefined }])
      expect(state.songs[0]?.captures).toHaveLength(1)
      expect(state.projects.poolOrder).toEqual(['safe-song'])
      expect(state.projects.sequencePages[0]?.songIds).toEqual(['safe-song'])
      expect(state.projects.selectedSongId).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('persists valid per-line alternatives and drops malformed entries', () => {
    const root = tmpWorkspace()
    try {
      const song = createLabSong(root, { title: 'Alternate Lines' })
      const state = loadLabState(root)
      saveLabState(root, {
        ...state,
        songs: [{
          ...song,
          lineAlternatives: [{
            id: 'rough-line-1',
            source: 'rough',
            anchorText: 'Window down',
            lineIndex: 0,
            occurrence: 0,
            alternatives: [{ id: 'alt-1', text: 'Windows open', createdAt: '2026-08-29T00:00:00.000Z' }],
            updatedAt: '2026-08-29T00:00:00.000Z',
          }],
        }],
      })

      expect(loadLabSongs(root)[0]?.lineAlternatives).toEqual([{
        id: 'rough-line-1',
        source: 'rough',
        anchorText: 'Window down',
        lineIndex: 0,
        occurrence: 0,
        alternatives: [{ id: 'alt-1', text: 'Windows open', createdAt: '2026-08-29T00:00:00.000Z' }],
        updatedAt: '2026-08-29T00:00:00.000Z',
      }])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('persists typed, tagged sparks with optional song context', () => {
    const root = tmpWorkspace()
    try {
      const song = createLabSong(root, { title: 'Night Drive' })
      const state = loadLabState(root)
      saveLabState(root, {
        ...state,
        sparks: [{
          id: 'spark-1',
          text: 'Headlights know my name',
          kind: 'line',
          tags: ['night', 'hook'],
          pinned: true,
          songId: song.id,
          createdAt: '2026-08-29T00:00:00.000Z',
          updatedAt: '2026-08-29T00:00:00.000Z',
        }],
      })

      expect(loadLabState(root).sparks).toEqual([{
        id: 'spark-1',
        text: 'Headlights know my name',
        kind: 'line',
        tags: ['night', 'hook'],
        pinned: true,
        songId: song.id,
        createdAt: '2026-08-29T00:00:00.000Z',
        updatedAt: '2026-08-29T00:00:00.000Z',
      }])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

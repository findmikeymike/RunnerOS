import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLabSong, loadLabSongs, saveLabLyrics } from './songs.ts'

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
})

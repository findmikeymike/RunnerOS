import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LabSong, LabState } from '@craft-agent/shared/lab'
import { loadLabState, saveLabState } from '@craft-agent/shared/lab'
import { removeLabSequencePage, removeLabSongFromState } from './lab-song-state'

describe('Lab song CRUD state', () => {
  test('deleting a song cleans every relation while preserving its sparks', () => {
    const state = makeState()
    const next = removeLabSongFromState(state, 'song-a')

    expect(next.songs.map((song) => song.id)).toEqual(['song-b'])
    expect(next.projects.poolOrder).toEqual(['song-b'])
    expect(next.projects.sequencePages.map((page) => page.songIds)).toEqual([['song-b'], []])
    expect(next.projects.selectedSongId).toBeUndefined()
    expect(next.sparks).toEqual([
      expect.objectContaining({ id: 'spark-a', text: 'Keep this line', songId: undefined }),
    ])
  })

  test('a deleted song stays deleted after a canonical file reload', () => {
    const root = mkdtempSync(join(tmpdir(), 'lab-crud-reload-'))
    try {
      saveLabState(root, makeState())
      saveLabState(root, removeLabSongFromState(loadLabState(root), 'song-a'))
      const reloaded = loadLabState(root)

      expect(reloaded.songs.map((song) => song.id)).toEqual(['song-b'])
      expect(reloaded.projects.sequencePages.flatMap((page) => page.songIds)).not.toContain('song-a')
      expect(reloaded.sparks[0]?.text).toBe('Keep this line')
      expect(reloaded.sparks[0]?.songId).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('deleting the active sequence selects its nearest surviving neighbor', () => {
    const next = removeLabSequencePage(makeState().projects, 'sequence-a')

    expect(next.sequencePages.map((page) => page.id)).toEqual(['sequence-b'])
    expect(next.activeSequenceId).toBe('sequence-b')
  })

  test('never deletes the final sequence page', () => {
    const projects = {
      ...makeState().projects,
      sequencePages: [{ id: 'only', title: 'Only', songIds: [] }],
      activeSequenceId: 'only',
    }

    expect(removeLabSequencePage(projects, 'only')).toBe(projects)
  })
})

function makeState(): LabState {
  return {
    songs: [makeSong('song-a'), makeSong('song-b')],
    sparks: [{
      id: 'spark-a',
      text: 'Keep this line',
      kind: 'line',
      tags: ['hook'],
      songId: 'song-a',
      pinned: false,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    }],
    projects: {
      poolOrder: ['song-a', 'song-b'],
      sequencePages: [
        { id: 'sequence-a', title: 'A', songIds: ['song-a', 'song-b'] },
        { id: 'sequence-b', title: 'B', songIds: ['song-a'] },
      ],
      activeSequenceId: 'sequence-a',
      selectedSongId: 'song-a',
    },
  }
}

function makeSong(id: string): LabSong {
  return {
    id,
    title: id,
    project: 'Loose Singles',
    color: '#fb923c',
    notes: '',
    status: 'working',
    focused: false,
    roughText: '',
    rememberText: '',
    sections: [],
    lineAlternatives: [],
    captures: [],
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  }
}

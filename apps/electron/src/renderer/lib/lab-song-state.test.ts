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

// Isolate the browser globals and module caches from the rest of the Bun suite.
test('Lab host-save barrier drains queued writes, propagates recovery failures, and reloads read-only', async () => {
  const moduleUrl = new URL('./lab-song-state.ts', import.meta.url).href
  const script = `
    import assert from 'node:assert/strict';
    const { flushLabState, reloadLabState, saveLabUiSongs } = await import(${JSON.stringify(moduleUrl)});
    const values = new Map();
    let canonical = ${JSON.stringify(makeState())};
    let writes = 0;
    let fail = false;
    let gate;
    globalThis.window = {
      localStorage: { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) },
      dispatchEvent: () => {},
      electronAPI: {
        getLabState: async () => structuredClone(canonical),
        saveLabState: async (_id, state) => { writes++; if (fail) throw new Error('disk unavailable'); if (gate) await gate; canonical = structuredClone(state); return canonical; }
      }
    };
    const key = id => 'lab:pending-state:v2:' + id;
    values.set(key('failed'), JSON.stringify(canonical));
    fail = true;
    await assert.rejects(flushLabState('failed'), /disk unavailable/);
    assert.ok(values.has(key('failed')), 'retain failed recovery draft');
    fail = false;
    await flushLabState('failed');
    assert.equal(values.has(key('failed')), false);

    let release;
    gate = new Promise(resolve => { release = resolve; });
    const first = saveLabUiSongs('queued', [canonical.songs[0]]);
    const second = saveLabUiSongs('queued', [{ ...canonical.songs[1], title: 'latest edit' }]);
    let drained = false;
    const barrier = flushLabState('queued').then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(drained, false, 'must await in-flight queue');
    release();
    await Promise.all([first, second, barrier]);
    gate = undefined;
    assert.equal(canonical.songs[0].title, 'latest edit');
    assert.equal(values.has(key('queued')), false);

    const stale = { ...canonical, songs: [] };
    values.set(key('read'), JSON.stringify(stale));
    const before = writes;
    const loaded = await reloadLabState('read');
    assert.equal(loaded.songs[0].title, 'latest edit');
    assert.equal(writes, before, 'reload must never replay stale state');
    assert.ok(values.has(key('read')), 'read must preserve recovery data');
  `
  const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(stderr).toBe('')
  expect(code).toBe(0)
})

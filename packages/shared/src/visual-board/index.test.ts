import { describe, expect, test } from 'bun:test';
import {
  VISUAL_BOARD_MAX_BODY_LENGTH,
  createEmptyVisualBoardSnapshot,
  isVisualBoardSnapshot,
  parseVisualBoardSnapshot,
  summarizeVisualBoard,
  rebaseVisualBoardDraft,
  type VisualBoardSnapshot,
} from './index.ts';

describe('visual board snapshots', () => {
  test('keeps edits made during save and adopts the returned observed state', () => {
    const board = createEmptyVisualBoardSnapshot({ workspaceId: 'ws', sessionId: 'session-1' });
    const note = { id: 'note', type: 'note' as const, title: 'Note', body: 'submitted', createdAt: board.createdAt, updatedAt: board.updatedAt };
    const submitted = { ...board, cards: [note] };
    const current = { ...submitted, cards: [{ ...note, body: 'typed while saving' }] };
    const saved = { ...submitted, observedState: { title: board.title, cards: [{ id: 'note', hash: 'a'.repeat(64) }] }, cards: [{ ...note, id: 'remote' }, note] };
    const rebased = rebaseVisualBoardDraft(submitted, current, saved);
    expect(rebased.observedState).toEqual(saved.observedState);
    expect(rebased.cards).toHaveLength(2);
    expect(rebased.cards.find((card) => card.id === 'note')).toMatchObject({ body: 'typed while saving' });
    expect(rebaseVisualBoardDraft(submitted, { ...current, cards: [] }, saved).cards.map((card) => card.id)).toEqual(['remote']);
  });

  test('rejects duplicate card IDs and malformed observed state', () => {
    const board = createEmptyVisualBoardSnapshot({ workspaceId: 'ws', sessionId: 'session-1' });
    const note = { id: 'note', type: 'note', title: 'Note', body: '', createdAt: board.createdAt, updatedAt: board.updatedAt };
    expect(isVisualBoardSnapshot({ ...board, cards: [note, note] })).toBe(false);
    expect(isVisualBoardSnapshot({ ...board, observedState: { title: '', cards: [{ id: 'note', hash: 'bad' }] } })).toBe(false);
  });
  test('creates and validates an empty session board', () => {
    const board = createEmptyVisualBoardSnapshot({
      workspaceId: 'ws',
      sessionId: 'session-1',
      now: '2026-05-22T00:00:00.000Z',
    });

    expect(isVisualBoardSnapshot(board, { workspaceId: 'ws', sessionId: 'session-1' })).toBe(true);
    expect(board.cards).toEqual([]);
    expect(summarizeVisualBoard(board)).toBe('Empty visual board');
  });

  test('rejects mismatched workspace or session snapshots', () => {
    const board = createEmptyVisualBoardSnapshot({ workspaceId: 'ws', sessionId: 'session-1' });

    expect(isVisualBoardSnapshot(board, { workspaceId: 'other', sessionId: 'session-1' })).toBe(false);
    expect(isVisualBoardSnapshot(board, { workspaceId: 'ws', sessionId: 'other' })).toBe(false);
  });

  test('parses populated note and output cards', () => {
    const now = '2026-05-22T00:00:00.000Z';
    const board: VisualBoardSnapshot = {
      schemaVersion: 1,
      workspaceId: 'ws',
      sessionId: 'session-1',
      title: 'Session board',
      createdAt: now,
      updatedAt: now,
      cards: [
        { id: 'note-1', type: 'note', title: 'Plan', body: 'Ship it', createdAt: now, updatedAt: now },
        { id: 'out-1', type: 'output', outputId: 'output-1', title: 'Preview', kind: 'image', createdAt: now, updatedAt: now },
      ],
    };

    const parsed = parseVisualBoardSnapshot(JSON.stringify(board), { workspaceId: 'ws', sessionId: 'session-1' });
    expect(parsed?.cards.length).toBe(2);
    expect(summarizeVisualBoard(board)).toBe('2 cards: 1 note, 1 output');
  });

  test('rejects note cards over the body limit', () => {
    const now = '2026-05-22T00:00:00.000Z';
    const board: VisualBoardSnapshot = {
      schemaVersion: 1,
      workspaceId: 'ws',
      sessionId: 'session-1',
      title: 'Session board',
      createdAt: now,
      updatedAt: now,
      cards: [{
        id: 'note-1',
        type: 'note',
        title: 'Too long',
        body: 'x'.repeat(VISUAL_BOARD_MAX_BODY_LENGTH + 1),
        createdAt: now,
        updatedAt: now,
      }],
    };

    expect(isVisualBoardSnapshot(board, { workspaceId: 'ws', sessionId: 'session-1' })).toBe(false);
  });
});

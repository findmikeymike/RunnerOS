import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addAgendaTaskComment, deleteAgendaTaskThread, readAgendaTaskThread } from './storage.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agenda-thread-'));
  roots.push(root);
  return root;
}

describe('agenda task discussions', () => {
  it('appends comments and deduplicates a retried comment id', () => {
    const root = workspace();
    addAgendaTaskComment(root, 'machine-a', 'Alex', 'task_1', { id: 'comment_1', body: ' First note ' });
    const retried = addAgendaTaskComment(root, 'machine-a', 'Alex', 'task_1', { id: 'comment_1', body: 'First note' });
    const result = addAgendaTaskComment(root, 'machine-b', 'Sam', 'task_1', { id: 'comment_2', body: 'Second note' });

    expect(retried.comments).toHaveLength(1);
    expect(result.comments.map((comment) => comment.body)).toEqual(['First note', 'Second note']);
    expect(result.comments[1]?.authorName).toBe('Sam');
  });

  it('removes the task discussion with a tombstone', () => {
    const root = workspace();
    addAgendaTaskComment(root, 'machine-a', 'Alex', 'task_1', { id: 'comment_1', body: 'Delete me' });
    deleteAgendaTaskThread(root, 'machine-a', 'task_1');
    expect(readAgendaTaskThread(root, 'task_1')).toBeNull();
  });

  it('rejects empty comments', () => {
    const root = workspace();
    expect(() => addAgendaTaskComment(root, 'machine-a', 'Alex', 'task_1', { id: 'comment_1', body: '   ' })).toThrow('Comment cannot be empty');
  });
});

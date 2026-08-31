import { describe, expect, it } from 'bun:test';
import {
  SESSION_TASK_LIST_MAX_ITEMS,
  SessionTaskStateError,
  abandonSessionTask,
  appendSessionTasks,
  assertSessionTaskListRevision,
  completeSessionTask,
  createSessionTaskList,
  delegateSessionTask,
  parseSessionTaskList,
  reopenSessionTask,
  settleSessionTaskDelegation,
  recoverSessionTaskListAfterRestart,
  projectTodoWriteSessionTasks,
  startSessionTask,
  type SessionTaskStateErrorCode,
} from '../session-tasks.ts';

const T0 = '2026-08-30T12:00:00.000Z';
const T1 = '2026-08-30T12:01:00.000Z';
const T2 = '2026-08-30T12:02:00.000Z';

function expectCode(fn: () => unknown, code: SessionTaskStateErrorCode): void {
  try {
    fn();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SessionTaskStateError);
    expect((error as SessionTaskStateError).code).toBe(code);
  }
}

function createList() {
  return createSessionTaskList([
    { content: 'Research release timing', activeForm: 'Researching release timing' },
    { content: 'Draft campaign brief' },
  ], 'native-tool', {
    id: 'tasks_test',
    taskIds: ['task_research', 'task_brief'],
    now: T0,
  });
}

describe('session task-list state', () => {
  it('creates a normalized immutable list with stable ids and source', () => {
    const list = createSessionTaskList([
      { content: '  Research release timing  ', activeForm: '  Researching release timing  ' },
    ], 'native-tool', { id: 'tasks_test', taskIds: ['task_research'], now: T0 });

    expect(list).toEqual({
      schemaVersion: 1,
      id: 'tasks_test',
      revision: 1,
      items: [{
        id: 'task_research',
        content: 'Research release timing',
        activeForm: 'Researching release timing',
        status: 'pending',
        delegation: undefined,
        createdAt: T0,
        updatedAt: T0,
      }],
      createdAt: T0,
      updatedAt: T0,
      source: 'native-tool',
    });
  });

  it('rejects empty, overlong, duplicate, over-cap, and multiple-active inputs with typed codes', () => {
    expectCode(() => createSessionTaskList([{ content: ' ' }]), 'empty-content');
    expectCode(() => createSessionTaskList([{ content: 'x'.repeat(201) }]), 'content-too-long');
    expectCode(() => createSessionTaskList([
      { content: 'Draft copy' },
      { content: '  DRAFT COPY  ' },
    ]), 'duplicate-content');
    expectCode(() => createSessionTaskList(Array.from(
      { length: SESSION_TASK_LIST_MAX_ITEMS + 1 },
      (_, index) => ({ content: `Task ${index}` }),
    )), 'too-many-items');
    expectCode(() => createSessionTaskList([
      { content: 'First', status: 'in_progress' },
      { content: 'Second', status: 'in_progress' },
    ]), 'multiple-in-progress');
  });

  it('increments revision exactly once per accepted mutation and leaves prior state untouched', () => {
    const initial = createList();
    const appended = appendSessionTasks(initial, [{ content: 'Approve artwork' }], {
      taskIds: ['task_art'],
      now: T1,
    });
    const started = startSessionTask(appended, 'task_research', T2);

    expect(initial.revision).toBe(1);
    expect(initial.items).toHaveLength(2);
    expect(appended.revision).toBe(2);
    expect(appended.items[2]?.id).toBe('task_art');
    expect(started.revision).toBe(3);
    expect(started.items[0]?.status).toBe('in_progress');
    expect(appended.items[0]?.status).toBe('pending');
  });

  it('does not increment revision when a mutation is rejected', () => {
    const initial = createList();

    expectCode(() => completeSessionTask(initial, 'task_research', T1), 'invalid-transition');
    expectCode(() => appendSessionTasks(initial, [{ content: 'DRAFT CAMPAIGN BRIEF' }], { now: T1 }), 'duplicate-content');
    expectCode(() => appendSessionTasks(initial, [{ content: 'Travel backward' }], {
      taskIds: ['task_backward'],
      now: '2026-08-30T11:59:00.000Z',
    }), 'invalid-list');
    expect(initial.revision).toBe(1);
    expect(initial.items.every(item => item.status === 'pending')).toBe(true);
  });

  it('enforces one active task through start and completion transitions', () => {
    const initial = createList();
    const firstStarted = startSessionTask(initial, 'task_research', T1);
    expectCode(() => startSessionTask(firstStarted, 'task_brief', T2), 'multiple-in-progress');

    const firstDone = completeSessionTask(firstStarted, 'task_research', T2);
    const secondStarted = startSessionTask(firstDone, 'task_brief', '2026-08-30T12:03:00.000Z');

    expect(firstDone.items[0]?.status).toBe('completed');
    expect(secondStarted.items[1]?.status).toBe('in_progress');
  });

  it('makes completed and abandoned tasks terminal until explicit reopen', () => {
    const started = startSessionTask(createList(), 'task_research', T1);
    const completed = completeSessionTask(started, 'task_research', T2);
    const abandoned = abandonSessionTask(completed, 'task_brief', T2);

    expectCode(() => startSessionTask(completed, 'task_research', T2), 'terminal-task');
    expectCode(() => abandonSessionTask(abandoned, 'task_brief', T2), 'terminal-task');

    const reopenedComplete = reopenSessionTask(completed, 'task_research', T2);
    const reopenedAbandoned = reopenSessionTask(abandoned, 'task_brief', T2);
    expect(reopenedComplete.items[0]?.status).toBe('pending');
    expect(reopenedAbandoned.items[1]?.status).toBe('pending');
  });

  it('requires exact delegation provenance and settles host-owned outcomes', () => {
    const initial = startSessionTask(createList(), 'task_research', T1);
    expectCode(() => createSessionTaskList([
      { content: 'Delegated without receipt', status: 'delegated' },
    ]), 'missing-delegation');

    const delegated = delegateSessionTask(initial, 'task_research', {
      receiptId: 'receipt-1',
      childSessionId: 'child-1',
      targetAgentSlug: 'critic',
      dispatchedAt: T1,
    }, T1);
    expect(delegated.items[0]?.status).toBe('delegated');
    expect(delegated.items[0]?.delegation?.receiptId).toBe('receipt-1');
    expectCode(() => completeSessionTask(delegated, 'task_research', T2), 'invalid-transition');
    expectCode(() => abandonSessionTask(delegated, 'task_research', T2), 'invalid-transition');

    const succeeded = settleSessionTaskDelegation(delegated, 'task_research', 'succeeded', {
      summary: 'Review passed',
      now: T2,
    });
    expect(succeeded.items[0]).toMatchObject({
      status: 'completed',
      delegation: { outcome: 'succeeded', settledAt: T2, summary: 'Review passed' },
    });
    expectCode(() => settleSessionTaskDelegation(succeeded, 'task_research', 'succeeded', {
      now: T2,
    }), 'terminal-task');
  });

  it('converts adapter ownership when the host records a delegation', () => {
    const adapterList = createSessionTaskList([
      { content: 'Review launch copy' },
    ], 'todowrite-adapter', { id: 'tasks_adapter', taskIds: ['task_review'], now: T0 });

    expectCode(() => createSessionTaskList([{
      content: 'Invalid adapter delegation',
      status: 'delegated',
      delegation: { receiptId: 'receipt-1', targetAgentSlug: 'critic', dispatchedAt: T0 },
    }], 'todowrite-adapter'), 'invalid-list');

    const delegated = delegateSessionTask(adapterList, 'task_review', {
      receiptId: 'receipt-1',
      targetAgentSlug: 'critic',
      dispatchedAt: T1,
    }, T1);

    expect(delegated.source).toBe('native-tool');
    expect(delegated.items[0]?.status).toBe('delegated');
  });

  it('returns failed delegation work to pending and clears provenance only on reopen', () => {
    const delegated = delegateSessionTask(createList(), 'task_research', {
      receiptId: 'receipt-1',
      targetAgentSlug: 'critic',
      dispatchedAt: T0,
    }, T0);
    const failed = settleSessionTaskDelegation(delegated, 'task_research', 'failed', {
      summary: 'Provider failed',
      now: T1,
    });

    expect(failed.items[0]).toMatchObject({
      status: 'pending',
      delegation: { receiptId: 'receipt-1', outcome: 'failed', summary: 'Provider failed' },
    });
    const restarted = startSessionTask(failed, 'task_research', T2);
    expect(restarted.items[0]?.delegation?.outcome).toBe('failed');

    const completed = completeSessionTask(restarted, 'task_research', T2);
    const reopened = reopenSessionTask(completed, 'task_research', T2);
    expect(reopened.items[0]?.delegation).toBeUndefined();
  });

  it('parses every status defensively and rejects malformed persisted state', () => {
    const valid = createSessionTaskList([
      { content: 'Pending', status: 'pending' },
      { content: 'Active', status: 'in_progress' },
      {
        content: 'Delegated',
        status: 'delegated',
        delegation: { receiptId: 'receipt-1', targetAgentSlug: 'critic', dispatchedAt: T0 },
      },
      { content: 'Complete', status: 'completed' },
      { content: 'Abandoned', status: 'abandoned' },
    ], 'native-tool', {
      id: 'tasks_all',
      taskIds: ['task_pending', 'task_active', 'task_delegated', 'task_complete', 'task_abandoned'],
      now: T0,
    });

    expect(parseSessionTaskList(valid)).toEqual(valid);
    expect(parseSessionTaskList({ ...valid, schemaVersion: 99 })).toBeUndefined();
    expect(parseSessionTaskList({ ...valid, revision: 0 })).toBeUndefined();
    expect(parseSessionTaskList({ ...valid, items: [{ ...valid.items[0], content: ' ' }] })).toBeUndefined();
    expect(parseSessionTaskList({ ...valid, items: [valid.items[0], { ...valid.items[0] }] })).toBeUndefined();
    expect(parseSessionTaskList({
      ...valid,
      items: [{ ...valid.items[2], delegation: undefined }],
    })).toBeUndefined();
  });

  it('rejects stale revision fences with a typed conflict code', () => {
    const list = createList();

    expect(assertSessionTaskListRevision(list, list.id, list.revision)).toBe(list);
    expectCode(() => assertSessionTaskListRevision(list, list.id, list.revision + 1), 'stale-revision');
    expectCode(() => assertSessionTaskListRevision(undefined, list.id, list.revision), 'stale-revision');
  });

  it('demotes interrupted in-progress work exactly once after restart', () => {
    const active = startSessionTask(createList(), 'task_research', T1);
    const recovered = recoverSessionTaskListAfterRestart(active, T2);

    expect(recovered.revision).toBe(active.revision + 1);
    expect(recovered.items.find(item => item.id === 'task_research')?.status).toBe('pending');
    expect(recoverSessionTaskListAfterRestart(recovered, T2)).toEqual(recovered);
  });

  it('projects TodoWrite snapshots while preserving matching ids and timestamps', () => {
    const first = projectTodoWriteSessionTasks(undefined, [
      { content: 'Research release timing', activeForm: 'Researching release timing', status: 'in_progress' },
      { content: 'Draft campaign brief', status: 'pending' },
    ], T0);
    const second = projectTodoWriteSessionTasks(first, [
      { content: 'Research release timing', status: 'completed' },
      { content: 'Draft campaign brief', activeForm: 'Drafting campaign brief', status: 'in_progress' },
      { content: 'Verify assets', status: 'pending' },
    ], T1);

    expect(second.source).toBe('todowrite-adapter');
    expect(second.revision).toBe(first.revision + 1);
    expect(second.items[0]?.id).toBe(first.items[0]?.id);
    expect(second.items[0]?.createdAt).toBe(first.items[0]?.createdAt);
    expect(second.items[2]?.id).toStartWith('task_');
  });

  it('rejects malformed TodoWrite snapshots and protects delegated host state', () => {
    expectCode(() => projectTodoWriteSessionTasks(undefined, [
      { content: 'One', status: 'in_progress' },
      { content: 'Two', status: 'in_progress' },
    ]), 'invalid-list');

    const delegated = delegateSessionTask(createList(), 'task_research', {
      receiptId: 'receipt-1',
      targetAgentSlug: 'researcher',
      dispatchedAt: T1,
    }, T1);
    expectCode(() => projectTodoWriteSessionTasks(delegated, [
      { content: 'Draft campaign brief', status: 'pending' },
    ], T2), 'invalid-list');
  });
});

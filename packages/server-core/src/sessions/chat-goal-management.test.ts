import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatGoalState, loadSession, pauseChatGoalState } from '@craft-agent/shared/sessions';
import { SessionManager, createManagedSession } from './SessionManager.ts';

describe('SessionManager chat Goal management', () => {
  let root: string;
  let manager: SessionManager;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chat-goal-management-'));
    manager = new SessionManager();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function installSession() {
    const workspace = { id: 'ws-test', name: 'Test', rootPath: root, createdAt: 1 };
    const chatGoal = createChatGoalState({ objective: 'Finish the plan' }, { id: 'goal-1', now: 100 });
    const managed = createManagedSession(
      { id: 'session-1', createdAt: 1, chatGoal },
      workspace as never,
      { messagesLoaded: true },
    );
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed);
    return managed;
  }

  it('persists pause/edit/resume with append-only Goal events', async () => {
    const managed = installSession();
    const paused = await manager.pauseChatGoal('session-1', { goalId: 'goal-1', revision: 1 });
    const edited = await manager.editChatGoal('session-1', { goalId: 'goal-1', revision: paused.revision }, { objective: 'Finish the launch plan' });
    const resumed = await manager.resumeChatGoal('session-1', { goalId: 'goal-1', revision: edited.revision });

    expect(resumed.status).toBe('active');
    expect(resumed.objective).toBe('Finish the launch plan');
    expect(managed.messages.filter(message => message.goalEvent).map(message => message.goalEvent?.type)).toEqual([
      'paused',
      'edited',
      'resumed',
    ]);
    expect(loadSession(root, 'session-1')?.chatGoal).toEqual(resumed);
    expect(loadSession(root, 'session-1')?.messages.filter(message => message.goalEvent)).toHaveLength(3);
  });

  it('rejects stale revisions and preserves the current Goal', async () => {
    installSession();
    await manager.pauseChatGoal('session-1', { goalId: 'goal-1', revision: 1 });

    await expect(manager.editChatGoal(
      'session-1',
      { goalId: 'goal-1', revision: 1 },
      { objective: 'Stale edit' },
    )).rejects.toThrow('Goal changed');
    expect(manager.getChatGoal('session-1')?.objective).toBe('Finish the plan');
  });

  it('serializes concurrent mutations so one stale writer loses', async () => {
    installSession();
    const results = await Promise.allSettled([
      manager.editChatGoal('session-1', { goalId: 'goal-1', revision: 1 }, { objective: 'First edit' }),
      manager.editChatGoal('session-1', { goalId: 'goal-1', revision: 1 }, { objective: 'Second edit' }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(manager.getChatGoal('session-1')?.revision).toBe(2);
  });

  it('keeps model completion requests provisional', async () => {
    const managed = installSession();
    const result = await manager.requestChatGoalUpdate('session-1', {
      goalId: 'goal-1',
      revision: 1,
      status: 'complete',
      summary: 'Finished.',
      evidence: ['report.md'],
    });

    expect(result).toEqual({ accepted: true, pending: true, status: 'complete' });
    expect(managed.chatGoal?.status).toBe('active');
    expect(managed.pendingChatGoalUpdate?.status).toBe('complete');
    await expect(manager.requestChatGoalUpdate('session-1', {
      goalId: 'goal-1',
      revision: 1,
      status: 'blocked',
      summary: 'Blocked.',
      blockerFingerprint: 'same-blocker',
    })).rejects.toThrow('already submitted');
  });

  it('archives only after pausing an active Goal', async () => {
    installSession();
    await manager.archiveSession('session-1');

    const persisted = loadSession(root, 'session-1');
    expect(persisted?.isArchived).toBe(true);
    expect(persisted?.chatGoal?.status).toBe('paused');
    expect(persisted?.chatGoal?.stop?.code).toBe('session-archived');
  });

  it('activates an ownership-transferred snapshot as a new Goal id', async () => {
    const managed = installSession();
    managed.chatGoal = pauseChatGoalState(managed.chatGoal!, {
      code: 'ownership-changed',
      message: 'Transferred.',
    });

    const resumed = await manager.resumeChatGoal('session-1', {
      goalId: managed.chatGoal.id,
      revision: managed.chatGoal.revision,
    });

    expect(resumed.status).toBe('active');
    expect(resumed.id).not.toBe('goal-1');
    expect(resumed.round).toBe(0);
    expect(managed.messages.at(-1)?.goalEvent?.type).toBe('created');
  });

  it('rejects Goal proposals from hidden sessions', async () => {
    const managed = installSession();
    managed.hidden = true;

    await expect(manager.proposeChatGoal('session-1', {
      objective: 'Run invisibly',
    })).rejects.toThrow('visible user-owned chat');
  });
});

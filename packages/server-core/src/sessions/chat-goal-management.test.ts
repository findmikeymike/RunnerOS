import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatGoalState, loadSession, pauseChatGoalState } from '@craft-agent/shared/sessions';
import { SessionManager, createManagedSession } from './SessionManager.ts';
import type { ChatGoalDriver } from './ChatGoalDriver.ts';

describe('SessionManager chat Goal management', () => {
  let root: string;
  let manager: SessionManager;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chat-goal-management-'));
    manager = new SessionManager();
    (manager as unknown as { dispatchChatGoalContinuation(): void }).dispatchChatGoalContinuation = () => {};
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function installSession(options: { withGoal?: boolean; hidden?: boolean } = {}) {
    const workspace = { id: 'ws-test', name: 'Test', rootPath: root, createdAt: 1 };
    const chatGoal = createChatGoalState({ objective: 'Finish the plan' }, { id: 'goal-1', now: 100 });
    const managed = createManagedSession(
      {
        id: 'session-1',
        name: 'Goal test session',
        createdAt: 1,
        chatGoal: options.withGoal === false ? undefined : chatGoal,
        hidden: options.hidden,
      },
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
    installSession({ hidden: true });

    await expect(manager.proposeChatGoal('session-1', {
      objective: 'Run invisibly',
    })).rejects.toThrow('visible user-owned chat');
  });

  it('requires a host nonce and durably admits the first Goal turn before acknowledgement', async () => {
    installSession({ withGoal: false });
    const pushedEvents: Array<{ type?: string }> = [];
    manager.setEventSink((_channel, _target, event) => pushedEvents.push(event));
    const prepared = await manager.prepareChatGoalCreation('session-1', {
      objective: 'Finish the release plan',
      doneWhen: 'The plan is saved and verified',
      maxRounds: 4,
    });

    await expect(manager.startChatGoal('session-1', 'wrong-nonce', 'Start the plan')).rejects.toThrow('confirmation');
    expect(manager.getChatGoal('session-1')).toBeUndefined();

    let acceptedMessageId: string | undefined;
    await manager.sendMessage(
      'session-1',
      'Start the plan',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (messageId) => { acceptedMessageId = messageId; },
      { kind: 'create', confirmationNonce: prepared.confirmationNonce },
    ).catch(() => { /* expected post-ack provider-init failure in this unit harness */ });
    const persisted = loadSession(root, 'session-1');
    expect(manager.getChatGoal('session-1')?.round).toBe(1);
    expect(persisted?.chatGoal?.id).toBe(manager.getChatGoal('session-1')?.id);
    expect(persisted?.messages.some(message => message.id === acceptedMessageId && message.type === 'user')).toBe(true);
    expect(persisted?.messages.some(message => message.goalEvent?.type === 'created')).toBe(true);
    expect(pushedEvents.some(event => event.type === 'goal_event')).toBe(true);
  });

  it('persists and emits a visible divider when an automatic round is admitted', async () => {
    const managed = installSession();
    managed.chatGoal = { ...managed.chatGoal!, round: 1 };
    const pushedEvents: Array<{ type?: string; message?: { goalEvent?: { round?: number } } }> = [];
    manager.setEventSink((_channel, _target, event) => pushedEvents.push(event));
    const driver = (manager as unknown as { chatGoalDriver: ChatGoalDriver }).chatGoalDriver;
    const reservation = driver.reserve({
      sessionId: managed.id,
      goal: managed.chatGoal,
      processingGeneration: managed.processingGeneration,
      settledReason: 'complete',
      didReceiveFinalResponse: true,
      hasQueuedHumanInput: false,
      hasPendingAuth: false,
      hasPendingApproval: false,
      hasPendingPlan: false,
      hasPendingBackgroundWork: false,
      isArchived: false,
      currentTotalTokens: 0,
    });
    expect(reservation.kind).toBe('reserved');
    if (reservation.kind !== 'reserved') return;

    await manager.sendMessage(
      managed.id,
      '<system-reminder>Continue.</system-reminder>',
      undefined,
      undefined,
      { hidden: true },
      undefined,
      undefined,
      undefined,
      { kind: 'continuation', reservationId: reservation.reservation.id },
    ).catch(() => { /* expected post-ack provider-init failure in this unit harness */ });

    const continued = loadSession(root, managed.id)?.messages.find(message =>
      message.goalEvent?.type === 'resumed' && message.goalEvent.round === 2
    );
    expect(continued?.goalEvent?.summary).toContain('continuing automatically');
    expect(pushedEvents.some(event => event.type === 'goal_event' && event.message?.goalEvent?.round === 2)).toBe(true);
  });

  it('finalizes a provisional completion only after a clean final response', async () => {
    const managed = installSession();
    await manager.flagSession('session-1');
    managed.isProcessing = true;
    managed.processingGeneration = 1;
    managed.activeChatGoalTurn = {
      origin: 'goal-initial',
      goalId: 'goal-1',
      goalRevision: 1,
      admittedRound: 1,
      completedToolCountAtStart: 0,
      failedToolCountAtStart: 0,
    };
    managed.messages.push({ id: 'assistant-1', role: 'assistant', content: 'Finished.', timestamp: 200 });
    await manager.requestChatGoalUpdate('session-1', {
      goalId: 'goal-1',
      revision: 1,
      status: 'complete',
      summary: 'Finished the plan.',
    });

    await (manager as unknown as {
      onProcessingStopped(id: string, reason: 'complete'): Promise<void>;
    }).onProcessingStopped('session-1', 'complete');

    expect(manager.getChatGoal('session-1')?.status).toBe('complete');
    expect(loadSession(root, 'session-1')?.chatGoal?.completion?.summary).toBe('Finished the plan.');
  });

  it('deduplicates completion and reserves only one continuation', async () => {
    const managed = installSession();
    await manager.flagSession('session-1');
    managed.isProcessing = true;
    managed.processingGeneration = 1;
    managed.activeChatGoalTurn = {
      origin: 'goal-initial',
      goalId: 'goal-1',
      goalRevision: 1,
      admittedRound: 1,
      completedToolCountAtStart: 0,
      failedToolCountAtStart: 0,
    };
    managed.messages.push({ id: 'assistant-1', role: 'assistant', content: 'More work remains.', timestamp: 200 });
    let dispatches = 0;
    (manager as unknown as { dispatchChatGoalContinuation(): void }).dispatchChatGoalContinuation = () => { dispatches += 1; };
    const stop = (manager as unknown as {
      onProcessingStopped(id: string, reason: 'complete'): Promise<void>;
    }).onProcessingStopped.bind(manager);

    await Promise.all([stop('session-1', 'complete'), stop('session-1', 'complete')]);
    expect(dispatches).toBe(1);
  });

  it('pauses instead of continuing across an authentication boundary', async () => {
    const managed = installSession();
    await manager.flagSession('session-1');
    managed.isProcessing = true;
    managed.processingGeneration = 1;
    managed.pendingAuthRequest = { requestId: 'auth-1' } as never;
    managed.messages.push({ id: 'assistant-1', role: 'assistant', content: 'Authentication is required.', timestamp: 200 });
    await manager.requestChatGoalUpdate('session-1', {
      goalId: 'goal-1',
      revision: 1,
      status: 'complete',
      summary: 'Claimed complete despite auth.',
    });

    await (manager as unknown as {
      onProcessingStopped(id: string, reason: 'complete'): Promise<void>;
    }).onProcessingStopped('session-1', 'complete');

    expect(manager.getChatGoal('session-1')?.status).toBe('paused');
    expect(manager.getChatGoal('session-1')?.stop?.code).toBe('needs-auth');
  });
});

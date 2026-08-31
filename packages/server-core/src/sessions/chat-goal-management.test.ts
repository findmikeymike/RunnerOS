import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admitChatGoalRound, appendSessionTasks, createChatGoalState, createSessionTaskList, loadSession, pauseChatGoalState } from '@craft-agent/shared/sessions';
import { SessionManager, createManagedSession } from './SessionManager.ts';
import type { ChatGoalDriver, ChatGoalTurnContext } from './ChatGoalDriver.ts';

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

  it('returns a typed invalidation when a continuation reservation is stale', async () => {
    const managed = installSession();

    await expect(manager.sendMessage(
      managed.id,
      '<system-reminder>Continue.</system-reminder>',
      undefined,
      undefined,
      { hidden: true },
      undefined,
      undefined,
      undefined,
      { kind: 'continuation', reservationId: 'missing-reservation' },
    )).rejects.toMatchObject({
      name: 'ChatGoalAdmissionInvalidatedError',
      code: 'stale-reservation',
    });
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
      sessionTaskRevisionAtStart: 0,
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

  it('keeps a Goal active when completion is claimed with unfinished session tasks', async () => {
    const managed = installSession();
    managed.sessionTasks = createSessionTaskList([
      { content: 'Finish the report', status: 'pending' },
    ], 'native-tool', { id: 'tasks_1', now: '2026-08-30T00:00:00.000Z' });
    managed.isProcessing = true;
    managed.processingGeneration = 1;
    managed.activeChatGoalTurn = {
      origin: 'goal-initial',
      goalId: 'goal-1',
      goalRevision: 1,
      admittedRound: 1,
      completedToolCountAtStart: 0,
      failedToolCountAtStart: 0,
      sessionTaskRevisionAtStart: 1,
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

    expect(manager.getChatGoal('session-1')?.status).toBe('active');
    expect(manager.getChatGoal('session-1')?.completion).toBeUndefined();
    expect(managed.pendingChatGoalUpdate).toBeUndefined();
  });

  it('does not enforce a stale task list after advisory persistence degrades', async () => {
    const managed = installSession();
    managed.sessionTasks = createSessionTaskList([
      { content: 'Stale unfinished task', status: 'pending' },
    ], 'native-tool', { id: 'tasks_1', now: '2026-08-30T00:00:00.000Z' });
    managed.sessionTasksDegraded = true;
    managed.messages.push({ id: 'assistant-1', role: 'assistant', content: 'Finished.', timestamp: 200 });
    await manager.requestChatGoalUpdate('session-1', {
      goalId: 'goal-1',
      revision: 1,
      status: 'complete',
      summary: 'Finished despite the advisory task-store failure.',
    });

    await (manager as unknown as {
      settleChatGoalAtIdle(
        session: typeof managed,
        reason: 'complete',
        didReceiveNewFinalMessage: boolean,
        turn: undefined,
      ): Promise<unknown>;
    }).settleChatGoalAtIdle(managed, 'complete', true, undefined);

    expect(manager.getChatGoal('session-1')?.status).toBe('complete');
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
      sessionTaskRevisionAtStart: 0,
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

  it('disarms and persists an active Goal when sessions are restored after restart', async () => {
    const managed = installSession();
    await manager.flagSession(managed.id);

    const restarted = new SessionManager();
    await (restarted as unknown as {
      loadSessionsFromDisk(workspaces: Array<typeof managed.workspace>): Promise<void>;
    }).loadSessionsFromDisk([managed.workspace]);

    expect(restarted.getChatGoal(managed.id)?.status).toBe('paused');
    expect(restarted.getChatGoal(managed.id)?.stop?.code).toBe('restart-disarmed');
    expect(loadSession(root, managed.id)?.chatGoal?.status).toBe('paused');
    expect(loadSession(root, managed.id)?.messages.at(-1)?.goalEvent?.type).toBe('paused');
  });

  it('pauses after two identical continuation turns make no tool progress', async () => {
    const managed = installSession();
    managed.chatGoal = { ...managed.chatGoal!, round: 1 };
    const settle = (manager as unknown as {
      settleChatGoalAtIdle(
        session: typeof managed,
        reason: 'complete',
        didReceiveNewFinalMessage: boolean,
        turn: {
          origin: 'goal-continuation';
          goalId: string;
          goalRevision: number;
          reservationId: string;
          admittedRound: number;
          completedToolCountAtStart: number;
          failedToolCountAtStart: number;
          sessionTaskRevisionAtStart: number;
        },
      ): Promise<ReturnType<ChatGoalDriver['consume']>>;
    }).settleChatGoalAtIdle.bind(manager);

    managed.messages.push({ id: 'assistant-1', role: 'assistant', content: 'I am still reviewing the same files.', timestamp: 200 });
    const firstReservation = await settle(managed, 'complete', true, {
      origin: 'goal-continuation',
      goalId: 'goal-1',
      goalRevision: 1,
      reservationId: 'prior-reservation-1',
      admittedRound: 1,
      completedToolCountAtStart: 0,
      failedToolCountAtStart: 0,
      sessionTaskRevisionAtStart: 0,
    });
    expect(firstReservation).toBeDefined();
    if (!firstReservation) return;

    const driver = (manager as unknown as { chatGoalDriver: ChatGoalDriver }).chatGoalDriver;
    expect(driver.consume(managed.id, firstReservation.id, managed.chatGoal, managed.processingGeneration)).toBeDefined();
    managed.chatGoal = admitChatGoalRound(managed.chatGoal!);
    managed.messages.push({ id: 'assistant-2', role: 'assistant', content: 'I am still reviewing the same files.', timestamp: 300 });

    await settle(managed, 'complete', true, {
      origin: 'goal-continuation',
      goalId: 'goal-1',
      goalRevision: 1,
      reservationId: firstReservation.id,
      admittedRound: 2,
      completedToolCountAtStart: 0,
      failedToolCountAtStart: 0,
      sessionTaskRevisionAtStart: 0,
    });

    expect(manager.getChatGoal(managed.id)?.status).toBe('paused');
    expect(manager.getChatGoal(managed.id)?.stop?.code).toBe('no-progress');
  });

  it('treats a session task revision as progress during no-progress detection', async () => {
    const managed = installSession();
    managed.chatGoal = { ...managed.chatGoal!, round: 1 };
    managed.sessionTasks = createSessionTaskList([
      { content: 'Draft the report', status: 'pending' },
    ], 'native-tool', { id: 'tasks_1', now: '2026-08-30T00:00:00.000Z' });
    const settle = (manager as unknown as {
      settleChatGoalAtIdle(
        session: typeof managed,
        reason: 'complete',
        didReceiveNewFinalMessage: boolean,
        turn: {
          origin: 'goal-continuation';
          goalId: string;
          goalRevision: number;
          reservationId: string;
          admittedRound: number;
          completedToolCountAtStart: number;
          failedToolCountAtStart: number;
          sessionTaskRevisionAtStart: number;
        },
      ): Promise<ReturnType<ChatGoalDriver['consume']>>;
    }).settleChatGoalAtIdle.bind(manager);

    managed.messages.push({ id: 'assistant-1', role: 'assistant', content: 'I am still reviewing the same files.', timestamp: 200 });
    const firstReservation = await settle(managed, 'complete', true, {
      origin: 'goal-continuation',
      goalId: 'goal-1',
      goalRevision: 1,
      reservationId: 'prior-reservation-1',
      admittedRound: 1,
      completedToolCountAtStart: 0,
      failedToolCountAtStart: 0,
      sessionTaskRevisionAtStart: 1,
    });
    expect(firstReservation).toBeDefined();
    if (!firstReservation) return;

    const driver = (manager as unknown as { chatGoalDriver: ChatGoalDriver }).chatGoalDriver;
    expect(driver.consume(managed.id, firstReservation.id, managed.chatGoal, managed.processingGeneration)).toBeDefined();
    managed.chatGoal = admitChatGoalRound(managed.chatGoal!);
    managed.sessionTasks = appendSessionTasks(managed.sessionTasks, [{ content: 'Verify the report', status: 'pending' }]);
    managed.messages.push({ id: 'assistant-2', role: 'assistant', content: 'I am still reviewing the same files.', timestamp: 300 });

    const secondReservation = await settle(managed, 'complete', true, {
      origin: 'goal-continuation',
      goalId: 'goal-1',
      goalRevision: 1,
      reservationId: firstReservation.id,
      admittedRound: 2,
      completedToolCountAtStart: 0,
      failedToolCountAtStart: 0,
      sessionTaskRevisionAtStart: 1,
    });

    expect(secondReservation).toBeDefined();
    expect(manager.getChatGoal(managed.id)?.status).toBe('active');
  });

  it('pauses paraphrased spinning after two rounds with no task or tool progress', async () => {
    const managed = installSession();
    managed.chatGoal = { ...managed.chatGoal!, round: 1 };
    managed.sessionTasks = createSessionTaskList([
      { content: 'Draft the report', status: 'pending' },
    ], 'native-tool', { id: 'tasks_1', now: '2026-08-30T00:00:00.000Z' });
    const settle = (manager as unknown as {
      settleChatGoalAtIdle(
        session: typeof managed,
        reason: 'complete',
        didReceiveNewFinalMessage: boolean,
        turn: ChatGoalTurnContext,
      ): Promise<ReturnType<ChatGoalDriver['consume']>>;
    }).settleChatGoalAtIdle.bind(manager);
    const turn = (reservationId: string, admittedRound: number): ChatGoalTurnContext => ({
      origin: 'goal-continuation',
      goalId: 'goal-1',
      goalRevision: 1,
      reservationId,
      admittedRound,
      completedToolCountAtStart: 0,
      failedToolCountAtStart: 0,
      sessionTaskRevisionAtStart: 1,
    });

    managed.messages.push({ id: 'assistant-1', role: 'assistant', content: 'I am still reviewing the files.', timestamp: 200 });
    const firstReservation = await settle(managed, 'complete', true, turn('prior-reservation-1', 1));
    expect(firstReservation).toBeDefined();
    if (!firstReservation) return;

    const driver = (manager as unknown as { chatGoalDriver: ChatGoalDriver }).chatGoalDriver;
    expect(driver.consume(managed.id, firstReservation.id, managed.chatGoal, managed.processingGeneration)).toBeDefined();
    managed.chatGoal = admitChatGoalRound(managed.chatGoal!);
    managed.messages.push({ id: 'assistant-2', role: 'assistant', content: 'I am checking another angle now.', timestamp: 300 });

    await settle(managed, 'complete', true, turn(firstReservation.id, 2));

    expect(manager.getChatGoal(managed.id)?.status).toBe('paused');
    expect(manager.getChatGoal(managed.id)?.stop?.code).toBe('no-progress');
  });

  it('invalidates an active Goal reservation when its session is deleted', async () => {
    const managed = installSession();
    const driver = (manager as unknown as { chatGoalDriver: ChatGoalDriver }).chatGoalDriver;
    const result = driver.reserve({
      sessionId: managed.id,
      goal: managed.chatGoal!,
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
    expect(result.kind).toBe('reserved');
    if (result.kind !== 'reserved') return;

    await manager.deleteSession(managed.id);

    expect(driver.consume(
      managed.id,
      result.reservation.id,
      managed.chatGoal,
      managed.processingGeneration,
    )).toBeUndefined();
  });
});

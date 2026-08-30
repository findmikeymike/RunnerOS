import { describe, expect, it } from 'bun:test';
import {
  CHAT_GOAL_DEFAULT_MAX_ROUNDS,
  ChatGoalConflictError,
  ChatGoalValidationError,
  admitChatGoalRound,
  assertChatGoalRevision,
  cancelChatGoalState,
  completeChatGoalState,
  createChatGoalState,
  disarmChatGoalAfterRestart,
  editChatGoalState,
  limitChatGoalByBudget,
  makeChatGoalEvent,
  parseChatGoalState,
  pauseChatGoalState,
  recordChatGoalBlocker,
  resumeChatGoalState,
} from '../chat-goal.ts';

describe('chat goal state', () => {
  it('creates a normalized, bounded active Goal', () => {
    const goal = createChatGoalState(
      { objective: '  Build the release plan  ', doneWhen: '  Plan is saved  ' },
      { id: 'goal-1', now: 100, tokenBaseline: 50 },
    );

    expect(goal).toEqual({
      schemaVersion: 1,
      id: 'goal-1',
      objective: 'Build the release plan',
      doneWhen: 'Plan is saved',
      status: 'active',
      revision: 1,
      round: 0,
      maxRounds: CHAT_GOAL_DEFAULT_MAX_ROUNDS,
      createdAt: 100,
      updatedAt: 100,
      tokenBaseline: 50,
      tokenBudget: undefined,
    });
  });

  it('rejects empty objectives and unsafe round budgets', () => {
    expect(() => createChatGoalState({ objective: ' ' })).toThrow(ChatGoalValidationError);
    expect(() => createChatGoalState({ objective: 'x', maxRounds: 1 })).toThrow(ChatGoalValidationError);
    expect(() => createChatGoalState({ objective: 'x', maxRounds: 13 })).toThrow(ChatGoalValidationError);
    expect(() => createChatGoalState({ objective: 'x', tokenBudget: 0 })).toThrow(ChatGoalValidationError);
  });

  it('edits with a revision fence and never lowers the cap below used rounds', () => {
    const initial = { ...createChatGoalState({ objective: 'First', maxRounds: 6 }, { id: 'goal-1', now: 100 }), round: 4 };
    const edited = editChatGoalState(initial, { objective: 'Second', doneWhen: null, maxRounds: 5 }, 200);

    expect(edited.objective).toBe('Second');
    expect(edited.revision).toBe(2);
    expect(edited.updatedAt).toBe(200);
    expect(() => editChatGoalState(edited, { maxRounds: 3 })).toThrow(ChatGoalValidationError);
    expect(() => assertChatGoalRevision(edited, 'goal-1', 1)).toThrow(ChatGoalConflictError);
  });

  it('pauses and requires a remaining round before resume', () => {
    const initial = createChatGoalState({ objective: 'Work', maxRounds: 2 }, { id: 'goal-1', now: 100 });
    const paused = pauseChatGoalState(initial, { code: 'restart-disarmed', message: 'Resume explicitly.', at: 200 });
    const resumed = resumeChatGoalState(paused, 300);

    expect(paused.status).toBe('paused');
    expect(resumed.status).toBe('active');
    expect(resumed.revision).toBe(2);
    expect(resumed.stop).toBeUndefined();
    expect(() => resumeChatGoalState({ ...paused, round: 2 })).toThrow(ChatGoalConflictError);
  });

  it('cancels idempotently and emits a render-safe event', () => {
    const initial = createChatGoalState({ objective: 'Work' }, { id: 'goal-1', now: 100 });
    const cancelled = cancelChatGoalState(initial, 'Stopped.', 200);
    const event = makeChatGoalEvent(cancelled, 'cancelled', 'Stopped.', 200);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelChatGoalState(cancelled)).toBe(cancelled);
    expect(event).toEqual({
      type: 'cancelled',
      goalId: 'goal-1',
      revision: 2,
      timestamp: 200,
      round: 0,
      status: 'cancelled',
      summary: 'Stopped.',
    });
  });

  it('rejects malformed persisted Goal state without throwing', () => {
    const valid = createChatGoalState({ objective: 'Work' }, { id: 'goal-1', now: 100 });
    expect(parseChatGoalState(valid)).toEqual(valid);
    expect(parseChatGoalState({ ...valid, status: 'running' })).toBeUndefined();
    expect(parseChatGoalState({ ...valid, round: 7, maxRounds: 6 })).toBeUndefined();
    expect(parseChatGoalState({ ...valid, schemaVersion: 99 })).toBeUndefined();
    expect(parseChatGoalState({ ...valid, status: 'complete' })).toBeUndefined();
    expect(parseChatGoalState({ ...valid, stop: { code: 'user-paused', message: 'bad', at: 100 } })).toBeUndefined();
  });

  it('admits bounded rounds and marks the exhausted Goal budget-limited', () => {
    const initial = createChatGoalState({ objective: 'Work', maxRounds: 2 }, { id: 'goal-1', now: 100 });
    const roundOne = admitChatGoalRound(initial, 110);
    const roundTwo = admitChatGoalRound(roundOne, 120);
    const limited = limitChatGoalByBudget(roundTwo, 'round', 130);

    expect(roundTwo.round).toBe(2);
    expect(() => admitChatGoalRound(roundTwo)).toThrow(ChatGoalConflictError);
    expect(limited.status).toBe('budget-limited');
    expect(limited.stop?.code).toBe('round-limit');
  });

  it('completes only an active Goal with durable completion evidence', () => {
    const initial = admitChatGoalRound(createChatGoalState({ objective: 'Work' }, { id: 'goal-1', now: 100 }), 110);
    const complete = completeChatGoalState(initial, { summary: 'Finished.', evidence: [' report.md '], completedAt: 200 });

    expect(complete.status).toBe('complete');
    expect(complete.completion).toEqual({ summary: 'Finished.', evidence: ['report.md'], completedAt: 200 });
    expect(parseChatGoalState(complete)).toEqual(complete);
    expect(() => resumeChatGoalState(complete)).toThrow(ChatGoalConflictError);
  });

  it('requires the same blocker for three Goal turns', () => {
    const initial = createChatGoalState({ objective: 'Work' }, { id: 'goal-1', now: 100 });
    const first = recordChatGoalBlocker(initial, { fingerprint: 'network', message: 'Offline.' }, 110);
    const reset = recordChatGoalBlocker(first, { fingerprint: 'auth', message: 'No token.' }, 120);
    const second = recordChatGoalBlocker(reset, { fingerprint: 'auth', message: 'No token.' }, 130);
    const blocked = recordChatGoalBlocker(second, { fingerprint: 'auth', message: 'No token.' }, 140);

    expect(first.blockerAudit?.consecutiveGoalTurns).toBe(1);
    expect(reset.blockerAudit?.consecutiveGoalTurns).toBe(1);
    expect(second.status).toBe('active');
    expect(blocked.status).toBe('blocked');
    expect(blocked.stop?.code).toBe('repeated-blocker');
  });

  it('disarms active Goals after restart without altering terminal Goals', () => {
    const active = createChatGoalState({ objective: 'Work' }, { id: 'goal-1', now: 100 });
    const paused = disarmChatGoalAfterRestart(active, 200);
    const cancelled = cancelChatGoalState(active, 'Stopped.', 200);

    expect(paused.status).toBe('paused');
    expect(paused.stop?.code).toBe('restart-disarmed');
    expect(disarmChatGoalAfterRestart(cancelled, 300)).toBe(cancelled);
  });
});

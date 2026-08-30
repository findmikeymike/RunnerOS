import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleCreateGoal, handleGetGoal, handleUpdateGoal } from './chat-goal.ts';

function context(overrides: Partial<SessionToolContext>): SessionToolContext {
  return { sessionId: 'session-1', ...overrides } as SessionToolContext;
}

describe('chat Goal session tools', () => {
  it('reads the current Goal without mutating it', async () => {
    const goal = { id: 'goal-1', status: 'active', revision: 1 };
    const result = await handleGetGoal(context({ getChatGoal: () => goal }));

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('goal-1');
  });

  it('proposes creation but delegates activation to the host confirmation flow', async () => {
    let received: unknown;
    const result = await handleCreateGoal(context({
      proposeChatGoal: async (input) => {
        received = input;
        return { proposed: true, message: 'Awaiting confirmation.' };
      },
    }), { objective: 'Finish the plan', maxRounds: 6 });

    expect(received).toEqual({ objective: 'Finish the plan', maxRounds: 6 });
    expect(result.content[0]?.text).toContain('Awaiting confirmation');
  });

  it('records completion as a pending host-audited request', async () => {
    let received: unknown;
    const result = await handleUpdateGoal(context({
      requestChatGoalUpdate: async (input) => {
        received = input;
        return { accepted: true, pending: true };
      },
    }), {
      goalId: 'goal-1',
      revision: 1,
      status: 'complete',
      summary: 'Finished.',
      evidence: ['report.md'],
    });

    expect(received).toMatchObject({ status: 'complete', summary: 'Finished.' });
    expect(result.content[0]?.text).toContain('"pending": true');
  });

  it('fails clearly when the backend capability is unavailable', async () => {
    const result = await handleGetGoal(context({}));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toStartWith('[ERROR]');
  });
});

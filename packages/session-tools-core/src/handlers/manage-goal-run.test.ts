import { describe, expect, test } from 'bun:test';
import type { ManageGoalRunResult } from '@craft-agent/shared/scheduled-work';
import type { SessionToolContext } from '../context.ts';
import { handleManageGoalRun, type ManageGoalRunToolInput } from './manage-goal-run.ts';

const input: ManageGoalRunToolInput = {
  runId: 'goal-run-1',
  operation: 'pause',
  expectedUpdatedAt: '2026-08-30T12:00:00.000Z',
  explanation: 'The user asked to pause this run.',
};

function context(manageGoalRun?: SessionToolContext['manageGoalRun']): SessionToolContext {
  return { manageGoalRun } as SessionToolContext;
}

describe('manage_goal_run', () => {
  test('is unavailable outside HNIC', async () => {
    const result = await handleManageGoalRun(context(), input);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('only available to HNIC');
  });

  test('blocks an unresolved confirmation before calling the backend', async () => {
    let called = false;
    const result = await handleManageGoalRun(context(async () => {
      called = true;
      return {} as ManageGoalRunResult;
    }), { ...input, requiresUserConfirmation: true });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  test('passes a confirmed version-fenced operation to the backend', async () => {
    let captured: ManageGoalRunToolInput | undefined;
    const result = await handleManageGoalRun(context(async (args) => {
      captured = args;
      return { coordinator: { title: 'Launch goal' }, work: {} } as ManageGoalRunResult;
    }), input);
    expect(result.isError).toBe(false);
    expect(captured).toEqual(input);
  });
});

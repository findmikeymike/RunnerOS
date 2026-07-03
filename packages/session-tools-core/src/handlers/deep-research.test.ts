import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleApproveDeepResearchPlan,
  handleCancelDeepResearchRun,
  handleGetDeepResearchRun,
  handleListDeepResearchRuns,
  handleReviseDeepResearchPlan,
  handleStartDeepResearch,
} from './deep-research.ts';

function makeCtx(overrides?: Partial<SessionToolContext>): SessionToolContext {
  return {
    sessionId: 't',
    workspacePath: '/tmp',
    plansFolderPath: '/tmp/plans',
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    get sourcesPath() { return '/tmp/sources'; },
    get skillsPath() { return '/tmp/skills'; },
    ...overrides,
  } as SessionToolContext;
}

function text(result: { content: Array<{ text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

describe('deep research session tools', () => {
  const RUN_ID = '11111111-1111-4111-8111-111111111111';

  it('start_deep_research errors when context capability is missing', async () => {
    const result = await handleStartDeepResearch(makeCtx(), { topic: 'Find A&Rs for this artist' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('not available');
  });

  it('start_deep_research returns the run snapshot', async () => {
    const result = await handleStartDeepResearch(makeCtx({
      startDeepResearch: async (input) => ({ id: RUN_ID, state: 'awaiting_plan_approval', topic: input.topic }),
    }), { topic: 'Find A&Rs for this artist', planPolicy: 'approve', depth: 'standard' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result))).toEqual({
      id: RUN_ID,
      state: 'awaiting_plan_approval',
      topic: 'Find A&Rs for this artist',
    });
  });

  it('list_deep_research_runs returns JSON from context', async () => {
    const result = await handleListDeepResearchRuns(makeCtx({
      listDeepResearchRuns: () => ({
        total: 1,
        returned: 1,
        runs: [{
          id: RUN_ID,
          title: 'Industry hunt',
          topic: 'Find A&Rs',
          state: 'succeeded',
          planPolicy: 'auto',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      }),
    }), { state: 'succeeded', limit: 10 });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result)).runs[0].id).toBe(RUN_ID);
  });

  it('get_deep_research_run returns not found cleanly', async () => {
    const result = await handleGetDeepResearchRun(makeCtx({ getDeepResearchRun: () => null }), { runId: 'missing' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Deep research run not found');
  });

  it('approve_deep_research_plan returns updated run', async () => {
    const result = await handleApproveDeepResearchPlan(makeCtx({
      approveDeepResearchPlan: async (runId) => ({ id: runId, state: 'running' }),
    }), { runId: RUN_ID });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result))).toEqual({ id: RUN_ID, state: 'running' });
  });

  it('revise_deep_research_plan returns updated run', async () => {
    const result = await handleReviseDeepResearchPlan(makeCtx({
      reviseDeepResearchPlan: async (runId, feedback) => ({ id: runId, feedback }),
    }), { runId: RUN_ID, feedback: 'Focus on indie label A&R, not CEOs.' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result)).feedback).toContain('indie label');
  });

  it('cancel_deep_research_run returns cancelled run', async () => {
    const result = await handleCancelDeepResearchRun(makeCtx({
      cancelDeepResearchRun: async (runId) => ({ id: runId, state: 'cancelled' }),
    }), { runId: RUN_ID });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result))).toEqual({ id: RUN_ID, state: 'cancelled' });
  });
});

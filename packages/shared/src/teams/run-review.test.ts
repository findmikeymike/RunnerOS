import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTeamTask,
  updateTeamTask,
  writeTeamRun,
} from './run-storage.ts';
import type { TeamRunSnapshot, TeamTaskReview } from './run-types.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'team-review-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const RUN_ID = '44444444-4444-4444-8444-444444444444';

function sampleRun(overrides?: Partial<TeamRunSnapshot>): TeamRunSnapshot {
  return {
    id: RUN_ID,
    workspaceId: 'workspace-1',
    teamSlug: 'engineering-ship-team',
    state: 'running',
    userRequest: 'Ship it',
    teamSnapshot: {
      metadata: {
        name: 'Engineering Ship Team',
        description: 'Ships features',
        lead: 'system-architect',
        members: [
          { slug: 'coder', role: 'Implementation' },
          { slug: 'reviewer', role: 'Review' },
        ],
        permissionMode: 'ask',
      },
      body: '# Team',
    },
    permissionMode: 'ask',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const OUTPUT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'score'],
  properties: {
    verdict: { type: 'string' },
    score: { type: 'integer' },
  },
};

function review(status: TeamTaskReview['status'], findings?: string): TeamTaskReview {
  return {
    requestedAt: '2026-01-01T00:00:00.000Z',
    reviewerAgentSlug: 'reviewer',
    status,
    findings,
    reviewedAt: '2026-01-01T00:01:00.000Z',
  };
}

describe('U3: structured output schema enforcement', () => {
  test('accepts review transition when output matches schema', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Analyze', description: 'd', ownerAgentSlug: 'coder', outputSchema: OUTPUT_SCHEMA,
    });
    const updated = updateTeamTask(workspace, RUN_ID, task.id, {
      status: 'review',
      output: JSON.stringify({ verdict: 'pass', score: 9 }),
    });
    expect(updated.status).toBe('review');
  });

  test('rejects review transition when output violates schema', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Analyze', description: 'd', ownerAgentSlug: 'coder', outputSchema: OUTPUT_SCHEMA,
    });
    expect(() => updateTeamTask(workspace, RUN_ID, task.id, {
      status: 'review',
      output: JSON.stringify({ verdict: 'pass' }), // missing score
    })).toThrow(/output schema/);
  });

  test('rejects done transition when output is missing entirely', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Analyze', description: 'd', ownerAgentSlug: 'coder', outputSchema: OUTPUT_SCHEMA,
    });
    expect(() => updateTeamTask(workspace, RUN_ID, task.id, { status: 'done' }))
      .toThrow(/no output to validate/);
  });

  test('tasks without an output schema are unaffected', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, { title: 'Free', description: 'd', ownerAgentSlug: 'coder' });
    const updated = updateTeamTask(workspace, RUN_ID, task.id, { status: 'review', output: 'just prose' });
    expect(updated.status).toBe('review');
  });
});

describe('U3: evidence-gated review', () => {
  test('review cannot pass without evidence', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Build', description: 'd', ownerAgentSlug: 'coder', reviewRequired: true, reviewerAgentSlug: 'reviewer',
    });
    expect(() => updateTeamTask(workspace, RUN_ID, task.id, { review: review('passed') }))
      .toThrow(/without at least one evidence/);
  });

  test('review passes when evidence is attached', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Build', description: 'd', ownerAgentSlug: 'coder', reviewRequired: true, reviewerAgentSlug: 'reviewer',
    });
    const updated = updateTeamTask(workspace, RUN_ID, task.id, {
      review: review('passed'),
      evidence: [{ type: 'file', label: 'diff', value: 'src/foo.ts' }],
    });
    expect(updated.review?.status).toBe('passed');
  });
});

describe('U3: auto-reopen revise loop', () => {
  test('failed review reopens the task to its owner with findings', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Build', description: 'd', ownerAgentSlug: 'coder', reviewRequired: true, reviewerAgentSlug: 'reviewer',
    });
    // owner submits for review
    updateTeamTask(workspace, RUN_ID, task.id, { status: 'review', output: 'done' });
    // reviewer fails it
    const reopened = updateTeamTask(workspace, RUN_ID, task.id, {
      review: review('failed', 'Missing error handling on the null path.'),
    });
    expect(reopened.status).toBe('todo');
    expect(reopened.revisionCount).toBe(1);
    expect(reopened.reviseFindings).toBe('Missing error handling on the null path.');
    expect(reopened.lease).toBeUndefined();
    // Clean reopen: no contradictory todo + failed-review state.
    expect(reopened.review).toBeUndefined();
    expect(reopened.reviewRequired).toBe(true);
  });

  test('reopened task can be reworked and pass a fresh review', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Build', description: 'd', ownerAgentSlug: 'coder', reviewRequired: true, reviewerAgentSlug: 'reviewer',
    });
    updateTeamTask(workspace, RUN_ID, task.id, { status: 'review', output: 'v1' });
    updateTeamTask(workspace, RUN_ID, task.id, { review: review('failed', 'fix it') });
    // owner reworks, re-requests review, reviewer passes with evidence
    updateTeamTask(workspace, RUN_ID, task.id, { status: 'review', output: 'v2', review: review('requested') });
    const passed = updateTeamTask(workspace, RUN_ID, task.id, {
      review: review('passed'),
      evidence: [{ type: 'output', label: 'fixed', value: 'v2' }],
    });
    expect(passed.review?.status).toBe('passed');
    const done = updateTeamTask(workspace, RUN_ID, task.id, { status: 'done' });
    expect(done.status).toBe('done');
  });

  test('exhausting the revision budget fails the task instead of looping', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Build', description: 'd', ownerAgentSlug: 'coder',
      reviewRequired: true, reviewerAgentSlug: 'reviewer', maxRevisions: 2,
    });
    let last = updateTeamTask(workspace, RUN_ID, task.id, { review: review('failed', 'r1') }); // rev 1 -> todo
    expect(last.status).toBe('todo');
    // Re-request review (reopen cleared the prior review) then fail again, each
    // round forcing a fresh "newly failed" transition.
    updateTeamTask(workspace, RUN_ID, task.id, { review: review('requested') });
    last = updateTeamTask(workspace, RUN_ID, task.id, { review: review('failed', 'r2') }); // rev 2 -> todo
    expect(last.status).toBe('todo');
    updateTeamTask(workspace, RUN_ID, task.id, { review: review('requested') });
    last = updateTeamTask(workspace, RUN_ID, task.id, { review: review('failed', 'r3') }); // rev 3 > 2 -> failed
    expect(last.status).toBe('failed');
    expect(last.lastError).toMatch(/revision budget/);
  });
});

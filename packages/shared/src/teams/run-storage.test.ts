import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimTeamTask,
  completeTeamRun,
  controlTeamRun,
  createTeamTask,
  expireStaleTeamTaskLeases,
  getTeamRunFile,
  heartbeatTeamTask,
  isValidTeamRunId,
  linkTeamRunMemberSession,
  listTeamRunTicks,
  listTeamRuns,
  readTeamRunDetail,
  markTeamMessagesRead,
  runTeamRunTick,
  sendTeamMessage,
  updateTeamTask,
  writeTeamRun,
} from './run-storage.ts';
import type { TeamRunSnapshot } from './run-types.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'team-runs-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function sampleRun(overrides?: Partial<TeamRunSnapshot>): TeamRunSnapshot {
  return {
    id: RUN_ID,
    workspaceId: 'workspace-1',
    teamSlug: 'engineering-ship-team',
    state: 'created',
    userRequest: 'Ship the feature',
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

describe('team run storage', () => {
  test('validates run ids', () => {
    expect(isValidTeamRunId(RUN_ID)).toBe(true);
    expect(isValidTeamRunId('../bad')).toBe(false);
  });

  test('writes, reads, and lists run snapshots', () => {
    writeTeamRun(workspace, sampleRun());

    expect(existsSync(getTeamRunFile(workspace, RUN_ID))).toBe(true);
    const runs = listTeamRuns(workspace);
    expect(runs.map((run) => run.id)).toEqual([RUN_ID]);
    expect(runs[0]!.teamSlug).toBe('engineering-ship-team');
  });

  test('creates tasks, updates derived run state, and persists messages/events', () => {
    writeTeamRun(workspace, sampleRun());

    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Implement storage',
      description: 'Add run persistence',
      ownerAgentSlug: 'coder',
      priority: 'high',
    });
    expect(task.status).toBe('todo');

    const message = sendTeamMessage(workspace, RUN_ID, {
      fromAgentSlug: 'system-architect',
      toAgentSlug: 'coder',
      taskId: task.id,
      kind: 'assignment',
      body: 'Please implement this.',
    });
    expect(message.kind).toBe('assignment');

    const done = updateTeamTask(workspace, RUN_ID, task.id, {
      status: 'done',
      output: 'Implemented.',
    });
    expect(done.status).toBe('done');

    const detail = readTeamRunDetail(workspace, RUN_ID);
    expect(detail?.state).toBe('review');
    expect(detail?.tasks).toHaveLength(1);
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.events.map((event) => event.kind)).toEqual([
      'task.created',
      'message.sent',
      'task.updated',
    ]);
  });

  test('marks unread messages for a recipient without changing other messages', () => {
    writeTeamRun(workspace, sampleRun());
    const direct = sendTeamMessage(workspace, RUN_ID, {
      fromAgentSlug: 'system-architect',
      toAgentSlug: 'coder',
      kind: 'question',
      body: 'Can you handle this?',
    });
    const broadcast = sendTeamMessage(workspace, RUN_ID, {
      fromAgentSlug: 'system-architect',
      toAgentSlug: 'all',
      kind: 'note',
      body: 'Team update.',
    });
    const other = sendTeamMessage(workspace, RUN_ID, {
      fromAgentSlug: 'system-architect',
      toAgentSlug: 'reviewer',
      kind: 'review',
      body: 'Please review.',
    });

    const next = markTeamMessagesRead(workspace, RUN_ID, 'coder');
    expect(next.find((message) => message.id === direct.id)?.readAt).toBeString();
    expect(next.find((message) => message.id === broadcast.id)?.readAt).toBeString();
    expect(next.find((message) => message.id === other.id)?.readAt).toBeUndefined();
    expect(readTeamRunDetail(workspace, RUN_ID)?.messages.filter((message) => message.readAt)).toHaveLength(2);
  });

  test('skips malformed jsonl records while preserving valid records', () => {
    writeTeamRun(workspace, sampleRun());
    createTeamTask(workspace, RUN_ID, {
      title: 'Valid task',
      description: '',
      ownerAgentSlug: 'coder',
    });
    writeFileSync(join(workspace, '.runneros', 'teams', 'runs', RUN_ID, 'tasks.jsonl'), '{"bad": true}\n', { flag: 'a' });

    expect(readTeamRunDetail(workspace, RUN_ID)?.tasks).toHaveLength(1);
  });

  test('blocks review-required tasks from finishing until review passes and links member sessions', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Change production code',
      description: 'Implement and verify the change',
      ownerAgentSlug: 'coder',
      reviewRequired: true,
      reviewerAgentSlug: 'reviewer',
    });

    expect(() => updateTeamTask(workspace, RUN_ID, task.id, { status: 'done' })).toThrow('requires a passed review');

    updateTeamTask(workspace, RUN_ID, task.id, {
      status: 'review',
      evidence: [{ type: 'output', label: 'result', value: 'change applied and verified' }],
      review: {
        requestedAt: '2026-01-01T00:01:00.000Z',
        reviewerAgentSlug: 'reviewer',
        status: 'passed',
        findings: 'Looks good',
        reviewedAt: '2026-01-01T00:02:00.000Z',
      },
    });
    const done = updateTeamTask(workspace, RUN_ID, task.id, { status: 'done' });
    expect(done.status).toBe('done');

    linkTeamRunMemberSession(workspace, RUN_ID, 'coder', 'session_coder');
    expect(readTeamRunDetail(workspace, RUN_ID)?.memberSessionIds?.coder).toBe('session_coder');
  });

  test('blocks approval-required tasks from finishing until user approval passes', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Publish customer message',
      description: 'Prepare and publish the approved message',
      ownerAgentSlug: 'coder',
      approvalRequired: true,
    });

    expect(() => updateTeamTask(workspace, RUN_ID, task.id, { status: 'done' })).toThrow('requires user approval');

    updateTeamTask(workspace, RUN_ID, task.id, {
      approval: {
        requestedAt: '2026-01-01T00:01:00.000Z',
        requestedByAgentSlug: 'coder',
        reason: 'Publish customer-facing message',
        status: 'approved',
        decidedAt: '2026-01-01T00:02:00.000Z',
      },
    });

    const done = updateTeamTask(workspace, RUN_ID, task.id, { status: 'done' });
    expect(done.status).toBe('done');
  });

  test('prevents approval and review gates from being cleared once active', () => {
    writeTeamRun(workspace, sampleRun());
    const approvalTask = createTeamTask(workspace, RUN_ID, {
      title: 'Publish customer message',
      description: 'Prepare and publish the approved message',
      ownerAgentSlug: 'coder',
      approvalRequired: true,
    });
    const reviewTask = createTeamTask(workspace, RUN_ID, {
      title: 'Change production code',
      description: 'Implement and verify the change',
      ownerAgentSlug: 'coder',
      reviewRequired: true,
      reviewerAgentSlug: 'reviewer',
    });

    expect(() => updateTeamTask(workspace, RUN_ID, approvalTask.id, {
      approvalRequired: false,
      status: 'done',
    })).toThrow('approval requirement cannot be cleared');
    expect(() => updateTeamTask(workspace, RUN_ID, reviewTask.id, {
      reviewRequired: false,
      status: 'done',
    })).toThrow('review requirement cannot be cleared');
  });

  test('leases tasks to their owner, heartbeats them, and respects run concurrency', () => {
    writeTeamRun(workspace, sampleRun({
      swarm: {
        maxConcurrentTasks: 1,
        taskLeaseMs: 1000,
        heartbeatIntervalMs: 250,
        staleAfterMs: 2000,
        retryLimit: 2,
        retryBackoffMs: 500,
      },
    }));
    const first = createTeamTask(workspace, RUN_ID, {
      title: 'Implement first slice',
      description: '',
      ownerAgentSlug: 'coder',
    });
    createTeamTask(workspace, RUN_ID, {
      title: 'Implement second slice',
      description: '',
      ownerAgentSlug: 'reviewer',
    });

    const claimed = claimTeamTask(workspace, RUN_ID, {
      agentSlug: 'coder',
      taskId: first.id,
    }, new Date('2026-01-01T00:00:00.000Z'));
    expect(claimed?.status).toBe('in_progress');
    expect(claimed?.attemptCount).toBe(1);
    expect(claimed?.lease?.ownerAgentSlug).toBe('coder');
    expect(claimTeamTask(workspace, RUN_ID, { agentSlug: 'reviewer' }, new Date('2026-01-01T00:00:00.100Z'))).toBeNull();

    const heartbeat = heartbeatTeamTask(workspace, RUN_ID, {
      agentSlug: 'coder',
      taskId: first.id,
      leaseId: claimed!.lease!.id,
      leaseTtlMs: 3000,
    }, new Date('2026-01-01T00:00:00.500Z'));
    expect(heartbeat.lease?.expiresAt).toBe('2026-01-01T00:00:03.500Z');
    expect(readTeamRunDetail(workspace, RUN_ID)?.events.map((event) => event.kind)).toContain('task.heartbeat');
  });

  test('expires stale leases, backs off retry, and allows reclaim after retry window', () => {
    writeTeamRun(workspace, sampleRun({
      swarm: {
        maxConcurrentTasks: 2,
        taskLeaseMs: 1000,
        heartbeatIntervalMs: 250,
        staleAfterMs: 2000,
        retryLimit: 2,
        retryBackoffMs: 500,
      },
    }));
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Retryable task',
      description: '',
      ownerAgentSlug: 'coder',
    });

    const claimed = claimTeamTask(workspace, RUN_ID, {
      agentSlug: 'coder',
      taskId: task.id,
    }, new Date('2026-01-01T00:00:00.000Z'));
    expect(claimed?.lease?.expiresAt).toBe('2026-01-01T00:00:01.000Z');

    const expired = expireStaleTeamTaskLeases(workspace, RUN_ID, new Date('2026-01-01T00:00:01.100Z'));
    expect(expired).toHaveLength(1);
    expect(expired[0]!.status).toBe('todo');
    expect(expired[0]!.nextAttemptAt).toBe('2026-01-01T00:00:01.600Z');
    expect(claimTeamTask(workspace, RUN_ID, { agentSlug: 'coder' }, new Date('2026-01-01T00:00:01.200Z'))).toBeNull();

    const reclaimed = claimTeamTask(workspace, RUN_ID, { agentSlug: 'coder' }, new Date('2026-01-01T00:00:01.700Z'));
    expect(reclaimed?.attemptCount).toBe(2);
    expect(reclaimed?.lease?.ownerAgentSlug).toBe('coder');
  });

  test('operator controls pause, resume, and cancel swarm runs', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Controlled task',
      description: '',
      ownerAgentSlug: 'coder',
    });

    const paused = controlTeamRun(workspace, RUN_ID, 'pause', 'Need operator review');
    expect(paused.state).toBe('paused');
    expect(paused.swarm?.operatorPausedReason).toBe('Need operator review');
    expect(() => claimTeamTask(workspace, RUN_ID, { agentSlug: 'coder', taskId: task.id })).toThrow('paused');

    const resumed = controlTeamRun(workspace, RUN_ID, 'resume');
    expect(resumed.state).toBe('running');
    expect(resumed.swarm?.operatorPausedAt).toBeUndefined();
    expect(claimTeamTask(workspace, RUN_ID, { agentSlug: 'coder', taskId: task.id })).toBeTruthy();

    const cancelled = controlTeamRun(workspace, RUN_ID, 'cancel', 'Stop work');
    expect(cancelled.state).toBe('cancelled');
    expect(() => controlTeamRun(workspace, RUN_ID, 'resume')).toThrow('cancelled');
  });

  test('resume restores the derived run state from current tasks', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Blocked task',
      description: '',
      ownerAgentSlug: 'coder',
    });
    updateTeamTask(workspace, RUN_ID, task.id, { status: 'blocked', blockedReason: 'Needs input' });
    expect(readTeamRunDetail(workspace, RUN_ID)?.state).toBe('blocked');

    controlTeamRun(workspace, RUN_ID, 'pause', 'Hold work');
    const resumed = controlTeamRun(workspace, RUN_ID, 'resume');

    expect(resumed.state).toBe('blocked');
    expect(resumed.swarm?.operatorPausedAt).toBeUndefined();
  });

  test('preserves paused runs during task updates and fails runs when a task fails', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Risky task',
      description: '',
      ownerAgentSlug: 'coder',
    });

    controlTeamRun(workspace, RUN_ID, 'pause', 'Hold work');
    updateTeamTask(workspace, RUN_ID, task.id, { status: 'in_progress' });
    expect(readTeamRunDetail(workspace, RUN_ID)?.state).toBe('paused');

    controlTeamRun(workspace, RUN_ID, 'resume');
    updateTeamTask(workspace, RUN_ID, task.id, { status: 'failed', lastError: 'Worker crashed' });
    expect(readTeamRunDetail(workspace, RUN_ID)?.state).toBe('failed');
  });

  test('ticks active runs, records durable actions, and respects cooldowns', () => {
    writeTeamRun(workspace, sampleRun({
      state: 'running',
      leadSessionId: 'lead-session',
      swarm: {
        maxConcurrentTasks: 2,
        taskLeaseMs: 1000,
        heartbeatIntervalMs: 250,
        staleAfterMs: 2000,
        retryLimit: 2,
        retryBackoffMs: 500,
        leadWakeCooldownMs: 5000,
        memberWakeCooldownMs: 5000,
      },
    }));
    const stale = createTeamTask(workspace, RUN_ID, {
      title: 'Stale task',
      description: '',
      ownerAgentSlug: 'coder',
    });
    const blocked = createTeamTask(workspace, RUN_ID, {
      title: 'Blocked task',
      description: '',
      ownerAgentSlug: 'reviewer',
    });
    const claimed = claimTeamTask(workspace, RUN_ID, {
      agentSlug: 'coder',
      taskId: stale.id,
      leaseTtlMs: 1000,
    }, new Date('2026-01-01T00:00:00.000Z'));
    updateTeamTask(workspace, RUN_ID, blocked.id, { status: 'blocked', blockedReason: 'Needs input' });

    const tick = runTeamRunTick(workspace, RUN_ID, { reason: 'manual', now: new Date('2026-01-01T00:00:01.100Z') });
    expect(tick.actions.map((action) => action.type)).toContain('expired-lease');
    expect(tick.actions.some((action) => action.type === 'wake-lead' && action.taskId === blocked.id)).toBe(true);
    expect(readTeamRunDetail(workspace, RUN_ID)?.tasks.find((task) => task.id === claimed!.id)?.status).toBe('todo');
    expect(listTeamRunTicks(workspace, RUN_ID)).toHaveLength(1);

    const second = runTeamRunTick(workspace, RUN_ID, { reason: 'manual', now: new Date('2026-01-01T00:00:02.000Z') });
    expect(second.actions.some((action) => action.type === 'wake-lead' && action.taskId === blocked.id)).toBe(false);
  });

  test('ticks paused and terminal runs as no-op', () => {
    writeTeamRun(workspace, sampleRun({ state: 'paused' }));

    const tick = runTeamRunTick(workspace, RUN_ID, { reason: 'scheduled', now: new Date('2026-01-01T00:00:00.000Z') });

    expect(tick.actions).toEqual([{ type: 'no-op', message: 'Run is paused.' }]);
  });

  test('requires explicit lead completion after tasks are done', () => {
    writeTeamRun(workspace, sampleRun({ state: 'running' }));
    const task = createTeamTask(workspace, RUN_ID, {
      title: 'Finish me',
      description: '',
      ownerAgentSlug: 'coder',
    });
    updateTeamTask(workspace, RUN_ID, task.id, { status: 'done', output: 'Done' });
    expect(readTeamRunDetail(workspace, RUN_ID)?.state).toBe('review');

    const tick = runTeamRunTick(workspace, RUN_ID, { reason: 'manual', now: new Date('2026-01-01T00:00:00.000Z') });
    expect(tick.actions.map((action) => action.type)).toContain('finalization-needed');

    const completed = completeTeamRun(workspace, RUN_ID, { summary: 'All work finished.' });
    expect(completed.state).toBe('done');
    expect(completed.finalSummary).toBe('All work finished.');
    expect(completed.completedAt).toBeString();
  });
});

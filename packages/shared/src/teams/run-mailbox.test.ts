import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ackTeamWakesForTarget,
  claimTeamTask,
  createTeamTask,
  enqueueTeamWake,
  listPendingTeamWakes,
  listTeamWakes,
  markTeamWakeDelivered,
  markTeamWakeFailed,
  writeTeamRun,
} from './run-storage.ts';
import { emitTeamRunSignal, onTeamRunSignal, teamRunSignalListenerCount } from './run-signal.ts';
import type { TeamRunSnapshot } from './run-types.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'team-mailbox-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const RUN_ID = '55555555-5555-4555-8555-555555555555';

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
        members: [{ slug: 'coder', role: 'Implementation' }],
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

describe('U1b: durable wake mailbox', () => {
  test('enqueue creates a pending wake', () => {
    writeTeamRun(workspace, sampleRun());
    const wake = enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'wake-member', body: 'go' });
    expect(wake.status).toBe('pending');
    expect(wake.attempts).toBe(0);
    expect(listPendingTeamWakes(workspace, RUN_ID)).toHaveLength(1);
  });

  test('coalesces duplicate open wakes for the same target/task/kind (anti-spam) and refreshes body', () => {
    writeTeamRun(workspace, sampleRun());
    const a = enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'wake-member', body: 'go' });
    const b = enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'wake-member', body: 'go again' });
    expect(b.id).toBe(a.id);
    expect(b.body).toBe('go again'); // latest nudge content wins, not dropped
    expect(listTeamWakes(workspace, RUN_ID)).toHaveLength(1);
  });

  test('mailbox stays bounded — terminal wakes are pruned past the cap', () => {
    writeTeamRun(workspace, sampleRun());
    for (let i = 0; i < 130; i++) {
      enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: `task_${i}`, kind: 'wake-member', body: 'go' });
    }
    expect(listTeamWakes(workspace, RUN_ID)).toHaveLength(130);
    // Ack them all (terminal); pruning caps retained terminal wakes at 100.
    ackTeamWakesForTarget(workspace, RUN_ID, 'coder');
    expect(listTeamWakes(workspace, RUN_ID).length).toBeLessThanOrEqual(100);
  });

  test('different task or kind is NOT coalesced', () => {
    writeTeamRun(workspace, sampleRun());
    enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'wake-member', body: 'a' });
    enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_2', kind: 'wake-member', body: 'b' });
    enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'finalization', body: 'c' });
    expect(listTeamWakes(workspace, RUN_ID)).toHaveLength(3);
  });

  test('delivered then re-enqueue coalesces but becomes pending for redelivery', () => {
    writeTeamRun(workspace, sampleRun());
    const a = enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'wake-member', body: 'go' });
    markTeamWakeDelivered(workspace, RUN_ID, a.id);
    const b = enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'wake-member', body: 'again' });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe('pending');
    expect(b.body).toBe('again');
    expect(b.deliveredAt).toBeUndefined();
    expect(listPendingTeamWakes(workspace, RUN_ID)).toHaveLength(1);
  });

  test('failed delivery retries until the budget is exhausted, then marks failed', () => {
    writeTeamRun(workspace, sampleRun());
    const wake = enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', kind: 'wake-member', body: 'go', maxAttempts: 2 });
    const first = markTeamWakeFailed(workspace, RUN_ID, wake.id, 'session busy');
    expect(first?.status).toBe('pending'); // attempt 1 < 2, still retryable
    expect(listPendingTeamWakes(workspace, RUN_ID)).toHaveLength(1);
    const second = markTeamWakeFailed(workspace, RUN_ID, wake.id, 'session busy again');
    expect(second?.status).toBe('failed'); // attempt 2 >= 2, give up
    expect(listPendingTeamWakes(workspace, RUN_ID)).toHaveLength(0);
    expect(second?.lastError).toBe('session busy again');
  });

  test('a failed wake is no longer coalesced — a fresh one is enqueued', () => {
    writeTeamRun(workspace, sampleRun());
    const wake = enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'wake-member', body: 'go', maxAttempts: 1 });
    markTeamWakeFailed(workspace, RUN_ID, wake.id, 'dead');
    const fresh = enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: 'task_1', kind: 'wake-member', body: 'go' });
    expect(fresh.id).not.toBe(wake.id);
    expect(listTeamWakes(workspace, RUN_ID)).toHaveLength(2);
  });

  test('claiming a task acks its open wakes (closes the loop)', () => {
    writeTeamRun(workspace, sampleRun());
    const task = createTeamTask(workspace, RUN_ID, { title: 'T', description: 'd', ownerAgentSlug: 'coder' });
    enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', taskId: task.id, kind: 'wake-member', body: 'go' });
    expect(listPendingTeamWakes(workspace, RUN_ID)).toHaveLength(1);
    const claimed = claimTeamTask(workspace, RUN_ID, { agentSlug: 'coder', taskId: task.id });
    expect(claimed?.status).toBe('in_progress');
    expect(listPendingTeamWakes(workspace, RUN_ID)).toHaveLength(0);
    expect(listTeamWakes(workspace, RUN_ID)[0]!.status).toBe('acked');
  });

  test('ackTeamWakesForTarget only acks the matching agent', () => {
    writeTeamRun(workspace, sampleRun());
    enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'coder', kind: 'wake-member', body: 'a' });
    enqueueTeamWake(workspace, RUN_ID, { targetAgentSlug: 'system-architect', kind: 'wake-lead', body: 'b' });
    ackTeamWakesForTarget(workspace, RUN_ID, 'coder');
    const wakes = listTeamWakes(workspace, RUN_ID);
    expect(wakes.find((w) => w.targetAgentSlug === 'coder')!.status).toBe('acked');
    expect(wakes.find((w) => w.targetAgentSlug === 'system-architect')!.status).toBe('pending');
  });
});

describe('U1b: reactive wake signal', () => {
  test('persisted mutations emit a signal for the affected run', async () => {
    const seen: string[] = [];
    const off = onTeamRunSignal((sig) => {
      if (sig.runId === RUN_ID) seen.push(sig.reason);
    });
    try {
      writeTeamRun(workspace, sampleRun());
      createTeamTask(workspace, RUN_ID, { title: 'T', description: 'd', ownerAgentSlug: 'coder' });
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      off();
    }
  });

  test('unsubscribe stops delivery and is reflected in the listener count', () => {
    const before = teamRunSignalListenerCount();
    const off = onTeamRunSignal(() => {});
    expect(teamRunSignalListenerCount()).toBe(before + 1);
    off();
    expect(teamRunSignalListenerCount()).toBe(before);
  });

  test('emit with no listeners does not throw', () => {
    expect(() => emitTeamRunSignal({ workspaceRootPath: workspace, runId: RUN_ID, reason: 'test' })).not.toThrow();
  });
});

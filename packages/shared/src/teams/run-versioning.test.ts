import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTeamTask,
  readTeamRun,
  StaleRunWriteError,
  touchTeamRun,
  updateTeamTask,
  writeTeamRun,
  writeTeamRunGuarded,
} from './run-storage.ts';
import { pendingRunMutationChains, withRunMutationLock } from './run-mutation-queue.ts';
import type { TeamRunSnapshot } from './run-types.ts';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'team-rev-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const RUN_ID = '22222222-2222-4222-8222-222222222222';

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

describe('team run versioning', () => {
  test('touchTeamRun increments rev monotonically from absent (legacy=0)', () => {
    writeTeamRun(workspace, sampleRun());
    expect(readTeamRun(workspace, RUN_ID)!.rev).toBeUndefined();

    const a = touchTeamRun(workspace, readTeamRun(workspace, RUN_ID)!);
    expect(a.rev).toBe(1);
    const b = touchTeamRun(workspace, readTeamRun(workspace, RUN_ID)!);
    expect(b.rev).toBe(2);
    expect(readTeamRun(workspace, RUN_ID)!.rev).toBe(2);
  });

  test('every task mutation bumps the run rev', () => {
    writeTeamRun(workspace, sampleRun());
    const revBefore = readTeamRun(workspace, RUN_ID)!.rev ?? 0;
    createTeamTask(workspace, RUN_ID, { title: 'T1', description: 'd', ownerAgentSlug: 'coder' });
    const revAfter = readTeamRun(workspace, RUN_ID)!.rev ?? 0;
    expect(revAfter).toBeGreaterThan(revBefore);
  });

  test('rev survives a round-trip through the snapshot guard', () => {
    writeTeamRun(workspace, sampleRun({ rev: 7 }));
    expect(readTeamRun(workspace, RUN_ID)!.rev).toBe(7);
  });

  test('writeTeamRunGuarded succeeds when expected rev matches and bumps rev', () => {
    const persisted = touchTeamRun(workspace, sampleRun()); // rev 1
    const next = writeTeamRunGuarded(workspace, { ...persisted, state: 'running' }, persisted.rev!);
    expect(next.rev).toBe(2);
    expect(readTeamRun(workspace, RUN_ID)!.state).toBe('running');
  });

  test('writeTeamRunGuarded throws StaleRunWriteError on concurrent modification', () => {
    const persisted = touchTeamRun(workspace, sampleRun()); // rev 1
    // Simulate a concurrent writer bumping rev to 2 behind our back.
    touchTeamRun(workspace, readTeamRun(workspace, RUN_ID)!); // rev 2

    expect(() => writeTeamRunGuarded(workspace, { ...persisted, state: 'running' }, persisted.rev!))
      .toThrow(StaleRunWriteError);
    // The losing write did not clobber the winner.
    expect(readTeamRun(workspace, RUN_ID)!.state).toBe('created');
  });
});

describe('run mutation queue', () => {
  test('serializes overlapping mutations for the same run in call order', async () => {
    const order: number[] = [];
    const make = (n: number, delay: number) => () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(n);
          resolve();
        }, delay);
      });

    // Enqueue in order 1,2,3 but with decreasing delays — without serialization
    // they'd resolve 3,2,1. The lock must force 1,2,3.
    const p1 = withRunMutationLock(workspace, RUN_ID, make(1, 30));
    const p2 = withRunMutationLock(workspace, RUN_ID, make(2, 20));
    const p3 = withRunMutationLock(workspace, RUN_ID, make(3, 10));
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  test('different runs are not serialized against each other', async () => {
    const otherRun = '33333333-3333-4333-8333-333333333333';
    const started: string[] = [];
    let releaseA: (() => void) | undefined;
    const blockA = withRunMutationLock(workspace, RUN_ID, () =>
      new Promise<void>((resolve) => {
        started.push('A');
        releaseA = resolve;
      }),
    );
    // B targets a different run; it must run even while A is still holding.
    const b = withRunMutationLock(workspace, otherRun, () => {
      started.push('B');
    });
    await b;
    expect(started).toContain('B');
    releaseA?.();
    await blockA;
  });

  test('a rejected mutation does not poison the chain for the next caller', async () => {
    const results: string[] = [];
    const bad = withRunMutationLock(workspace, RUN_ID, () => {
      throw new Error('boom');
    });
    await expect(bad).rejects.toThrow('boom');
    await withRunMutationLock(workspace, RUN_ID, () => {
      results.push('ran-after-failure');
    });
    expect(results).toEqual(['ran-after-failure']);
  });

  test('queue map is bounded — drains back to zero after settling', async () => {
    await withRunMutationLock(workspace, RUN_ID, () => undefined);
    // allow the post-settle cleanup microtask to run
    await new Promise((r) => setTimeout(r, 0));
    expect(pendingRunMutationChains()).toBe(0);
  });

  test('serialized mutation result is returned to its own caller', async () => {
    const value = await withRunMutationLock(workspace, RUN_ID, () => 42);
    expect(value).toBe(42);
  });
});

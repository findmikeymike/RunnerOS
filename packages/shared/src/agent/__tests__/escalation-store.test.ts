/**
 * Tests for the SQLite-backed escalation store (R7 / Plan 01-07).
 *
 * Uses temp-file DBs so the across-instance durability assertion has a
 * real on-disk artifact to reopen.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getEscalationStore,
  type EscalationStore,
} from '../escalation-store.ts';

let dir: string;
let dbPath: string;
let store: EscalationStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'esc-store-'));
  dbPath = join(dir, 'escalations.db');
  store = getEscalationStore(dbPath);
});

afterEach(() => {
  try {
    store.close();
  } catch {
    /* idempotent */
  }
  rmSync(dir, { recursive: true, force: true });
});

const sampleInput = (overrides: Partial<{ workflowRunId: string; recommendation: string }> = {}) => ({
  workflowRunId: overrides.workflowRunId ?? 'run-1',
  recommendation: overrides.recommendation ?? 'git push origin main',
  toolCall: { name: 'Bash', args: { command: 'git push' } },
});

describe('EscalationStore — create', () => {
  test('persists a pending row and returns a uuid id', () => {
    const e = store.create(sampleInput());
    expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(e.status).toBe('pending');
    expect(e.workflowRunId).toBe('run-1');
    expect(e.toolCall.name).toBe('Bash');
    expect(e.resolvedAt).toBeUndefined();
    expect(e.createdAt).toBeGreaterThan(0);
  });

  test('round-trips taskId, durationMs, recommendation', () => {
    const e = store.create({
      workflowRunId: 'run-x',
      taskId: 'task-7',
      recommendation: 'Send email to ceo@example.com',
      toolCall: { name: 'api_gmail.send', args: { to: 'ceo@example.com' } },
      durationMs: 1234,
    });
    expect(e.taskId).toBe('task-7');
    expect(e.durationMs).toBe(1234);
    expect(e.recommendation).toContain('ceo@example.com');
  });
});

describe('EscalationStore — listPending', () => {
  test('returns only pending rows, ordered by createdAt asc', async () => {
    const a = store.create(sampleInput({ workflowRunId: 'run-a' }));
    // Spacer to guarantee distinct timestamps even on fast machines.
    await new Promise((r) => setTimeout(r, 2));
    const b = store.create(sampleInput({ workflowRunId: 'run-b' }));
    await new Promise((r) => setTimeout(r, 2));
    const c = store.create(sampleInput({ workflowRunId: 'run-c' }));

    store.approve(b.id, { type: 'user', clientId: 'test-client' });

    const pending = store.listPending();
    expect(pending.map((e) => e.id)).toEqual([a.id, c.id]);
  });

  test('filters by workflowRunId when provided', () => {
    const a = store.create(sampleInput({ workflowRunId: 'run-a' }));
    store.create(sampleInput({ workflowRunId: 'run-b' }));
    const onlyA = store.listPending({ workflowRunId: 'run-a' });
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0]?.id).toBe(a.id);
  });
});

describe('EscalationStore — approve / reject', () => {
  test('approve flips status, sets resolvedAt, stores result', () => {
    const e = store.create(sampleInput());
    const updated = store.approve(e.id, { type: 'user', clientId: 'test-client' }, { ok: true });
    expect(updated.status).toBe('approved');
    expect(updated.resolvedAt).toBeGreaterThanOrEqual(updated.createdAt);
    expect(updated.result).toEqual({ ok: true });
    expect(updated.resolvedBy).toEqual({ type: 'user', clientId: 'test-client' });

    const reread = store.get(e.id);
    expect(reread?.status).toBe('approved');
    expect(reread?.result).toEqual({ ok: true });
    expect(reread?.resolvedBy).toEqual({ type: 'user', clientId: 'test-client' });
  });

  test('reject flips status to rejected', () => {
    const e = store.create(sampleInput());
    const updated = store.reject(e.id, { type: 'user', clientId: 'test-client' }, { reason: 'user clicked no' });
    expect(updated.status).toBe('rejected');
    expect(updated.result).toEqual({ reason: 'user clicked no' });
  });

  test('approve/reject on non-pending throws', () => {
    const e = store.create(sampleInput());
    store.approve(e.id, { type: 'user', clientId: 'test-client' });
    expect(() => store.approve(e.id, { type: 'user', clientId: 'test-client' })).toThrow(/current status is "approved"/);
    expect(() => store.reject(e.id, { type: 'user', clientId: 'test-client' })).toThrow(/current status is "approved"/);
  });

  test('approve/reject on unknown id throws', () => {
    expect(() => store.approve('does-not-exist', { type: 'user', clientId: 'test-client' })).toThrow(/not found/);
  });
});

describe('EscalationStore — multiple pending concurrent', () => {
  test('holds many pending escalations and resolves them independently', () => {
    const ids = Array.from({ length: 5 }, (_, i) =>
      store.create(sampleInput({ workflowRunId: `run-${i}` })).id,
    );
    expect(store.listPending()).toHaveLength(5);

    // Resolve out of order.
    store.approve(ids[2]!, { type: 'user', clientId: 'test-client' });
    store.reject(ids[4]!, { type: 'user', clientId: 'test-client' });
    const stillPending = store.listPending();
    const expected: string[] = [ids[0]!, ids[1]!, ids[3]!];
    expect(stillPending.map((e) => e.id).sort()).toEqual(expected.sort());
  });
});

describe('EscalationStore — durability across instance restart', () => {
  test('rows persist after close + reopen', () => {
    const a = store.create(sampleInput({ workflowRunId: 'run-persist' }));
    const b = store.create(sampleInput({ workflowRunId: 'run-persist-2' }));
    store.approve(b.id, { type: 'user', clientId: 'test-client' }, { side: 'effect' });
    store.close();

    // Reopen at the same path — should see both rows.
    const reopened = getEscalationStore(dbPath);
    try {
      const pendingNow = reopened.listPending();
      expect(pendingNow.map((e) => e.id)).toEqual([a.id]);
      const approvedB = reopened.get(b.id);
      expect(approvedB?.status).toBe('approved');
      expect(approvedB?.result).toEqual({ side: 'effect' });
    } finally {
      reopened.close();
    }
    // Replace handle so afterEach doesn't double-close.
    store = getEscalationStore(dbPath);
  });
});

describe('EscalationStore — subscribe', () => {
  test('fires for create and resolution', () => {
    const events: Array<{ id: string; status: string }> = [];
    const unsub = store.subscribe((e) => {
      events.push({ id: e.id, status: e.status });
    });
    const e = store.create(sampleInput());
    store.approve(e.id, { type: 'user', clientId: 'test-client' });
    unsub();
    store.create(sampleInput());

    expect(events).toEqual([
      { id: e.id, status: 'pending' },
      { id: e.id, status: 'approved' },
    ]);
  });
});

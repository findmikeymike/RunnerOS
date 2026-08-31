/**
 * Tests for the subconscious-mode coordinator + permission evaluator (R7).
 *
 * Verifies the end-to-end pause/resume contract using a temp-file SQLite
 * escalation store. The real prompt-handler integration is exercised by
 * stubbing the `execute` callback that the runner would supply.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getEscalationStore,
  type EscalationStore,
} from '../escalation-store.ts';
import {
  evaluateWriteAttempt,
  isWriteTool,
  extractRecommendation,
  normalizeSubconsciousMode,
} from '../subconscious-permissions.ts';
import {
  _resetSubconsciousModeForTests,
  gateWriteAttempt,
  resolveSubconsciousAlias,
  setEscalationNotifier,
  type EscalationNotification,
} from '../subconscious-mode.ts';

let dir: string;
let store: EscalationStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sub-mode-'));
  store = getEscalationStore(join(dir, 'escalations.db'));
});

afterEach(() => {
  _resetSubconsciousModeForTests();
  try {
    store.close();
  } catch {
    /* idempotent */
  }
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// evaluateWriteAttempt + DSL aliases
// ---------------------------------------------------------------------------

describe('evaluateWriteAttempt', () => {
  test('default mode: writes return "allow" (workspace policy decides downstream)', () => {
    expect(evaluateWriteAttempt('default', 'Write', { path: '/tmp/x' })).toBe('allow');
    expect(evaluateWriteAttempt('default', 'Read', { path: '/tmp/x' })).toBe('allow');
  });

  test('yolo mode: everything returns "allow"', () => {
    expect(evaluateWriteAttempt('yolo', 'Write', {})).toBe('allow');
    expect(evaluateWriteAttempt('yolo', 'Bash', { command: 'rm -rf /' })).toBe('allow');
  });

  test('subconscious mode: writes escalate, reads allow', () => {
    expect(evaluateWriteAttempt('subconscious', 'Write', {})).toBe('escalate');
    expect(evaluateWriteAttempt('subconscious', 'Read', {})).toBe('allow');
    expect(evaluateWriteAttempt('subconscious', 'Bash', { command: 'ls' })).toBe('allow');
    expect(evaluateWriteAttempt('subconscious', 'Bash', { command: 'git push' })).toBe(
      'escalate',
    );
  });
});

describe('isWriteTool', () => {
  test('exact write-tool names are classified as writes', () => {
    expect(isWriteTool('Write')).toBe(true);
    expect(isWriteTool('save_memory')).toBe(true);
    expect(isWriteTool('Read')).toBe(false);
  });

  test('bash heuristic only fires on write verbs', () => {
    expect(isWriteTool('Bash', { command: 'ls -la' })).toBe(false);
    expect(isWriteTool('Bash', { command: 'rm file' })).toBe(true);
    expect(isWriteTool('Bash', { command: 'curl -X POST https://x' })).toBe(true);
  });

  test('mcp__ prefix is conservatively treated as write', () => {
    expect(isWriteTool('mcp__github__create_issue')).toBe(true);
  });
});

describe('normalizeSubconsciousMode / resolveSubconsciousAlias', () => {
  test('accepts canonical modes', () => {
    expect(normalizeSubconsciousMode('default')).toBe('default');
    expect(normalizeSubconsciousMode('subconscious')).toBe('subconscious');
    expect(normalizeSubconsciousMode('yolo')).toBe('yolo');
  });

  test('accepts "escalate-on-write" alias for subconscious', () => {
    expect(normalizeSubconsciousMode('escalate-on-write')).toBe('subconscious');
    expect(resolveSubconsciousAlias('ESCALATE-ON-WRITE')).toBe('subconscious');
  });

  test('returns null for unknown', () => {
    expect(normalizeSubconsciousMode('nope')).toBeNull();
  });
});

describe('extractRecommendation', () => {
  test('extracts RECOMMENDED ACTION marker when present', () => {
    const text = 'I analyzed the repo. RECOMMENDED ACTION: push to main with --force';
    expect(
      extractRecommendation({ assistantText: text, toolName: 'Bash', toolArgs: {} }),
    ).toBe('push to main with --force');
  });

  test('falls back to formatted tool call when marker absent', () => {
    const rec = extractRecommendation({
      toolName: 'Write',
      toolArgs: { path: '/tmp/x', content: 'hi' },
    });
    expect(rec).toContain('Write(');
    expect(rec).toContain('/tmp/x');
  });
});

// ---------------------------------------------------------------------------
// gateWriteAttempt — end-to-end pause/resume
// ---------------------------------------------------------------------------

describe('gateWriteAttempt — pause/resume', () => {
  test('subconscious + write → creates escalation, emits notification, awaits resolution', async () => {
    const notifications: EscalationNotification[] = [];
    setEscalationNotifier((e) => notifications.push(e));

    let executed = 0;
    const outcomePromise = gateWriteAttempt({
      mode: 'subconscious',
      toolName: 'Write',
      args: { path: '/tmp/x', content: 'hello' },
      workflowRunId: 'run-1',
      taskId: 'step-a',
      assistantText: 'I will write a file. RECOMMENDED ACTION: write /tmp/x',
      execute: async () => {
        executed += 1;
        return { wrote: '/tmp/x' };
      },
      store,
    });

    // Wait a tick for the create + notification + await-pending to land.
    await new Promise((r) => setTimeout(r, 10));

    expect(notifications).toHaveLength(1);
    const escalation = notifications[0]!.escalation;
    expect(escalation.status).toBe('pending');
    expect(escalation.recommendation).toBe('write /tmp/x');
    expect(executed).toBe(0); // paused — execute() NOT called yet

    // Approve via the store (the same code path the UI/RPC handler will use).
    store.approve(escalation.id, { type: 'user', clientId: 'test-client' });

    const outcome = await outcomePromise;
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.result).toEqual({ wrote: '/tmp/x' });
    }
    expect(executed).toBe(1);
  });

  test('subconscious + write → rejection yields { kind: "denied" } and does NOT execute', async () => {
    setEscalationNotifier(() => {});
    let executed = 0;
    const outcomePromise = gateWriteAttempt({
      mode: 'subconscious',
      toolName: 'Bash',
      args: { command: 'git push --force' },
      workflowRunId: 'run-2',
      execute: () => {
        executed += 1;
        return 'pushed';
      },
      store,
    });

    await new Promise((r) => setTimeout(r, 10));
    const pendingList = store.listPending({ workflowRunId: 'run-2' });
    expect(pendingList).toHaveLength(1);
    const id = pendingList[0]!.id;
    store.reject(id, { type: 'user', clientId: 'test-client' }, { reason: 'too dangerous' });

    const outcome = await outcomePromise;
    expect(outcome.kind).toBe('denied');
    if (outcome.kind === 'denied') {
      expect(outcome.escalationId).toBe(id);
      expect(outcome.reason).toContain('User rejected');
    }
    expect(executed).toBe(0);
  });

  test('subconscious + read → executes immediately (no escalation)', async () => {
    let executed = 0;
    const outcome = await gateWriteAttempt({
      mode: 'subconscious',
      toolName: 'Read',
      args: { path: '/etc/hostname' },
      workflowRunId: 'run-3',
      execute: () => {
        executed += 1;
        return 'hostname-data';
      },
      store,
    });
    expect(outcome.kind).toBe('executed');
    expect(executed).toBe(1);
    expect(store.listPending()).toHaveLength(0);
  });

  test('yolo + write → executes immediately (no escalation)', async () => {
    let executed = 0;
    const outcome = await gateWriteAttempt({
      mode: 'yolo',
      toolName: 'Bash',
      args: { command: 'rm -rf /tmp/abc' },
      workflowRunId: 'run-4',
      execute: () => {
        executed += 1;
        return 'gone';
      },
      store,
    });
    expect(outcome.kind).toBe('executed');
    expect(executed).toBe(1);
    expect(store.listPending()).toHaveLength(0);
  });

  test('concurrent escalations resolve independently', async () => {
    setEscalationNotifier(() => {});
    const p1 = gateWriteAttempt({
      mode: 'subconscious',
      toolName: 'Write',
      args: { path: '/tmp/a' },
      workflowRunId: 'run-c1',
      execute: () => 'a-done',
      store,
    });
    const p2 = gateWriteAttempt({
      mode: 'subconscious',
      toolName: 'Write',
      args: { path: '/tmp/b' },
      workflowRunId: 'run-c2',
      execute: () => 'b-done',
      store,
    });

    await new Promise((r) => setTimeout(r, 10));
    const all = store.listPending();
    expect(all).toHaveLength(2);
    const [first, second] = all;
    // Approve second first → resolves p2 first.
    store.approve(second!.id, { type: 'user', clientId: 'test-client' });
    const o2 = await p2;
    expect(o2.kind).toBe('executed');
    store.reject(first!.id, { type: 'user', clientId: 'test-client' });
    const o1 = await p1;
    expect(o1.kind).toBe('denied');
  });
});

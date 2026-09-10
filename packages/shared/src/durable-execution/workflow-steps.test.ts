import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal, type DurableRunSpec } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function fixture(maxAttempts = 4) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-steps-')), key = randomBytes(32);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let journal = new DurableJournal({ configRoot: root, key });
  cleanup.push(() => journal.close());
  const spec: DurableRunSpec = {
    engine: 'sqlite-v2-readonly-1', runId: 'r', workspaceId: 'w', commandId: 'admit', createdAt: Date.now(),
    credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, allowedTools: ['read'],
    model: 'fixture', maxOutputTokens: 100, maxModelAttempts: maxAttempts, authority: {}, context: {},
    deadlineAt: Date.now() + 60000, costPolicy: { unit: 'model-requests', maxTotalUnits: maxAttempts, maxUnitsPerAttempt: 1 },
    workflowSteps: [{ id: 'research' }, { id: 'summary' }],
  };
  return { spec, get journal() { return journal; }, reopen() { journal.close(); journal = new DurableJournal({ configRoot: root, key }); } };
}
function execution(f: ReturnType<typeof fixture>) {
  const claim = f.journal.claim('r', 'w'), bridge = f.journal.bridge(claim);
  return { claim, bridge, async model(turn: number, text = 'saved output') {
    await bridge.checkpoint({ kind: 'model-start', turn, context: { turn } });
    await bridge.checkpoint({ kind: 'model-result', turn, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } });
  } };
}

test('sequential step checkpoints survive reopen and final completion is atomic and idempotent', async () => {
  const f = fixture(); f.journal.admit(f.spec); let e = execution(f);
  const start = { kind: 'workflow-step-start' as const, step: 0, input: { prompt: 'research' } };
  await e.bridge.checkpoint(start); const version = f.journal.get('r', 'w').version;
  expect(await e.bridge.checkpoint(start)).toEqual({}); expect(f.journal.get('r', 'w').version).toBe(version);
  await e.model(0, 'first output');
  expect(await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).toEqual({ cached: 'first output' });
  const first = f.journal.get('r', 'w'); expect(first.status).toBe('running');
  expect(first.workflowSteps?.[0]).toMatchObject({ id: 'research', startTurn: 0, endTurn: 1, output: 'first output' });
  f.journal.release(e.claim); f.reopen(); e = execution(f);
  expect(await e.bridge.checkpoint(start)).toEqual({ cached: 'first output' });
  expect(await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).toEqual({ cached: 'first output' });
  expect(f.journal.get('r', 'w').version).toBe(first.version);
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: { previous: 'first output' } });
  await e.model(1, 'second output');
  expect(await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 1 })).toEqual({ cached: 'second output' });
  const final = f.journal.get('r', 'w'); expect(final.status).toBe('succeeded');
  expect(final.workflowSteps?.[1]).toMatchObject({ id: 'summary', startTurn: 1, endTurn: 2, output: 'second output' });
  expect(await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 1 })).toEqual({ cached: 'second output' });
  expect(f.journal.get('r', 'w').version).toBe(final.version);
});

test('invalid, skipped, premature and changed-input step transitions do not advance the journal', async () => {
  const f = fixture(); f.journal.admit(f.spec); const e = execution(f);
  for (const step of [-1, 0.5, 2, NaN]) {
    await expect(e.bridge.checkpoint({ kind: 'workflow-step-start', step, input: {} })).rejects.toThrow();
  }
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: {} })).rejects.toThrow('step-order');
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('not-started');
  await expect(e.bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} })).rejects.toThrow('step-not-started');
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: 'pinned' });
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: 'changed' })).rejects.toThrow('input-changed');
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: {} })).rejects.toThrow('step-order');
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('incomplete');
  await expect(e.bridge.checkpoint({ kind: 'complete' })).rejects.toThrow('step-completion-required');
  await e.model(0);
  await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 });
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: 'changed' })).rejects.toThrow('input-changed');
  await expect(e.bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} })).rejects.toThrow('step-not-started');
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: {} });
  await expect(e.bridge.checkpoint({ kind: 'model-start', turn: 0, context: { turn: 0 } })).rejects.toThrow('step-not-started');
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 1 })).rejects.toThrow('incomplete');
  expect(f.journal.get('r', 'w').modelAttempts).toBe(1);
});

test('pending and applied-but-unconsumed steering must be replayed before completing the current step', async () => {
  const f = fixture(); f.journal.admit(f.spec); let e = execution(f);
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} }); await e.model(0);
  f.journal.steer({ runId: 'r', workspaceId: 'w', commandId: 'steer', action: 'steer', expectedVersion: f.journal.get('r', 'w').version, text: 'include corrections' });
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('steering-pending');
  expect(f.journal.get('r', 'w').workflowSteps?.[0]?.endTurn).toBeUndefined();
  f.journal.release(e.claim); f.reopen(); e = execution(f);
  expect((await e.bridge.checkpoint({ kind: 'turn-boundary', turn: 0 })).steering).toHaveLength(1);
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('steering-pending');
  f.journal.release(e.claim); e = execution(f); await e.model(1, 'corrected');
  await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 });
  expect(f.journal.get('r', 'w').workflowSteps?.[0]).toMatchObject({ output: 'corrected', endTurn: 2 });
});

test('cancelled and stale workers cannot advance a step even if a late model result arrives', async () => {
  const f = fixture(); f.journal.admit(f.spec); let e = execution(f);
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} });
  const old = e; f.journal.release(e.claim); e = execution(f);
  await expect(old.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} })).rejects.toThrow('stale-owner');
  await e.bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
  f.journal.cancel('r', 'w');
  await e.bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'late' }] } });
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('dispatch-blocked');
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: {} })).rejects.toThrow('dispatch-blocked');
  expect(f.journal.get('r', 'w').status).toBe('cancelled'); expect(f.journal.get('r', 'w').workflowSteps?.[0]?.output).toBeUndefined();
});

test('attempt reservations remain shared across completed steps and interrupted retries', async () => {
  const f = fixture(2); f.journal.admit(f.spec); let e = execution(f);
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} }); await e.model(0);
  await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 });
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: {} });
  await e.bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} });
  f.journal.release(e.claim); f.reopen(); e = execution(f);
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: {} });
  await expect(e.bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} })).rejects.toThrow('budget-exhausted');
  expect(f.journal.get('r', 'w').reservedUnits).toBe(2); expect(f.journal.get('r', 'w').modelAttempts).toBe(2);
});

test('step completion rejects unfinished tools but preserves allowed empty output', async () => {
  const f = fixture(); f.journal.admit(f.spec); const e = execution(f);
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} });
  await e.bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
  await e.bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'c', name: 'read', arguments: {} }] } });
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('incomplete');
  await e.bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'c', tool: 'read', input: {} });
  await e.bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'c', result: 'read result' });
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('incomplete');
  await e.bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} });
  await e.bridge.checkpoint({ kind: 'model-result', turn: 1, message: { role: 'assistant', stopReason: 'stop', content: [] } });
  expect(await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).toEqual({ cached: '' });
  expect(f.journal.get('r', 'w').workflowSteps?.[0]).toMatchObject({ output: '', endTurn: 2 });
  expect(await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} })).toEqual({ cached: '' });
  expect(await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).toEqual({ cached: '' });
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: { previous: '' } });
  await e.bridge.checkpoint({ kind: 'model-start', turn: 2, context: {} });
  await e.bridge.checkpoint({ kind: 'model-result', turn: 2, message: { role: 'assistant', stopReason: 'stop', content: [] } });
  expect(await e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 1 })).toEqual({ cached: '' });
  expect(f.journal.get('r', 'w').status).toBe('succeeded');
});

test('admission rejects malformed or ambiguous step definitions', () => {
  for (const steps of [[], Array.from({ length: 9 }, (_, i) => ({ id: `${i}` })), [{ id: 'same' }, { id: 'same' }], [{ id: '' }], [{ id: '  ' }], [{ id: 'x', unexpected: true }], [null], ['step']]) {
    const f = fixture(); expect(() => f.journal.admit({ ...f.spec, workflowSteps: steps as NonNullable<DurableRunSpec['workflowSteps']> })).toThrow('invalid-durable-workflow-steps'); expect(f.journal.listInternal('w')).toEqual([]);
  }
});

test('existing single-step specifications retain plain completion behavior', async () => {
  const f = fixture(); delete f.spec.workflowSteps; f.journal.admit(f.spec); const e = execution(f);
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} })).rejects.toThrow('invalid-workflow-step');
  await e.model(0); await e.bridge.checkpoint({ kind: 'complete' }); expect(f.journal.get('r', 'w').status).toBe('succeeded');
});


test('pause/resume fences old step checkpoints and deadline blocks every step transition', async () => {
  const f = fixture(); f.journal.admit(f.spec); const e = execution(f);
  await e.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} }); await e.model(0);
  const control = (action: 'pause' | 'resume') => f.journal.command({ runId: 'r', workspaceId: 'w', commandId: action, expectedVersion: f.journal.get('r', 'w').version, action });
  control('pause');
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('paused');
  control('resume');
  await expect(e.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('control-changed');
  f.journal.release(e.claim); const resumed = execution(f);
  await resumed.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 });
  const expired = fixture(); expired.journal.admit(expired.spec); const blocked = execution(expired);
  const clock = spyOn(Date, 'now').mockReturnValue(expired.spec.deadlineAt);
  try {
    await expect(blocked.bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} })).rejects.toThrow('dispatch-blocked');
    await expect(blocked.bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 })).rejects.toThrow('dispatch-blocked');
  } finally { clock.mockRestore(); }
});

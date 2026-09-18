import { afterEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableJournal, digest, hasDispatchedWriteSince, type DurableRunSpec, type DurableOperationIntent } from './index';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
const validator = { id: 'receipt', version: '1', validate: (value: unknown) => value === 'confirmed' };
function fixture(fallback = false) {
 const root = mkdtempSync(join(tmpdir(), 'single-write-')), key = randomBytes(32); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
 let journal = new DurableJournal({ configRoot: root, key }); cleanup.push(() => journal.close());
 const candidates = [{ model: 'm', connectionSlug: 'a', credentialIdentity: 'a'.repeat(64) }, { model: 'n', connectionSlug: 'b', credentialIdentity: 'b'.repeat(64) }];
 const spec: DurableRunSpec = { runId: 'r', workspaceId: 'w', commandId: 'admit', engine: 'sqlite-v2-readonly-1', credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, createdAt: Date.now(), deadlineAt: Date.now() + 60000, allowedTools: ['read'], model: 'm', maxOutputTokens: 100, maxModelAttempts: 5, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 }, context: {}, authority: {}, approvalPrincipalId: 'alice', ...(fallback ? { workflowSteps: [{ id: 'first' }, { id: 'second' }], fallbackPlan: { steps: [{ candidates }, { candidates }] } } : {}) };
 journal.admit(spec); let claim = journal.claim('r', 'w');
 const intent: DurableOperationIntent = { slotId: 'write', adapterId: 'api-write', adapterVersion: '1', credentialIdentity: 'a'.repeat(64), effectClass: 'single-attempt-write', idempotencyKey: 'local-correlation-only', input: { method: 'POST', path: '/message', params: { text: 'approved' } }, outputSchema: { id: 'receipt', version: '1' }, maxAttempts: 1, maxUnitsPerAttempt: 0 };
 return { spec, get journal() { return journal; }, get claim() { return claim; }, set claim(value) { claim = value; }, intent,
  state: () => journal.get('r', 'w'),
  control(action: 'pause' | 'resume' | 'cancel') { return journal.command({ runId: 'r', workspaceId: 'w', commandId: action, action, expectedVersion: journal.get('r', 'w').version }); },
  start() { journal.reserveOperation(claim, intent); return journal.startOperation(claim, 'write', 'issue').attempt!; },
  reopen() { journal.release(claim); journal.close(); journal = new DurableJournal({ configRoot: root, key }); },
 };
}
test('single-attempt writes require exactly one attempt and cannot retry even proven absence', () => {
 const f = fixture();
 for (const maxAttempts of [0, 2, 1.5]) expect(() => f.journal.reserveOperation(f.claim, { ...f.intent, maxAttempts })).toThrow('invalid-durable-operation-intent');
 const issued = f.start();
 expect(f.journal.startOperation(f.claim, 'write', 'issue').dispatch).toBe(false);
 f.journal.settleOperation(f.claim, issued, { kind: 'not-applied', reason: 'dispatch blocked before I/O' });
 expect(() => f.journal.startOperation(f.claim, 'write', 'retry')).toThrow('budget-exhausted');
 expect(f.state().operations![0]!.attempts).toHaveLength(1);
});
for (const effectClass of ['single-attempt-write', 'idempotent-write', 'reconcilable-write'] as const) {
 for (const unknown of [false, true]) test(`${effectClass} ${unknown ? 'unknown' : 'inflight'} blocks model, resume and steering without pretending success`, async () => {
  const f = fixture(); f.intent.effectClass = effectClass; const issued = f.start();
  if (unknown) f.journal.settleOperation(f.claim, issued, { kind: 'unknown', reason: 'response lost' });
  await expect(f.journal.bridge(f.claim).checkpoint({ kind: 'model-start', turn: 0, context: {} })).rejects.toThrow('write-outcome-unknown');
  expect(f.state().modelAttempts).toBe(0);
  expect(() => f.journal.steer({ runId: 'r', workspaceId: 'w', commandId: 'steer', expectedVersion: f.state().version, action: 'steer', text: 'continue elsewhere' })).toThrow('write-outcome-unknown');
  await expect(f.journal.bridge(f.claim).checkpoint({ kind: 'complete' })).rejects.toThrow('operation-incomplete');
  f.control('pause'); expect(() => f.control('resume')).toThrow('write-outcome-unknown');
  expect(f.state().status).toBe('paused'); expect(f.state().operations![0]!.status).toBe(unknown ? 'unknown' : 'inflight');
 });
}
test('unknown write cannot be hidden by provider fallback', async () => {
 const f = fixture(true);
 await f.journal.bridge(f.claim).checkpoint({ kind: 'workflow-step-start', step: 0, input: 'prompt' });
 f.claim = f.journal.beginStepAttempt(f.claim, { step: 0, candidateIndex: 0 });
 const issued = f.start(); f.journal.settleOperation(f.claim, issued, { kind: 'unknown', reason: 'response lost' });
 f.claim = f.journal.recordProviderFailure(f.claim, { step: 0, candidateIndex: 0, code: 'provider-unavailable' });
 expect(() => f.journal.beginStepAttempt(f.claim, { step: 0, candidateIndex: 1 })).toThrow('write-outcome-unknown');
 expect(f.state().providerAttempts).toHaveLength(1);
});
for (const action of ['pause', 'cancel'] as const) test(`late write settlement and observation remain allowed after ${action}`, () => {
 const f = fixture(), issued = f.start(); f.control(action);
 f.journal.settleOperation(f.claim, issued, { kind: 'unknown', reason: 'response lost' });
 f.reopen(); const observer = f.journal.claimObservation('r', 'w');
 expect(f.journal.reconcileOperation(observer, issued, { kind: 'succeeded', output: 'confirmed' }, validator).status).toBe('succeeded');
 expect(f.state().status).toBe(action === 'pause' ? 'paused' : 'cancelled');
 expect(() => f.journal.startOperation(observer, 'write', 'retry')).toThrow('observation-only');
 f.journal.release(observer);
});
test('authoritative resolution reopens model progress, while cached model replay does not dispatch', async () => {
 const f = fixture(), bridge = f.journal.bridge(f.claim);
 const response = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'prepared' }] };
 await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
 await bridge.checkpoint({ kind: 'model-result', turn: 0, message: response });
 const issued = f.start(); f.journal.settleOperation(f.claim, issued, { kind: 'unknown', reason: 'response lost' });
 expect(await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} })).toEqual({ cached: response });
 await expect(bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} })).rejects.toThrow('write-outcome-unknown');
 f.journal.reconcileOperation(f.claim, issued, { kind: 'succeeded', output: 'confirmed' }, validator);
 await bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} });
 expect(f.state().modelAttempts).toBe(2);
});
test('uncertain read does not acquire the external-write guard', async () => {
 const f = fixture(); f.intent.effectClass = 'read'; f.start();
 await f.journal.bridge(f.claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
 expect(f.state().modelAttempts).toBe(1);
});

function childRequest(spec: DurableRunSpec, mode: 'required' | 'detached' = 'required') {
 const slotId = 'child', hash = digest(['durable-child-v1', spec.workspaceId, spec.runId, slotId]);
 const runId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
 return { slotId, mode, outputSchema: { type: 'string' }, childSpec: { ...spec, runId, commandId: `child:${spec.runId}:${slotId}`, parent: { runId: spec.runId, slotId, mode }, context: { prompt: 'delegated task', systemPrompt: 'system' }, maxModelAttempts: 1 } };
}
test('uncertain parent write prevents new children and existing required child dispatch', async () => {
 const fresh = fixture(), issued = fresh.start();
 fresh.journal.settleOperation(fresh.claim, issued, { kind: 'unknown', reason: 'response lost' });
 expect(() => fresh.journal.admitChild(fresh.claim, childRequest(fresh.spec))).toThrow('write-outcome-unknown');
 expect(fresh.state().children).toBeUndefined();
 const active = fixture(), request = childRequest(active.spec);
 const edge = active.journal.admitChild(active.claim, request);
 const childClaim = active.journal.claim(edge.childRunId, 'w');
 const childBridge = active.journal.bridge(childClaim); active.start();
 await expect(childBridge.checkpoint({ kind: 'model-start', turn: 0, context: {} })).rejects.toThrow('write-outcome-unknown');
 expect(active.journal.get(edge.childRunId, 'w').modelAttempts).toBe(0);
 active.journal.release(childClaim);
});
test('restart preserves uncertain write and cannot reset its attempt allowance', async () => {
 const f = fixture(), issued = f.start();
 f.reopen(); f.claim = f.journal.claim('r', 'w');
 expect(f.journal.startOperation(f.claim, 'write', issued.commandId).dispatch).toBe(false);
 expect(() => f.journal.startOperation(f.claim, 'write', 'new-command')).toThrow('reconciliation-required');
 await expect(f.journal.bridge(f.claim).checkpoint({ kind: 'model-start', turn: 0, context: {} })).rejects.toThrow('write-outcome-unknown');
 expect(f.state().operations![0]!.attempts).toHaveLength(1);
});

test('confirmed write retains same-provider replay and blocks abandoning its step for a new provider', async () => {
 const f = fixture(true), response = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'saved step' }] };
 await f.journal.bridge(f.claim).checkpoint({ kind: 'workflow-step-start', step: 0, input: 'first' });
 f.claim = f.journal.beginStepAttempt(f.claim, { step: 0, candidateIndex: 0 });
 await f.journal.bridge(f.claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
 await f.journal.bridge(f.claim).checkpoint({ kind: 'model-result', turn: 0, message: response });
 f.intent.slotId = 'source-write:0:call'; f.journal.reserveOperation(f.claim, f.intent);
 const issued = f.journal.startOperation(f.claim, f.intent.slotId, 'issue').attempt!;
 f.journal.settleOperation(f.claim, issued, { kind: 'succeeded', output: 'confirmed' }, validator);
 f.claim = f.journal.recordProviderFailure(f.claim, { step: 0, candidateIndex: 0, code: 'provider-unavailable' });
 expect(f.journal.beginStepAttempt(f.claim, { step: 0, candidateIndex: 0 })).toEqual(f.claim);
 expect(() => f.journal.beginStepAttempt(f.claim, { step: 0, candidateIndex: 1 })).toThrow('write-provider-switch-blocked');
 expect(await f.journal.bridge(f.claim).checkpoint({ kind: 'model-start', turn: 0, context: {} })).toEqual({ cached: response });
 await f.journal.bridge(f.claim).checkpoint({ kind: 'workflow-step-complete', step: 0 });
 await f.journal.bridge(f.claim).checkpoint({ kind: 'workflow-step-start', step: 1, input: 'second' });
 f.claim = f.journal.beginStepAttempt(f.claim, { step: 1, candidateIndex: 0 });
 await f.journal.bridge(f.claim).checkpoint({ kind: 'model-start', turn: 1, context: {} });
 f.claim = f.journal.recordProviderFailure(f.claim, { step: 1, candidateIndex: 0, code: 'provider-unavailable' });
 expect(() => f.journal.beginStepAttempt(f.claim, { step: 1, candidateIndex: 1 })).not.toThrow();
});
test('write-provider switch scope is conservative for generic and malformed write slots', () => {
 const f = fixture(); f.start(); const operation = f.state().operations![0]!;
 expect(hasDispatchedWriteSince([operation], 10)).toBe(true);
 expect(hasDispatchedWriteSince([{ ...operation, attempts: [] }], 0)).toBe(false);
 expect(hasDispatchedWriteSince([{ ...operation, intent: { ...operation.intent, effectClass: 'read' } }], 0)).toBe(false);
 for (const slotId of ['source-write:NaN:call', 'source-write:999999999999999999999:call']) expect(hasDispatchedWriteSince([{ ...operation, intent: { ...operation.intent, slotId } }], 10)).toBe(true);
 expect(hasDispatchedWriteSince([{ ...operation, intent: { ...operation.intent, slotId: 'source-write:1:call' } }], 2)).toBe(false);
 expect(hasDispatchedWriteSince([{ ...operation, intent: { ...operation.intent, slotId: 'source-write:2:call' } }], 2)).toBe(true);
});

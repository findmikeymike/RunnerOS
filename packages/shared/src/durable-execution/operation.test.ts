import { afterEach, expect, test, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableJournal, type DurableRunSpec, type DurableOperationIntent } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()));
const validator = { id: 'output', version: '1', validate: (value: any) => typeof value?.reference === 'string' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-operation-')), key = randomBytes(32);
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  let journal = new DurableJournal({ configRoot: root, key });
  cleanups.push(() => journal.close());
  const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: 'run', workspaceId: 'workspace', commandId: 'admit',
    createdAt: Date.now(), deadlineAt: Date.now() + 60000, credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST },
    allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 10, authority: {}, context: {},
    costPolicy: { unit: 'trusted-upper-bound', maxTotalUnits: 20, maxUnitsPerAttempt: 5 } };
  journal.admit(spec);
  let claim = journal.claim(spec.runId, spec.workspaceId);
  const intent: DurableOperationIntent = { slotId: 'publish-1', adapterId: 'fixture', adapterVersion: '1', credentialIdentity: 'b'.repeat(64),
    effectClass: 'idempotent-write', idempotencyKey: 'unique-1', input: { secret: 'reviewable confidential payload' },
    outputSchema: { id: 'output', version: '1' }, maxAttempts: 2, maxUnitsPerAttempt: 7 };
  return { get journal() { return journal; }, get claim() { return claim; }, spec, intent,
    state: () => journal.get(spec.runId, spec.workspaceId),
    reopen(maxPayloadBytes?: number) { journal.release(claim); journal.close(); journal = new DurableJournal({ configRoot: root, key, maxPayloadBytes }); claim = journal.claim(spec.runId, spec.workspaceId); },
    start(commandId = 'attempt-1') { journal.reserveOperation(claim, intent); return journal.startOperation(claim, intent.slotId, commandId).attempt!; },
  };
}

test('immutable intent, account, schema and key survive reopen without plaintext disclosure', () => {
  const f = fixture(), first = f.journal.reserveOperation(f.claim, f.intent);
  f.intent.input = { secret: 'caller mutation' };
  expect(f.journal.getOperation('run', 'workspace', first.intent.slotId)).toEqual(first);
  expect(() => f.journal.reserveOperation(f.claim, f.intent)).toThrow('intent-conflict');
  f.reopen(); expect(f.journal.reserveOperation(f.claim, first.intent)).toEqual(first);
  expect(() => f.journal.reserveOperation(f.claim, { ...first.intent, slotId: 'other' })).toThrow('key-conflict');
  expect(readFileSync(f.journal.path).toString()).not.toContain('reviewable confidential payload');
  expect(() => f.journal.getOperation('run', 'other', first.intent.slotId)).toThrow('not-found');
});

test('start commits one budget reservation and duplicate start never authorizes dispatch', () => {
  const f = fixture(); f.journal.reserveOperation(f.claim, f.intent);
  const first = f.journal.startOperation(f.claim, f.intent.slotId, 'send');
  expect(first.dispatch).toBe(true); expect(first.attempt!.attempt).toBe(1); expect(f.state().reservedUnits).toBe(7);
  const duplicate = f.journal.startOperation(f.claim, f.intent.slotId, 'send');
  expect(duplicate.dispatch).toBe(false); expect(duplicate.attempt).toBeUndefined(); expect(f.state().reservedUnits).toBe(7);
  expect(() => f.journal.startOperation(f.claim, f.intent.slotId, 'send-again')).toThrow('reconciliation-required');
});

test('restart treats an issued invocation as uncertain, never a fresh send', () => {
  const f = fixture(), issued = f.start(), oldClaim = f.claim;
  expect(() => f.journal.reconcileOperation(f.claim, issued, { kind: 'not-applied', reason: 'not yet observed' })).toThrow('still-inflight');
  f.reopen();
  expect(f.journal.startOperation(f.claim, f.intent.slotId, issued.commandId).dispatch).toBe(false);
  expect(() => f.journal.startOperation(f.claim, f.intent.slotId, 'second')).toThrow('reconciliation-required');
  expect(() => f.journal.settleOperation(oldClaim, issued, { kind: 'succeeded', output: { reference: 'remote' } }, validator)).toThrow('stale-owner');
  const reconciled = f.journal.reconcileOperation(f.claim, issued, { kind: 'succeeded', output: { reference: 'remote' } }, validator);
  expect(reconciled.status).toBe('succeeded'); expect(reconciled.attempts).toHaveLength(1); expect(f.state().reservedUnits).toBe(7);
  expect(f.journal.reconcileOperation(f.claim, issued, { kind: 'succeeded', output: { reference: 'remote' } }, validator)).toEqual(reconciled);
});

test('unknown is not retryable; authoritative absence permits only a bounded fresh attempt', () => {
  const f = fixture(), first = f.start();
  f.journal.settleOperation(f.claim, first, { kind: 'unknown', reason: 'connection lost' });
  expect(() => f.journal.startOperation(f.claim, f.intent.slotId, 'second')).toThrow('reconciliation-required');
  f.journal.reconcileOperation(f.claim, first, { kind: 'not-applied', reason: 'authoritative provider lookup' });
  const second = f.journal.startOperation(f.claim, f.intent.slotId, 'second').attempt!;
  expect(second.attempt).toBe(2); expect(f.state().reservedUnits).toBe(14);
  f.journal.settleOperation(f.claim, second, { kind: 'not-applied', reason: 'provider definitively refused' });
  expect(() => f.journal.startOperation(f.claim, f.intent.slotId, 'third')).toThrow('budget-exhausted');
  expect(f.state().operations![0]!.attempts[0]!.outcome!.kind).toBe('unknown');
});

test('model and operation reservations share the same conservative hard budget', async () => {
  const f = fixture();
  await f.journal.bridge(f.claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
  expect(f.state().reservedUnits).toBe(5);
  f.intent.maxUnitsPerAttempt = 8; const token = f.start();
  f.journal.settleOperation(f.claim, token, { kind: 'not-applied', reason: 'no effect' });
  expect(() => f.journal.startOperation(f.claim, f.intent.slotId, 'second')).toThrow('budget-exhausted');
  expect(f.state().reservedUnits).toBe(13);
});

test('pause and cancel fence new dispatch while retaining issued observations', () => {
  const f = fixture(), token = f.start();
  f.journal.command({ runId: 'run', workspaceId: 'workspace', commandId: 'pause', expectedVersion: f.state().version, action: 'pause' });
  expect(() => f.journal.reserveOperation(f.claim, { ...f.intent, slotId: 'new', idempotencyKey: 'new' })).toThrow('dispatch-blocked');
  f.journal.command({ runId: 'run', workspaceId: 'workspace', commandId: 'cancel', expectedVersion: f.state().version, action: 'cancel' });
  expect(f.journal.settleOperation(f.claim, token, { kind: 'succeeded', output: { reference: 'late' } }, validator).status).toBe('succeeded');
  expect(f.state().status).toBe('cancelled');
  expect(() => f.journal.startOperation(f.claim, f.intent.slotId, 'new')).toThrow('dispatch-blocked');
});

test('success requires exact validator binding; invalid data cannot complete or unlock successors', async () => {
  const f = fixture();
  await f.journal.bridge(f.claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
  await f.journal.bridge(f.claim).checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [], stopReason: 'stop' } });
  const token = f.start();
  expect(() => f.journal.settleOperation(f.claim, token, { kind: 'succeeded', output: { reference: 'remote' } })).toThrow('output-invalid');
  expect(() => f.journal.settleOperation(f.claim, token, { kind: 'succeeded', output: {} }, validator)).toThrow('output-invalid');
  expect(() => f.journal.settleOperation(f.claim, token, { kind: 'succeeded', output: { reference: 'remote' } }, { ...validator, version: '2' })).toThrow('output-invalid');
  await expect(f.journal.bridge(f.claim).checkpoint({ kind: 'complete' })).rejects.toThrow('operation-incomplete');
  f.journal.reserveOperation(f.claim, { ...f.intent, slotId: 'next', idempotencyKey: 'next' });
  expect(() => f.journal.startOperation(f.claim, 'next', 'next')).toThrow('predecessor-incomplete');
  f.journal.settleOperation(f.claim, token, { kind: 'succeeded', output: { reference: 'remote' } }, validator);
  expect(f.journal.startOperation(f.claim, 'next', 'next').dispatch).toBe(true);
});

test('failed dispatch persistence cannot acknowledge or reserve budget', () => {
  const f = fixture(); f.journal.reserveOperation(f.claim, f.intent); const before = f.state(); f.reopen(100);
  expect(() => f.journal.startOperation(f.claim, f.intent.slotId, 'send')).toThrow('payload-limit');
  expect(f.state()).toEqual(before); f.reopen();
  expect(f.journal.startOperation(f.claim, f.intent.slotId, 'send').dispatch).toBe(true);
});

test('late reconciliation cannot be applied to a different attempt or forged identity', () => {
  const f = fixture(), first = f.start();
  f.journal.settleOperation(f.claim, first, { kind: 'unknown', reason: 'lost' });
  f.journal.reconcileOperation(f.claim, first, { kind: 'not-applied', reason: 'absent' });
  const second = f.journal.startOperation(f.claim, f.intent.slotId, 'second').attempt!;
  f.journal.settleOperation(f.claim, second, { kind: 'unknown', reason: 'lost again' });
  expect(() => f.journal.reconcileOperation(f.claim, first, { kind: 'succeeded', output: { reference: 'stale' } }, validator)).toThrow('outcome-conflict');
  expect(() => f.journal.reconcileOperation(f.claim, { ...second, operationId: 'forged' }, { kind: 'failed', reason: 'forged' })).toThrow('attempt-mismatch');
  expect(f.state().operations![0]!.status).toBe('unknown');
});

test('intent validation refuses unbounded attempts, mutable schema identity and key reuse', () => {
  const f = fixture();
  for (const change of [{ maxAttempts: 0 }, { maxAttempts: 1.5 }, { maxUnitsPerAttempt: -1 }, { outputSchema: { id: '', version: '1' } }]) {
    expect(() => f.journal.reserveOperation(f.claim, { ...f.intent, ...change })).toThrow('invalid-durable-operation-intent');
  }
  f.journal.reserveOperation(f.claim, f.intent);
  expect(() => f.journal.reserveOperation(f.claim, { ...f.intent, adapterVersion: '2' })).toThrow('intent-conflict');
  expect(() => f.journal.reserveOperation(f.claim, { ...f.intent, credentialIdentity: 'c'.repeat(64) })).toThrow('intent-conflict');
});

test('expiry blocks dispatch but not observations; old control revisions cannot start work', () => {
  const f = fixture(), token = f.start();
  const clock = spyOn(Date, 'now').mockReturnValue(f.spec.deadlineAt + 1);
  try {
    expect(() => f.journal.reserveOperation(f.claim, { ...f.intent, slotId: 'late', idempotencyKey: 'late' })).toThrow('dispatch-blocked');
    expect(f.journal.settleOperation(f.claim, token, { kind: 'succeeded', output: { reference: 'late' } }, validator).status).toBe('succeeded');
  } finally { clock.mockRestore(); }
  f.journal.command({ runId: 'run', workspaceId: 'workspace', commandId: 'pause', expectedVersion: f.state().version, action: 'pause' });
  f.journal.command({ runId: 'run', workspaceId: 'workspace', commandId: 'resume', expectedVersion: f.state().version, action: 'resume' });
  expect(() => f.journal.reserveOperation(f.claim, { ...f.intent, slotId: 'stale', idempotencyKey: 'stale' })).toThrow('dispatch-blocked');
});

test('intent and reconciliation writes roll back completely when storage refuses their payload', () => {
  const f = fixture(), before = f.state(); f.reopen(100);
  expect(() => f.journal.reserveOperation(f.claim, f.intent)).toThrow('payload-limit'); expect(f.state()).toEqual(before);
  f.reopen(); const token = f.start(); f.reopen(100);
  const inflight = f.state();
  expect(() => f.journal.reconcileOperation(f.claim, token, { kind: 'succeeded', output: { reference: 'remote' } }, validator)).toThrow('payload-limit');
  expect(f.state()).toEqual(inflight); f.reopen();
  expect(f.journal.reconcileOperation(f.claim, token, { kind: 'succeeded', output: { reference: 'remote' } }, validator).status).toBe('succeeded');
});

test('validator sees a separately frozen result and cannot rewrite saved output', () => {
  const f = fixture(), token = f.start();
  const output = { reference: 'remote', nested: { saved: true } };
  const checked = { ...validator, validate(value: any) { expect(Object.isFrozen(value.nested)).toBe(true); try { value.nested.saved = false; } catch {} return true; } };
  f.journal.settleOperation(f.claim, token, { kind: 'succeeded', output }, checked);
  output.nested.saved = false;
  expect((f.state().operations![0]!.attempts[0]!.outcome as any).output.nested.saved).toBe(true);
});

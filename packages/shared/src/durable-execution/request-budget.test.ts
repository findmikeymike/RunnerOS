import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal, type DurableRunSpec, type DurableOperationIntent } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function fixture() {
 const root = mkdtempSync(join(tmpdir(), 'request-budget-')), key = randomBytes(32); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
 let journal = new DurableJournal({ configRoot: root, key }); cleanup.push(() => journal.close());
 const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: 'r', workspaceId: 'w', commandId: 'admit', createdAt: Date.now(), credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 2, authority: {}, context: {}, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'model-requests', maxTotalUnits: 2, maxUnitsPerAttempt: 1 }, approvalPrincipalId: 'alice' };
 return { spec, get journal() { return journal; }, reopen() { journal.close(); journal = new DurableJournal({ configRoot: root, key }); } };
}
test('interrupted model requests retain reservations after reopen and exhaust the fixed cap', async () => {
 const f = fixture(); f.journal.admit(f.spec);
 let claim = f.journal.claim('r', 'w'); await f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context: {} }); f.journal.release(claim); f.reopen();
 expect(f.journal.get('r', 'w').reservedUnits).toBe(1);
 claim = f.journal.claim('r', 'w'); const bridge = f.journal.bridge(claim);
 await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
 expect(f.journal.get('r', 'w').modelAttempts).toBe(2); expect(f.journal.get('r', 'w').reservedUnits).toBe(2);
 await expect(bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} })).rejects.toThrow('budget-exhausted');
 expect(f.journal.get('r', 'w').reservedUnits).toBe(2);
});
test('request policies must reserve exactly one integer unit per allowed model attempt', () => {
 for (const [total, perAttempt] of [[1, 1], [3, 1], [2, 0], [2, 2], [2, 0.5], [2.5, 1]]) {
  const f = fixture(); expect(() => f.journal.admit({ ...f.spec, costPolicy: { unit: 'model-requests', maxTotalUnits: total!, maxUnitsPerAttempt: perAttempt! } })).toThrow('invalid-durable-admission'); expect(f.journal.listInternal('w')).toEqual([]);
 }
});
test('request budgets cannot fund effect operations or child admission', () => {
 const f = fixture(); f.journal.admit(f.spec); const claim = f.journal.claim('r', 'w');
 expect(() => f.journal.reserveOperation(claim, { slotId: 'effect', adapterId: 'fixture', adapterVersion: '1', credentialIdentity: f.spec.credentialIdentity, effectClass: 'idempotent-write', idempotencyKey: 'key', input: {}, outputSchema: { id: 'fixture', version: '1' }, maxAttempts: 1, maxUnitsPerAttempt: 0 })).toThrow('operations-unsupported');
 expect(() => f.journal.admitChild(claim, { slotId: 'child', mode: 'required', childSpec: { ...f.spec, runId: 'child' }, outputSchema: { type: 'string' } })).toThrow('children-unsupported');
 expect(f.journal.get('r', 'w').operations).toBeUndefined(); expect(f.journal.get('r', 'w').children).toBeUndefined(); expect(f.journal.listInternal('w')).toHaveLength(1);
});

function readIntent(slotId = 'read'): DurableOperationIntent {
 return { slotId, adapterId: 'fixture', adapterVersion: '1', credentialIdentity: 'a'.repeat(64), effectClass: 'read', idempotencyKey: slotId, input: {}, outputSchema: { id: 'fixture', version: '1' }, maxAttempts: 2, maxUnitsPerAttempt: 0 };
}
const outputValidator = { id: 'fixture', version: '1', validate: () => true };
test('read operation grants require a strict bounded shape and model-request policy', () => {
 for (const budget of [null, [], {}, { maxOperations: 0, maxAttempts: 1 }, { maxOperations: 9, maxAttempts: 1 }, { maxOperations: 1, maxAttempts: 0 }, { maxOperations: 1, maxAttempts: 17 }, { maxOperations: 1.5, maxAttempts: 1 }, { maxOperations: 1, maxAttempts: 1.5 }, { maxOperations: 1, maxAttempts: 1, extra: true }]) {
  const f = fixture(); expect(() => f.journal.admit({ ...f.spec, readOperationBudget: budget as any })).toThrow('invalid-durable-read-operation-budget'); expect(f.journal.listInternal('w')).toEqual([]);
 }
 for (const unit of ['verified-free', 'trusted-upper-bound'] as const) {
  const f = fixture(); expect(() => f.journal.admit({ ...f.spec, readOperationBudget: { maxOperations: 1, maxAttempts: 1 }, costPolicy: { unit, maxTotalUnits: unit === 'verified-free' ? 0 : 2, maxUnitsPerAttempt: unit === 'verified-free' ? 0 : 1 } })).toThrow('invalid-durable-read-operation-budget');
 }
});
test('read grant never authorizes writes, model-unit costs, excessive retries, or ungranted reads', () => {
 const f = fixture(); f.journal.admit({ ...f.spec, readOperationBudget: { maxOperations: 2, maxAttempts: 2 } }); const claim = f.journal.claim('r', 'w');
 for (const patch of [{ effectClass: 'idempotent-write' }, { effectClass: 'reconcilable-write' }, { maxUnitsPerAttempt: 1 }, { maxUnitsPerAttempt: 0.5 }, { maxAttempts: 3 }]) expect(() => f.journal.reserveOperation(claim, { ...readIntent(), ...patch } as DurableOperationIntent)).toThrow('operations-unsupported');
 expect(f.journal.get('r', 'w').operations).toBeUndefined();
 const ungranted = fixture(); ungranted.journal.admit(ungranted.spec); expect(() => ungranted.journal.reserveOperation(ungranted.journal.claim('r', 'w'), readIntent())).toThrow('operations-unsupported');
});
test('read count and aggregate attempts persist across reopen independently of model units', async () => {
 const f = fixture(); f.journal.admit({ ...f.spec, readOperationBudget: { maxOperations: 2, maxAttempts: 2 } }); let claim = f.journal.claim('r', 'w');
 f.journal.reserveOperation(claim, readIntent('one')); f.journal.reserveOperation(claim, readIntent('two'));
 expect(() => f.journal.reserveOperation(claim, readIntent('three'))).toThrow('operation-budget-exhausted');
 expect(f.journal.reserveOperation(claim, readIntent('one')).attempts).toHaveLength(0);
 const first = f.journal.startOperation(claim, 'one', 'attempt-one');
 f.journal.settleOperation(claim, first.attempt!, { kind: 'succeeded', output: 'one' }, outputValidator);
 f.journal.release(claim); f.reopen(); claim = f.journal.claim('r', 'w');
 expect(f.journal.get('r', 'w').spec.readOperationBudget).toEqual({ maxOperations: 2, maxAttempts: 2 });
 const second = f.journal.startOperation(claim, 'two', 'attempt-two');
 f.journal.settleOperation(claim, second.attempt!, { kind: 'not-applied', reason: 'retryable' });
 expect(f.journal.startOperation(claim, 'two', 'attempt-two').dispatch).toBe(false);
 expect(() => f.journal.startOperation(claim, 'two', 'attempt-three')).toThrow('operation-budget-exhausted');
 expect(f.journal.get('r', 'w').reservedUnits).toBe(0);
 await f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
 expect(f.journal.get('r', 'w').reservedUnits).toBe(1); expect(f.journal.get('r', 'w').modelAttempts).toBe(1);
});
test('an exhausted model budget does not consume the separate read allowance', async () => {
 const f = fixture(); f.journal.admit({ ...f.spec, readOperationBudget: { maxOperations: 1, maxAttempts: 2 } }); const claim = f.journal.claim('r', 'w');
 const bridge = f.journal.bridge(claim); await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} }); await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
 f.journal.reserveOperation(claim, readIntent()); expect(f.journal.startOperation(claim, 'read', 'read-attempt').dispatch).toBe(true);
 expect(f.journal.get('r', 'w').reservedUnits).toBe(2);
});
test('schema six upgrades to seven while retaining an ungranted run unchanged', () => {
 const f = fixture(); f.journal.admit(f.spec); (f.journal as any).db.exec('PRAGMA user_version=6'); f.reopen();
 expect((f.journal as any).db.prepare('PRAGMA user_version').get().user_version).toBe(10); expect(f.journal.get('r', 'w').spec).toEqual(f.spec);
 expect(() => f.journal.reserveOperation(f.journal.claim('r', 'w'), readIntent())).toThrow('operations-unsupported');
});

test('read attempt cap is never reset by release or uncertain dispatch recovery', () => {
 const f = fixture(); f.journal.admit({ ...f.spec, readOperationBudget: { maxOperations: 1, maxAttempts: 2 } }); let claim = f.journal.claim('r', 'w');
 f.journal.reserveOperation(claim, { ...readIntent(), maxAttempts: 1 }); const first = f.journal.startOperation(claim, 'read', 'uncertain');
 f.journal.release(claim); f.reopen(); claim = f.journal.claim('r', 'w');
 expect(f.journal.startOperation(claim, 'read', 'uncertain').dispatch).toBe(false);
 f.journal.reconcileOperation(claim, first.attempt!, { kind: 'not-applied', reason: 'safe read retry' });
 expect(() => f.journal.startOperation(claim, 'read', 'retry')).toThrow('operation-budget-exhausted');
 expect(f.journal.getOperation('r', 'w', 'read')!.attempts).toHaveLength(1);
});

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal, type DurableRunSpec } from './index.ts';
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

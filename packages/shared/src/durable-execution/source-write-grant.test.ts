import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal, type DurableRunSpec, type DurableOperationIntent } from './index';
import { DURABLE_RUNTIME_MANIFEST, isDurableSourceTools, isDurableSourceToolInput } from '../protocol/durable-execution';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
const source = { name: 'mcp__calendar__api_calendar', sourceSlug: 'calendar', description: 'Calendar', writeMethods: ['POST'], inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['GET', 'POST'] }, path: { type: 'string' } } } };
function fixture(patch: Partial<DurableRunSpec> = {}) {
 const root = mkdtempSync(join(tmpdir(), 'source-write-grant-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
 const journal = new DurableJournal({ configRoot: root, key: randomBytes(32) }); cleanup.push(() => journal.close());
 const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: 'r', workspaceId: 'w', commandId: 'admit', createdAt: Date.now(), credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, allowedTools: [source.name], sourceTools: [source], model: 'm', maxOutputTokens: 100, maxModelAttempts: 2, authority: {}, context: {}, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'model-requests', maxTotalUnits: 2, maxUnitsPerAttempt: 1 }, approvalPrincipalId: 'alice', ...patch };
 return { journal, spec, admit() { journal.admit(spec); return journal.claim('r', 'w'); } };
}
const intent = (slotId: string, effectClass: DurableOperationIntent['effectClass'] = 'single-attempt-write'): DurableOperationIntent => ({ slotId, adapterId: 'shared-api', adapterVersion: '1', credentialIdentity: 'a'.repeat(64), effectClass, idempotencyKey: slotId, input: { method: 'POST', path: '/events' }, outputSchema: { id: 'receipt', version: '1' }, maxAttempts: 1, maxUnitsPerAttempt: 0 });
const validator = { id: 'receipt', version: '1', validate: (value: unknown) => value === 'saved' };
test('source writes require exact grant and exact model-visible schema methods', () => {
 expect(isDurableSourceTools([source])).toBe(true);
 for (const writeMethods of [[], ['GET'], ['POST', 'POST'], ['HEAD'], ['POST', 'DELETE']]) expect(isDurableSourceTools([{ ...source, writeMethods }])).toBe(false);
 expect(isDurableSourceToolInput({ method: 'POST', path: '/events' })).toBe(false);
 expect(isDurableSourceToolInput({ method: 'POST', path: '/events' }, ['POST'])).toBe(true);
 expect(isDurableSourceToolInput({ method: 'DELETE', path: '/events' }, ['POST'])).toBe(false);
});
test('write operation budget is explicit, strict, and cannot fund retryable writes or money units', () => {
 for (const writeOperationBudget of [null, {}, { maxOperations: 9, maxAttempts: 1 }, { maxOperations: 1, maxAttempts: 9 }, { maxOperations: 1, maxAttempts: 1, extra: 1 }]) {
  const f = fixture({ writeOperationBudget: writeOperationBudget as any }); expect(() => f.admit()).toThrow('invalid-durable-write-operation-budget');
 }
 const absent = fixture(); expect(() => absent.admit()).toThrow('write-operation-budget');
 const readOnly = fixture({ sourceTools: [{ name: source.name, description: source.description, sourceSlug: source.sourceSlug, inputSchema: { type: 'object' } }] }), readClaim = readOnly.admit();
 expect(() => readOnly.journal.reserveOperation(readClaim, intent('w'))).toThrow('operations-unsupported');
 const f = fixture({ writeOperationBudget: { maxOperations: 2, maxAttempts: 2 } }), claim = f.admit();
 for (const patch of [{ effectClass: 'idempotent-write' }, { effectClass: 'reconcilable-write' }, { maxUnitsPerAttempt: 1 }]) expect(() => f.journal.reserveOperation(claim, { ...intent('w'), ...patch } as DurableOperationIntent)).toThrow('operations-unsupported');
 expect(() => f.journal.reserveOperation(claim, { ...intent('w'), maxAttempts: 2 })).toThrow('invalid-durable-operation-intent');
});
test('read and write operation counts are separate, fixed and leave model budget intact', () => {
 const f = fixture({ readOperationBudget: { maxOperations: 1, maxAttempts: 1 }, writeOperationBudget: { maxOperations: 1, maxAttempts: 1 } }), claim = f.admit();
 for (const [slot, effectClass] of [['read', 'read'], ['write', 'single-attempt-write']] as const) {
  f.journal.reserveOperation(claim, intent(slot, effectClass)); const attempt = f.journal.startOperation(claim, slot, slot).attempt!;
  f.journal.settleOperation(claim, attempt, { kind: 'succeeded', output: 'saved' }, validator);
 }
 expect(f.journal.get('r', 'w').reservedUnits).toBe(0);
 expect(() => f.journal.reserveOperation(claim, intent('extra'))).toThrow('operation-budget-exhausted');
 expect(() => f.journal.reserveOperation(claim, intent('extra-read', 'read'))).toThrow('operation-budget-exhausted');
});
test('journal starts only granted writes and successful operation receipt allows exact tool result completion', async () => {
 const f = fixture({ writeOperationBudget: { maxOperations: 1, maxAttempts: 1 } }), claim = f.admit();
 const bridge = f.journal.bridge(claim, { authorizeTool: async () => ({ principalId: 'alice', credentialIdentity: f.spec.credentialIdentity, policyRevision: 'existing-policy', allowed: true, requiresApproval: false, approvalExpiresAt: f.spec.deadlineAt }) });
 const input = { method: 'POST', path: '/events', params: { title: 'approved event' } }, request = { turn: 0, callId: 'call', tool: source.name, input };
 await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
 await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call', name: source.name, arguments: input }] } });
 await expect(bridge.checkpoint({ kind: 'tool-start', ...request, input: { ...input, method: 'DELETE' } })).rejects.toThrow('not-authorized');
 await bridge.checkpoint({ kind: 'tool-start', ...request });
 f.journal.assertSourceToolDispatch(claim, request);
 f.journal.reserveOperation(claim, intent('write')); const attempt = f.journal.startOperation(claim, 'write', 'send').attempt!;
 f.journal.settleOperation(claim, attempt, { kind: 'succeeded', output: 'saved' }, validator);
 // Recovery may reuse the effect receipt before the SDK tool-result was committed.
 f.journal.assertSourceToolDispatch(claim, request);
 const result = { content: [{ type: 'text', text: 'saved' }] };
 await bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'call', result });
 expect(await bridge.checkpoint({ kind: 'tool-start', ...request })).toEqual({ cached: result });
 expect(f.journal.startOperation(claim, 'write', 'send').dispatch).toBe(false);
});
test('final write dispatch uses the consumed exact approval and rejects changed authority without another prompt', async () => {
 const f = fixture({ writeOperationBudget: { maxOperations: 1, maxAttempts: 1 } }); let claim = f.admit();
 const authorization = { principalId: 'alice', credentialIdentity: f.spec.credentialIdentity, policyRevision: 'existing-policy', allowed: true, requiresApproval: true, approvalExpiresAt: f.spec.deadlineAt };
 let bridge = f.journal.bridge(claim, { authorizeTool: async () => authorization });
 const request = { turn: 0, callId: 'call', tool: source.name, input: { method: 'POST', path: '/events' } };
 await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
 await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call', name: source.name, arguments: request.input }] } });
 await expect(bridge.checkpoint({ kind: 'tool-start', ...request })).rejects.toThrow('approval-required');
 const state = f.journal.get('r', 'w'), approval = state.approvals![0]!;
 f.journal.decide({ runId: 'r', workspaceId: 'w', commandId: 'approve', expectedVersion: state.version, action: 'approve', approvalId: approval.id, inputDigest: approval.inputDigest, principalId: approval.principalId, credentialIdentity: approval.credentialIdentity, policyRevision: approval.policyRevision });
 f.journal.release(claim); claim = f.journal.claim('r', 'w'); bridge = f.journal.bridge(claim, { authorizeTool: async () => authorization });
 await bridge.checkpoint({ kind: 'tool-start', ...request });
 f.journal.assertSourceWriteAuthorization(claim, request, authorization);
 for (const patch of [{ allowed: false }, { principalId: 'bob' }, { credentialIdentity: 'b'.repeat(64) }, { policyRevision: 'changed' }, { approvalExpiresAt: Date.now() - 1 }]) expect(() => f.journal.assertSourceWriteAuthorization(claim, request, { ...authorization, ...patch })).toThrow('authorization-changed');
 expect(f.journal.get('r', 'w').approvals).toHaveLength(1);
 expect(f.journal.get('r', 'w').approvals![0]!.status).toBe('consumed');
});

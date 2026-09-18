import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal, type DurableRunSpec } from './index';
import { DURABLE_RUNTIME_MANIFEST, isDurableSourceTools, isDurableSourceToolInput } from '../protocol/durable-execution';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
const sourceTool = { name: 'mcp__calendar__api_calendar', sourceSlug: 'calendar', description: 'Read connected calendar', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } };
const request = { turn: 0, callId: 'call', tool: sourceTool.name, input: { method: 'GET', path: '/events' } };
function fixture() {
 const root = mkdtempSync(join(tmpdir(), 'source-tool-')), key = randomBytes(32); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
 const journal = new DurableJournal({ configRoot: root, key }); cleanup.push(() => journal.close());
 const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: 'r', workspaceId: 'w', commandId: 'admit', createdAt: Date.now(), credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, allowedTools: ['read', sourceTool.name], sourceTools: [structuredClone(sourceTool)], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 2, authority: {}, context: {}, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'model-requests', maxTotalUnits: 2, maxUnitsPerAttempt: 1 }, approvalPrincipalId: 'alice' };
 journal.admit(spec); const claim = journal.claim('r', 'w');
 const bridge = journal.bridge(claim, { authorizeTool: async () => ({ principalId: 'alice', policyRevision: 'read-1', credentialIdentity: spec.credentialIdentity, allowed: true, requiresApproval: false, approvalExpiresAt: spec.deadlineAt }) });
 async function model() {
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call', name: sourceTool.name, arguments: request.input }] } });
 }
 return { journal, claim, bridge, spec, model };
}
test('source grant shape rejects arbitrary proxies, duplicate tools, executable schemas and writes', () => {
 expect(isDurableSourceTools([sourceTool])).toBe(true);
 for (const value of [[], [sourceTool, sourceTool], [{ ...sourceTool, name: 'mcp__session__send' }], [{ ...sourceTool, inputSchema: { type: 'object', callback: () => {} } }]]) expect(isDurableSourceTools(value)).toBe(false);
 for (const value of [{ method: 'POST', path: '/events' }, { method: null, path: '/events' }, { path: '/events', params: [] }, { path: '/events', extra: true }]) expect(isDurableSourceToolInput(value)).toBe(false);
 expect(isDurableSourceToolInput({ path: '/events' })).toBe(true);
});
test('source dispatch requires committed model call and exact started input; replay avoids new dispatch', async () => {
 const f = fixture();
 expect(() => f.journal.assertSourceToolDispatch(f.claim, request)).toThrow();
 await f.model();
 expect(() => f.journal.assertSourceToolDispatch(f.claim, request)).toThrow('not-started');
 await f.bridge.checkpoint({ kind: 'tool-start', ...request });
 expect(() => f.journal.assertSourceToolDispatch(f.claim, request)).not.toThrow();
 expect(() => f.journal.assertSourceToolDispatch(f.claim, { ...request, input: { method: 'GET', path: '/other' } })).toThrow('not-started');
 expect(() => f.journal.assertSourceToolDispatch(f.claim, { ...request, input: { method: 'DELETE', path: '/events' } })).toThrow('not-authorized');
 const result = { content: [{ type: 'text', text: 'saved account result' }] };
 await f.bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'call', result });
 expect(await f.bridge.checkpoint({ kind: 'tool-start', ...request })).toEqual({ cached: result });
 expect(() => f.journal.assertSourceToolDispatch(f.claim, request)).toThrow('not-started');
 expect(f.journal.get('r', 'w').approvals ?? []).toHaveLength(0);
 expect(Object.isFrozen(f.bridge.descriptor.sourceTools?.[0]?.inputSchema)).toBe(true);
});
test('source writes are denied at journal start and paused runs cannot dispatch', async () => {
 const f = fixture(); await f.model();
 await expect(f.bridge.checkpoint({ kind: 'tool-start', ...request, input: { method: 'POST', path: '/events' } })).rejects.toThrow('source-read-not-authorized');
 await f.bridge.checkpoint({ kind: 'tool-start', ...request });
 f.journal.command({ runId: 'r', workspaceId: 'w', commandId: 'pause', expectedVersion: f.journal.get('r', 'w').version, action: 'pause' });
 expect(() => f.journal.assertSourceToolDispatch(f.claim, request)).toThrow();
});

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal, type DurableRunSpec } from '../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../../../shared/src/protocol/durable-execution.ts';
import { DurableWorkflowRuns } from './durable-workflow-runs.ts';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
const actor = { clientId: 'connection', workspaceId: 'w' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-projection-')), key = randomBytes(32);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let journal = new DurableJournal({ configRoot: root, key }); cleanup.push(() => journal.close());
  const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: 'r', workspaceId: 'w', commandId: 'admit', createdAt: Date.now(), credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 3, authority: { adapter: 'pi-local-read-1', stepCount: 1, completion: 'journal-only' }, context: { systemPrompt: 'PRIVATE SYSTEM', bindingDigest: 'PRIVATE BINDING', workflow: { slug: 'review', body: 'Review', metadata: { name: 'Review', trigger: { type: 'manual' }, outputs: { mode: 'none' }, steps: [{ id: 'read', agent: 'reader', input: 'Read fixture' }] } } }, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 }, approvalPrincipalId: 'alice' };
  journal.admit(spec);
  return { root, spec, get journal() { return journal; }, reopen() { journal.close(); journal = new DurableJournal({ configRoot: root, key }); }, service(active = false) { return new DurableWorkflowRuns({ journal, resolvePrincipal: () => 'alice', isActive: () => active }); } };
}
test('journal output survives reopen and exposes no runtime secrets or duplicate run file', async () => {
  const f = fixture(), claim = f.journal.claim('r', 'w'), bridge = f.journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Saved answer' }] } });
  await bridge.checkpoint({ kind: 'complete' }); f.journal.release(claim); f.reopen();
  const run = await f.service().get('w', 'r', actor);
  expect(run?.state).toBe('succeeded'); expect(run?.steps[0]?.output).toBe('Saved answer');
  expect(run?.completedAt).toBeUndefined(); expect(JSON.stringify(run)).not.toContain('PRIVATE'); expect(JSON.stringify(run)).not.toContain(f.spec.credentialIdentity);
  expect(existsSync(join(f.root, 'runs', 'r', 'run.json'))).toBe(false);
});
test('running is interrupted without a live owner and paused remains paused', async () => {
  const f = fixture(); expect((await f.service().get('w', 'r', actor))?.state).toBe('interrupted');
  expect((await f.service(true).get('w', 'r', actor))?.state).toBe('running');
  f.journal.command({ runId: 'r', workspaceId: 'w', commandId: 'pause', expectedVersion: f.journal.get('r', 'w').version, action: 'pause' });
  expect((await f.service().get('w', 'r', actor))?.state).toBe('paused');
});
test('authority filters list, rejects foreign direct reads and distinguishes internal IDs from missing', async () => {
  const f = fixture(); f.journal.admit({ ...f.spec, runId: 'foreign', commandId: 'foreign', approvalPrincipalId: 'bob' });
  f.journal.admit({ ...f.spec, runId: 'internal', commandId: 'internal', context: {} });
  expect((await f.service().list('w', actor)).map(run => run.id)).toEqual(['r']);
  await expect(f.service().get('w', 'foreign', actor)).rejects.toThrow('principal-mismatch');
  await expect(f.service().get('w', 'internal', actor)).rejects.toThrow('not-public');
  expect(await f.service().get('w', 'missing', actor)).toBeNull();
  await expect(f.service().list('other', actor)).rejects.toThrow('workspace-mismatch');
});
test('actor is pinned before asynchronous authority resolution', async () => {
  const f = fixture(); let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  const input = { ...actor }; let observed = '';
  const service = new DurableWorkflowRuns({ journal: f.journal, resolvePrincipal: async (_workspace, pinned) => { await gate; observed = pinned.clientId; return 'alice'; } });
  const pending = service.get('w', 'r', input); input.clientId = 'attacker'; input.workspaceId = 'elsewhere'; release();
  expect((await pending)?.id).toBe('r'); expect(observed).toBe('connection');
});
test('saved approval wait projects paused and awaiting-human after restart', async () => {
  const f = fixture(), claim = f.journal.claim('r', 'w');
  const bridge = f.journal.bridge(claim, { authorizeTool: async () => ({ principalId: 'alice', policyRevision: 'p', credentialIdentity: f.spec.credentialIdentity, allowed: true, requiresApproval: true, approvalExpiresAt: Date.now() + 30000 }) });
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call', name: 'read', arguments: { path: 'fixture' } }] } });
  await expect(bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'call', tool: 'read', input: { path: 'fixture' } })).rejects.toThrow('approval-required');
  f.journal.release(claim); f.reopen(); const run = await f.service().get('w', 'r', actor);
  expect(run?.state).toBe('paused'); expect(run?.steps[0]?.state).toBe('awaiting-human'); expect(run?.steps[0]?.output).toBeUndefined(); expect(run?.durable?.status).toBe('waiting-approval');
});
test('all journal IDs suppress legacy collisions, including hidden and foreign-principal runs', async () => {
  const f = fixture();
  f.journal.admit({ ...f.spec, runId: 'internal', commandId: 'internal', context: {} });
  f.journal.admit({ ...f.spec, runId: 'foreign', commandId: 'foreign', approvalPrincipalId: 'bob' });
  const template = (await f.service().get('w', 'r', actor))!;
  const legacy = ['r', 'internal', 'foreign', 'legacy', 'wrong-workspace'].map(id => ({ ...template, id, workflowSlug: 'legacy-copy', workspaceId: id === 'wrong-workspace' ? 'elsewhere' : 'w' }));
  const runs = await f.service().list('w', actor, legacy);
  expect(runs.map(run => run.id).sort()).toEqual(['legacy', 'r']);
  expect(runs.find(run => run.id === 'r')?.workflowSlug).toBe('review');
  expect(runs.find(run => run.id === 'legacy')?.workflowSlug).toBe('legacy-copy');
});
test('legacy list input is frozen before authority awaits', async () => {
  const f = fixture(), template = (await f.service().get('w', 'r', actor))!;
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  const service = new DurableWorkflowRuns({ journal: f.journal, resolvePrincipal: async () => { await gate; return 'alice'; } });
  const legacy = [{ ...template, id: 'legacy', workspaceId: 'elsewhere' }];
  const pending = service.list('w', actor, legacy); legacy[0]!.workspaceId = 'w'; release();
  expect((await pending).map(run => run.id)).toEqual(['r']);
});

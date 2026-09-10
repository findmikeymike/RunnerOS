import { afterEach, expect, test, spyOn } from 'bun:test';
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
test('pending publication shows saved step text but exposes final Output only after receipt', async () => {
  const f = fixture(), outputId = 'dd38148b-74d8-5fce-9f33-47886ead6297';
  f.journal.admit({ ...f.spec, runId: 'publish', commandId: 'publish', publication: { outputId, kind: 'report', title: 'Report', stepId: 'read' } });
  const claim = f.journal.claim('publish', 'w'), bridge = f.journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Saved report' }] } });
  await bridge.checkpoint({ kind: 'complete' });
  const pending = await f.service().get('w', 'publish', actor);
  expect(pending?.state).toBe('interrupted'); expect(pending?.steps[0]?.state).toBe('succeeded');
  expect(pending?.steps[0]?.output).toBe('Saved report'); expect(pending?.outputError).toContain('Resume'); expect(pending?.finalOutputId).toBeUndefined();
  await bridge.checkpoint({ kind: 'output-published', outputId });
  const published = await f.service().get('w', 'publish', actor);
  expect(published?.state).toBe('succeeded'); expect(published?.finalOutputId).toBe(outputId); expect(published?.outputError).toBeUndefined();
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

test('multi-step history keeps completed outputs while later steps are interrupted or fail', async () => {
  const f = fixture();
  const steps = [{ id: 'first', agent: 'reader', input: 'Read notes' }, { id: 'second', agent: 'reader', input: '{{steps.first.output}}' }, { id: 'third', agent: 'reader', input: 'Finish' }];
  const spec: DurableRunSpec = { ...f.spec, runId: 'multi', commandId: 'multi', workflowSteps: steps.map(({ id }) => ({ id })), authority: { adapter: 'pi-local-read-multi-1', stepCount: 3, completion: 'journal-only' }, context: { workflow: { slug: 'multi', body: '', metadata: { steps, name: 'Multi', trigger: { type: 'manual' }, outputs: { mode: 'none' } } } } };
  f.journal.admit(spec); const claim = f.journal.claim('multi', 'w'), bridge = f.journal.bridge(claim);
  await bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: { prompt: 'Read notes' } });
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Kept result' }] } });
  await bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 }); f.journal.release(claim); f.reopen();
  const interrupted = await f.service().get('w', 'multi', actor);
  expect(interrupted?.state).toBe('interrupted');
  expect(interrupted?.steps.map(step => step.state)).toEqual(['succeeded', 'interrupted', 'queued']);
  expect(interrupted?.steps[0]?.output).toBe('Kept result');
  const next = f.journal.claim('multi', 'w'); await f.journal.bridge(next).fail('fixture'); f.journal.release(next);
  const failed = await f.service().get('w', 'multi', actor);
  expect(failed?.steps.map(step => step.state)).toEqual(['succeeded', 'failed', 'skipped']);
  expect(failed?.steps[0]?.output).toBe('Kept result'); expect(failed?.steps[1]?.output).toBeUndefined();
});

test('provider attention exposes safe model receipts and expired-run recovery guidance', async () => {
  const f = fixture();
  const spec: DurableRunSpec = { ...f.spec, runId: 'fallback', commandId: 'fallback',
    workflowSteps: [{ id: 'read' }], authority: { adapter: 'pi-local-read-multi-1', stepCount: 1, completion: 'journal-only' },
    fallbackPlan: { steps: [{ candidates: [{ connectionSlug: 'saved-connection', model: 'saved-model', credentialIdentity: f.spec.credentialIdentity }] }] },
    context: { ...(f.spec.context as object), modelPlans: [{ role: 'reasoning' }] },
  };
  f.journal.admit(spec); let claim = f.journal.claim('fallback', 'w');
  await f.journal.bridge(claim).checkpoint({ kind: 'workflow-step-start', step: 0, input: {} });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 0 });
  claim = f.journal.recordProviderFailure(claim, { step: 0, candidateIndex: 0, code: 'credits-exhausted', exhausted: true });
  f.journal.release(claim);
  const available = await f.service().get('w', 'fallback', actor);
  expect(available?.steps[0]?.error?.message).toContain('Add credits');
  expect(available?.durable?.resumeBlockedReason).toBeUndefined();
  expect(available?.durable?.providerAttempts).toEqual([{ step: 'read', role: 'reasoning', connectionSlug: 'saved-connection', model: 'saved-model', candidateIndex: 0, retries: 0, error: 'credits-exhausted' }]);
  expect(JSON.stringify(available)).not.toContain(f.spec.credentialIdentity);
  const clock = spyOn(Date, 'now').mockReturnValue(spec.deadlineAt + 1);
  try {
    const expired = await f.service().get('w', 'fallback', actor);
    expect(expired?.durable?.resumeBlockedReason).toContain('Stop this saved run');
    expect(expired?.steps[0]?.error?.message).toContain('time limit expired');
  } finally { clock.mockRestore(); }
});

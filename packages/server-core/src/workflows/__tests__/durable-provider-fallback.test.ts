import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal } from '../../../../shared/src/durable-execution';
import type { LoadedWorkflow } from '../../../../shared/src/workflows/types';
import { DurableReadRunner, type DurableReadBinding, type DurableReadWorkflowInput, type DurableReadRunnerOptions } from '../durable-read-runner';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture(multi = false) {
  const root = mkdtempSync(join(tmpdir(), 'durable-fallback-')), key = randomBytes(32);
  let journal = new DurableJournal({ configRoot: root, key });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  const binding = (slug: string, model: string): DurableReadBinding => ({ credentialIdentity: (slug === 'local' ? 'a' : 'b').repeat(64), workspace: { id: 'w', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: model, authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug, name: slug, providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } });
  const workflow: LoadedWorkflow = { slug: 'read', source: 'global', path: root, body: '', metadata: {
    name: 'Read', description: '', trigger: { type: 'manual' }, outputs: { mode: 'none' },
    steps: [{ id: 'first', agent: 'reader', input: 'Read notes', modelRole: 'reasoning' }, ...(multi ? [{ id: 'second', agent: 'reader', input: '{{steps.first.output}}', modelRole: 'fast' as const }] : [])],
  } };
  const input: DurableReadWorkflowInput = { runId: randomUUID(), commandId: randomUUID(), workspaceId: 'w', connectionSlug: 'local', model: 'primary',
    systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 256, deadlineAt: Date.now() + 60000, maxModelAttempts: 8,
    resolvedAgentSlug: 'reader', resolvedSteps: workflow.metadata.steps.map(step => ({ id: step.id, agent: step.agent, systemPrompt: 'Read only', modelPlan: { role: step.modelRole, candidates: [{ connectionSlug: 'local', model: 'primary' }, { connectionSlug: 'backup', model: 'secondary' }] } })),
    costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  const options = (): DurableReadRunnerOptions => ({ journal, hostRuntime: { appRootPath: root, isPackaged: false }, providerRetryDelayMs: 5, resolveBinding: (_ws, slug, model) => binding(slug, model) });
  return { root, workflow, input, options, get journal() { return journal; }, reopen() { journal.close(); journal = new DurableJournal({ configRoot: root, key }); } };
}
function backend(calls: string[], failure: (model: string, count: number) => string | undefined): DurableReadRunnerOptions['createBackend'] {
  return args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!, model = args.coreConfig.model!;
    const start = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { model, credential: bridge.descriptor.credentialIdentity } });
    if (start.cached === undefined) {
      calls.push(model);
      const error = failure(model, calls.length);
      if (error) { await bridge.fail(error); yield { type: 'error' as const, message: error }; return; }
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Saved result' }] } });
    }
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} });
}
test('rate limit retries once then switches to the pinned role candidate', async () => {
  const f = fixture(), calls: string[] = [];
  const runner = new DurableReadRunner({ ...f.options(), createBackend: backend(calls, model => model === 'primary' ? '429 rate limit exceeded' : undefined) });
  const result = await runner.startWorkflow(f.workflow, f.input);
  expect(result.status).toBe('succeeded'); expect(calls).toEqual(['primary', 'primary', 'secondary']);
  expect(result.providerAttempts).toHaveLength(2); expect(result.providerAttempts![0]!.retries).toBe(1);
});
test('quota immediately switches without retrying the exhausted connection', async () => {
  const f = fixture(), calls: string[] = [];
  const runner = new DurableReadRunner({ ...f.options(), createBackend: backend(calls, model => model === 'primary' ? '429 insufficient_quota' : undefined) });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('succeeded');
  expect(calls).toEqual(['primary', 'secondary']);
});
test('exhaustion pauses for help and preserves completed preceding steps', async () => {
  const f = fixture(true), calls: string[] = [];
  const runner = new DurableReadRunner({ ...f.options(), createBackend: backend(calls, (_model, count) => count > 1 ? 'Payment required 402' : undefined) });
  const result = await runner.startWorkflow(f.workflow, f.input);
  expect(result.status).toBe('paused'); expect(result.providerAttention).toBe('credits-exhausted');
  expect(result.workflowSteps![0]!.output).toBe('Saved result'); expect(calls).toEqual(['primary', 'primary', 'secondary']);
  f.reopen();
  const resumed = new DurableReadRunner({ ...f.options(), createBackend: backend(calls, () => undefined) });
  const state = f.journal.get(f.input.runId, 'w');
  const receipt = await resumed.control({ runId: f.input.runId, workspaceId: 'w', commandId: randomUUID(), expectedVersion: state.version, action: 'resume' });
  expect((await receipt.execution)?.status).toBe('succeeded'); expect(calls).toEqual(['primary', 'primary', 'secondary', 'secondary']);
});
test('non-provider errors stay terminal rather than silently falling back', async () => {
  const f = fixture(), calls: string[] = [];
  const runner = new DurableReadRunner({ ...f.options(), createBackend: backend(calls, () => 'durable-context-changed') });
  await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow();
  expect(f.journal.get(f.input.runId, 'w').status).toBe('failed'); expect(calls).toEqual(['primary']);
});
test.each(['pause', 'cancel'] as const)('%s while waiting for retry prevents another provider dispatch', async action => {
  const f = fixture(), calls: string[] = [];
  const runner = new DurableReadRunner({ ...f.options(), providerRetryDelayMs: 1000,
    createBackend: backend(calls, () => '429 rate limit exceeded') });
  const started = await runner.admitWorkflow(f.workflow, f.input);
  for (let i = 0; i < 100 && !f.journal.get(f.input.runId, 'w').providerAttempts?.at(-1)?.retryAt; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const state = f.journal.get(f.input.runId, 'w');
  expect(state.providerAttempts?.at(-1)?.retryAt).toBeDefined();
  await runner.control({ runId: f.input.runId, workspaceId: 'w', commandId: randomUUID(), expectedVersion: state.version, action });
  expect((await started.execution).status).toBe(action === 'pause' ? 'paused' : 'cancelled');
  expect(calls).toEqual(['primary']);
});
test('later step skips connections already proven out of credits', async () => {
  const f = fixture(true), calls: string[] = [];
  const runner = new DurableReadRunner({ ...f.options(), createBackend: backend(calls, model => model === 'primary' ? 'insufficient credits' : undefined) });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('succeeded');
  expect(calls).toEqual(['primary', 'secondary', 'secondary']);
});
test('missing role backups pauses rather than using an unrelated general model', async () => {
  const f = fixture(), calls: string[] = [];
  f.input.resolvedSteps![0]!.modelPlan!.candidates.length = 1;
  const runner = new DurableReadRunner({ ...f.options(), createBackend: backend(calls, () => '402 payment required') });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('paused'); expect(calls).toEqual(['primary']);
});
test('late binding rejection from an abandoned attempt cannot pause its replacement', async () => {
  const f = fixture();
  const base = f.options();
  let blockPrimary = false;
  let rejectBinding!: (error: Error) => void;
  let oldCheckpoint: Promise<unknown> | undefined;
  const pending = new Promise<DurableReadBinding>((_resolve, reject) => { rejectBinding = reject; });
  const runner = new DurableReadRunner({ ...base,
    resolveBinding: (ws, slug, model) => blockPrimary && model === 'primary' ? pending : base.resolveBinding(ws, slug, model),
    createBackend: args => ({ async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      if (args.coreConfig.model === 'primary') {
        blockPrimary = true;
        oldCheckpoint = bridge.checkpoint({ kind: 'model-start', turn: 0, context: { model: 'primary' } }).catch(error => error);
        yield { type: 'error' as const, message: '402 payment required' };
        return;
      }
      rejectBinding(new Error('old credentials no longer available'));
      await oldCheckpoint;
      expect(f.journal.get(f.input.runId, 'w').status).toBe('running');
      await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { model: 'secondary' } });
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } });
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} }),
  });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('succeeded');
});

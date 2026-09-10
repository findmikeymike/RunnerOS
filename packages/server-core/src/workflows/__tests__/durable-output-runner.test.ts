import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal } from '../../../../shared/src/durable-execution/index.ts';
import type { LoadedWorkflow } from '../../../../shared/src/workflows/types.ts';
import { DurableReadRunner, supportsDurableReadWorkflow, type DurableReadBinding, type DurableReadWorkflowInput, type DurableReadRunnerOptions } from '../durable-read-runner.ts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture(multi = false) {
  const root = mkdtempSync(join(tmpdir(), 'artist-os-output-runner-'));
  const journal = new DurableJournal({ configRoot: root, key: randomBytes(32) });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'workspace', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: 'test-model', authType: 'api_key', capabilities: { needsHttpPoolServer: false },
      connection: { slug: 'test-local', name: 'test', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const workflow: LoadedWorkflow = { slug: 'read', source: 'global', path: '/workflows/read', body: '', metadata: {
    name: '  Read notes  ', description: '', trigger: { type: 'manual' }, outputs: { mode: 'final-step', kind: 'report' },
    steps: [{ id: 'first', agent: 'reader', input: 'Read' }, ...(multi ? [{ id: 'last', agent: 'reader', input: '{{steps.first.output}}' }] : [])],
  } };
  const input: DurableReadWorkflowInput = { runId: randomUUID(), commandId: randomUUID(), workspaceId: 'workspace', connectionSlug: 'test-local', model: 'test-model',
    systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 128, deadlineAt: Date.now() + 60000, maxModelAttempts: 3,
    approvalPrincipalId: 'principal', resolvedAgentSlug: 'reader', resolvedSteps: workflow.metadata.steps.map(step => ({ id: step.id, agent: step.agent, systemPrompt: 'Read only' })),
    costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  let models = 0;
  const options: DurableReadRunnerOptions = { journal, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding,
    resolvePublicationWorkspace: () => binding.workspace, authorizePublication() {}, createBackend: args => ({ async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: `result ${++models}` }], stopReason: 'stop' } });
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} }),
  };
  return { root, journal, binding, workflow, input, options, models: () => models };
}
async function resume(f: ReturnType<typeof fixture>, runner: DurableReadRunner) {
  const state = f.journal.get(f.input.runId, f.input.workspaceId);
  const result = await runner.control({ runId: state.spec.runId, workspaceId: state.spec.workspaceId, commandId: randomUUID(), expectedVersion: state.version, action: 'resume' });
  return result.execution!;
}

test('final publication contract rejects templates, files, earlier steps and unknown fields', () => {
  const f = fixture(true), outputs = f.workflow.metadata.outputs!;
  expect(supportsDurableReadWorkflow(f.workflow)).toBe(true);
  for (const invalid of [{ title: '{{foo}}' }, { primary: { from: 'file' } }, { primary: { from: 'step-output', step: 'first' } }, { kind: 'link' }, { extra: true }]) {
    f.workflow.metadata.outputs = { ...outputs, ...invalid } as typeof outputs;
    expect(supportsDurableReadWorkflow(f.workflow)).toBe(false);
  }
});

test.each([false, true])('publication is required for success and contains last saved step (multi=%s)', async multi => {
  const f = fixture(multi);
  let published = 0;
  const runner = new DurableReadRunner({ ...f.options, publishOutput: (_root, input) => {
    const state = f.journal.get(f.input.runId, f.input.workspaceId);
    expect(state.status).toBe('running'); expect(state.publication?.status).toBe('pending');
    expect(input.content).toBe(multi ? 'result 2' : 'result 1'); expect(input.title).toBe('Read notes');
    expect(input.stepId).toBe(multi ? 'last' : 'first'); published++;
    return { outputId: input.id };
  } });
  const state = await runner.startWorkflow(f.workflow, f.input);
  expect(state.status).toBe('succeeded'); expect(state.publication?.status).toBe('published');
  expect(published).toBe(1); expect(f.models()).toBe(multi ? 2 : 1);
});

test('storage failure pauses; resume publishes saved text without model or credential dependency after deadline', async () => {
  const f = fixture(true);
  const runner = new DurableReadRunner({ ...f.options, publishOutput() { throw new Error('disk full'); } });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('paused');
  const pending = f.journal.get(f.input.runId, f.input.workspaceId);
  const originalNow = Date.now;
  Date.now = () => f.input.deadlineAt + 1;
  cleanup.push(() => { Date.now = originalNow; });
  f.binding.credentialIdentity = 'changed';
  const recovered = new DurableReadRunner({ ...f.options, resolveBinding() { throw new Error('connection deleted'); }, createBackend() { throw new Error('must not model'); }, publishOutput: (_root, input) => {
    expect(input.id).toBe(pending.publication!.outputId); expect(input.content).toBe('result 2'); return { outputId: input.id };
  } });
  expect((await resume(f, recovered)).status).toBe('succeeded'); expect(f.models()).toBe(2);
});

test('revoked publication permission or moved workspace never writes and keeps saved output retryable', async () => {
  const f = fixture(); let allowed = true, writes = 0;
  const runner = new DurableReadRunner({ ...f.options, authorizePublication() { if (!allowed) throw new Error('denied'); }, publishOutput() { throw new Error('disk full'); } });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('paused'); allowed = false;
  const recovered = new DurableReadRunner({ ...f.options, authorizePublication() { if (!allowed) throw new Error('denied'); }, publishOutput: (_root, input) => { writes++; return { outputId: input.id }; } });
  expect((await resume(f, recovered)).status).toBe('paused'); expect(writes).toBe(0);
  allowed = true; f.binding.workspace.id = 'other';
  expect((await resume(f, recovered)).status).toBe('paused'); expect(writes).toBe(0);
});

test('backend cannot certify publication itself', async () => {
  const f = fixture();
  const runner = new DurableReadRunner({ ...f.options, createBackend: args => ({ async *chat() {
    await expect(args.coreConfig.durableExecution!.checkpoint({ kind: 'output-published', outputId: randomUUID() })).rejects.toThrow('durable-workflow-host-checkpoint-required');
  }, async abort() {}, destroy() {} }) });
  await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow('durable-read-missing-completion-checkpoint');
});

test('cancel while publication workspace lookup waits fences the output write', async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void, writes = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runner = new DurableReadRunner({ ...f.options, resolvePublicationWorkspace: async () => { entered(); await gate; return f.binding.workspace; },
    publishOutput: (_root, input) => { writes++; return { outputId: input.id }; },
  });
  const execution = runner.startWorkflow(f.workflow, f.input);
  await started;
  await runner.cancel(f.input.runId, f.input.workspaceId);
  release();
  expect((await execution).status).toBe('cancelled'); expect(writes).toBe(0);
});

test('late backend exception preserves committed pending text for explicit resume', async () => {
  const f = fixture();
  const originalFactory = f.options.createBackend!;
  const runner = new DurableReadRunner({ ...f.options, createBackend: async args => {
    const backend = await originalFactory(args);
    return { ...backend, async *chat(prompt) { yield* backend.chat(prompt); throw new Error('late stream failure'); } };
  } });
  const state = await runner.startWorkflow(f.workflow, f.input);
  expect(state.status).toBe('paused'); expect(state.publication?.content).toBe('result 1');
  const recovered = new DurableReadRunner({ ...f.options, createBackend() { throw new Error('must not call model'); },
    publishOutput: (_root, input) => ({ outputId: input.id }),
  });
  expect((await resume(f, recovered)).status).toBe('succeeded');
});

test('backend destroy exception preserves pending text and fresh resume publishes without model replay', async () => {
  const f = fixture();
  const originalFactory = f.options.createBackend!;
  let destroys = 0, publications = 0;
  const runner = new DurableReadRunner({ ...f.options, createBackend: async args => {
    const backend = await originalFactory(args);
    return { ...backend, destroy() { destroys++; throw new Error('backend destroy failure'); } };
  }, publishOutput: (_root, input) => { publications++; return { outputId: input.id }; } });
  // Cleanup may reject after saving the paused state; the saved output must remain recoverable.
  let executionError: unknown;
  try { await runner.startWorkflow(f.workflow, f.input); } catch (error) { executionError = error; }
  if (executionError !== undefined) expect(String(executionError)).toContain('backend destroy failure');
  const pending = f.journal.get(f.input.runId, f.input.workspaceId);
  expect(destroys).toBeGreaterThan(0);
  expect(pending.status).toBe('paused');
  expect(pending.publication?.status).toBe('pending');
  expect(pending.publication?.content).toBe('result 1');
  expect(publications).toBe(0);
  const recovered = new DurableReadRunner({ ...f.options, createBackend() { throw new Error('must not call model'); },
    publishOutput: (_root, input) => { publications++; expect(input.content).toBe('result 1'); return { outputId: input.id }; },
  });
  const completed = await resume(f, recovered);
  expect(completed.status).toBe('succeeded');
  expect(completed.publication?.outputId).toBe(pending.publication?.outputId);
  expect(completed.spec.deadlineAt).toBe(pending.spec.deadlineAt);
  expect(completed.reservedUnits).toBe(pending.reservedUnits);
  expect(publications).toBe(1);
  expect(f.models()).toBe(1);
});

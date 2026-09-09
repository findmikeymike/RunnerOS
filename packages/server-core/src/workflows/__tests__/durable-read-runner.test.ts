import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal } from '../../../../shared/src/durable-execution/index.ts';
import { DurableReadRunner, type DurableReadBackendArgs, type DurableReadBinding, type DurableReadInput, type DurableReadRunnerOptions } from '../durable-read-runner.ts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'artist-os-read-host-'));
  const journal = new DurableJournal({ configRoot: root, key: randomBytes(32) });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'workspace', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: 'test-model', authType: 'api_key', capabilities: { needsHttpPoolServer: false },
      connection: { slug: 'test-local', name: 'test', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const input: DurableReadInput = { runId: randomUUID(), commandId: randomUUID(), workspaceId: 'workspace', connectionSlug: 'test-local', model: 'test-model',
    prompt: 'Read the release notes', systemPrompt: 'Only read local files', allowedTools: ['read'], maxOutputTokens: 128,
    deadlineAt: Date.now() + 60000, maxModelAttempts: 2, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  const base: DurableReadRunnerOptions = { journal, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding };
  return { root, journal, binding, input, base };
}
async function complete(args: DurableReadBackendArgs) {
  const bridge = args.coreConfig.durableExecution!;
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } });
  await bridge.checkpoint({ kind: 'complete' });
}

test('admits before backend creation, freezes routing, and uses the journal as success authority', async () => {
  const { journal, input, base } = fixture();
  let creations = 0, destroyed = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: args => {
    creations++;
    expect(journal.get(input.runId, input.workspaceId).status).toBe('running');
    expect(args.coreConfig.modelFallback?.enabled).toBe(false);
    expect(args.coreConfig.session?.permissionMode).toBe('safe');
    expect(args.coreConfig.session?.id).toBe(input.runId);
    expect(args.coreConfig.customSystemPrompt).toBe(input.systemPrompt);
    return { async *chat(prompt) { expect(prompt).toBe(input.prompt); await complete(args); }, async abort() {}, destroy() { destroyed++; } };
  } });
  expect((await runner.start(input)).status).toBe('succeeded');
  expect((await runner.start(input)).status).toBe('succeeded');
  expect(creations).toBe(1); expect(destroyed).toBe(1);
  await expect(runner.start({ ...input, prompt: 'mutated' })).rejects.toThrow('durable-command-conflict');
});

test('a stream ending without a committed final model turn fails closed', async () => {
  const { journal, input, base } = fixture();
  const runner = new DurableReadRunner({ ...base, createBackend: () => ({ async *chat() {}, async abort() {}, destroy() {} }) });
  await expect(runner.start(input)).rejects.toThrow('durable-read-missing-completion-checkpoint');
  expect(journal.get(input.runId, input.workspaceId).status).toBe('failed');
});

test('concurrent resume shares one execution and cancel is persisted before abort', async () => {
  const { journal, input, base } = fixture();
  let signalStarted!: () => void, signalFinish!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const finish = new Promise<void>(resolve => { signalFinish = resolve; });
  let creations = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: () => {
    creations++;
    return { async *chat() { signalStarted(); await finish; }, async abort() { expect(journal.get(input.runId, input.workspaceId).status).toBe('cancelled'); signalFinish(); }, destroy() {} };
  } });
  const running = runner.start(input); await started;
  const resumed = runner.resume(input.runId, input.workspaceId);
  await runner.cancel(input.runId, input.workspaceId);
  expect((await running).status).toBe('cancelled'); expect((await resumed).status).toBe('cancelled'); expect(creations).toBe(1);
});

test('changed connection after admission cannot construct a backend', async () => {
  const { journal, input, binding, base } = fixture();
  let resolutions = 0, creations = 0;
  const runner = new DurableReadRunner({ ...base, resolveBinding: () => {
    if (++resolutions === 2) binding.context.connection!.baseUrl = 'http://different-endpoint.invalid';
    return binding;
  }, createBackend: () => { creations++; throw new Error('must not construct'); } });
  await expect(runner.start(input)).rejects.toThrow('durable-read-binding-changed');
  expect(creations).toBe(0); expect(journal.get(input.runId, input.workspaceId).status).toBe('failed');
});

test('cancel during asynchronous factory prevents even the first chat dispatch', async () => {
  const { input, base } = fixture();
  let factoryStarted!: () => void, factoryContinue!: () => void;
  const started = new Promise<void>(resolve => { factoryStarted = resolve; });
  const proceed = new Promise<void>(resolve => { factoryContinue = resolve; });
  let chats = 0, destroyed = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: async () => {
    factoryStarted(); await proceed;
    return { async *chat() { chats++; }, async abort() {}, destroy() { destroyed++; } };
  } });
  const running = runner.start(input); await started;
  await runner.cancel(input.runId, input.workspaceId); factoryContinue();
  await expect(running).rejects.toThrow('durable-read-dispatch-blocked');
  expect(chats).toBe(0); expect(destroyed).toBe(1);
});

test('rejects wrong workspace and unsupported provider before admitting', async () => {
  const { input, binding, base, journal } = fixture();
  binding.context.provider = 'anthropic';
  const runner = new DurableReadRunner(base);
  await expect(runner.start(input)).rejects.toThrow('durable-read-local-pi-required');
  expect(journal.list(input.workspaceId)).toEqual([]);
});


test('credential/account change blocks recovery before construction', async () => {
  const { input, binding, base } = fixture();
  let resolves = 0;
  const runner = new DurableReadRunner({ ...base, resolveBinding: () => {
    if (++resolves === 2) binding.credentialIdentity = 'b'.repeat(64);
    return binding;
  }, createBackend: () => { throw new Error('must not construct'); } });
  await expect(runner.start(input)).rejects.toThrow('durable-read-binding-changed');
});

test('existing workflow adapter freezes its literal step and rejects output side effects', async () => {
  const { input, base, journal } = fixture();
  const workflow = { slug: 'read-notes', source: 'global' as const, path: '/host/workflows/read-notes', body: '',
    metadata: { name: 'Read notes', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const },
      steps: [{ id: 'read', agent: 'researcher', input: 'Read release notes' }] } };
  const runner = new DurableReadRunner({ ...base, createBackend: args => ({
    async *chat(prompt) { expect(prompt).toBe('Read release notes'); await complete(args); }, async abort() {}, destroy() {},
  }) });
  const { prompt: _prompt, ...hostInput } = input;
  await expect(runner.startWorkflow({ ...workflow, metadata: { ...workflow.metadata, outputs: { mode: 'final-step' } } }, { ...hostInput, resolvedAgentSlug: 'researcher' })).rejects.toThrow('unsupported-durable-read-workflow');
  expect(journal.list(input.workspaceId)).toEqual([]);
  const result = await runner.startWorkflow(workflow, { ...hostInput, resolvedAgentSlug: 'researcher' });
  expect(result.status).toBe('succeeded');
  expect((result.spec.context as Record<string, unknown>).workflow).toEqual(workflow);
});

test('empty assistant text cannot satisfy default workflow completion', async () => {
  const { input, base, journal } = fixture();
  const runner = new DurableReadRunner({ ...base, createBackend: args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [], stopReason: 'stop' } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }) });
  await expect(runner.start(input)).rejects.toThrow('durable-read-empty-output');
  expect(journal.get(input.runId, input.workspaceId).status).toBe('failed');
});


test('disk-full primary failure survives failure-record and release errors', async () => {
  const { input, base, journal } = fixture();
  const primary = new Error('SQLITE_FULL');
  const originalFail = journal.fail.bind(journal), originalRelease = journal.release.bind(journal);
  const runner = new DurableReadRunner({ ...base, createBackend: () => ({ async *chat() {
    journal.fail = () => { throw new Error('durable-storage-unavailable'); };
    journal.release = () => { throw new Error('durable-storage-unavailable'); };
    throw primary;
  }, async abort() {}, destroy() {} }) });
  try { await expect(runner.start(input)).rejects.toBe(primary); }
  finally { journal.fail = originalFail; journal.release = originalRelease; }
});

test('streamed checkpoint error survives missing completion and poisoned cleanup', async () => {
  const { input, base, journal } = fixture();
  const originalFail = journal.fail.bind(journal), originalRelease = journal.release.bind(journal);
  const runner = new DurableReadRunner({ ...base, createBackend: () => ({ async *chat() {
    journal.fail = () => { throw new Error('durable-storage-unavailable'); };
    journal.release = () => { throw new Error('durable-storage-unavailable'); };
    yield { type: 'error' as const, message: 'SQLITE_FULL at model-result' };
  }, async abort() {}, destroy() {} }) });
  try { await expect(runner.start(input)).rejects.toThrow('SQLITE_FULL at model-result'); }
  finally { journal.fail = originalFail; journal.release = originalRelease; }
});

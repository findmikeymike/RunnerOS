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
  expect((await running).status).toBe('cancelled');
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

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('pause is durable and cooperative: issued model result saves, next checkpoint stops', async () => {
  const { input, base, journal } = fixture();
  const started = latch(), finish = latch();
  let aborts = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
    started.resolve(); await finish.promise;
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'issued result' }], stopReason: 'stop' } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() { aborts++; }, destroy() {} }) });
  const running = runner.start(input); await started.promise;
  const { receipt } = await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'pause' });
  expect(receipt.status).toBe('paused'); expect(journal.get(input.runId, input.workspaceId).status).toBe('paused');
  expect(aborts).toBe(0); finish.resolve();
  const stopped = await running;
  expect(stopped.status).toBe('paused'); expect(stopped.turns[0]!.message).toBeDefined();
});

test('pause then resume drains old claim before fresh backend reuses saved model result', async () => {
  const { input, base, journal } = fixture();
  const started = latch(), finish = latch();
  let creations = 0, destroyed = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: args => {
    const attempt = ++creations;
    if (attempt === 2) expect(destroyed).toBe(1);
    return { async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      const reply = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
      if (attempt === 1) {
        started.resolve(); await finish.promise;
        await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'issued result' }], stopReason: 'stop' } });
      } else expect(reply.cached).toBeDefined();
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() { throw new Error('pause must not abort'); }, destroy() { destroyed++; } };
  } });
  const original = runner.start(input); await started.promise;
  await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'pause' });
  const resumed = await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'resume' });
  expect(resumed.receipt.status).toBe('running'); expect(creations).toBe(1);
  finish.resolve();
  expect((await original).status).toBe('running');
  expect((await resumed.execution!).status).toBe('succeeded');
  expect(creations).toBe(2); expect(journal.get(input.runId, input.workspaceId).modelAttempts).toBe(1);
});

test('duplicate resume receipt never reverses a later pause while old execution drains', async () => {
  const { input, base, journal } = fixture();
  const started = latch(), finish = latch();
  let creations = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: args => {
    creations++;
    return { async *chat() { started.resolve(); await finish.promise; await complete(args); }, async abort() {}, destroy() {} };
  } });
  const running = runner.start(input); await started.promise;
  const control = (action: 'pause' | 'resume') => ({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action });
  await runner.control(control('pause'));
  const resumeCommand = control('resume');
  const resumed = await runner.control(resumeCommand);
  const lastPause = await runner.control(control('pause'));
  const duplicate = await runner.control(resumeCommand);
  expect(duplicate.receipt).toEqual(resumed.receipt);
  expect(journal.get(input.runId, input.workspaceId).controlRevision).toBe(lastPause.receipt.controlRevision);
  finish.resolve();
  expect((await running).status).toBe('paused');
  expect((await resumed.execution!).status).toBe('paused');
  expect((await duplicate.execution!).status).toBe('paused');
  expect(creations).toBe(1);
});

test('cancel command commits before abort and late backend error cannot revive the run', async () => {
  const { input, base, journal } = fixture();
  const started = latch(), finish = latch();
  const runner = new DurableReadRunner({ ...base, createBackend: args => ({ async *chat() {
    started.resolve(); await finish.promise;
    await args.coreConfig.durableExecution!.fail('late provider error');
    yield { type: 'error' as const, message: 'late provider error' };
  }, async abort() { expect(journal.get(input.runId, input.workspaceId).status).toBe('cancelled'); finish.resolve(); }, destroy() {} }) });
  const running = runner.start(input); await started.promise;
  const cancelled = await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'cancel' });
  expect(cancelled.receipt.status).toBe('cancelled'); expect((await running).status).toBe('cancelled');
});

test('failed command commit never aborts or acknowledges a cancelled state', async () => {
  const { input, base, journal } = fixture();
  const started = latch(), finish = latch();
  let aborts = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: args => ({ async *chat() {
    started.resolve(); await finish.promise; await complete(args);
  }, async abort() { aborts++; }, destroy() {} }) });
  const running = runner.start(input); await started.promise;
  const originalCommand = journal.command.bind(journal);
  const primary = new Error('SQLITE_FULL command commit');
  journal.command = () => { throw primary; };
  try {
    await expect(runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'cancel' })).rejects.toBe(primary);
    expect(aborts).toBe(0); expect(journal.get(input.runId, input.workspaceId).status).toBe('running');
  } finally { journal.command = originalCommand; finish.resolve(); }
  expect((await running).status).toBe('succeeded');
});

for (const breakFreshClaim of [false, true]) {
  test(`explicit resume after late provider error ${breakFreshClaim ? 'preserves both errors if fresh claim fails' : 'uses a fresh backend and saved model result'}`, async () => {
    const { input, base, journal } = fixture();
    const started = latch(), finish = latch();
    const oldFailure = new Error('old provider stream failed');
    const claimFailure = new Error('SQLITE_FULL on resumed claim');
    const originalClaim = journal.claim.bind(journal);
    let creations = 0;
    const runner = new DurableReadRunner({ ...base, createBackend: args => {
      const attempt = ++creations;
      return { async *chat() {
        const bridge = args.coreConfig.durableExecution!;
        const reply = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
        if (attempt === 1) {
          await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'saved answer' }], stopReason: 'stop' } });
          started.resolve(); await finish.promise;
          await bridge.fail(oldFailure.message);
          throw oldFailure;
        }
        expect(reply.cached).toBeDefined();
        await bridge.checkpoint({ kind: 'complete' });
      }, async abort() {}, destroy() {} };
    } });
    const original = runner.start(input); await started.promise;
    const command = (action: 'pause' | 'resume') => ({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action });
    await runner.control(command('pause'));
    const resumed = await runner.control(command('resume'));
    if (breakFreshClaim) journal.claim = () => { throw claimFailure; };
    finish.resolve();
    try {
      await expect(original).rejects.toBe(oldFailure);
      if (breakFreshClaim) {
        let caught: unknown;
        try { await resumed.execution; } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(AggregateError);
        expect((caught as AggregateError).cause).toBe(oldFailure);
        expect((caught as AggregateError).errors).toEqual([oldFailure, claimFailure]);
        expect(creations).toBe(1);
      } else {
        expect((await resumed.execution!).status).toBe('succeeded');
        expect(journal.get(input.runId, input.workspaceId).modelAttempts).toBe(1);
        expect(creations).toBe(2);
      }
    } finally { journal.claim = originalClaim; }
  });
}

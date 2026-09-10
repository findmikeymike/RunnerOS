import { afterEach, expect, test, spyOn } from 'bun:test';
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
  const key = randomBytes(32);
  const journal = new DurableJournal({ configRoot: root, key });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'workspace', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: 'test-model', authType: 'api_key', capabilities: { needsHttpPoolServer: false },
      connection: { slug: 'test-local', name: 'test', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const input: DurableReadInput = { runId: randomUUID(), commandId: randomUUID(), workspaceId: 'workspace', connectionSlug: 'test-local', model: 'test-model',
    prompt: 'Read the release notes', systemPrompt: 'Only read local files', allowedTools: ['read'], maxOutputTokens: 128,
    deadlineAt: Date.now() + 60000, maxModelAttempts: 2, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  const base: DurableReadRunnerOptions = { journal, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding };
  return { root, key, journal, binding, input, base };
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

function approvalFixture() {
  const setup = fixture();
  const expiresAt = Date.now() + 60000;
  let policyRevision = 'policy-1', authorized = true, authorizationChecks = 0, executions = 0;
  const input = { ...setup.input, approvalPrincipalId: 'artist-principal' };
  const options: DurableReadRunnerOptions = { ...setup.base,
    authorizeTool: async (request, context) => {
      authorizationChecks++;
      expect(request.tool).toBe('read'); expect(context.approvalPrincipalId).toBe('artist-principal');
      return { principalId: 'artist-principal', policyRevision, credentialIdentity: setup.binding.credentialIdentity,
        allowed: authorized, requiresApproval: true, approvalExpiresAt: expiresAt };
    },
    createBackend: args => ({ async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      const initial = await bridge.checkpoint({ kind: 'turn-boundary', turn: -1 });
      const model = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [], steering: JSON.parse(JSON.stringify(initial.steering ?? [])) } });
      if (!model.cached) await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'approval-read', name: 'read', arguments: { path: 'notes.txt' } }], stopReason: 'toolUse' } });
      const reply = await bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'approval-read', tool: 'read', input: { path: 'notes.txt' } });
      if (!reply.skipped && !reply.cached) {
        executions++;
        await bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'approval-read', result: { content: [{ type: 'text', text: 'approved read result' }] } });
      }
      const updates = await bridge.checkpoint({ kind: 'turn-boundary', turn: 0 });
      const final = await bridge.checkpoint({ kind: 'model-start', turn: 1, context: { messages: [], result: reply.skipped ? 'skipped' : 'approved read result', steering: JSON.parse(JSON.stringify(updates.steering ?? [])) } });
      if (!final.cached) await bridge.checkpoint({ kind: 'model-result', turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } });
      await bridge.checkpoint({ kind: 'turn-boundary', turn: 1 });
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} }),
  };
  return { ...setup, input, options, get executions() { return executions; }, get authorizationChecks() { return authorizationChecks; }, setPolicy(value: string) { policyRevision = value; }, revoke() { authorized = false; } };
}

function approvalDecision(journal: DurableJournal, input: DurableReadInput, action: 'approve' | 'deny' = 'approve') {
  const state = journal.get(input.runId, input.workspaceId);
  const approval = state.approvals!.findLast(item => item.status === 'pending')!;
  return { runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: state.version,
    action, approvalId: approval.id, inputDigest: approval.inputDigest, principalId: approval.principalId,
    policyRevision: approval.policyRevision, credentialIdentity: approval.credentialIdentity };
}

test('approval survives reopening: decision resumes cached model and rechecks current authorization', async () => {
  const setup = approvalFixture();
  const first = new DurableReadRunner(setup.options);
  const waiting = await first.start(setup.input);
  expect(waiting.status).toBe('waiting-approval'); expect(setup.executions).toBe(0);
  const reopened = new DurableJournal({ configRoot: setup.root, key: setup.key });
  cleanup.push(() => reopened.close());
  const resumed = new DurableReadRunner({ ...setup.options, journal: reopened });
  const decision = await resumed.decide(approvalDecision(reopened, setup.input));
  expect(decision.receipt.status).toBe('running');
  const completed = await decision.execution!;
  expect(completed.status).toBe('succeeded'); expect(setup.executions).toBe(1); expect(setup.authorizationChecks).toBe(2);
  expect(completed.modelAttempts).toBe(2);
});

test('approved old policy cannot dispatch after policy change; a fresh approval is required', async () => {
  const setup = approvalFixture(), runner = new DurableReadRunner(setup.options);
  await runner.start(setup.input);
  const command = approvalDecision(setup.journal, setup.input);
  setup.setPolicy('policy-2');
  const decision = await runner.decide(command);
  const waiting = await decision.execution!;
  expect(waiting.status).toBe('waiting-approval'); expect(setup.executions).toBe(0);
  expect(waiting.approvals!.findLast(item => item.status === 'pending')!.policyRevision).toBe('policy-2');
  expect(waiting.approvals!.findLast(item => item.status === 'pending')!.id).not.toBe(command.approvalId);
});

test('current permission revocation pauses an approved operation before dispatch', async () => {
  const setup = approvalFixture(), runner = new DurableReadRunner(setup.options);
  await runner.start(setup.input);
  const command = approvalDecision(setup.journal, setup.input);
  setup.revoke();
  const decision = await runner.decide(command);
  expect((await decision.execution!).status).toBe('paused'); expect(setup.executions).toBe(0);
});

test('later pause and duplicate approval receipt cannot restart execution', async () => {
  const setup = approvalFixture();
  const started = latch(), drain = latch();
  const originalCreate = setup.options.createBackend!;
  let attempts = 0;
  const runner = new DurableReadRunner({ ...setup.options, createBackend: async args => {
    const backend = await originalCreate(args);
    attempts++;
    return { ...backend, async *chat(prompt: string) {
      try { yield* backend.chat(prompt); }
      catch (error) { started.resolve(); await drain.promise; throw error; }
    } };
  } });
  const first = runner.start(setup.input); await started.promise;
  const command = approvalDecision(setup.journal, setup.input);
  const approved = await runner.decide(command);
  await runner.control({ runId: setup.input.runId, workspaceId: setup.input.workspaceId, commandId: randomUUID(), action: 'pause', expectedVersion: setup.journal.get(setup.input.runId, setup.input.workspaceId).version });
  const duplicate = await runner.decide(command);
  expect(duplicate.receipt).toEqual(approved.receipt);
  drain.resolve();
  expect((await first).status).toBe('paused'); expect((await approved.execution!).status).toBe('paused');
  expect((await duplicate.execution!).status).toBe('paused'); expect(attempts).toBe(1); expect(setup.executions).toBe(0);
});

test('approval received while paused leaves the run paused without launching a backend', async () => {
  const setup = approvalFixture(), runner = new DurableReadRunner(setup.options);
  await runner.start(setup.input);
  await runner.control({ runId: setup.input.runId, workspaceId: setup.input.workspaceId, commandId: randomUUID(), action: 'pause', expectedVersion: setup.journal.get(setup.input.runId, setup.input.workspaceId).version });
  const approved = await runner.decide(approvalDecision(setup.journal, setup.input));
  expect(approved.receipt.status).toBe('paused'); expect(approved.execution).toBeUndefined(); expect(setup.executions).toBe(0);
});

test('denial commits cancellation before aborting the waiting backend', async () => {
  const setup = approvalFixture(), started = latch(), drain = latch();
  const originalCreate = setup.options.createBackend!;
  let aborts = 0;
  const runner = new DurableReadRunner({ ...setup.options, createBackend: async args => {
    const backend = await originalCreate(args);
    return { ...backend, async *chat(prompt: string) {
      try { yield* backend.chat(prompt); }
      catch (error) { started.resolve(); await drain.promise; throw error; }
    }, async abort() { aborts++; expect(setup.journal.get(setup.input.runId, setup.input.workspaceId).status).toBe('cancelled'); drain.resolve(); } };
  } });
  const running = runner.start(setup.input); await started.promise;
  const denied = await runner.decide(approvalDecision(setup.journal, setup.input, 'deny'));
  expect(denied.receipt.status).toBe('cancelled'); expect((await running).status).toBe('cancelled');
  expect(aborts).toBe(1); expect(setup.executions).toBe(0);
});

test('ordinary certified read execution does not invoke or introduce approval checks', async () => {
  const setup = approvalFixture(), runner = new DurableReadRunner(setup.options);
  const { approvalPrincipalId: _principal, ...input } = setup.input;
  expect((await runner.start(input)).status).toBe('succeeded');
  expect(setup.authorizationChecks).toBe(0); expect(setup.executions).toBe(1);
});


test('late steering before completion automatically replays only after the prior owner releases', async () => {
  const { input, base, journal } = fixture(), ready = latch(), finish = latch();
  let creations = 0, destroyed = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: args => {
    const attempt = ++creations;
    if (attempt === 2) expect(destroyed).toBe(1);
    return { async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      await bridge.checkpoint({ kind: 'turn-boundary', turn: -1 });
      const model = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
      if (!model.cached) await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'old answer' }], stopReason: 'stop' } });
      const updates = await bridge.checkpoint({ kind: 'turn-boundary', turn: 0 });
      if (attempt === 1) { ready.resolve(); await finish.promise; }
      if (updates.steering?.length) {
        expect(updates.steering.map(item => item.text)).toEqual(['Use the new direction']);
        await bridge.checkpoint({ kind: 'model-start', turn: 1, context: { steering: JSON.parse(JSON.stringify(updates.steering)) } });
        await bridge.checkpoint({ kind: 'model-result', turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'new answer' }], stopReason: 'stop' } });
        await bridge.checkpoint({ kind: 'turn-boundary', turn: 1 });
      }
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() { destroyed++; } };
  } });
  const running = runner.start(input); await ready.promise;
  const queued = await runner.steer({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'steer', text: 'Use the new direction' });
  expect(queued.receipt.sequence).toBe(1); expect(queued.execution).toBeUndefined(); expect(creations).toBe(1);
  finish.resolve();
  expect((await running).status).toBe('succeeded'); expect(creations).toBe(2); expect(journal.get(input.runId, input.workspaceId).modelAttempts).toBe(2);
});

test('steering supersedes a pending approval and restarts the waiting read without executing it', async () => {
  const setup = approvalFixture(), runner = new DurableReadRunner(setup.options);
  expect((await runner.start(setup.input)).status).toBe('waiting-approval');
  const command = { runId: setup.input.runId, workspaceId: setup.input.workspaceId, commandId: randomUUID(), expectedVersion: setup.journal.get(setup.input.runId, setup.input.workspaceId).version, action: 'steer' as const, text: 'Skip this read and use the new direction' };
  const queued = await runner.steer(command);
  expect(queued.receipt.status).toBe('running');
  const result = await queued.execution!;
  expect(result.status).toBe('succeeded'); expect(setup.executions).toBe(0);
  expect(result.approvals![0]!.status).toBe('superseded'); expect(result.steering![0]!.text).toBe(command.text);
});

test('steering while paused persists its ordered message without starting execution', async () => {
  const setup = approvalFixture(), runner = new DurableReadRunner(setup.options);
  await runner.start(setup.input);
  await runner.control({ runId: setup.input.runId, workspaceId: setup.input.workspaceId, commandId: randomUUID(), expectedVersion: setup.journal.get(setup.input.runId, setup.input.workspaceId).version, action: 'pause' });
  const command = { runId: setup.input.runId, workspaceId: setup.input.workspaceId, commandId: randomUUID(), expectedVersion: setup.journal.get(setup.input.runId, setup.input.workspaceId).version, action: 'steer' as const, text: 'New direction after pause' };
  const queued = await runner.steer(command), duplicate = await runner.steer(command);
  expect(queued.receipt.status).toBe('paused'); expect(queued.execution).toBeUndefined();
  expect(duplicate.receipt).toEqual(queued.receipt); expect(duplicate.execution).toBeUndefined();
  expect(setup.journal.get(setup.input.runId, setup.input.workspaceId).steering).toHaveLength(1); expect(setup.executions).toBe(0);
});

test('repeated pending steering without applying its boundary cannot spin forever', async () => {
  const { input, base, journal } = fixture(), ready = latch(), finish = latch();
  let attempts = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: args => {
    const attempt = ++attempts;
    return { async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      const model = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
      if (!model.cached) await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'old answer' }], stopReason: 'stop' } });
      if (attempt === 1) { ready.resolve(); await finish.promise; }
      // Deliberately broken injected backend: never applies the queued boundary.
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} };
  } });
  const running = runner.start(input); await ready.promise;
  await runner.steer({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'steer', text: 'Apply this update' });
  finish.resolve();
  await expect(running).rejects.toThrow('durable-steering-replay-stalled');
  expect(attempts).toBe(2);
});

for (const action of ['cancel', 'deny'] as const) for (const shutdown of ['reject', 'hang'] as const) {
  test(`${action} acknowledges committed cancellation when backend aborts ${shutdown}`, async () => {
    const { journal, input: original, base } = fixture();
    const input = { ...original, ...(action === 'deny' ? { approvalPrincipalId: 'artist-principal' } : {}) };
    let ready!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const drain = new Promise<void>(resolve => { finish = resolve; });
    const abortError = new Error('backend-shutdown-rejected');
    let aborts = 0;
    const runner = new DurableReadRunner({ ...base,
      authorizeTool: async () => ({ principalId: 'artist-principal', credentialIdentity: 'a'.repeat(64), policyRevision: 'policy', allowed: true, requiresApproval: true, approvalExpiresAt: Date.now() + 30000 }),
      createBackend: args => ({
        async *chat() {
          if (action === 'deny') {
            const bridge = args.coreConfig.durableExecution!;
            await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
            await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: {} }] } });
            await expect(bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'read', tool: 'read', input: {} })).rejects.toThrow('approval-required');
          }
          ready(); await drain;
          yield { type: 'error', message: 'late cancelled backend error' };
        },
        async abort() {
          aborts++;
          expect(journal.get(input.runId, input.workspaceId).status).toBe('cancelled');
          if (shutdown === 'reject') throw abortError;
          await new Promise<void>(() => {});
        }, destroy() {},
      }),
    });
    const running = runner.start(input); await started;
    try {
      const result = await (action === 'deny'
        ? runner.decide(approvalDecision(journal, input, 'deny'))
        : runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'cancel' }));
      expect(result.receipt.status).toBe('cancelled');
      expect(aborts).toBe(1);
      expect(result.execution).toBeDefined();
      if (shutdown === 'reject') await expect(result.execution!).rejects.toBe(abortError);
      expect(journal.get(input.runId, input.workspaceId).status).toBe('cancelled');
    } finally { finish(); }
    expect((await running).status).toBe('cancelled');
  });
}

test('cancel after committed success leaves its draining backend alone', async () => {
  const { journal, input, base } = fixture();
  let ready!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const drain = new Promise<void>(resolve => { finish = resolve; });
  let aborts = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: args => ({
    async *chat() { await complete(args); ready(); await drain; },
    async abort() { aborts++; }, destroy() {},
  }) });
  const running = runner.start(input); await started;
  try {
    const result = await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'cancel' });
    expect(result.receipt.status).toBe('succeeded');
    expect((await result.execution!)!.status).toBe('succeeded');
    expect(aborts).toBe(0);
  } finally { finish(); }
  expect((await running).status).toBe('succeeded');
});

test('quiesce persists pause immediately, fences new calls, and drains without cancellation', async () => {
  const { journal, input, base } = fixture();
  let ready!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const drain = new Promise<void>(resolve => { finish = resolve; });
  let destroyed = false, aborts = 0;
  const runner = new DurableReadRunner({ ...base, createBackend: () => ({
    async *chat() { ready(); await drain; }, async abort() { aborts++; }, destroy() { destroyed = true; },
  }) });
  const running = runner.start(input); await started;
  let drained = false;
  const closing = runner.quiesce(); void closing.then(() => { drained = true; });
  expect(runner.quiesce()).toBe(closing);
  expect(journal.get(input.runId, input.workspaceId).status).toBe('paused');
  await expect(runner.start(input)).rejects.toThrow('durable-host-closing');
  await expect(runner.resume(input.runId, input.workspaceId)).rejects.toThrow('durable-host-closing');
  await expect(runner.control({} as never)).rejects.toThrow('durable-host-closing');
  await expect(runner.decide({} as never)).rejects.toThrow('durable-host-closing');
  await expect(runner.steer({} as never)).rejects.toThrow('durable-host-closing');
  expect(drained).toBe(false); expect(aborts).toBe(0);
  finish(); expect((await running).status).toBe('paused'); await closing;
  expect(destroyed).toBe(true); expect(drained).toBe(true);
  expect(journal.get(input.runId, input.workspaceId).status).toBe('paused');
});

test('quiesce prevents an admission waiting for binding from writing a run', async () => {
  const { journal, input, base, binding } = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runner = new DurableReadRunner({ ...base, resolveBinding: async () => { await gate; return binding; } });
  const starting = runner.start(input);
  await runner.quiesce(); release();
  await expect(starting).rejects.toThrow('durable-host-closing');
  expect(journal.listInternal(input.workspaceId)).toEqual([]);
});

test('quiesce drains pending resume continuations without starting a replacement backend', async () => {
  const { journal, input, base } = fixture();
  let ready!: () => void, finish!: () => void, creations = 0;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const drain = new Promise<void>(resolve => { finish = resolve; });
  const runner = new DurableReadRunner({ ...base, createBackend: () => {
    creations++; return { async *chat() { ready(); await drain; }, async abort() {}, destroy() {} };
  } });
  const running = runner.start(input); await started;
  await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'pause' });
  const resume = await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'resume' });
  const closing = runner.quiesce(); finish(); await running; await closing;
  expect((await resume.execution!)!.status).toBe('paused'); expect(creations).toBe(1);
});

test('quiesce waits for pending backend shutdown and reports its original failure', async () => {
  const { input, journal, base } = fixture();
  let ready!: () => void, finish!: () => void, rejectAbort!: (error: Error) => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const drain = new Promise<void>(resolve => { finish = resolve; });
  const shutdown = new Promise<void>((_resolve, reject) => { rejectAbort = reject; });
  const runner = new DurableReadRunner({ ...base, createBackend: () => ({
    async *chat() { ready(); await drain; }, async abort() { await shutdown; }, destroy() {},
  }) });
  const running = runner.start(input); await started;
  const cancelled = await runner.control({ runId: input.runId, workspaceId: input.workspaceId, commandId: randomUUID(), expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'cancel' });
  let settled = false;
  const closing = runner.quiesce(); void closing.then(() => { settled = true; }, () => { settled = true; });
  finish(); await running;
  expect(settled).toBe(false);
  const failure = new Error('shutdown-failed'); rejectAbort(failure);
  await expect(closing).rejects.toBe(failure);
  await expect(cancelled.execution!).rejects.toBe(failure);
  await runner.quiesce();
  await expect(runner.start(input)).rejects.toThrow('durable-host-closing');
  expect(journal.get(input.runId, input.workspaceId).status).toBe('cancelled');
});

test('quiesce retry retains a failed pause obligation after its active execution drained', async () => {
  const { journal, input, base } = fixture();
  let ready!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const drain = new Promise<void>(resolve => { finish = resolve; });
  const failure = new Error('transient-pause-storage-error');
  const originalBridge = journal.bridge.bind(journal);
  const failedBridge = spyOn(journal, 'bridge').mockImplementation((...args) => ({ ...originalBridge(...args), fail: async () => { throw failure; } }));
  const runner = new DurableReadRunner({ ...base, createBackend: () => ({
    async *chat() { ready(); await drain; }, async abort() {}, destroy() {},
  }) });
  const running = runner.start(input); void running.catch(() => {}); await started;
  const command = spyOn(journal, 'command').mockImplementation(() => { throw failure; });
  const first = runner.quiesce(); finish();
  try {
    await expect(running).rejects.toThrow('missing-completion-checkpoint');
    try { await first; throw new Error('expected quiesce failure'); }
    catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toContain(failure); }
    expect(journal.get(input.runId, input.workspaceId).status).toBe('running');
  } finally { command.mockRestore(); failedBridge.mockRestore(); }
  const retried = runner.quiesce(); expect(retried).not.toBe(first); await retried;
  expect(journal.get(input.runId, input.workspaceId).status).toBe('paused');
  await expect(runner.resume(input.runId, input.workspaceId)).rejects.toThrow('durable-host-closing');
});

for (const scenario of ['sensitive-path', 'credential-change'] as const) {
  test(`approval callback cannot bypass current policy: ${scenario}`, async () => {
    const { input, binding, base, journal } = fixture(); input.approvalPrincipalId = 'alice';
    let dispatched = false;
    const runner = new DurableReadRunner({ ...base,
      authorizeTool: async () => {
        if (scenario === 'credential-change') binding.credentialIdentity = 'b'.repeat(64);
        return { principalId: 'alice', credentialIdentity: 'a'.repeat(64), policyRevision: 'p', allowed: true, requiresApproval: false, approvalExpiresAt: Date.now() + 30000 };
      },
      createBackend: args => ({ async *chat() {
        const bridge = args.coreConfig.durableExecution!;
        await bridge.checkpoint({kind:'model-start',turn:0,context:{}});
        await bridge.checkpoint({kind:'model-result',turn:0,message:{role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id:'read',name:'read',arguments:{path:'fixture'}}]}});
        await bridge.checkpoint({kind:'tool-start',turn:0,callId:'read',tool:'read',input:{path:scenario === 'sensitive-path' ? '/tmp/.ssh/id_rsa' : '/tmp/fixture'}});
        dispatched = true;
      }, async abort() {}, destroy() {} }),
    });
    expect((await runner.start(input)).status).toBe('paused');
    expect(dispatched).toBe(false);
    expect(journal.get(input.runId,input.workspaceId).turns[0]!.calls[0]!.attempts).toBe(0);
  });
}

test('workspace revocation after a tool result blocks the next model reservation', async () => {
  const { input, base, binding, journal } = fixture(); let revoked = false, dispatched = false;
  const runner = new DurableReadRunner({ ...base, resolveBinding: () => { if (revoked) throw new Error('workspace removed'); return binding; },
    createBackend: args => ({ async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      await bridge.checkpoint({kind:'model-start',turn:0,context:{}});
      await bridge.checkpoint({kind:'model-result',turn:0,message:{role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id:'read',name:'read',arguments:{path:'/tmp/fixture'}}]}});
      await bridge.checkpoint({kind:'tool-start',turn:0,callId:'read',tool:'read',input:{path:'/tmp/fixture'}});
      await bridge.checkpoint({kind:'tool-result',turn:0,callId:'read',result:{content:'private data'}});
      revoked = true;
      await bridge.checkpoint({kind:'model-start',turn:1,context:{messages:['private data']}});
      dispatched = true;
    }, async abort() {}, destroy() {} }),
  });
  expect((await runner.start(input)).status).toBe('paused'); expect(dispatched).toBe(false);
  expect(journal.get(input.runId,input.workspaceId).modelAttempts).toBe(1);
});

test('workflow admission acknowledges persistence before model completion and duplicate callers share execution', async () => {
  const { input, base, journal } = fixture();
  const workflow = { slug: 'read-notes', source: 'global' as const, path: '/host/read-notes', body: '', metadata: { name: 'Read', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'researcher', input: 'Read notes' }] } };
  let release!: () => void, creations = 0;
  const gate = new Promise<void>(resolve => release = resolve);
  const runner = new DurableReadRunner({ ...base, createBackend: args => { creations++; return { async *chat() { await gate; await complete(args); }, async abort() {}, destroy() {} }; } });
  const request = { ...input, resolvedAgentSlug: 'researcher' };
  const first = await runner.admitWorkflow(workflow, request);
  expect(first.snapshot.status).toBe('running');
  expect(journal.get(input.runId, input.workspaceId).spec.commandId).toBe(input.commandId);
  const second = await runner.admitWorkflow(workflow, request);
  expect(second.execution).toBe(first.execution);
  expect(creations).toBe(1);
  release(); expect((await first.execution).status).toBe('succeeded');
});

test('admitted execution failure is observed even when caller initially reads only the receipt', async () => {
  const { input, base } = fixture();
  const workflow = { slug: 'read-notes', source: 'global' as const, path: '/host/read-notes', body: '', metadata: { name: 'Read', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'researcher', input: 'Read notes' }] } };
  const failure = new Error('provider unavailable');
  const runner = new DurableReadRunner({ ...base, createBackend: () => ({ async *chat() { throw failure; }, async abort() {}, destroy() {} }) });
  const accepted = await runner.admitWorkflow(workflow, { ...input, resolvedAgentSlug: 'researcher' });
  expect(accepted.snapshot.status).toBe('running');
  // Let rejection notifications run before the caller attaches its own observer.
  await new Promise(resolve => setTimeout(resolve, 10));
  await expect(accepted.execution).rejects.toBe(failure);
});

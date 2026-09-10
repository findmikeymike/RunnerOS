import * as workspaceConfig from '@craft-agent/shared/config';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { registerWorkflowRunsHandlers } from '../handlers/rpc/workflow-runs';
import type { HandlerDeps } from '../handlers/handler-deps';
import type { HandlerFn, RpcServer } from '../transport/types';
import type { WorkflowRunSnapshot } from '../../../shared/src/workflows/run-types';
import { afterEach, expect, test, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableJournal, loadDurableKey, type DurableSafeStorage } from '../../../shared/src/durable-execution/index.ts';
import { DurableWorkflowHost } from './durable-workflow-host.ts';
import type { DurableReadBinding, DurableReadInput, DurableReadRunnerOptions } from './durable-read-runner.ts';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
/** Test envelope only; does not simulate actual operating-system protection. */
const protection: DurableSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`fixture:${value}`), decryptString: bytes => { const value = bytes.toString(); if (!value.startsWith('fixture:')) throw new Error('invalid fixture envelope'); return value.slice(8); } };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-lifecycle-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'w', name: 'test', slug: 'test', rootPath: root, createdAt: 1 }, context: { provider: 'pi', resolvedModel: 'test-model', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'test-local', name: 'test', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const input: DurableReadInput = { runId: '11111111-1111-4111-8111-111111111111', commandId: 'start', workspaceId: 'w', connectionSlug: 'test-local', model: 'test-model', prompt: 'Read local notes', systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 128, deadlineAt: Date.now() + 60000, maxModelAttempts: 2, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 }, approvalPrincipalId: 'alice' };
  let creations = 0;
  const runnerOptions: Omit<DurableReadRunnerOptions, 'journal'> = { hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding, createBackend: args => {
    creations++; return { async *chat() { const bridge = args.coreConfig.durableExecution!; await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } }); await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'finished' }] } }); await bridge.checkpoint({ kind: 'complete' }); }, async abort() {}, destroy() {} };
  } };
  const open = (resolvePrincipal: (workspaceId: string, actor: { clientId: string; workspaceId?: string }) => string | Promise<string> = () => 'alice') => { const host = DurableWorkflowHost.open({ configRoot: root, protection, runnerOptions, resolvePrincipal }); cleanup.push(() => host.close()); return host; };
  return { root, input, runnerOptions, open, creations: () => creations };
}
const actor = { clientId: 'connection', workspaceId: 'w' };

test('host initializes a protected journal, persists its envelope, and reopens without automatic execution', async () => {
  const f = fixture(), host = f.open(); expect((await host.start(f.input)).status).toBe('succeeded');
  const envelope = readFileSync(join(f.root, 'durable-execution/key.envelope')); await host.close();
  const reopened = f.open(); expect(readFileSync(join(f.root, 'durable-execution/key.envelope'))).toEqual(envelope); expect(f.creations()).toBe(1);
  expect((await reopened.start(f.input)).status).toBe('succeeded'); expect(f.creations()).toBe(1); await reopened.close();
  const key = loadDurableKey(f.root, protection), journal = new DurableJournal({ configRoot: f.root, key }); key.fill(0);
  try { expect(journal.get(f.input.runId, 'w').status).toBe('succeeded'); } finally { journal.close(); }
});

test('unavailable protection and a missing envelope fail closed without replacing journal identity', async () => {
  const f = fixture();
  expect(() => DurableWorkflowHost.open({ configRoot: f.root, protection: { ...protection, isEncryptionAvailable: () => false }, runnerOptions: f.runnerOptions, resolvePrincipal: () => 'alice' })).toThrow('secure-storage-unavailable');
  const host = f.open(); await host.start(f.input); await host.close(); unlinkSync(join(f.root, 'durable-execution/key.envelope'));
  expect(() => f.open()).toThrow('durable-key-missing');
});

test('close drains an already accepted asynchronous principal lookup and blocks new calls immediately', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  const host = f.open(async () => { entered(); await gate; return 'alice'; });
  const accepted = host.controls.listAttention('w', actor); await ready;
  let closed = false; const closing = host.close().then(() => { closed = true; });
  await expect(host.controls.listAttention('w', actor)).rejects.toThrow();
  await expect(host.start(f.input)).rejects.toThrow(); expect(closed).toBe(false); expect(f.creations()).toBe(0);
  release(); expect(await accepted).toEqual([]); await closing; expect(closed).toBe(true);
  await host.close(); await host.close();
});

test('repeated close remains safe and rejects all control operations after shutdown', async () => {
  const f = fixture(), host = f.open(); await Promise.all([host.close(), host.close()]);
  await expect(host.controls.listAttention('w', actor)).rejects.toThrow();
  await expect(host.controls.control('w', 'r', { commandId: 'late', expectedVersion: 1, action: 'cancel' }, actor)).rejects.toThrow();
  await expect(host.controls.resolveAttention('w', 'missing', 'approved', { commandId: 'late-decision', expectedVersion: 1 }, actor)).rejects.toThrow();
  await expect(host.start(f.input)).rejects.toThrow(); expect(f.creations()).toBe(0);
});

test('close pauses a live backend before draining and preserves restartable state', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  f.runnerOptions.createBackend = args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} }); entered(); await gate;
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'saved after pause' }] } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} });
  const host = f.open(), running = host.start(f.input); await ready;
  let closed = false; const closing = host.close().then(() => { closed = true; });
  const key = loadDurableKey(f.root, protection), observer = new DurableJournal({ configRoot: f.root, key }); key.fill(0);
  try { expect(observer.get(f.input.runId, 'w').status).toBe('paused'); expect(closed).toBe(false); release(); expect((await running).status).toBe('paused'); await closing; expect(observer.get(f.input.runId, 'w').turns[0]!.message).toBeDefined(); } finally { release(); observer.close(); }
  const reopened = f.open(); expect(await reopened.controls.listAttention('w', actor)).toEqual([]); await reopened.close();
});

test('host facade pins caller arguments before returning a promise', async () => {
  const f = fixture(); const host = f.open(); const mutableActor = { ...actor };
  const reading = host.controls.listAttention('w', mutableActor); mutableActor.workspaceId = 'other';
  expect(await reading).toEqual([]);
  const original = { ...f.input }; const starting = host.start(f.input); f.input.prompt = 'mutated after call';
  const completed = await starting; expect((completed.spec.context as { prompt: string }).prompt).toBe(original.prompt);
});

test('storage-close failure rejects safely, keeps admissions fenced, and permits close retry', async () => {
  const f = fixture(), host = f.open(); await host.start(f.input);
  const original = DurableJournal.prototype.close;
  const closingStorage = spyOn(DurableJournal.prototype, 'close').mockImplementation(function(this: DurableJournal) { throw new Error('injected storage close failure'); });
  try { await expect(host.close()).rejects.toThrow('injected storage close failure'); await expect(host.start(f.input)).rejects.toThrow('durable-host-closing'); }
  finally { closingStorage.mockRestore(); }
  await host.close(); await host.close();
  const key = loadDurableKey(f.root, protection), observer = new DurableJournal({configRoot:f.root,key}); key.fill(0);
  try { expect(observer.get(f.input.runId,'w').status).toBe('succeeded'); } finally { original.call(observer); }
});
test('an accepted principal lookup rejection does not prevent clean shutdown', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  const host = f.open(async () => { entered(); await gate; throw new Error('access revoked'); });
  const request = host.controls.listAttention('w', actor); void request.catch(() => {}); await ready;
  const closing = host.close(); release(); await expect(request).rejects.toThrow('access revoked'); await closing; await host.close();
});

test('transient pause persistence failure drains the backend and a later close retries safely', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  f.runnerOptions.createBackend = args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({kind:'model-start',turn:0,context:{}}); entered(); await gate;
    await bridge.checkpoint({kind:'model-result',turn:0,message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'drained safely'}]}});
    await bridge.checkpoint({kind:'complete'});
  }, async abort() {}, destroy() {} });
  const host = f.open(), running = host.start(f.input); await ready;
  const failure = new Error('transient pause storage failure');
  const originalCommand = DurableJournal.prototype.command, originalClose = DurableJournal.prototype.close;
  let closeCalls = 0;
  const closingStorage = spyOn(DurableJournal.prototype,'close').mockImplementation(function(this:DurableJournal){closeCalls++;return originalClose.call(this)});
  const command = spyOn(DurableJournal.prototype,'command').mockImplementation(function(this:DurableJournal,input){if(input.action==='pause')throw failure;return originalCommand.call(this,input)});
  const firstClose = host.close(); void firstClose.catch(()=>{});
  try {
    await expect(host.start(f.input)).rejects.toThrow('durable-host-closing');
    release(); expect((await running).status).toBe('succeeded');
    await expect(firstClose).rejects.toBe(failure); expect(closeCalls).toBe(0);
    command.mockRestore(); await host.close(); expect(closeCalls).toBe(1);
    await expect(host.start(f.input)).rejects.toThrow('durable-host-closing');
  } finally { release(); command.mockRestore(); closingStorage.mockRestore(); }
  const key=loadDurableKey(f.root,protection),observer=new DurableJournal({configRoot:f.root,key});key.fill(0);
  try {expect(observer.get(f.input.runId,'w').status).toBe('succeeded');}finally{observer.close();}
});

test('a drained backend error preserves the first close failure but does not poison close retry', async () => {
  const f=fixture();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const failure=new Error('backend failed while draining');
  f.runnerOptions.createBackend=()=>({async *chat(){entered();await gate;throw failure;},async abort(){},destroy(){}});
  const host=f.open(),running=host.start(f.input);void running.catch(()=>{});await ready;
  const closing=host.close();void closing.catch(()=>{});release();await expect(running).rejects.toBe(failure);await expect(closing).rejects.toBe(failure);
  await expect(host.start(f.input)).rejects.toThrow('durable-host-closing');await host.close();
  const key=loadDurableKey(f.root,protection),observer=new DurableJournal({configRoot:f.root,key});key.fill(0);
  try{expect(observer.get(f.input.runId,'w').status).toBe('paused');}finally{observer.close();}
});

function readWorkflow() { return { slug: 'read-notes', source: 'global' as const, path: '/host/read-notes', body: '', metadata: { name: 'Read', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'researcher', input: 'Read notes' }] } }; }

test('host owns admitted workflow execution after acknowledgement and drains it on close', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  f.runnerOptions.createBackend = args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} }); entered(); await gate;
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'saved' }] } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} });
  const host = f.open(); const accepted = await host.admitWorkflow(readWorkflow(), { ...f.input, resolvedAgentSlug: 'researcher' });
  expect(accepted.snapshot.status).toBe('running'); await ready;
  expect((await host.runs.get('w', f.input.runId, actor))?.state).toBe('running');
  expect((await host.runs.list('w', actor)).map(run => run.id)).toEqual([f.input.runId]);
  let closed = false; const closing = host.close().then(() => { closed = true; });
  await expect(host.admitWorkflow(readWorkflow(), { ...f.input, resolvedAgentSlug: 'researcher' })).rejects.toThrow('durable-host-closing');
  expect(closed).toBe(false); release(); expect((await accepted.execution).status).toBe('paused'); await closing; expect(closed).toBe(true);
  await expect(host.runs.list('w', actor)).rejects.toThrow('durable-host-closing');
});

test('close during workflow binding lookup prevents admission from appearing after journal shutdown', async () => {
  const f = fixture(), binding = await f.runnerOptions.resolveBinding('w', 'test-local', 'test-model');
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  f.runnerOptions.resolveBinding = async () => { entered(); await gate; return binding; };
  const host = f.open(), admission = host.admitWorkflow(readWorkflow(), { ...f.input, resolvedAgentSlug: 'researcher' });
  void admission.catch(() => {}); await ready;
  const closing = host.close(); release(); await expect(admission).rejects.toThrow('durable-host-closing'); await closing;
  const key = loadDurableKey(f.root, protection), observer = new DurableJournal({ configRoot: f.root, key }); key.fill(0);
  try { expect(observer.list('w')).toEqual([]); } finally { observer.close(); }
});

test('normal history RPC and durable control preserve the admitted run across pause, host reopen, and cached resume', async () => {
  const f = fixture();
  const binding = await f.runnerOptions.resolveBinding('w', 'test-local', 'test-model');
  const workspaceSpy = spyOn(workspaceConfig, 'getWorkspaceByNameOrId').mockImplementation(id => id === 'w' ? binding.workspace : null);
  cleanup.push(() => workspaceSpy.mockRestore());
  let release!: () => void, entered!: () => void, finished!: () => void, modelCalls = 0, backends = 0;
  const gate = new Promise<void>(resolve => release = resolve), ready = new Promise<void>(resolve => entered = resolve), resumed = new Promise<void>(resolve => finished = resolve);
  f.runnerOptions.createBackend = args => {
    const backendNumber = ++backends;
    return { async *chat() {
      const bridge = args.coreConfig.durableExecution!;
      const result = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
      if (result.cached === undefined) {
        modelCalls++; entered(); await gate;
        await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'saved once' }] } });
      }
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() { if (backendNumber === 2) finished(); } };
  };
  let host = f.open();
  const handlers = new Map<string, HandlerFn>();
  registerWorkflowRunsHandlers({ handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler), push() {} } as unknown as RpcServer, {
    getDurableWorkflowRuns: () => host.runs, getDurableWorkflowControls: () => host.controls,
    getWorkflowRunner: () => { throw new Error('legacy runner must not execute'); },
  } as unknown as HandlerDeps);
  const ctx = { ...actor, webContentsId: null };
  const get = () => handlers.get(RPC_CHANNELS.workflowRuns.GET)!(ctx, 'w', f.input.runId) as Promise<WorkflowRunSnapshot>;
  const list = () => handlers.get(RPC_CHANNELS.workflowRuns.LIST)!(ctx, 'w') as Promise<WorkflowRunSnapshot[]>;
  const accepted = await host.admitWorkflow(readWorkflow(), { ...f.input, resolvedAgentSlug: 'researcher' }); await ready;
  const running = await get(); expect(running.state).toBe('running'); expect(running.durable).toBeDefined();
  expect((await list()).map(run => run.id)).toEqual([f.input.runId]);
  await handlers.get(RPC_CHANNELS.workflowRuns.DURABLE_CONTROL)!(ctx, 'w', f.input.runId, { action: 'pause', commandId: 'rpc-pause', expectedVersion: running.durable!.version });
  release(); expect((await accepted.execution).status).toBe('paused'); await host.close();
  host = f.open();
  const paused = await get(); expect(paused.id).toBe(f.input.runId); expect(paused.state).toBe('paused');
  await handlers.get(RPC_CHANNELS.workflowRuns.DURABLE_CONTROL)!(ctx, 'w', f.input.runId, { action: 'resume', commandId: 'rpc-resume', expectedVersion: paused.durable!.version });
  await resumed;
  const completed = await get(); expect(completed.id).toBe(f.input.runId); expect(completed.state).toBe('succeeded');
  expect((await list()).map(run => run.id)).toEqual([f.input.runId]); expect(modelCalls).toBe(1); expect(backends).toBe(2);
  await host.close();
});
test('cancelled durable backend keeps workflow admission blocked until actual backend drain', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  let aborts = 0, destroyed = false;
  f.runnerOptions.createBackend = () => ({ async *chat() { entered(); await gate; }, abort: async () => { aborts++; }, destroy: async () => { destroyed = true; } });
  const host = f.open();
  const workflow = { slug: 'read', path: f.root, source: 'global' as const, body: '', metadata: { name: 'Read', description: 'Read', execution: 'durable-local-read' as const, trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'reader', input: 'Read' }] } };
  const { prompt: _prompt, approvalPrincipalId: _principal, ...input } = f.input;
  const admitted = await host.admitWorkflowForActor(workflow, { ...input, resolvedAgentSlug: 'reader' }, actor); await ready;
  const run = (await host.runs.get('w', f.input.runId, actor))!;
  const cancelled = await host.controls.control('w', f.input.runId, { action: 'cancel', commandId: 'cancel', expectedVersion: run.durable!.version }, actor);
  expect(cancelled.state.status).toBe('cancelled'); expect(aborts).toBe(1); expect(destroyed).toBe(false);
  expect(await host.hasUnfinishedWorkflow('w', 'read')).toBe(true);
  release(); await admitted.execution; expect(destroyed).toBe(true); expect(await host.hasUnfinishedWorkflow('w', 'read')).toBe(false);
});

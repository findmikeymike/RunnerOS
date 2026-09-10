import { writeRun, getRunFile, listRuns } from '../../../shared/src/workflows/run-storage';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as config from '@craft-agent/shared/config';
import * as workflows from '@craft-agent/shared/workflows';
import * as workspaces from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { DurableWorkflowHost } from './durable-workflow-host';
import { createDurableWorkflowStart, type DurableStartBundle } from './durable-workflow-start';
import { WorkflowRunner, type WorkflowStartInput } from './runner';
import { DurableJournal, loadDurableKey, type DurableSafeStorage } from '../../../shared/src/durable-execution';
import { registerWorkflowRunsHandlers } from '../handlers/rpc/workflow-runs';
import type { HandlerDeps } from '../handlers/handler-deps';
import type { HandlerFn, RpcServer } from '../transport/types';
import type { DurableReadRunnerOptions } from './durable-read-runner';

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const protection: DurableSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }; // Isolated test protection only.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-normal-start-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = { id: 'w', slug: 'w', name: 'w', rootPath: root, createdAt: 1 };
  const workflow = { slug: 'read', source: 'global' as const, path: '/fixture/read', body: '', metadata: { execution: 'durable-local-read' as const, name: 'Read', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'reader', input: 'Read notes' }] } };
  const bundle = { connectionSlug: 'route', model: 'fixture', systemPrompt: 'Read only' };
  let release!: () => void, entered!: () => void, finished!: () => void, modelCalls = 0, legacyCalls = 0;
  const gate = new Promise<void>(resolve => release = resolve), ready = new Promise<void>(resolve => entered = resolve), done = new Promise<void>(resolve => finished = resolve);
  const runnerOptions: Omit<DurableReadRunnerOptions, 'journal'> = { hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', authType: 'api_key', resolvedModel: 'fixture', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'route', name: 'route', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }), createBackend: args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!; const reply = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    if (reply.cached === undefined) { modelCalls++; entered(); await gate;
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'done' }] } }); }
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() { finished(); } }) };
  const open = () => DurableWorkflowHost.open({ configRoot: root, protection, runnerOptions, resolvePrincipal: () => 'alice' });
  const host = open(); cleanup.push(async () => { release(); await host.close(); });
  const input: WorkflowStartInput = { workspaceId: 'w', workflow, triggerInputs: {}, invocation: 'manual-ui', actor: { clientId: 'c', workspaceId: 'w' } };
  const createStart = (resolveBundle: () => Promise<DurableStartBundle | null> = async () => bundle) => createDurableWorkflowStart({ host, resolveBundle, getWorkspaceRootPath: () => root });
  const createRunner = (durableStart = createStart()) => new WorkflowRunner({ durableStart, getWorkspaceRootPath: () => root,
    assertWorkflowAdmissionAvailable: async (workspaceId, workflowSlug) => { if (await host.hasUnfinishedWorkflow(workspaceId, workflowSlug)) throw new Error('This workflow has unfinished work.'); },
    createSession: async () => { legacyCalls++; return { id: 'legacy' }; }, sendMessage: async () => {}, getLastAssistantText: () => 'legacy output', abortSession: async () => {} });
  return { root, workspace, workflow, bundle, host, open, input, createStart, createRunner, ready, done, release, modelCalls: () => modelCalls, legacyCalls: () => legacyCalls };
}

test('normal START returns committed durable identity before completion and GET/LIST expose that identity', async () => {
  const f = fixture(), runner = f.createRunner(); let currentHost = f.host;
  const spies = [spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(f.workspace), spyOn(workflows, 'loadGlobalWorkflow').mockReturnValue(f.workflow),
    spyOn(workflows, 'readActivatedWorkflows').mockReturnValue({ active: ['read'] } as ReturnType<typeof workflows.readActivatedWorkflows>), spyOn(workspaces, 'assertTeamPermission').mockReturnValue({ allowed: true, action: 'agent.chat', role: 'owner', machineId: 'fixture' })];
  cleanup.push(() => spies.forEach(spy => spy.mockRestore()));
  const handlers = new Map<string, HandlerFn>();
  registerWorkflowRunsHandlers({ handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler), push() {} } as unknown as RpcServer,
    { getWorkflowRunner: () => runner, getDurableWorkflowRuns: () => currentHost.runs, getDurableWorkflowControls: () => currentHost.controls } as unknown as HandlerDeps);
  const ctx = { clientId: 'c', workspaceId: 'w', webContentsId: null };
  const saved = await handlers.get(RPC_CHANNELS.workflowRuns.START)!(ctx, 'w', 'read', {}); await f.ready;
  await expect(runner.start({ ...f.input, invocation: undefined })).rejects.toThrow('unfinished work');
  expect(saved.durable.engine).toBe('sqlite-v2-readonly-1'); expect(saved.state).toBe('running'); expect(f.legacyCalls()).toBe(0);
  expect((await handlers.get(RPC_CHANNELS.workflowRuns.GET)!(ctx, 'w', saved.id)).id).toBe(saved.id);
  expect((await handlers.get(RPC_CHANNELS.workflowRuns.LIST)!(ctx, 'w')).map((run: { id: string }) => run.id)).toEqual([saved.id]);
  const key = loadDurableKey(f.root, protection), observer = new DurableJournal({ configRoot: f.root, key }); key.fill(0);
  try { const state = observer.get(saved.id, 'w'); expect(state.spec.costPolicy).toEqual({ unit: 'model-requests', maxTotalUnits: 8, maxUnitsPerAttempt: 1 }); expect(state.reservedUnits).toBe(1); } finally { observer.close(); }
  const running = await currentHost.runs.get('w', saved.id, ctx);
  await handlers.get(RPC_CHANNELS.workflowRuns.DURABLE_CONTROL)!(ctx, 'w', saved.id, { action: 'pause', commandId: 'pause-normal', expectedVersion: running!.durable!.version });
  f.release(); await f.done; await currentHost.close(); currentHost = f.open(); cleanup.push(() => currentHost.close());
  const paused = await handlers.get(RPC_CHANNELS.workflowRuns.GET)!(ctx, 'w', saved.id); expect(paused.state).toBe('paused');
  const reopenedStart = createDurableWorkflowStart({ host: currentHost, resolveBundle: async () => f.bundle, getWorkspaceRootPath: () => f.root });
  await expect(reopenedStart({ ...f.input, invocation: undefined })).rejects.toThrow('unfinished work');
  const completed = await currentHost.controls.control('w', saved.id, { action: 'resume', commandId: 'resume-normal', expectedVersion: paused.durable.version }, ctx);
  expect(completed.receipt.runId).toBe(saved.id);
  // Bound polling to persisted state; replay must finish without a fresh model dispatch.
  for (let i = 0; i < 100; i++) {
    const state = await currentHost.runs.get('w', saved.id, ctx);
    if (state?.state === 'succeeded') break;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  expect((await currentHost.runs.get('w', saved.id, ctx))?.state).toBe('succeeded'); expect(f.modelCalls()).toBe(1);
});

test('unmarked workflows stay legacy while marked unsupported bundles and automatic invocation reject', async () => {
  const f = fixture(); let lookups = 0; const start = f.createStart(async () => { lookups++; return null; });
  await expect(start({ ...f.input, invocation: undefined })).rejects.toThrow(); expect(lookups).toBe(0);
  await expect(f.createRunner(start).start(f.input)).rejects.toThrow(); expect(f.legacyCalls()).toBe(0);
  const unmarked = { ...f.input, workflow: { ...f.workflow, metadata: { ...f.workflow.metadata, execution: undefined } } };
  const legacy = await f.createRunner(start).start(unmarked); expect(legacy.durable).toBeUndefined();
  for (let i = 0; i < 20 && f.legacyCalls() < 1; i++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(f.legacyCalls()).toBe(1);
});

test('duplicate manual start is blocked while bundle lookup is pending', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => entered = resolve), gate = new Promise<void>(resolve => release = resolve);
  const start = f.createStart(async () => { entered(); await gate; return f.bundle; });
  const first = start(f.input); await ready; await expect(start(f.input)).rejects.toThrow('already starting'); release();
  const result = await first; expect(result?.durable).toBeDefined(); f.release(); await f.done; expect(f.modelCalls()).toBe(1);
});

test('projection failure after admission cannot fall back to a legacy session', async () => {
  const f = fixture(); const get = spyOn(f.host.runs, 'get').mockRejectedValue(new Error('projection unavailable')); cleanup.push(() => get.mockRestore());
  await expect(f.createRunner().start(f.input)).rejects.toThrow('projection unavailable');
  expect(f.legacyCalls()).toBe(0); await f.ready; f.release(); await f.done;
});

test('explicit durable workflow cannot fall back when the host is unavailable', async () => {
  const f = fixture(); let legacy = 0;
  const runner = new WorkflowRunner({ getWorkspaceRootPath: () => f.root, createSession: async () => { legacy++; return { id: 'bad' }; }, sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {} });
  await expect(runner.start(f.input)).rejects.toThrow(); expect(legacy).toBe(0);
});


test('rerunning an older legacy failure cannot bypass active durable work or mutate the old record', async () => {
  const f = fixture(), runner = f.createRunner();
  const oldId = '11111111-1111-4111-8111-111111111111', now = new Date().toISOString();
  writeRun(f.root, { id: oldId, workflowSlug: f.workflow.slug, workspaceId: 'w', state: 'failed',
    trigger: { type: 'manual', inputs: {}, firedAt: now }, createdAt: now, updatedAt: now, completedAt: now,
    workflowSnapshot: { metadata: { ...f.workflow.metadata, execution: undefined }, body: '' },
    steps: [{ id: 'read', state: 'failed', attempts: 1, error: { code: 'old-failure', message: 'Previous attempt failed' } }],
  });
  const original = readFileSync(getRunFile(f.root, oldId));
  const admitted = await runner.start(f.input); await f.ready;
  expect(admitted.durable).toBeDefined();
  await expect(runner.rerunFromStep({ workspaceId: 'w', runId: oldId, stepId: 'read' })).rejects.toThrow('unfinished work');
  expect(f.legacyCalls()).toBe(0);
  expect(readFileSync(getRunFile(f.root, oldId))).toEqual(original);
  expect(listRuns(f.root).map(run => run.id)).toEqual([oldId]);
  f.release(); await f.done;
});

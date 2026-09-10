import { getOutputDir, readOutputManifest, listOutputs } from '../../../shared/src/outputs/storage';
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
import { DurableWorkflowStartupGate } from './durable-workflow-startup-gate';

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const protection: DurableSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }; // Isolated test protection only.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-normal-start-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = { id: 'w', slug: 'w', name: 'w', rootPath: root, createdAt: 1 };
  const workflow = { slug: 'read', source: 'global' as const, path: '/fixture/read', body: '', metadata: { execution: 'durable-local-read' as const, name: 'Read', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'reader', input: 'Read notes' }] } };
  const bundle = { connectionSlug: 'route', model: 'fixture', systemPrompt: 'Read only' };
  let release!: () => void, entered!: () => void, finished!: () => void, modelCalls = 0, legacyCalls = 0;
  const prompts: string[] = [];
  const gate = new Promise<void>(resolve => release = resolve), ready = new Promise<void>(resolve => entered = resolve), done = new Promise<void>(resolve => finished = resolve);
  const runnerOptions: Omit<DurableReadRunnerOptions, 'journal'> = { resolvePublicationWorkspace: () => workspace, authorizePublication: () => {}, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', authType: 'api_key', resolvedModel: 'fixture', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'route', name: 'route', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }), createBackend: args => ({ async *chat(prompt: string) {
    prompts.push(prompt);
    const bridge = args.coreConfig.durableExecution!; const reply = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    if (reply.cached === undefined) { modelCalls++; entered(); await gate;
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'done' }] } }); }
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() { finished(); } }) };
  let scheduledPrincipal = 'alice';
  const open = () => DurableWorkflowHost.open({ configRoot: root, protection, runnerOptions, resolvePrincipal: () => 'alice', resolveScheduledPrincipal: () => scheduledPrincipal });
  const host = open(); cleanup.push(async () => { release(); await host.close(); });
  const input: WorkflowStartInput = { workspaceId: 'w', workflow, triggerInputs: {}, invocation: 'manual-ui', actor: { clientId: 'c', workspaceId: 'w' } };
  const createStart = (resolveBundle: Parameters<typeof createDurableWorkflowStart>[0]['resolveBundle'] = async () => bundle) => createDurableWorkflowStart({ host, resolveBundle, getWorkspaceRootPath: () => root });
  const createRunner = (durableStart = createStart()) => new WorkflowRunner({ durableStart, getWorkspaceRootPath: () => root,
    assertWorkflowAdmissionAvailable: async (workspaceId, workflowSlug) => { if (await host.hasUnfinishedWorkflow(workspaceId, workflowSlug)) throw new Error('This workflow has unfinished work.'); },
    createSession: async () => { legacyCalls++; return { id: 'legacy' }; }, sendMessage: async () => {}, getLastAssistantText: () => 'legacy output', abortSession: async () => {} });
  return { prompts, setScheduledPrincipal: (value: string) => { scheduledPrincipal = value; }, root, workspace, workflow, bundle, host, open, input, createStart, createRunner, ready, done, release, modelCalls: () => modelCalls, legacyCalls: () => legacyCalls };
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

test('unavailable recovery storage blocks manual legacy starts and reruns until a host opens', async () => {
  const f = fixture(), gate = new DurableWorkflowStartupGate(); let legacy = 0;
  expect(() => gate.assertAdmissionAvailable()).not.toThrow();
  gate.defer(); expect(gate.finish(false)).toBe(false);
  const runner = new WorkflowRunner({ getWorkspaceRootPath: () => f.root, assertWorkflowAdmissionAvailable: () => gate.assertAdmissionAvailable(),
    createSession: async () => { legacy++; return { id: 'legacy' }; }, sendMessage: async () => {}, getLastAssistantText: () => 'done', abortSession: async () => {} });
  const oldId = '11111111-1111-4111-8111-111111111111', now = new Date().toISOString();
  const metadata = { ...f.workflow.metadata, execution: undefined };
  writeRun(f.root, { id: oldId, workflowSlug: f.workflow.slug, workspaceId: 'w', state: 'failed',
    trigger: { type: 'manual', inputs: {}, firedAt: now }, createdAt: now, updatedAt: now,
    workflowSnapshot: { metadata, body: '' }, steps: [{ id: 'read', state: 'failed', attempts: 1 }] });
  const original = readFileSync(getRunFile(f.root, oldId));
  await expect(runner.start({ ...f.input, workflow: { ...f.workflow, metadata } })).rejects.toThrow('recovery is unavailable');
  await expect(runner.rerunFromStep({ workspaceId: 'w', runId: oldId, stepId: 'read' })).rejects.toThrow('recovery is unavailable');
  expect(legacy).toBe(0); expect(readFileSync(getRunFile(f.root, oldId))).toEqual(original);
  expect(gate.finish(true)).toBe(true); expect(() => gate.assertAdmissionAvailable()).not.toThrow();
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


test('scheduled local read admits once and reconnects the same saved attempt after reopening', async () => {
  const f = fixture();
  const occurrence = { workOrderId: 'order', attemptId: 'attempt', workflowSlug: f.workflow.slug, workflowDigest: 'fixture-digest' };
  const input = { ...f.input, invocation: 'scheduled-work' as const, actor: undefined, occurrence };
  const saved = await f.createRunner().start(input); await f.ready;
  expect(saved.durable).toBeDefined(); expect(f.legacyCalls()).toBe(0);
  expect((await f.host.getScheduledRun('w', occurrence))?.id).toBe(saved.id);
  await expect(f.host.getScheduledRun('w', { ...occurrence, workflowDigest: 'changed' })).rejects.toThrow('occurrence-mismatch');
  await expect(f.host.getScheduledRun('w', { ...occurrence, workflowSlug: 'changed' })).rejects.toThrow('occurrence-mismatch');
  expect(await f.host.getScheduledRun('w', { ...occurrence, attemptId: 'different' })).toBeNull();
  f.release(); await f.done; await f.host.close();
  const reopened = f.open(); cleanup.push(() => reopened.close());
  expect((await reopened.getScheduledRun('w', occurrence))?.id).toBe(saved.id);
  expect((await reopened.getRunForScheduler('w', saved.id))?.state).toBe('succeeded');
  expect(f.modelCalls()).toBe(1);
});


test('scheduled identity reads and admission require current owner authority', async () => {
  const f = fixture();
  const occurrence = { workOrderId: 'order', attemptId: 'attempt', workflowSlug: f.workflow.slug, workflowDigest: 'fixture-digest' };
  f.setScheduledPrincipal('');
  await expect(f.createRunner().start({ ...f.input, invocation: 'scheduled-work', actor: undefined, occurrence })).rejects.toThrow('authority-unavailable');
  expect(f.modelCalls()).toBe(0); expect(f.legacyCalls()).toBe(0);
  f.setScheduledPrincipal('alice');
  const saved = await f.createRunner().start({ ...f.input, invocation: 'scheduled-work', actor: undefined, occurrence }); await f.ready;
  f.setScheduledPrincipal('bob');
  await expect(f.host.getScheduledRun('w', occurrence)).rejects.toThrow('principal-mismatch');
  await expect(f.host.getRunForScheduler('w', saved.id)).rejects.toThrow('principal-mismatch');
  f.release(); await f.done;
});

test('scheduled cancellation retains actual worker ownership until cleanup finishes', async () => {
  const f = fixture();
  const occurrence = { workOrderId: 'order', attemptId: 'attempt', workflowSlug: f.workflow.slug, workflowDigest: 'fixture-digest' };
  const run = await f.createRunner().start({ ...f.input, invocation: 'scheduled-work', actor: undefined, occurrence }); await f.ready;
  const current = await f.host.getScheduledRun('w', occurrence);
  await f.host.controls.control('w', run.id, { action: 'cancel', commandId: 'cancel-scheduled', expectedVersion: current!.durable!.version }, f.input.actor!);
  expect((await f.host.getScheduledRun('w', occurrence))?.state).toBe('cancelled');
  expect(await f.host.isRunActive('w', run.id)).toBe(true);
  f.release(); await f.done;
  for (let i = 0; i < 100 && await f.host.isRunActive('w', run.id); i++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(await f.host.isRunActive('w', run.id)).toBe(false);
});

test('normal manual multi-step admission resolves all agents and exposes each saved result', async () => {
  const f = fixture(), resolved: string[] = [];
  const workflow = { ...f.workflow, metadata: { ...f.workflow.metadata, steps: [
    f.workflow.metadata.steps[0]!, { id: 'summary', agent: 'summarizer', input: 'Summarize {{steps.read.output | escape}}' },
  ] } };
  const start = createDurableWorkflowStart({ host: f.host, getWorkspaceRootPath: () => f.root, resolveBundle: async (_workspace, agent) => {
    resolved.push(agent); return { ...f.bundle, systemPrompt: `PRIVATE instructions for ${agent}` };
  } });
  const saved = await f.createRunner(start).start({ ...f.input, workflow });
  expect(saved.steps.map(step => step.id)).toEqual(['read', 'summary']);
  expect(resolved).toEqual(['reader', 'summarizer']);
  f.release();
  for (let i = 0; i < 100 && (await f.host.runs.get('w', saved.id, f.input.actor!))?.state !== 'succeeded'; i++) await new Promise(resolve => setTimeout(resolve, 1));
  const complete = await f.host.runs.get('w', saved.id, f.input.actor!);
  expect(complete?.state).toBe('succeeded');
  expect(complete?.steps.map(step => [step.state, step.output])).toEqual([['succeeded', 'done'], ['succeeded', 'done']]);
  expect(JSON.stringify(complete)).not.toContain('PRIVATE'); expect(f.modelCalls()).toBe(2); expect(f.legacyCalls()).toBe(0);
});

test('a later unsupported or differently routed agent rejects the whole workflow before admission', async () => {
  for (const second of [null, { connectionSlug: 'other', model: 'fixture', systemPrompt: 'read only' }, { connectionSlug: 'route', model: 'other', systemPrompt: 'read only' }]) {
    const f = fixture();
    const workflow = { ...f.workflow, metadata: { ...f.workflow.metadata, steps: [f.workflow.metadata.steps[0]!, { id: 'second', agent: 'second', input: 'Read more' }] } };
    const start = createDurableWorkflowStart({ host: f.host, getWorkspaceRootPath: () => f.root, resolveBundle: async (_workspace, agent) => agent === 'reader' ? f.bundle : second });
    await expect(f.createRunner(start).start({ ...f.input, workflow })).rejects.toThrow();
    expect(await f.host.runs.list('w', f.input.actor!)).toEqual([]);
    expect(f.modelCalls()).toBe(0); expect(f.legacyCalls()).toBe(0);
  }
});

test.each(['manual-ui', 'scheduled-work'] as const)('%s freezes typed inputs in prompts and authorized history', async invocation => {
  const f = fixture();
  const workflow: WorkflowStartInput['workflow'] = { ...f.workflow, metadata: { ...f.workflow.metadata,
    trigger: { type: 'manual', inputs: [{ name: 'release', type: 'string', required: true }, { name: 'count', type: 'number', default: 0 }, { name: 'draft', type: 'boolean', default: false }] },
    steps: [{ id: 'read', agent: 'reader', input: '{{trigger.release}}/{{trigger.count}}/{{trigger.draft}}' }],
  } };
  const occurrence = { workOrderId: 'input-order', attemptId: 'input-attempt', workflowSlug: workflow.slug, workflowDigest: 'input-definition' };
  const input: WorkflowStartInput = { ...f.input, workflow, triggerInputs: { release: 'First release' }, invocation,
    ...(invocation === 'scheduled-work' ? { actor: undefined, occurrence } : {}) };
  const saved = await f.createRunner().start(input); await f.ready;
  input.triggerInputs.release = 'Later edit'; workflow.metadata.trigger.inputs![1]!.default = 99;
  expect(saved.trigger.inputs).toEqual({ release: 'First release', count: 0, draft: false });
  expect(f.prompts).toEqual(['First release/0/false']);
  f.release();
  for (let i = 0; i < 100 && await f.host.isRunActive('w', saved.id); i++) await new Promise(resolve => setTimeout(resolve, 1));
  await f.host.close(); const reopened = f.open(); cleanup.push(() => reopened.close());
  const restored = await reopened.runs.get('w', saved.id, f.input.actor!);
  expect(restored?.trigger.inputs).toEqual(saved.trigger.inputs); expect(restored?.state).toBe('succeeded');
  if (invocation === 'scheduled-work') {
    workflow.metadata.trigger.inputs![1]!.default = 'invalid later default';
    const start = createDurableWorkflowStart({ host: reopened, getWorkspaceRootPath: () => f.root, resolveBundle: async () => { throw new Error('must reuse occurrence'); } });
    const reused = await start({ ...input, triggerInputs: { release: 123 } });
    expect(reused?.id).toBe(saved.id); expect(reused?.trigger.inputs).toEqual(saved.trigger.inputs);
  }
  expect(f.modelCalls()).toBe(1);
});

test('invalid typed inputs reject before bundle resolution or journal admission', async () => {
  const f = fixture(); let bundles = 0;
  const workflow: WorkflowStartInput['workflow'] = { ...f.workflow, metadata: { ...f.workflow.metadata,
    trigger: { type: 'manual', inputs: [{ name: 'count', type: 'number', required: true, min: 1, max: 3, integer: true }] },
    steps: [{ id: 'read', agent: 'reader', input: '{{trigger.count}}' }],
  } };
  const start = createDurableWorkflowStart({ host: f.host, getWorkspaceRootPath: () => f.root, resolveBundle: async () => { bundles++; return f.bundle; } });
  for (const triggerInputs of [{}, { count: '2' }, { count: 0 }, { count: 4 }, { count: 1.5 }, { count: NaN }, { count: Infinity }, { count: 2, permission_mode: 'yolo' }, { count: 2, enabled_source_slugs: [] }]) {
    await expect(f.createRunner(start).start({ ...f.input, workflow, triggerInputs })).rejects.toThrow();
  }
  expect(bundles).toBe(0); expect(await f.host.runs.list('w', f.input.actor!)).toEqual([]); expect(f.modelCalls()).toBe(0);
});

test.each(['', null])('RPC Start preserves explicit empty optional input (%s) instead of refilling its default', async value => {
  const f = fixture(), workflow: WorkflowStartInput['workflow'] = { ...f.workflow, metadata: { ...f.workflow.metadata,
    trigger: { type: 'manual', inputs: [{ name: 'brief', type: 'string', default: 'DEFAULT' }] },
    steps: [{ id: 'read', agent: 'reader', input: 'Brief: {{trigger.brief}}' }],
  } };
  const spies = [spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(f.workspace), spyOn(workflows, 'loadGlobalWorkflow').mockReturnValue(workflow),
    spyOn(workflows, 'readActivatedWorkflows').mockReturnValue({ active: ['read'] } as ReturnType<typeof workflows.readActivatedWorkflows>), spyOn(workspaces, 'assertTeamPermission').mockReturnValue({ allowed: true, action: 'agent.chat', role: 'owner', machineId: 'fixture' })];
  cleanup.push(() => spies.forEach(spy => spy.mockRestore()));
  const handlers = new Map<string, HandlerFn>(), runner = f.createRunner();
  registerWorkflowRunsHandlers({ handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler), push() {} } as unknown as RpcServer,
    { getWorkflowRunner: () => runner, getDurableWorkflowRuns: () => f.host.runs, getDurableWorkflowControls: () => f.host.controls } as unknown as HandlerDeps);
  const saved = await handlers.get(RPC_CHANNELS.workflowRuns.START)!({ clientId: 'c', workspaceId: 'w', webContentsId: null }, 'w', 'read', { brief: value });
  await f.ready; expect(saved.trigger.inputs).toEqual({}); expect(f.prompts).toEqual(['Brief: ']); f.release();
});

test('tracked schedules admit multi-step reads under one occurrence identity', async () => {
  const f = fixture();
  const workflow = { ...f.workflow, metadata: { ...f.workflow.metadata, steps: [f.workflow.metadata.steps[0]!, { id: 'second', agent: 'reader', input: '{{steps.read.output}}' }] } };
  const occurrence = { workOrderId: 'order', attemptId: 'multi-attempt', workflowSlug: workflow.slug, workflowDigest: 'multi-definition' };
  const saved = await f.createRunner().start({ ...f.input, workflow, invocation: 'scheduled-work', actor: undefined, occurrence });
  expect(saved.steps).toHaveLength(2); f.release();
  for (let i = 0; i < 100 && (await f.host.getScheduledRun('w', occurrence))?.state !== 'succeeded'; i++) await new Promise(resolve => setTimeout(resolve, 1));
  const complete = await f.host.getScheduledRun('w', occurrence);
  expect(complete?.id).toBe(saved.id); expect(complete?.state).toBe('succeeded'); expect(complete?.steps.every(step => step.state === 'succeeded')).toBe(true);
  expect(f.modelCalls()).toBe(2); expect(f.legacyCalls()).toBe(0);
});


test.each(['manual-ui', 'scheduled-work'] as const)('normal %s final-step output publishes one real bundle and survives reopening', async invocation => {
  const f = fixture();
  const workflow = { ...f.workflow, metadata: { ...f.workflow.metadata,
    outputs: { mode: 'final-step' as const, kind: 'report' as const, title: 'Release research', summary: 'Saved local research', primary: { from: 'step-output' as const, step: 'summary' } },
    steps: [f.workflow.metadata.steps[0]!, { id: 'summary', agent: 'reader', input: '{{steps.read.output}}' }],
  } };
  const occurrence = { workOrderId: 'output-order', attemptId: 'output-attempt', workflowSlug: workflow.slug, workflowDigest: 'output-definition' };
  const input: WorkflowStartInput = { ...f.input, workflow, invocation, ...(invocation === 'scheduled-work' ? { actor: undefined, occurrence } : {}) };
  const saved = await f.createRunner().start(input);
  await f.ready;
  expect(saved.state).toBe('running'); expect(listOutputs(f.root)).toEqual([]);
  f.release();
  for (let i = 0; i < 100 && await f.host.isRunActive('w', saved.id); i++) await new Promise(resolve => setTimeout(resolve, 1));
  const complete = await f.host.runs.get('w', saved.id, f.input.actor!);
  expect(complete?.state).toBe('succeeded');
  expect(complete?.finalOutputId).toBeDefined();
  expect(complete?.outputIds).toEqual([complete!.finalOutputId!]);
  const outputId = complete!.finalOutputId!;
  const manifest = readOutputManifest(f.root, outputId);
  expect(manifest?.status).toBe('published'); expect(manifest?.title).toBe('Release research');
  expect(manifest?.origin).toMatchObject({ workflowRunId: saved.id, workflowSlug: workflow.slug, stepId: 'summary' });
  expect(readFileSync(join(getOutputDir(f.root, outputId), 'content.md'), 'utf8')).toBe('done');
  expect(listOutputs(f.root).map(output => output.id)).toEqual([outputId]);
  expect(f.modelCalls()).toBe(2); expect(f.legacyCalls()).toBe(0);
  await f.host.close();
  const reopened = f.open(); cleanup.push(() => reopened.close());
  const recovered = invocation === 'scheduled-work' ? await reopened.getScheduledRun('w', occurrence) : await reopened.runs.get('w', saved.id, f.input.actor!);
  expect(recovered?.id).toBe(saved.id); expect(recovered?.finalOutputId).toBe(outputId); expect(recovered?.state).toBe('succeeded');
  if (invocation === 'scheduled-work') {
    const replayStart = createDurableWorkflowStart({ host: reopened, getWorkspaceRootPath: () => f.root, resolveBundle: async () => { throw new Error('saved occurrence must not resolve model'); } });
    const replayRunner = new WorkflowRunner({ durableStart: replayStart, getWorkspaceRootPath: () => f.root,
      createSession: async () => { throw new Error('must not start legacy'); }, sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {} });
    expect((await replayRunner.start(input)).id).toBe(saved.id);
  }
  expect(f.modelCalls()).toBe(2); expect(listOutputs(f.root).map(output => output.id)).toEqual([outputId]);
});


test('same agent with different explicit task modes resolves and pins distinct bundles', async () => {
  const f = fixture();
  f.input.workflow.metadata.steps = [
    { id: 'one', agent: 'reader', taskModeId: 'scan', input: 'Read first' },
    { id: 'two', agent: 'reader', taskModeId: 'summarize', input: '{{steps.one.output}}' },
    { id: 'three', agent: 'reader', taskModeId: 'scan', input: 'Read again' },
  ];
  const resolved: Array<string | undefined> = [];
  const start = f.createStart(async (_workspaceId, _agentSlug, taskModeId) => {
    resolved.push(taskModeId); return { ...f.bundle, systemPrompt: `Pinned ${taskModeId}` };
  });
  const admit = f.host.admitWorkflowForActor.bind(f.host);
  let steps: unknown;
  const spy = spyOn(f.host, 'admitWorkflowForActor').mockImplementation((workflow, input, actor) => { steps = input.resolvedSteps; return admit(workflow, input, actor); });
  cleanup.push(() => spy.mockRestore());
  const result = await f.createRunner(start).start(f.input);
  expect(result.durable).toBeDefined();
  expect(resolved).toEqual(['scan', 'summarize']);
  expect(steps).toEqual([
    { id: 'one', agent: 'reader', taskModeId: 'scan', systemPrompt: 'Pinned scan' },
    { id: 'two', agent: 'reader', taskModeId: 'summarize', systemPrompt: 'Pinned summarize' },
    { id: 'three', agent: 'reader', taskModeId: 'scan', systemPrompt: 'Pinned scan' },
  ]);
  f.release();
});

test('normal Start pins explicit public web URLs and enables only the certified web reader', async () => {
  const f = fixture(); Object.assign(f.workflow.metadata, { webReadUrls: ['https://example.com/article'] });
  const run = await f.createRunner().start(f.input); await f.ready;
  const journal = new DurableJournal({ configRoot: f.root, key: loadDurableKey(f.root, protection) });
  try { const spec = journal.get(run.id, 'w').spec; expect(spec.webReadUrls).toEqual(['https://example.com/article']); expect(spec.allowedTools).toEqual(['read', 'grep', 'find', 'ls', 'web_fetch']); expect(spec.approvalPrincipalId).toBe('alice'); } finally { journal.close(); f.release(); }
  await f.done;
});

for (const redirects of [false, true]) test(`normal Start pins explicit redirect opt-in (${redirects})`, async () => {
  const f = fixture(); Object.assign(f.workflow.metadata, { webReadUrls: ['https://example.com/article'], webReadRedirects: redirects });
  const run = await f.createRunner().start(f.input); await f.ready;
  const journal = new DurableJournal({ configRoot: f.root, key: loadDurableKey(f.root, protection) });
  try { expect(journal.get(run.id, 'w').spec.webReadRedirects).toBe(redirects); } finally { journal.close(); f.release(); }
  await f.done;
});

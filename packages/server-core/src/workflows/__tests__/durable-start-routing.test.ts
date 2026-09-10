import { writeRun } from '@craft-agent/shared/workflows';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowRunner, type WorkflowRunnerDeps, type WorkflowStartInput } from '../runner.ts';
import type { WorkflowRunSnapshot } from '@craft-agent/shared/workflows';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function harness(adapter: WorkflowRunnerDeps['durableStart']) {
  const root = mkdtempSync(join(tmpdir(), 'durable-route-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const calls: string[] = []; let completed!: () => void; const done = new Promise<void>(resolve => completed = resolve);
  const deps: WorkflowRunnerDeps = { durableStart: adapter, createSession: async () => { calls.push('session'); return { id: 'session' }; }, preflightStepAgent: () => { calls.push('preflight'); }, sendMessage: async () => { calls.push('send'); }, getLastAssistantText: () => 'done', abortSession: async () => {}, getWorkspaceRootPath: () => root, emit: event => { if (event.type === 'run.completed') completed(); } };
  const input: WorkflowStartInput = { workspaceId: 'w', triggerInputs: {}, invocation: 'manual-ui', actor: { clientId: 'c', workspaceId: 'w' }, workflow: { slug: 'read', path: root, source: 'global', body: '', metadata: { name: 'Read', description: 'Read', trigger: { type: 'manual' }, outputs: { mode: 'none' }, steps: [{ id: 'step', agent: 'reader', input: 'Read' }] } } };
  const result: WorkflowRunSnapshot = { id: 'durable', workspaceId: 'w', workflowSlug: 'read', state: 'running', trigger: { type: 'manual', inputs: {}, firedAt: 'now' }, workflowSnapshot: { metadata: input.workflow.metadata, body: '' }, steps: [], createdAt: 'now', updatedAt: 'now' };
  return { root, calls, input, result, done, deps, runner: new WorkflowRunner(deps) };
}
test('selected durable route returns without legacy hooks or persistence', async () => {
  let response!: WorkflowRunSnapshot; const f = harness(() => response); response = f.result;
  expect(await f.runner.start(f.input)).toEqual(response); expect(f.calls).toEqual([]); expect(existsSync(join(f.root, 'runs'))).toBe(false);
});
test('unselected route preserves legacy execution', async () => {
  const f = harness(() => null); const result = await f.runner.start(f.input); await f.done;
  expect(f.calls).toEqual(['preflight', 'session', 'send']); expect(existsSync(join(f.root, 'runs', result.id, 'run.json'))).toBe(true);
});
test('selected route rejection never invokes legacy even for automatic input', async () => {
  const f = harness(input => { if (!input.invocation) throw new Error('durable-manual-only'); throw new Error('durable-admission-failed'); });
  delete f.input.invocation;
  await expect(f.runner.start(f.input)).rejects.toThrow('durable-manual-only'); expect(f.calls).toEqual([]); expect(existsSync(join(f.root, 'runs'))).toBe(false);
});
test('caller mutation cannot change delayed selection and adapter input is deeply frozen', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve); let observed!: WorkflowStartInput;
  const f = harness(async input => { observed = input; await gate; return null; });
  const pending = f.runner.start(f.input); f.input.workflow.metadata.steps[0]!.input = 'CHANGED'; f.input.actor!.clientId = 'attacker';
  expect(Object.isFrozen(observed.workflow.metadata.steps[0])).toBe(true); release(); const result = await pending; await f.done;
  expect(observed.actor?.clientId).toBe('c'); expect(result.workflowSnapshot.metadata.steps[0]?.input).toBe('Read');
});
test('pending durable admission excludes automatic start and releases guard after rejection', async () => {
  let reject!: (error: Error) => void; const gate = new Promise<WorkflowRunSnapshot | null>((_resolve, fail) => reject = fail); let first = true;
  const f = harness(() => { if (first) { first = false; return gate; } return null; });
  const pending = f.runner.start(f.input); const automatic = { ...f.input }; delete automatic.invocation;
  await expect(f.runner.start(automatic)).rejects.toThrow('admission is already in progress');
  reject(new Error('admission failed')); await expect(pending).rejects.toThrow('admission failed');
  expect(f.calls).toEqual([]); await f.runner.start(automatic); await f.done; expect(f.calls).toEqual(['preflight', 'session', 'send']);
});
test('pending automatic legacy preflight excludes manual durable admission', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve); let entered!: () => void; const preflightEntered = new Promise<void>(resolve => entered = resolve); let selections = 0;
  const f = harness(() => { selections++; return null; });
  // Keep the actual legacy preflight await open, after its route was selected.
  f.deps.preflightStepAgent = async () => { entered(); await gate; };
  const automatic = { ...f.input }; delete automatic.invocation;
  const pending = f.runner.start(automatic); await preflightEntered;
  await expect(f.runner.start(f.input)).rejects.toThrow('admission is already in progress'); expect(selections).toBe(1);
  release(); await pending; await f.done;
});
function saveOriginal(f: ReturnType<typeof harness>) {
  const original: WorkflowRunSnapshot = { ...f.result, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'failed', steps: [{ id: 'step', state: 'failed', attempts: 1 }] };
  writeRun(f.root, original); return original;
}
test('pending durable admission excludes a legacy rerun of the same workflow', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  const f = harness(async () => { await gate; return f.result; }), original = saveOriginal(f);
  const pending = f.runner.start(f.input);
  await expect(f.runner.rerunFromStep({ workspaceId: 'w', runId: original.id })).rejects.toThrow('admission is already in progress');
  expect(f.calls).toEqual([]); release(); await pending;
});
test('pending rerun preflight excludes manual start and pins caller input', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve); let entered!: () => void; const ready = new Promise<void>(resolve => entered = resolve);
  const f = harness(() => null), original = saveOriginal(f);
  f.deps.preflightStepAgent = async () => { entered(); await gate; };
  const input = { workspaceId: 'w', runId: original.id }; const pending = f.runner.rerunFromStep(input); await ready; input.workspaceId = 'elsewhere';
  await expect(f.runner.start(f.input)).rejects.toThrow('admission is already in progress'); release();
  expect((await pending).workspaceId).toBe('w'); await f.done;
});
test('saved durable concurrency guard rejects rerun without changing original or writing a new run', async () => {
  const f = harness(() => null), original = saveOriginal(f), file = join(f.root, 'runs', original.id, 'run.json');
  const before = readFileSync(file, 'utf8'); f.deps.assertWorkflowAdmissionAvailable = () => { throw new Error('saved durable run exists'); };
  await expect(f.runner.rerunFromStep({ workspaceId: 'w', runId: original.id })).rejects.toThrow('saved durable run exists');
  expect(readFileSync(file, 'utf8')).toBe(before); expect(readdirSync(join(f.root, 'runs'))).toEqual([original.id]); expect(f.calls).toEqual([]);
  f.deps.assertWorkflowAdmissionAvailable = () => {}; await f.runner.rerunFromStep({ workspaceId: 'w', runId: original.id }); await f.done;
});
test('legacy rerun rejects durable snapshot and authored execution markers', async () => {
  const f = harness(() => null), original = saveOriginal(f);
  writeRun(f.root, { ...original, workflowSnapshot: { ...original.workflowSnapshot, metadata: { ...original.workflowSnapshot.metadata, execution: 'durable-local-read' } } });
  await expect(f.runner.rerunFromStep({ workspaceId: 'w', runId: original.id })).rejects.toThrow('durable resume');
  writeRun(f.root, { ...original, durable: { engine: 'sqlite-v2-readonly-1', version: 1, status: 'failed', controlRevision: 0, continuationRevision: 0 } });
  await expect(f.runner.rerunFromStep({ workspaceId: 'w', runId: original.id })).rejects.toThrow('durable resume'); expect(f.calls).toEqual([]);
});
test('cancelled legacy execution blocks durable selection until its send finishes draining', async () => {
  let durable = false, selections = 0, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), ready = new Promise<void>(resolve => entered = resolve);
  const f = harness(() => { selections++; return durable ? f.result : null; });
  f.deps.sendMessage = async () => { entered(); await gate; };
  const run = await f.runner.start(f.input); await ready;
  expect((await f.runner.cancel('w', run.id)).state).toBe('cancelled'); durable = true;
  await expect(f.runner.start(f.input)).rejects.toThrow('still draining'); expect(selections).toBe(1);
  release(); await f.done; expect((await f.runner.start(f.input)).id).toBe('durable'); expect(selections).toBe(2);
});

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal } from '../../../../shared/src/durable-execution/index.ts';
import { DurableReadRunner, supportsDurableReadWorkflow, type DurableReadBackendArgs, type DurableReadBinding, type DurableReadWorkflowInput, type DurableReadRunnerOptions } from '../durable-read-runner.ts';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'artist-os-multistep-')), key = randomBytes(32);
  let journal = new DurableJournal({ configRoot: root, key });
  cleanups.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'w', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: 'model', authType: 'api_key', capabilities: { needsHttpPoolServer: false },
      connection: { slug: 'local', name: 'test', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const workflow = { slug: 'research', source: 'global' as const, path: '/host/research', body: '', metadata: { name: 'Research', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const },
    steps: [{ id: 'read', agent: 'reader', input: 'Read notes' }, { id: 'summarize', agent: 'writer', input: 'Summarize {{steps.read.output | escape}}' }] } };
  const input: DurableReadWorkflowInput = { runId: randomUUID(), commandId: randomUUID(), workspaceId: 'w', connectionSlug: 'local', model: 'model',
    systemPrompt: 'Read files', resolvedAgentSlug: 'reader', resolvedSteps: [{ id: 'read', agent: 'reader', systemPrompt: 'Read files' }, { id: 'summarize', agent: 'writer', systemPrompt: 'Summarize files' }],
    allowedTools: ['read'], maxOutputTokens: 128, maxModelAttempts: 4, deadlineAt: Date.now() + 60000,
    costPolicy: { unit: 'model-requests', maxTotalUnits: 4, maxUnitsPerAttempt: 1 } };
  const base = (): DurableReadRunnerOptions => ({ journal, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding });
  return { workflow, input, binding, base, get journal() { return journal; }, reopen() { journal.close(); journal = new DurableJournal({ configRoot: root, key }); } };
}
async function model(args: DurableReadBackendArgs, prompt: string, text: string) {
  const bridge = args.coreConfig.durableExecution!;
  await bridge.checkpoint({ kind: 'turn-boundary', turn: -1 });
  const reply = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { prompt, systemPrompt: args.coreConfig.customSystemPrompt! } });
  if (reply.cached === undefined) await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } });
  await bridge.checkpoint({ kind: 'turn-boundary', turn: 0 });
}

test('distinct agents execute sequentially, persist outputs, and destroy each backend before its successor', async () => {
  const f = fixture(), prompts: string[] = [], lifecycle: string[] = [];
  const runner = new DurableReadRunner({ ...f.base(), createBackend: args => {
    const index = prompts.length; lifecycle.push(`create${index}`);
    return { async *chat(prompt) { prompts.push(prompt); await model(args, prompt, index === 0 ? '<notes>' : 'summary'); await args.coreConfig.durableExecution!.checkpoint({ kind: 'complete' }); }, async abort() {}, destroy() { lifecycle.push(`destroy${index}`); } };
  } });
  const done = await runner.startWorkflow(f.workflow, f.input);
  expect(done.status).toBe('succeeded'); expect(prompts).toEqual(['Read notes', 'Summarize &lt;notes&gt;']);
  expect(lifecycle).toEqual(['create0', 'destroy0', 'create1', 'destroy1']);
  expect(done.workflowSteps?.map(step => [step.id, step.startTurn, step.endTurn, step.output])).toEqual([['read', 0, 1, '<notes>'], ['summarize', 1, 2, 'summary']]);
  expect(done.modelAttempts).toBe(2); expect(done.reservedUnits).toBe(2);
});

test('reopen skips completed step and replays unfinished step from saved model result', async () => {
  const f = fixture(); let creations = 0;
  const first = new DurableReadRunner({ ...f.base(), createBackend: args => {
    const index = creations++;
    return { async *chat(prompt) { await model(args, prompt, index === 0 ? 'notes' : 'saved summary');
      if (index === 1) { const state = f.journal.get(f.input.runId, 'w'); f.journal.command({ runId: f.input.runId, workspaceId: 'w', commandId: 'pause', expectedVersion: state.version, action: 'pause' }); }
      await args.coreConfig.durableExecution!.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} };
  } });
  expect((await first.startWorkflow(f.workflow, f.input)).status).toBe('paused');
  f.reopen(); let resumed = 0;
  const second = new DurableReadRunner({ ...f.base(), createBackend: args => ({ async *chat(prompt) {
    resumed++; expect(prompt).toBe('Summarize notes'); await model(args, prompt, 'MUST NOT REPLACE'); await args.coreConfig.durableExecution!.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }) });
  const state = f.journal.get(f.input.runId, 'w');
  const result = await second.control({ runId: f.input.runId, workspaceId: 'w', commandId: 'resume', expectedVersion: state.version, action: 'resume' });
  const done = await result.execution!;
  expect(done.status).toBe('succeeded'); expect(resumed).toBe(1); expect(done.modelAttempts).toBe(2); expect(done.workflowSteps?.[1]?.output).toBe('saved summary');
});

test('one shared attempt budget cannot be reset by advancing a step', async () => {
  const f = fixture(); f.input.maxModelAttempts = 1; f.input.costPolicy.maxTotalUnits = 1;
  const runner = new DurableReadRunner({ ...f.base(), createBackend: args => ({ async *chat(prompt) { await model(args, prompt, 'output'); await args.coreConfig.durableExecution!.checkpoint({ kind: 'complete' }); }, async abort() {}, destroy() {} }) });
  await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow('budget-exhausted');
  const state = f.journal.get(f.input.runId, 'w'); expect(state.status).toBe('failed'); expect(state.modelAttempts).toBe(1); expect(state.workflowSteps?.[0]?.output).toBe('output'); expect(state.workflowSteps?.[1]?.output).toBeUndefined();
});

test('empty output and missing step completion block successor execution', async () => {
  for (const empty of [false, true]) {
    const f = fixture(); let creations = 0;
    const runner = new DurableReadRunner({ ...f.base(), createBackend: args => { creations++; return { async *chat(prompt) {
      await model(args, prompt, empty ? '' : 'notes'); if (empty) await args.coreConfig.durableExecution!.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} }; } });
    await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow(empty ? 'empty-output' : 'missing-completion'); expect(creations).toBe(1);
  }
});

test('unsupported and malformed references reject before admission', async () => {
  for (const prompt of ['{{steps.summarize.output}}', '{{steps.missing.output}}', '{{steps.read.output.bad}}', '{{steps.read.output | nope}}', '{{steps.read.output', '{{run.id}}', '{{trigger.name}}']) {
    const f = fixture(); f.workflow.metadata.steps[1]!.input = prompt;
    expect(supportsDurableReadWorkflow(f.workflow)).toBe(false);
    await expect(new DurableReadRunner(f.base()).admitWorkflow(f.workflow, f.input)).rejects.toThrow('unsupported'); expect(f.journal.listInternal('w')).toEqual([]);
  }
});

test('wrong resolved agent and duplicate step identity reject before admission', async () => {
  const f = fixture(); f.input.resolvedSteps![1]!.agent = 'other';
  await expect(new DurableReadRunner(f.base()).admitWorkflow(f.workflow, f.input)).rejects.toThrow('unsupported');
  f.workflow.metadata.steps[1]!.id = 'read'; expect(supportsDurableReadWorkflow(f.workflow)).toBe(false); expect(f.journal.listInternal('w')).toEqual([]);
});

test('cancellation during second backend creation never dispatches its prompt', async () => {
  const f = fixture(); let created = 0, chats = 0, destroyed = 0;
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const runner = new DurableReadRunner({ ...f.base(), createBackend: async args => {
    if (++created === 2) { entered(); await gate; }
    return { async *chat(prompt) { chats++; await model(args, prompt, 'notes'); await args.coreConfig.durableExecution!.checkpoint({ kind: 'complete' }); }, async abort() {}, destroy() { destroyed++; } };
  } });
  const run = runner.startWorkflow(f.workflow, f.input); void run.catch(() => {}); await ready;
  await runner.cancel(f.input.runId, 'w'); release();
  expect((await run).status).toBe('cancelled');
  expect(f.journal.get(f.input.runId, 'w').status).toBe('cancelled'); expect(chats).toBe(1); expect(destroyed).toBe(2);
});

test('steering queued between steps is delivered at the next step initial boundary', async () => {
  const f = fixture(); let created = 0; const seen: string[] = [];
  const runner = new DurableReadRunner({ ...f.base(), createBackend: args => {
    const index = created++;
    return { async *chat(prompt) {
      const bridge = args.coreConfig.durableExecution!;
      if (index === 1) {
        const reply = await bridge.checkpoint({ kind: 'turn-boundary', turn: -1 });
        seen.push(...(reply.steering ?? []).map(item => item.text));
      }
      await model(args, prompt, 'notes'); await bridge.checkpoint({ kind: 'complete' });
      if (index === 0) { const state = f.journal.get(f.input.runId, 'w'); f.journal.steer({ runId: f.input.runId, workspaceId: 'w', commandId: 'steer', action: 'steer', expectedVersion: state.version, text: 'Focus on release dates' }); }
    }, async abort() {}, destroy() {} };
  } });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('succeeded'); expect(seen).toEqual(['Focus on release dates']);
});

test('tool calls with repeated local IDs remain scoped to their own step turns', async () => {
  const f = fixture(); let created = 0;
  const runner = new DurableReadRunner({ ...f.base(), createBackend: args => {
    const index = created++;
    return { async *chat(prompt) {
      const b = args.coreConfig.durableExecution!;
      await b.checkpoint({ kind: 'turn-boundary', turn: -1 });
      await b.checkpoint({ kind: 'model-start', turn: 0, context: { prompt } });
      await b.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: { path: `file${index}` } }] } });
      await b.checkpoint({ kind: 'tool-disposition', turn: 0, callId: 'read', tool: 'read' });
      await b.checkpoint({ kind: 'tool-start', turn: 0, callId: 'read', tool: 'read', input: { path: `file${index}` } });
      await b.checkpoint({ kind: 'tool-result', turn: 0, callId: 'read', result: { content: `notes${index}` } });
      await b.checkpoint({ kind: 'turn-boundary', turn: 0 });
      await b.checkpoint({ kind: 'model-start', turn: 1, context: { prompt, result: `notes${index}` } });
      await b.checkpoint({ kind: 'model-result', turn: 1, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: `output${index}` }] } });
      await b.checkpoint({ kind: 'turn-boundary', turn: 1 });
      await b.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} };
  } });
  const done = await runner.startWorkflow(f.workflow, f.input);
  expect(done.status).toBe('succeeded'); expect(done.modelAttempts).toBe(4);
  expect(done.turns[0]!.calls[0]!.result).toEqual({ content: 'notes0' }); expect(done.turns[2]!.calls[0]!.result).toEqual({ content: 'notes1' });
  expect(done.workflowSteps?.map(step => [step.startTurn, step.endTurn])).toEqual([[0, 2], [2, 4]]);
});

test('explicitly allowed empty result remains valid and passes an empty string forward', async () => {
  const f = fixture(); let created = 0;
  const workflow = { ...f.workflow, metadata: { ...f.workflow.metadata, steps: f.workflow.metadata.steps.map((step, index) => index === 0 ? { ...step, completion: { requireNonEmptyOutput: false } } : step) } };
  const runner = new DurableReadRunner({ ...f.base(), createBackend: args => {
    const index = created++;
    return { async *chat(prompt) {
      const bridge = args.coreConfig.durableExecution!;
      if (index === 0) {
        await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
        await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [], stopReason: 'stop' } });
      } else { expect(prompt).toBe('Summarize '); await model(args, prompt, 'finished'); }
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} };
  } });
  const done = await runner.startWorkflow(workflow, f.input);
  expect(done.status).toBe('succeeded'); expect(done.workflowSteps?.[0]?.output).toBe(''); expect(done.workflowSteps?.[1]?.output).toBe('finished');
});

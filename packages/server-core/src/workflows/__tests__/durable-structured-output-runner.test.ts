import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal } from '../../../../shared/src/durable-execution';
import type { LoadedWorkflow, JsonSchema } from '../../../../shared/src/workflows/types';
import { DurableReadRunner, type DurableReadBinding, type DurableReadWorkflowInput, type DurableReadRunnerOptions } from '../durable-read-runner';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
const schema: JsonSchema = { type: 'object', properties: { title: { type: 'string' }, count: { type: 'integer' } }, required: ['title', 'count'] };
function fixture(multi = false) {
  const root = mkdtempSync(join(tmpdir(), 'durable-structured-')), key = randomBytes(32);
  let journal = new DurableJournal({ configRoot: root, key });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'w', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: 'test', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'local', name: 'test', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const workflow: LoadedWorkflow = { slug: 'structured-read', source: 'global', path: root, body: '', metadata: {
    name: 'Structured read', description: '', trigger: { type: 'manual' }, outputs: { mode: 'none' },
    steps: [{ id: 'first', agent: 'reader', input: 'Read notes', outputSchema: structuredClone(schema) },
      ...(multi ? [{ id: 'second', agent: 'reader', input: 'Title={{steps.first.output.title}} Count={{steps.first.output.count}}' }] : [])],
  } };
  const input: DurableReadWorkflowInput = { runId: randomUUID(), commandId: randomUUID(), workspaceId: 'w', connectionSlug: 'local', model: 'test',
    systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 256, deadlineAt: Date.now() + 60000, maxModelAttempts: 4,
    approvalPrincipalId: 'owner', resolvedAgentSlug: 'reader', resolvedSteps: workflow.metadata.steps.map(step => ({ id: step.id, agent: step.agent, systemPrompt: 'Read only' })),
    costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  const options = (): DurableReadRunnerOptions => ({ journal, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding,
    resolvePublicationWorkspace: () => binding.workspace, authorizePublication() {},
  });
  return { root, workflow, input, options, get journal() { return journal; }, reopen() { journal.close(); journal = new DurableJournal({ configRoot: root, key }); } };
}
function backend(options: { answers: string[]; prompts: string[]; onResult?: () => void; model?: () => void }): DurableReadRunnerOptions['createBackend'] {
  let index = 0;
  return args => ({ async *chat(prompt) {
    options.prompts.push(prompt);
    const bridge = args.coreConfig.durableExecution!, start = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    if (start.cached === undefined) {
      options.model?.();
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: options.answers[index++]! }] } });
    }
    options.onResult?.();
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} });
}

test.each([false, true])('valid declared JSON succeeds and carries structured fields forward (multi=%s)', async multi => {
  const f = fixture(multi), prompts: string[] = [];
  const first = '{"title":"Release notes","count":2}';
  const runner = new DurableReadRunner({ ...f.options(), createBackend: backend({ answers: [first, 'Summary complete'], prompts }) });
  const result = await runner.startWorkflow(f.workflow, f.input);
  expect(result.status).toBe('succeeded'); expect(prompts[0]).toContain('JSON'); expect(prompts[0]).toContain('"required"');
  expect(result.turns[0]?.message).toMatchObject({ content: [{ type: 'text', text: first }] });
  if (multi) { expect(prompts[1]).toBe('Title=Release notes Count=2'); expect(result.workflowSteps?.[0]?.output).toBe(first); }
});

test.each(['not JSON', '{"title":"Only title"}', '{"title":42,"count":2}', '{"title":"Text","count":2.5}'].flatMap(text => [false, true].map(multi => ({ text, multi }))))('invalid structured output %j cannot succeed, start next step or publish', async ({ text, multi }) => {
  const f = fixture(multi), prompts: string[] = []; let publications = 0;
  f.workflow.metadata.outputs = { mode: 'final-step', kind: 'report' };
  const runner = new DurableReadRunner({ ...f.options(), createBackend: backend({ answers: [text, 'must not run'], prompts }), publishOutput: (_root, input) => { publications++; return { outputId: input.id }; } });
  await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow('durable-output-');
  const result = f.journal.get(f.input.runId, 'w');
  expect(result.status).toBe('failed'); expect(result.publication).toBeUndefined(); expect(prompts).toHaveLength(1); expect(publications).toBe(0);
  expect(result.workflowSteps?.[0]?.endTurn).toBeUndefined();
});

test('nested object and array paths preserve one-pass text and escaping', async () => {
  const f = fixture(true), prompts: string[] = [];
  f.workflow.metadata.trigger.inputs = [{ name: 'topic', type: 'string', default: 'must not replace' }];
  f.workflow.metadata.steps[0]!.outputSchema = { type: 'object', required: ['rows', 'label'], properties: {
    rows: { type: 'array', items: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } }, label: { type: 'string' },
  } };
  f.workflow.metadata.steps[1]!.input = 'Value={{steps.first.output.rows.0.title}} Escaped={{steps.first.output.label | escape}} All={{steps.first.output}}';
  const value = { rows: [{ title: '{{trigger.topic}} {{steps.first.output.label}}' }], label: '<label>&' };
  const result = await new DurableReadRunner({ ...f.options(), createBackend: backend({ answers: [JSON.stringify(value), 'done'], prompts }) }).startWorkflow(f.workflow, f.input);
  expect(result.status).toBe('succeeded');
  expect(prompts[1]).toBe(`Value={{trigger.topic}} {{steps.first.output.label}} Escaped=&lt;label&gt;&amp; All=${JSON.stringify(value)}`);
});

test('paused saved JSON reopens and validates cached result without a repeated model call', async () => {
  const f = fixture(), prompts: string[] = []; let models = 0, pause = true;
  const makeBackend = () => backend({ answers: ['{"title":"Saved","count":1}'], prompts, model() { models++; }, onResult() {
    if (!pause) return; pause = false;
    const state = f.journal.get(f.input.runId, 'w');
    f.journal.command({ runId: f.input.runId, workspaceId: 'w', commandId: randomUUID(), expectedVersion: state.version, action: 'pause' });
  } });
  expect((await new DurableReadRunner({ ...f.options(), createBackend: makeBackend() }).startWorkflow(f.workflow, f.input)).status).toBe('paused');
  f.reopen(); f.workflow.metadata.steps[0]!.outputSchema = { type: 'boolean' };
  const state = f.journal.get(f.input.runId, 'w');
  const result = await new DurableReadRunner({ ...f.options(), createBackend: makeBackend() }).control({ runId: f.input.runId, workspaceId: 'w', commandId: randomUUID(), expectedVersion: state.version, action: 'resume' });
  expect((await result.execution!).status).toBe('succeeded'); expect(models).toBe(1); expect(prompts[1]).toBe(prompts[0]);
});

test.each(['additionalProperties', 'minimum', '$ref', 'oneOf', 'pattern'])('unsupported schema keyword %s rejects before admission', async keyword => {
  const f = fixture(); let models = 0;
  f.workflow.metadata.steps[0]!.outputSchema = { ...schema, [keyword]: false };
  const runner = new DurableReadRunner({ ...f.options(), createBackend() { models++; throw new Error('must not dispatch'); } });
  await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow();
  expect(models).toBe(0); expect(f.journal.listInternal('w')).toHaveLength(0);
});

test.each(['missing', 'title.nested', '__proto__.value', 'constructor'])('undeclared structured output path %s rejects before dispatch', async path => {
  const f = fixture(true); let models = 0;
  f.workflow.metadata.steps[1]!.input = `Use {{steps.first.output.${path}}}`;
  const runner = new DurableReadRunner({ ...f.options(), createBackend() { models++; throw new Error('must not dispatch'); } });
  await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow(); expect(models).toBe(0);
});

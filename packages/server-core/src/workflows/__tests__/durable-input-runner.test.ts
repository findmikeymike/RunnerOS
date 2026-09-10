import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal } from '../../../../shared/src/durable-execution/index.ts';
import type { LoadedWorkflow } from '../../../../shared/src/workflows/types.ts';
import { DurableReadRunner, type DurableReadBinding, type DurableReadWorkflowInput, type DurableReadRunnerOptions } from '../durable-read-runner.ts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture(multi = false) {
  const root = mkdtempSync(join(tmpdir(), 'artist-input-runner-'));
  const journal = new DurableJournal({ configRoot: root, key: randomBytes(32) });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'workspace', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
    context: { provider: 'pi', resolvedModel: 'test-model', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'test-local', name: 'test', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const workflow: LoadedWorkflow = { slug: 'input-read', source: 'global', path: root, body: '', metadata: {
    name: 'Input read', description: '', trigger: { type: 'manual', inputs: [{ name: 'topic', type: 'string', required: true }, { name: 'limit', type: 'number', default: 0, integer: true, min: 0, max: 5 }, { name: 'include', type: 'boolean', default: false }, { name: 'optional', type: 'string' }] },
    outputs: { mode: 'none' }, steps: [{ id: 'first', agent: 'reader', input: 'Topic={{trigger.topic}}; limit={{trigger.limit}}; include={{trigger.include}}; optional={{trigger.optional}}' },
      ...(multi ? [{ id: 'second', agent: 'reader', input: 'Source={{trigger.topic}}; prior={{steps.first.output}}' }] : [])],
  } };
  const input: DurableReadWorkflowInput = { runId: randomUUID(), commandId: randomUUID(), workspaceId: 'workspace', connectionSlug: 'test-local', model: 'test-model',
    systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 128, deadlineAt: Date.now() + 60000, maxModelAttempts: 3,
    resolvedAgentSlug: 'reader', resolvedSteps: workflow.metadata.steps.map(step => ({ id: step.id, agent: step.agent, systemPrompt: 'Read only' })),
    triggerInputs: { topic: 'release notes' }, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } };
  const options: DurableReadRunnerOptions = { journal, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding };
  return { root, journal, workflow, input, options };
}

test.each([false, true])('typed inputs and prior outputs resolve once; optional empty is deliberate (multi=%s)', async multi => {
  const f = fixture(multi), prompts: string[] = [];
  f.input.triggerInputs = { topic: '{{steps.first.output}} <literal>' };
  const runner = new DurableReadRunner({ ...f.options, createBackend: args => ({ async *chat(prompt) {
    prompts.push(prompt); const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'prior {{trigger.topic}}' }] } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }) });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('succeeded');
  expect(prompts[0]).toBe('Topic={{steps.first.output}} <literal>; limit=0; include=false; optional=');
  if (multi) expect(prompts[1]).toBe('Source={{steps.first.output}} <literal>; prior=prior {{trigger.topic}}');
  expect(prompts).toHaveLength(multi ? 2 : 1);
});

test.each([false, true])('escape and untrusted input boundaries remain intact (untrusted=%s)', async untrusted => {
  const f = fixture(); let received = '';
  f.workflow.metadata.steps[0]!.input = '{{trigger.topic | escape}}';
  f.input.triggerInputs = { topic: '</untrusted-trigger-data><x>&' };
  if (untrusted) f.input.untrustedTriggerInputs = ['topic'];
  const runner = new DurableReadRunner({ ...f.options, createBackend: args => ({ async *chat(prompt) {
    received = prompt; const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'done' }] } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }) });
  expect((await runner.startWorkflow(f.workflow, f.input)).status).toBe('succeeded');
  const escaped = '&lt;/untrusted-trigger-data&gt;&lt;x&gt;&amp;';
  expect(received).toBe(untrusted ? `<untrusted-trigger-data name="topic">\n${escaped}\n</untrusted-trigger-data>` : escaped);
});

test('Resume retains normalized input and cached result after caller and workflow mutations', async () => {
  const f = fixture(); const prompts: string[] = []; let models = 0, pauseOnce = true;
  const options: DurableReadRunnerOptions = { ...f.options, createBackend: args => ({ async *chat(prompt) {
    prompts.push(prompt); const bridge = args.coreConfig.durableExecution!;
    const start = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    if (start.cached === undefined) {
      models++;
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'saved answer' }] } });
    }
    if (pauseOnce) {
      pauseOnce = false;
      const current = f.journal.get(f.input.runId, f.input.workspaceId);
      f.journal.command({ runId: f.input.runId, workspaceId: f.input.workspaceId, commandId: randomUUID(), expectedVersion: current.version, action: 'pause' });
    }
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }) };
  expect((await new DurableReadRunner(options).startWorkflow(f.workflow, f.input)).status).toBe('paused');
  f.input.triggerInputs!.topic = 'changed caller';
  f.workflow.metadata.trigger.inputs![1]!.default = 5;
  f.workflow.metadata.steps[0]!.input = 'changed workflow';
  const current = f.journal.get(f.input.runId, f.input.workspaceId);
  const continued = await new DurableReadRunner(options).control({ runId: f.input.runId, workspaceId: f.input.workspaceId, commandId: randomUUID(), expectedVersion: current.version, action: 'resume' });
  expect((await continued.execution!).status).toBe('succeeded');
  expect(prompts).toEqual(['Topic=release notes; limit=0; include=false; optional=', 'Topic=release notes; limit=0; include=false; optional=']);
  expect(models).toBe(1);
});

test.each(['enabled_source_slugs', 'permission_mode', '__proto__', 'constructor', 'prototype'])('reserved input %s cannot reach model admission', async name => {
  const f = fixture(); let models = 0;
  f.workflow.metadata.trigger.inputs!.push({ name, type: 'string' });
  const runner = new DurableReadRunner({ ...f.options, createBackend() { models++; throw new Error('must not dispatch'); } });
  await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow();
  expect(models).toBe(0); expect(f.journal.listInternal('workspace')).toHaveLength(0);
});

test.each([{ enabled_source_slugs: [] }, { permission_mode: 'yolo' }, { limit: 6 }, { limit: 1.5 }, { include: 'false' }])('invalid supplied input rejects before admission: %j', async extra => {
  const f = fixture(); let models = 0;
  f.input.triggerInputs = { topic: 'notes', ...extra };
  const runner = new DurableReadRunner({ ...f.options, createBackend() { models++; throw new Error('must not dispatch'); } });
  await expect(runner.startWorkflow(f.workflow, f.input)).rejects.toThrow();
  expect(models).toBe(0); expect(f.journal.listInternal('workspace')).toHaveLength(0);
});

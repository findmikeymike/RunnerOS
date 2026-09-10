import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DurableWorkflowHost } from '../../durable-workflow-host';
import { createDurableWorkflowStart } from '../../durable-workflow-start';
import { WorkflowRunner } from '../../runner';
import { DurableJournal, loadDurableKey } from '../../../../../shared/src/durable-execution';

// Supervisor-owned synthetic profile. No provider or user credentials are loaded.
const [root, mode] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'multistep-crash-fixture' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-multistep-fixture-required');
const configRoot = join(root, 'config');
const workspaceId = 'multistep-fixture';
const actor = { clientId: 'fixture-client', workspaceId };
const workspace = { id: workspaceId, name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 };
const protection = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
const workflow = { slug: 'multistep-read', source: 'global' as const, path: root, body: '', metadata: { execution: 'durable-local-read' as const, name: 'Read and summarize', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'reader', input: 'Read local notes.' }, { id: 'summarize', agent: 'summarizer', input: 'Summarize this saved result: {{steps.read.output}}' }] } };
let creations = 0;
let observer: DurableJournal;
const host = DurableWorkflowHost.open({ configRoot, protection, resolvePrincipal: () => 'fixture-principal', runnerOptions: {
  hostRuntime: { appRootPath: root, isPackaged: false },
  resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', authType: 'api_key', resolvedModel: 'fixture', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }),
  createBackend: async args => {
    creations++;
    const step = args.coreConfig.customSystemPrompt === 'Reader system prompt.' ? 'read' : 'summarize';
    if (mode === 'start' && step === 'summarize') {
      const journal = observer.listInternal(workspaceId)[0]!;
      console.log(JSON.stringify({ barrier: 'between-steps', journal, projected: await host.runs.get(workspaceId, journal.spec.runId, actor) }));
      // The prior completion is committed; the next backend has not dispatched.
      await new Promise<void>(() => {});
    }
    return { async *chat(prompt: string) {
      const bridge = args.coreConfig.durableExecution!;
      const checkpoint = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { prompt } });
      if (checkpoint.cached !== undefined) throw new Error('completed-step-was-replayed');
      appendFileSync(join(root, 'model-dispatches'), JSON.stringify({ mode, step, prompt }) + '\n');
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: step === 'read' ? 'First result: exact durable text.' : 'Second result: summary complete.' }] } });
      await bridge.checkpoint({ kind: 'complete' });
    }, async abort() {}, destroy() {} };
  },
} });
const key = loadDurableKey(configRoot, protection);
observer = new DurableJournal({ configRoot, key }); key.fill(0);
const keepAlive = setInterval(() => {}, 1000);
try {
  if (mode === 'start') {
    const runner = new WorkflowRunner({ durableStart: createDurableWorkflowStart({ host, getWorkspaceRootPath: () => root, resolveBundle: async (_workspace, agent) => ({ connectionSlug: 'fixture', model: 'fixture', systemPrompt: agent === 'reader' ? 'Reader system prompt.' : 'Summarizer system prompt.' }) }), getWorkspaceRootPath: () => root,
      createSession: async () => { throw new Error('legacy-dispatch-forbidden'); }, sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {},
    });
    await runner.start({ workspaceId, workflow, triggerInputs: {}, invocation: 'manual-ui', actor });
    await new Promise<void>(() => {});
  } else {
    const before = observer.listInternal(workspaceId)[0]!;
    const projectedBefore = await host.runs.get(workspaceId, before.spec.runId, actor);
    const creationsBeforeResume = creations;
    await host.controls.control(workspaceId, before.spec.runId, { action: 'resume', commandId: 'resume-after-kill', expectedVersion: before.version }, actor);
    const timeoutAt = Date.now() + 10_000;
    while (observer.get(before.spec.runId, workspaceId).status === 'running' && Date.now() < timeoutAt) await new Promise(resolve => setTimeout(resolve, 5));
    const after = observer.get(before.spec.runId, workspaceId);
    if (after.status !== 'succeeded') throw new Error('multistep-recovery-did-not-complete:' + after.status);
    console.log(JSON.stringify({ result: 'recovered', before, after, creationsBeforeResume, creations, projectedBefore, projectedAfter: await host.runs.get(workspaceId, before.spec.runId, actor), journalCount: observer.listInternal(workspaceId).length }));
  }
} finally { clearInterval(keepAlive); observer.close(); await host.close(); }

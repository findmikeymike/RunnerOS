import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DurableWorkflowHost } from '../../durable-workflow-host';
import { createDurableWorkflowStart } from '../../durable-workflow-start';
import { createDurableConnectedReadBindingResolver } from '../../durable-connected-read-binding';
import { WorkflowRunner } from '../../runner';
import { DurableJournal, loadDurableKey } from '../../../../../shared/src/durable-execution';
import { loadSource } from '../../../../../shared/src/sources/storage';

// The supervisor creates this isolated fixture. Never load user accounts or providers.
const [root, mode] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'normal-connected-fixture' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-connected-fixture-required');
const configRoot = join(root, 'config');
const workspaceId = 'connected-fixture';
const actor = { clientId: 'fixture-client', workspaceId };
const workspace = { id: workspaceId, name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 };
const protection = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
const url = 'https://api.spotify.com/v1/artists/0123456789ABCDEFGHIJKL';
const bindingResolver = createDurableConnectedReadBindingResolver({ getWorkspaces: () => [workspace], loadSource, loadCredential: async () => ({ value: readFileSync(join(root, 'credential'), 'utf8') }), now: Date.now });
const workflow = { slug: 'connected-read', source: 'global' as const, path: root, body: '', metadata: { execution: 'durable-local-read' as const, connectedReads: [{ sourceSlug: 'account', url }], name: 'Read connected artist', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'reader', input: 'Summarize the connected artist.' }] } };
let observer: DurableJournal;
let creations = 0;
const host = DurableWorkflowHost.open({ configRoot, protection, resolvePrincipal: () => 'fixture-principal', runnerOptions: {
 authorizeRun: () => {},
 hostRuntime: { appRootPath: root, isPackaged: false },
 connectedReads: { bindingResolver, transport: async (binding, target, allowed) => {
   await bindingResolver.assertCurrent(binding);
   if (!allowed() || target !== url) throw new Error('fixture-dispatch-unauthorized');
   appendFileSync(join(root, 'get-dispatches'), JSON.stringify({ mode, url: target }) + '\n');
   if (mode === 'start-inflight') {
     console.log(JSON.stringify({ barrier: 'read-inflight', journal: observer.listInternal(workspaceId)[0] }));
     await new Promise<void>(() => {});
   }
   return { ok: true, data: { name: 'Saved fixture artist', followers: { total: 123 } } };
 } },
 resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', authType: 'api_key', resolvedModel: 'fixture', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }),
 createBackend: async args => {
   creations++;
   if (mode === 'start-saved') {
     console.log(JSON.stringify({ barrier: 'read-saved', journal: observer.listInternal(workspaceId)[0], systemPrompt: args.coreConfig.customSystemPrompt }));
     await new Promise<void>(() => {});
   }
   return { async *chat(prompt: string) {
     const bridge = args.coreConfig.durableExecution!;
     await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { prompt } });
     appendFileSync(join(root, 'model-dispatches'), JSON.stringify({ prompt, systemPrompt: args.coreConfig.customSystemPrompt }) + '\n');
     await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Connected artist summary complete.' }] } });
     await bridge.checkpoint({ kind: 'complete' });
   }, async abort() {}, destroy() {} };
 },
} });
const key = loadDurableKey(configRoot, protection); observer = new DurableJournal({ configRoot, key }); key.fill(0);
const keepAlive = setInterval(() => {}, 1000);
try {
 if (mode.startsWith('start-')) {
   const runner = new WorkflowRunner({ durableStart: createDurableWorkflowStart({ host, getWorkspaceRootPath: () => root, resolveBundle: async () => ({ connectionSlug: 'fixture', model: 'fixture', systemPrompt: 'Reader system prompt.' }) }), getWorkspaceRootPath: () => root,
     createSession: async () => { throw new Error('legacy-dispatch-forbidden'); }, sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {},
   });
   await runner.start({ workspaceId, workflow, triggerInputs: {}, invocation: 'manual-ui', actor });
   await new Promise<void>(() => {});
 } else {
   const before = observer.listInternal(workspaceId)[0]!;
   const creationsBeforeResume = creations;
   await host.controls.control(workspaceId, before.spec.runId, { action: 'resume', commandId: `resume-${mode}`, expectedVersion: before.version }, actor);
   const timeoutAt = Date.now() + 10_000;
   while (observer.get(before.spec.runId, workspaceId).status === 'running' && Date.now() < timeoutAt) await new Promise(resolve => setTimeout(resolve, 5));
   const after = observer.get(before.spec.runId, workspaceId);
   const expected = mode === 'recover-rotated' ? 'paused' : 'succeeded';
   if (after.status !== expected) throw new Error('connected-recovery-unexpected:' + after.status);
   console.log(JSON.stringify({ result: 'recovered', before, after, creationsBeforeResume, creations }));
 }
} finally { clearInterval(keepAlive); observer.close(); await host.close(); }

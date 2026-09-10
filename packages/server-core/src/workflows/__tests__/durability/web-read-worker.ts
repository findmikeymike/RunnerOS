import { appendFileSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { DurableWorkflowHost } from '../../durable-workflow-host';
import { DurableJournal, loadDurableKey } from '../../../../../shared/src/durable-execution';
const [root, mode] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'web-read-fixture' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-web-fixture-required');
const workspaceId = 'web-fixture', runId = '11111111-2222-4333-8444-555555555555', url = 'https://example.com/article';
const protection = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
const workspace = { id: workspaceId, name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 }, actor = { clientId: 'fixture', workspaceId };
function saved() { const key = loadDurableKey(join(root, 'config'), protection), journal = new DurableJournal({ configRoot: join(root, 'config'), key }); key.fill(0); try { return journal.get(runId, workspaceId); } finally { journal.close(); } }
const host = DurableWorkflowHost.open({ configRoot: join(root, 'config'), protection, resolvePrincipal: () => 'fixture-principal', runnerOptions: {
  hostRuntime: { appRootPath: root, isPackaged: false }, authorizeRun: () => {},
  authorizeTool: async () => ({ principalId: 'fixture-principal', credentialIdentity: 'a'.repeat(64), policyRevision: 'fixture', allowed: true, requiresApproval: false, approvalExpiresAt: Date.now() + 60000 }),
  resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', authType: 'api_key', resolvedModel: 'fixture', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }),
  createBackend: args => ({ async *chat() {
    const bridge = args.coreConfig.durableExecution!;
    const model = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    if (model.cached === undefined) await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'fetch', name: 'web_fetch', arguments: { url } }] } });
    const tool = await bridge.checkpoint({ kind: 'tool-start', turn: 0, callId: 'fetch', tool: 'web_fetch', input: { url } });
    if (tool.cached === undefined) { appendFileSync(join(root, 'remote-dispatches'), 'fetch\n'); await bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'fetch', result: { content: [{ type: 'text', text: 'saved article' }] } }); }
    if (mode === 'start') { writeSync(1, JSON.stringify({ barrier: 'saved-web-result', state: saved() }) + '\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
    await bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} });
    await bridge.checkpoint({ kind: 'model-result', turn: 1, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Read completed' }] } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }),
} });
try {
  if (mode === 'start') {
    const workflow = { slug: 'web-read', source: 'global' as const, path: root, body: '', metadata: { execution: 'durable-local-read' as const, webReadUrls: [url], name: 'Read web', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'none' as const }, steps: [{ id: 'read', agent: 'reader', input: 'Read article.' }] } };
    const admitted = await host.admitWorkflowForActor(workflow, { runId, commandId: 'start', workspaceId, connectionSlug: 'fixture', model: 'fixture', resolvedAgentSlug: 'reader', allowedTools: ['web_fetch'], webReadUrls: [url], systemPrompt: 'Read only.', maxOutputTokens: 128, deadlineAt: Date.now() + 60000, maxModelAttempts: 3, costPolicy: { unit: 'model-requests', maxTotalUnits: 3, maxUnitsPerAttempt: 1 } }, actor); await admitted.execution;
  } else {
    const before = saved(); await host.controls.control(workspaceId, runId, { commandId: 'resume-web', expectedVersion: before.version, action: 'resume' }, actor);
    for (let attempt = 0; attempt < 200 && saved().status !== 'succeeded'; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    console.log(JSON.stringify({ result: 'recovered', before, after: saved() }));
  }
} finally { await host.close(); }

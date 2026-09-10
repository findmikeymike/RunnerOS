import { appendFileSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { DurableWorkflowHost } from '../../durable-workflow-host';
import { DurableJournal, loadDurableKey } from '../../../../../shared/src/durable-execution';
import { ensureDurableTextOutput } from '../../../../../shared/src/outputs/durable-text';
import { listOutputManifests } from '../../../../../shared/src/outputs/storage';

const [root, mode] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'output-publish-fixture' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-output-fixture-required');
const workspaceId = 'output-fixture', runId = '11111111-2222-4333-8444-555555555555';
const protection = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
const workspace = { id: workspaceId, name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 };
const actor = { clientId: 'fixture', workspaceId };
function saved() {
  const key = loadDurableKey(join(root, 'config'), protection);
  const journal = new DurableJournal({ configRoot: join(root, 'config'), key }); key.fill(0);
  try { return journal.get(runId, workspaceId); } finally { journal.close(); }
}
const host = DurableWorkflowHost.open({ configRoot: join(root, 'config'), protection, resolvePrincipal: () => 'fixture-principal', runnerOptions: {
  hostRuntime: { appRootPath: root, isPackaged: false }, authorizePublication: () => {},
  resolvePublicationWorkspace: id => { if (id !== workspaceId) throw new Error('unknown-fixture-workspace'); return workspace; },
  resolveBinding: () => ({ workspace, credentialIdentity: 'a'.repeat(64), context: { provider: 'pi', authType: 'api_key', resolvedModel: 'fixture', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }),
  publishOutput: (path, input) => {
    appendFileSync(join(root, 'publish-attempts'), 'publish\n');
    const result = ensureDurableTextOutput(path, input);
    if (mode === 'start') {
      writeSync(1, JSON.stringify({ barrier: 'bundle-before-receipt', state: saved(), outputs: listOutputManifests(root) }) + '\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
    return result;
  },
  createBackend: args => ({ async *chat() {
    appendFileSync(join(root, 'model-dispatches'), 'model\n');
    const bridge = args.coreConfig.durableExecution!;
    await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
    await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '# Saved exactly once' }] } });
    await bridge.checkpoint({ kind: 'complete' });
  }, async abort() {}, destroy() {} }),
} });
try {
  if (mode === 'start') {
    const workflow = { slug: 'publish-read', source: 'global' as const, path: root, body: '', metadata: { execution: 'durable-local-read' as const, name: 'Publish', description: '', trigger: { type: 'manual' as const }, outputs: { mode: 'final-step' as const, kind: 'report' as const, title: 'Saved report' }, steps: [{ id: 'read', agent: 'reader', input: 'Read notes.' }] } };
    const admitted = await host.admitWorkflowForActor(workflow, { runId, commandId: 'start', workspaceId, connectionSlug: 'fixture', model: 'fixture', resolvedAgentSlug: 'reader', allowedTools: ['read'], systemPrompt: 'Read only.', maxOutputTokens: 128, deadlineAt: Date.now() + 60000, maxModelAttempts: 2, costPolicy: { unit: 'model-requests', maxTotalUnits: 2, maxUnitsPerAttempt: 1 } }, actor);
    await admitted.execution;
  } else {
    const before = saved();
    const projectedBefore = await host.runs.get(workspaceId, runId, actor);
    const attemptsBefore = readFileSync(join(root, 'publish-attempts'), 'utf8');
    await host.controls.control(workspaceId, runId, { commandId: 'resume-output', expectedVersion: before.version, action: 'resume' }, actor);
    for (let attempt = 0; attempt < 100 && saved().status !== 'succeeded'; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    console.log(JSON.stringify({ result: 'recovered', before, projectedBefore, attemptsBefore, after: saved(), projectedAfter: await host.runs.get(workspaceId, runId, actor), outputs: listOutputManifests(root) }));
  }
} finally { await host.close(); }

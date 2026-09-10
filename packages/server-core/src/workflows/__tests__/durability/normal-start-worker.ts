import { DurableWorkflowHost } from '../../durable-workflow-host';
import { WorkflowRunner } from '../../runner';
import { createDurableWorkflowStart } from '../../durable-workflow-start';
/** Actual normal Start/default Pi execution, only in supervisor-owned synthetic configuration. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { durableCredentialIdentity } from '../../../../../shared/src/protocol/durable-execution.ts';
import { getCredentialManager } from '../../../../../shared/src/credentials/manager.ts';
import { type DurableReadBinding } from '../../durable-read-runner.ts';

const [root, endpoint] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'approval-fixture' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-approval-fixture-required');
const key = 'synthetic-approval-provider-key';
getCredentialManager().getLlmApiKey = async slug => { if (slug !== 'approval-fixture') throw new Error('unexpected-key-read'); return key; };
const identity = await durableCredentialIdentity({ provider: 'custom-endpoint', credential: { type: 'api_key', key } });
const binding: DurableReadBinding = { credentialIdentity: identity,
  workspace: { id: 'approval-workspace', name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 },
  context: { provider: 'pi', resolvedModel: 'approval-fixture', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: {
    slug: 'approval-fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', piAuthProvider: 'openai', baseUrl: endpoint + '/v1', customEndpoint: { api: 'openai-completions' }, models: ['approval-fixture'], createdAt: 1,
  } },
};
const folder = join(root, 'app/packages/pi-agent-server/dist'); mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'index.js'), `import ${JSON.stringify(resolve(import.meta.dir, '../../../../../pi-agent-server/src/index.ts'))};\n`);
const host = DurableWorkflowHost.open({ configRoot: join(root, 'config'), protection: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, resolvePrincipal: () => 'fixture-principal', runnerOptions: {
  hostRuntime: { appRootPath: join(root, 'app'), isPackaged: false, nodeRuntimePath: process.execPath }, resolveBinding: () => binding,
  authorizeTool: async () => ({ principalId: 'fixture-principal', policyRevision: 'fixture', credentialIdentity: identity, allowed: true, requiresApproval: false, approvalExpiresAt: Date.now() + 60000 }),
} });
try {
  const runner = new WorkflowRunner({ durableStart: createDurableWorkflowStart({ host, getWorkspaceRootPath: () => root, resolveBundle: async () => ({ connectionSlug: 'approval-fixture', model: 'approval-fixture', systemPrompt: 'Use the native read tool to read fixture.txt, then summarize.' }) }),
    getWorkspaceRootPath: () => root, createSession: async () => { throw new Error('legacy-session-forbidden'); }, sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {},
  });
  const actor = { clientId: 'fixture-client', workspaceId: 'approval-workspace' };
  const state = await runner.start({ invocation: 'manual-ui', actor, workspaceId: actor.workspaceId, triggerInputs: {}, workflow: { slug: 'approval-fixture', path: root, source: 'global', body: '', metadata: { execution: 'durable-local-read' as const, name: 'Fixture', description: '', trigger: { type: 'manual' }, outputs: { mode: 'none' }, steps: [{ id: 'read', agent: 'reader', input: 'Read fixture.txt.' }] } } });
  console.log(JSON.stringify({ barrier: 'admitted', runId: state.id, state: state.state }));
  for (let i = 0; i < 1000; i++) {
    const current = await host.runs.get(actor.workspaceId, state.id, actor);
    if (current?.state === 'succeeded') { console.log(JSON.stringify({ result: current.state, runId: current.id })); break; }
    if (current?.state === 'failed') throw new Error(JSON.stringify(current));
    if (i === 999) throw new Error('completion-timeout');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
} finally { await host.close(); }

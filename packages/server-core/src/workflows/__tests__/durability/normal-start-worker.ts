import { createDurableReadAuthorization, readDurablePolicyRevision } from '../../durable-read-authorization';
import { DurableWorkflowHost } from '../../durable-workflow-host';
import { WorkflowRunner } from '../../runner';
import { createDurableWorkflowStart } from '../../durable-workflow-start';
/** Actual normal Start/default Pi execution, only in supervisor-owned synthetic configuration. */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { durableCredentialIdentity } from '../../../../../shared/src/protocol/durable-execution.ts';
import { getCredentialManager } from '../../../../../shared/src/credentials/manager.ts';
import { type DurableReadBinding } from '../../durable-read-runner.ts';
import { resolveDurableLocalSources } from '../../durable-workflow-sources.ts';
import { createDurableWorkflowBundleResolver } from '../../durable-workflow-bundle.ts';
import { savePersonalInstruction } from '../../../../../shared/src/skills/personal-instructions.ts';
import { setGlobalSkillEnabled } from '../../../../../shared/src/skills/storage.ts';

import { createDurableConnectedReadBindingResolver } from '../../durable-connected-read-binding';
import { loadSource } from '../../../../../shared/src/sources/storage';

const connectedUrl = 'https://api.spotify.com/v1/artists/0123456789ABCDEFGHIJKL';
const [root, endpoint, mode] = process.argv.slice(2) as [string, string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'approval-fixture' || process.env.CRAFT_CONFIG_DIR !== join(root, 'config')) throw new Error('isolated-approval-fixture-required');
const key = 'synthetic-approval-provider-key';
getCredentialManager().getLlmApiKey = async slug => { if (!['approval-fixture', 'backup-fixture'].includes(slug)) throw new Error('unexpected-key-read'); return key; };
const identity = await durableCredentialIdentity({ provider: 'custom-endpoint', credential: { type: 'api_key', key } });
if (mode === 'sources') {
  mkdirSync(join(root, 'sources/notes'), { recursive: true });
  writeFileSync(join(root, 'sources/notes/config.json'), JSON.stringify({ id: 'notes', slug: 'notes', name: 'Notes', enabled: true, provider: 'local', type: 'local', local: { format: 'filesystem', path: root } }));
  writeFileSync(join(root, 'sources/notes/guide.md'), 'SOURCE_CONTEXT_NATIVE_READ');
}
const localSources = mode === 'sources' ? resolveDurableLocalSources(root, ['notes'], []) : [];
const binding: DurableReadBinding = { credentialIdentity: identity,
  workspace: { id: 'approval-workspace', name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 },
  context: { provider: 'pi', resolvedModel: 'approval-fixture', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: {
    slug: 'approval-fixture', name: 'Fixture', providerType: 'pi_compat', authType: 'api_key', piAuthProvider: 'openai', baseUrl: endpoint + '/v1', customEndpoint: { api: 'openai-completions' }, models: ['approval-fixture', 'backup-fixture'], createdAt: 1,
  } },
};
if (mode === 'connected') {
  mkdirSync(join(root, 'sources/account'), { recursive: true });
  writeFileSync(join(root, 'sources/account/config.json'), JSON.stringify({ id: 'account', slug: 'account', name: 'Account', provider: 'spotify', type: 'api', enabled: true, isAuthenticated: true, api: { baseUrl: 'https://api.spotify.com/v1/', authType: 'bearer' } }));
}
const connectedResolver = createDurableConnectedReadBindingResolver({ getWorkspaces: () => [binding.workspace], loadSource, loadCredential: async () => ({ value: 'synthetic-account-token' }), now: Date.now });
const resolveBundle = async () => {
  const systemPrompt = 'Use the native read tool to read fixture.txt, then summarize.\n' + localSources.map(source => source.guide).join('\n');
  if (mode !== 'skills') return { connectionSlug: 'approval-fixture', model: 'approval-fixture', localSources, systemPrompt };
  const slug = 'artist-belief-system';
  setGlobalSkillEnabled(root, slug, true);
  savePersonalInstruction(root, slug, { scope: 'workspace', text: 'SKILL_PERSONAL_NATIVE_READ keep the answer concise.' });
  type Dependencies = NonNullable<Parameters<typeof createDurableWorkflowBundleResolver>[0]>;
  const resolver = createDurableWorkflowBundleResolver({
    getWorkspaceByNameOrId: () => binding.workspace,
    loadGlobalAgent: () => ({ slug: 'reader', metadata: { name: 'Reader', description: '', skills: [slug] } }),
    loadWorkspaceConfig: () => ({ defaults: { permissionMode: 'safe', thinkingLevel: 'off' } }),
    resolveBackendContext: () => binding.context,
    getDefaultThinkingLevel: () => 'off', loadConfigDefaults: () => ({ workspaceDefaults: { permissionMode: 'safe' } }),
  } as unknown as Dependencies);
  return resolver(binding.workspace.id, 'reader', { customSystemPrompt: systemPrompt, model: 'approval-fixture', llmConnection: 'approval-fixture',
    agentSkillSlugs: [slug], launchReceipt: { injected: { skills: [slug] } } } as Parameters<typeof resolver>[2]);
};
const folder = join(root, 'app/packages/pi-agent-server/dist'); mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'index.js'), `import ${JSON.stringify(resolve(import.meta.dir, '../../../../../pi-agent-server/src/index.ts'))};\n`);
const resolveBinding = (_workspace: string, slug: string, model: string) => ({ ...binding, context: { ...binding.context, resolvedModel: model, connection: { ...binding.context.connection!, slug } } });
const host = DurableWorkflowHost.open({ configRoot: join(root, 'config'), protection: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, resolvePrincipal: () => 'fixture-principal', runnerOptions: {
  authorizeRun: () => {},
  ...(mode === 'connected' ? { connectedReads: { bindingResolver: connectedResolver, transport: async (_binding: unknown, url: string, isAuthorized: () => boolean) => {
    if (url !== connectedUrl || !isAuthorized()) throw new Error('unexpected-connected-dispatch');
    appendFileSync(join(root, 'connected-dispatches'), 'read\n');
    return { ok: true as const, data: { name: 'CONNECTED_READ_CONTEXT' } };
  } } } : {}),
  hostRuntime: { appRootPath: join(root, 'app'), isPackaged: false, nodeRuntimePath: process.execPath }, providerRetryDelayMs: 5, resolveBinding,
  readPolicyRevision: workspaceRoot => readDurablePolicyRevision(join(root, 'config'), workspaceRoot),
  authorizeTool: createDurableReadAuthorization({ configRoot: join(root, 'config'), resolveBinding, assertRunPrincipal(workspaceId, principalId) {
    if (workspaceId !== 'approval-workspace' || principalId !== 'fixture-principal') throw new Error('fixture-principal-mismatch');
  } }),
} });
try {
  const runner = new WorkflowRunner({ durableStart: createDurableWorkflowStart({ resolveFallbackCandidates: async () => [{ connectionSlug: 'backup-fixture', model: 'backup-fixture' }], host, getWorkspaceRootPath: () => root, resolveBundle }),
    getWorkspaceRootPath: () => root, createSession: async () => { throw new Error('legacy-session-forbidden'); }, sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {},
  });
  const actor = { clientId: 'fixture-client', workspaceId: 'approval-workspace' };
  const state = await runner.start({ invocation: 'manual-ui', actor, workspaceId: actor.workspaceId, triggerInputs: mode === 'inputs' ? { file: 'fixture.txt' } : {}, workflow: { slug: 'approval-fixture', path: root, source: 'global', body: '', metadata: { execution: 'durable-local-read' as const, ...(mode === 'connected' ? { connectedReads: [{ sourceSlug: 'account', url: connectedUrl }] } : {}), name: 'Fixture', description: '', trigger: { type: 'manual', ...(mode === 'inputs' ? { inputs: [{ name: 'file', type: 'string' as const, required: true }] } : {}) }, outputs: { mode: 'none' }, steps: [{ id: 'read', agent: 'reader', ...(['fallback', 'credits'].includes(mode) ? { modelRole: 'fast' as const } : {}), ...(mode === 'structured' ? { outputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } } } : {}), input: mode === 'inputs' ? 'INPUT_FIXTURE Read {{trigger.file}}.' : 'Read fixture.txt.' }, ...(mode === 'multi' ? [{ id: 'second', agent: 'reader', input: 'Use {{steps.read.output}} and read fixture.txt again.' }] : [])] } } });
  console.log(JSON.stringify({ barrier: 'admitted', runId: state.id, state: state.state }));
  for (let i = 0; i < 1000; i++) {
    const current = await host.runs.get(actor.workspaceId, state.id, actor);
    if (current?.state === 'succeeded') { console.log(JSON.stringify({ result: current.state, runId: current.id, providerAttempts: current.durable?.providerAttempts, steps: current.steps.map(step => ({ id: step.id, state: step.state, output: step.output })) })); break; }
    if (current?.state === 'failed') throw new Error(JSON.stringify(current));
    if (i === 999) throw new Error('completion-timeout');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
} finally { await host.close(); }

/** Journal attention bridge with actual host/factory/Pi approval recovery, only in supervisor-owned synthetic configuration. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { durableCredentialIdentity } from '../../../../../shared/src/protocol/durable-execution.ts';
import { getCredentialManager } from '../../../../../shared/src/credentials/manager.ts';
import { DurableWorkflowControls } from '../../durable-workflow-controls.ts';
import { DurableReadRunner, type DurableReadBinding } from '../../durable-read-runner.ts';

const [root, endpoint, stage] = process.argv.slice(2) as [string, string, string];
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
const journal = new DurableJournal({ configRoot: join(root, 'config'), key: Buffer.from(process.env.APPROVAL_TEST_KEY!, 'hex') });
const input = JSON.parse(readFileSync(join(root, 'input.json'), 'utf8'));
const runner = new DurableReadRunner({ journal, hostRuntime: { appRootPath: join(root, 'app'), isPackaged: false, nodeRuntimePath: process.execPath }, resolveBinding: () => binding,
  authorizeTool: async () => {
    const policy = JSON.parse(readFileSync(join(root, 'policy.json'), 'utf8'));
    return { principalId: 'fixture-principal', policyRevision: policy.revision, credentialIdentity: identity, allowed: policy.allowed, requiresApproval: true, approvalExpiresAt: policy.expiresAt };
  },
});
try {
  if (stage === 'start') {
    const state = await runner.startWorkflow({ slug: 'approval-fixture', path: root, source: 'global', body: '', metadata: { name: 'Fixture', description: '', trigger: { type: 'manual' }, outputs: { mode: 'none' }, steps: [{ id: 'read', agent: 'reader', input: 'Read fixture.txt.' }] } }, input);
    console.log(JSON.stringify({ barrier: 'waiting', state }));
    await new Promise(() => setInterval(() => {}, 1000));
  } else if (stage === 'approve-stop') {
    // Stop after the authoritative decision commit. Recovery uses the real runner below.
    const attention = new DurableWorkflowControls({ journal, runner: { decide: async command => ({ receipt: journal.decide(command) }) }, resolvePrincipal: (_workspace, actor) => {
      if (actor.clientId !== 'fixture-client') throw new Error('unknown-actor');
      return 'fixture-principal';
    } });
    const actor = { clientId: 'fixture-client', workspaceId: input.workspaceId };
    const item = (await attention.listAttention(input.workspaceId, actor, input.runId))[0]!;
    if (!item.durable?.reviewable || JSON.stringify(item.toolCall.args) !== JSON.stringify({ path: join(root, 'fixture.txt') })) throw new Error('exact-review-input-missing');
    const command = { commandId: 'approve-command', expectedVersion: item.durable.version };
    const receipt = await attention.resolveAttention(input.workspaceId, item.id, 'approved', command, actor);
    const duplicate = await attention.resolveAttention(input.workspaceId, item.id, 'approved', command, actor);
    if (duplicate.status !== 'approved' || receipt.status !== 'approved') throw new Error('decision-not-saved');
    console.log(JSON.stringify({ barrier: 'approved', receipt }));
    await new Promise(() => setInterval(() => {}, 1000));
  } else {
    const state = await runner.resume(input.runId, input.workspaceId);
    console.log(JSON.stringify({ result: state.status, state }));
  }
} finally { journal.close(); }

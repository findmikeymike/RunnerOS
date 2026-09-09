/** Actual host/factory/Pi ordered steering recovery, only in supervisor-owned synthetic configuration. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { durableCredentialIdentity } from '../../../../../shared/src/protocol/durable-execution.ts';
import { getCredentialManager } from '../../../../../shared/src/credentials/manager.ts';
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
if (stage === 'resume-boundary-stop' || stage === 'start-late-boundary') {
  const original = journal.bridge.bind(journal);
  journal.bridge = (...args) => {
    const bridge = original(...args);
    return { ...bridge, checkpoint: async request => {
      const reply = await bridge.checkpoint(request);
      if (stage === 'start-late-boundary' && request.kind === 'turn-boundary' && request.turn === 0 && !journal.get(input.runId, input.workspaceId).steering?.length) {
        for (const [index, text] of ['Focus on radio first.', 'Only local stations.'].entries()) {
          journal.steer({ runId: input.runId, workspaceId: input.workspaceId, commandId: `late-${index}`, expectedVersion: journal.get(input.runId, input.workspaceId).version, action: 'steer', text });
        }
      }
      if (stage === 'resume-boundary-stop' && request.kind === 'turn-boundary' && reply.steering?.length) {
        console.log(JSON.stringify({ barrier: 'steering-applied', steering: reply.steering }));
        await new Promise(() => setInterval(() => {}, 1000));
      }
      return reply;
    } };
  };
}
const runner = new DurableReadRunner({ journal, hostRuntime: { appRootPath: join(root, 'app'), isPackaged: false, nodeRuntimePath: process.execPath }, resolveBinding: () => binding,
  authorizeTool: async () => {
    const policy = JSON.parse(readFileSync(join(root, 'policy.json'), 'utf8'));
    return { principalId: 'fixture-principal', policyRevision: policy.revision, credentialIdentity: identity, allowed: policy.allowed, requiresApproval: stage !== 'start-late-boundary', approvalExpiresAt: policy.expiresAt };
  },
});
try {
  if (stage === 'start' || stage === 'start-late-boundary') {
    const state = await runner.startWorkflow({ slug: 'approval-fixture', path: root, source: 'global', body: '', metadata: { name: 'Fixture', description: '', trigger: { type: 'manual' }, outputs: { mode: 'none' }, steps: [{ id: 'read', agent: 'reader', input: 'Read fixture.txt.' }] } }, input);
    if (stage === 'start-late-boundary') console.log(JSON.stringify({ result: state.status, state }));
    else {
      console.log(JSON.stringify({ barrier: 'waiting', state }));
      await new Promise(() => setInterval(() => {}, 1000));
    }
  } else if (stage === 'steer-stop') {
    const receipts = [];
    for (const [index, text] of ['Focus on radio first.', 'Only local stations.'].entries()) {
      const state = journal.get(input.runId, input.workspaceId);
      const command = { runId: input.runId, workspaceId: input.workspaceId, commandId: `steer-${index}`, expectedVersion: state.version, action: 'steer' as const, text };
      const receipt = journal.steer(command);
      assert.deepEqual(journal.steer(command), receipt);
      receipts.push(receipt);
    }
    console.log(JSON.stringify({ barrier: 'steering-saved', receipts }));
    await new Promise(() => setInterval(() => {}, 1000));
  } else if (stage === 'approve-stop') {
    const state = journal.get(input.runId, input.workspaceId);
    const approval = state.approvals!.find(item => item.status === 'pending')!;
    const receipt = journal.decide({ runId: input.runId, workspaceId: input.workspaceId, commandId: 'approve-command', expectedVersion: state.version, action: 'approve', approvalId: approval.id, inputDigest: approval.inputDigest, principalId: approval.principalId, policyRevision: approval.policyRevision, credentialIdentity: approval.credentialIdentity });
    console.log(JSON.stringify({ barrier: 'approved', receipt }));
    await new Promise(() => setInterval(() => {}, 1000));
  } else {
    const state = await runner.resume(input.runId, input.workspaceId);
    console.log(JSON.stringify({ result: state.status, state }));
  }
} finally { journal.close(); }

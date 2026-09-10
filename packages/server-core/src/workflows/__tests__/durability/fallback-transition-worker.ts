import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution';
import { DurableReadRunner, type DurableReadBinding } from '../../durable-read-runner';
const [root, mode] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'fallback-test') throw new Error('fixture-required');
const journal = new DurableJournal({ configRoot: root, key: Buffer.alloc(32, 7) });
const runId = 'abcd0000-1234-4567-8888-123456789abc';
const runner = new DurableReadRunner({ journal, hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: (_ws, slug, model): DurableReadBinding => ({
  credentialIdentity: 'a'.repeat(64), workspace: { id: 'w', name: 'test', slug: 'test', rootPath: root, createdAt: 1 },
  context: { provider: 'pi', resolvedModel: model, authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug, name: slug, providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } },
}), createBackend: args => ({ async *chat() {
  const bridge = args.coreConfig.durableExecution!, model = args.coreConfig.model!;
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { model } });
  appendFileSync(join(root, 'calls'), model + '\n');
  if (model === 'primary') { await bridge.fail('429 insufficient_quota'); yield { type: 'error' as const, message: '429 insufficient_quota' }; return; }
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } });
  await bridge.checkpoint({ kind: 'complete' });
}, async abort() {}, destroy() {} }) });
if (mode === 'start') {
  const original = journal.recordProviderFailure.bind(journal);
  journal.recordProviderFailure = (claim, input) => {
    const next = original(claim, input);
    writeFileSync(join(root, 'barrier'), 'saved');
    console.log(JSON.stringify({ barrier: 'provider-failure-saved' }));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
    return next;
  };
  await runner.startWorkflow({ slug: 'test', path: root, source: 'global', body: '', metadata: { name: 'test', description: '', trigger: { type: 'manual' }, outputs: { mode: 'none' }, steps: [{ id: 'read', agent: 'reader', input: 'Read only', modelRole: 'fast' }] } }, {
    runId, commandId: 'start', workspaceId: 'w', connectionSlug: 'one', model: 'primary', systemPrompt: 'Read only', resolvedAgentSlug: 'reader',
    resolvedSteps: [{ id: 'read', agent: 'reader', systemPrompt: 'Read only', modelPlan: { role: 'fast', candidates: [{ connectionSlug: 'one', model: 'primary' }, { connectionSlug: 'two', model: 'backup' }] } }],
    allowedTools: ['read'], maxOutputTokens: 128, maxModelAttempts: 8, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 },
  });
} else {
  const result = await runner.resume(runId, 'w');
  console.log(JSON.stringify({ result: result.status }));
}
journal.close();

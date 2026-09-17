import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DurableJournal, type DurableOperationIntent } from '../../../../../shared/src/durable-execution';
import { DURABLE_RUNTIME_MANIFEST } from '../../../../../shared/src/protocol/durable-execution';
import { loadSource } from '../../../../../shared/src/sources/storage';
import { createDurableConnectedReadBindingResolver, type DurableConnectedReadBinding } from '../../durable-connected-read-binding';
import { createDurableConnectedReadAdapter } from '../../durable-connected-read-adapter';
import { DurableEffectRunner } from '../../durable-effect-runner';

const [root, mode] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'connected-read-fixture') throw new Error('fixture only');
const key = Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex');
const journal = new DurableJournal({ configRoot: root, key });
const sourceResolver = createDurableConnectedReadBindingResolver({
  getWorkspaces: () => [{ id: 'fixture', name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 }], loadSource,
  loadCredential: async () => ({ value: readFileSync(join(root, 'synthetic-token'), 'utf8') }), now: () => Date.now(),
});
const url = 'https://api.example.com/v1/items';
const starting = mode === 'saved' || mode === 'unsaved';
const savedOperation = starting ? undefined : journal.getOperation('run', 'fixture', 'read');
const binding: DurableConnectedReadBinding = starting ? await sourceResolver.capture('fixture', 'account', [url])
  : (savedOperation!.intent.input as any).binding;
const waitForKill = async (barrier: string) => { process.stdout.write(barrier + '\n'); await new Promise(() => setInterval(() => {}, 1000)); };
const adapter = createDurableConnectedReadAdapter(binding, {
  bindingResolver: sourceResolver, isCertifiedRead: candidate => candidate === url, isAuthorized: () => true,
  // Synthetic transport; production DNS/TLS behavior has a separate native HTTPS test.
  transport: async (_binding, _url, authorized) => {
    if (!authorized()) throw new Error('unexpected policy denial');
    appendFileSync(join(root, 'fetches'), 'fetch\n');
    if (mode === 'unsaved') await waitForKill('response-before-save');
    return { ok: true, data: { private: 'PRIVATE_ACCOUNT_RESULT' } };
  },
});
if (starting) journal.admit({ runId: 'run', workspaceId: 'fixture', commandId: 'admit', engine: 'sqlite-v2-readonly-1',
  credentialIdentity: 'a'.repeat(64), runtimeManifest: DURABLE_RUNTIME_MANIFEST, createdAt: Date.now(), deadlineAt: Date.now() + 120000,
  allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 2,
  costPolicy: { unit: 'trusted-upper-bound', maxTotalUnits: 3, maxUnitsPerAttempt: 1 }, authority: {}, context: {} });
const intent: DurableOperationIntent = savedOperation?.intent ?? { slotId: 'read', adapterId: adapter.id, adapterVersion: adapter.version,
  credentialIdentity: adapter.credentialIdentity, effectClass: 'read', idempotencyKey: 'read-once',
  input: { url, binding: JSON.parse(JSON.stringify(binding)) }, outputSchema: { id: adapter.outputSchema.id, version: adapter.outputSchema.version }, maxAttempts: 2, maxUnitsPerAttempt: 1 };
const claim = journal.claim('run', 'fixture');
try {
  const runner = new DurableEffectRunner(journal, [adapter]);
  if (mode === 'rotated') {
    let denied = false;
    try { await runner.execute(claim, intent); } catch (error) { denied = (error as Error).message === 'durable-connected-read-unavailable'; }
    if (!denied) throw new Error('rotated source gained cached data');
  } else {
    let operation = await runner.execute(claim, intent, 'recover-or-start');
    if (mode === 'recover-unsaved') {
      if (operation.status !== 'intent') throw new Error('unsaved read not reconciled');
      if (readFileSync(join(root, 'fetches'), 'utf8') !== 'fetch\n') throw new Error('reconciliation fetched data');
      operation = await runner.execute(claim, intent, 'separate-retry');
    }
    if (operation.status !== 'succeeded') throw new Error('read not complete');
    if (mode === 'saved') await waitForKill('response-saved');
  }
  process.stdout.write('recovery-verified\n');
} finally { journal.release(claim); journal.close(); }

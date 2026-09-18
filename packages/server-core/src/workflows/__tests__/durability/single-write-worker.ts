import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution';
import { DurableEffectRunner } from '../../durable-effect-runner';
import { createDurableSingleAttemptWriteAdapter } from '../../durable-single-attempt-write';
const [root, action] = process.argv.slice(2) as [string, string];
if (readFileSync(join(root, 'synthetic-only'), 'utf8') !== 'single-write-fixture') throw new Error('synthetic-fixture-required');
const journal = new DurableJournal({ configRoot: root, key: Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex') });
const claim = journal.claim('run', 'workspace');
const intent = { slotId: 'send', adapterId: 'fixture-send', adapterVersion: '1', credentialIdentity: 'a'.repeat(64), effectClass: 'single-attempt-write' as const,
  idempotencyKey: 'local-only', input: { message: 'synthetic fixture' }, outputSchema: { id: 'receipt', version: '1' }, maxAttempts: 1, maxUnitsPerAttempt: 1 };
const adapter = createDurableSingleAttemptWriteAdapter({ id: intent.adapterId, version: '1', workspaceId: 'workspace', credentialIdentity: intent.credentialIdentity,
  outputSchema: { ...intent.outputSchema, validate: () => true }, authorize() {}, assertAuthorized() {}, async invoke(_input, guard) {
    guard(); appendFileSync(join(root, 'external-writes'), 'sent\n');
    console.log(JSON.stringify({ barrier: 'accepted' }));
    if (action === 'dispatch') await new Promise(() => { setInterval(() => {}, 1000); });
    return { receipt: 'unexpected-replay' };
  } });
try { const result = await new DurableEffectRunner(journal, [adapter]).execute(claim, intent); console.log(JSON.stringify({ status: result.status })); }
finally { journal.release(claim); journal.close(); }

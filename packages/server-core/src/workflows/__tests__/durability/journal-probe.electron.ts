/** Production journal binding proof in a copied runtime, with a disposable injected test key. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../../../../../shared/src/protocol/durable-execution.ts';
const { app } = require('electron') as typeof import('electron');
const root = process.env.DURABILITY_FIXTURE_ROOT!;
app.setName('Artist OS Production Journal Fixture');
app.setPath('userData', join(root, 'electron-user-data'));
app.setPath('sessionData', join(root, 'electron-session-data'));
app.dock?.hide();
void app.whenReady().then(async () => {
  let journal: DurableJournal | undefined;
  try {
    assert.equal(app.isPackaged, true);
    assert.equal(process.versions.bun, undefined);
    const key = Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex');
    journal = new DurableJournal({ configRoot: root, key });
    if (process.env.DURABILITY_FIXTURE_STAGE === 'write') {
      journal.admit({ engine: 'sqlite-v2-readonly-1', credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, runId: 'packaged-production', workspaceId: 'fixture', commandId: 'admit', createdAt: Date.now(), allowedTools: ['read'], model: 'simulator', maxOutputTokens: 100, authority: { testOnly: true }, context: { prompt: 'ENCRYPTED_PRODUCTION_JOURNAL_PAYLOAD' }, deadlineAt: Date.now() + 60000, maxModelAttempts: 3, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } });
      const bridge = journal.bridge(journal.claim('packaged-production', 'fixture'));
      await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'committed' }], stopReason: 'stop' } });
      console.log(JSON.stringify({ barrier: 'electron-committed' }));
      setTimeout(() => app.exit(91), 30000);
      return;
    }
    const recovered = journal.get('packaged-production', 'fixture');
    assert.equal((recovered.spec.context as { prompt: string }).prompt, 'ENCRYPTED_PRODUCTION_JOURNAL_PAYLOAD');
    const claim = journal.claim('packaged-production', 'fixture');
    assert.equal(claim.epoch, 2);
    const bridge = journal.bridge(claim);
    const replay = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
    assert.equal((replay.cached as { role: string }).role, 'assistant');
    await bridge.checkpoint({ kind: 'complete' });
    assert.equal(journal.get('packaged-production', 'fixture').status, 'succeeded');
    const destination = join(root, 'quarantined.sqlite');
    journal.backup(destination);
    console.log(JSON.stringify({ result: 'pass', implementation: 'production-journal', packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node, epoch: claim.epoch, cachedModelReused: true, complete: true, backupQuarantined: true, keyProtection: 'injected-test-key-not-OS-keychain-certification' }));
    journal.close(); app.exit(0);
  } catch (error) { console.error(error); journal?.close(); app.exit(1); }
});

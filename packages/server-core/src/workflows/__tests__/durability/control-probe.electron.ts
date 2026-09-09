/** Pause/resume storage proof in a copied packaged runtime with an injected disposable key. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../../../../../shared/src/protocol/durable-execution.ts';
const { app } = require('electron') as typeof import('electron');
const root = process.env.DURABILITY_FIXTURE_ROOT!;
app.setName('Artist OS Durable Control Fixture');
app.setPath('userData', join(root, 'electron-user-data'));
app.setPath('sessionData', join(root, 'electron-session-data'));
app.dock?.hide();
void app.whenReady().then(async () => {
  let journal: DurableJournal | undefined;
  try {
    assert.equal(app.isPackaged, true);
    journal = new DurableJournal({ configRoot: root, key: Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex') });
    const pause = { runId: 'controls', workspaceId: 'fixture', commandId: 'pause', expectedVersion: 3, action: 'pause' as const };
    if (process.env.DURABILITY_FIXTURE_STAGE === 'write') {
      journal.admit({ engine: 'sqlite-v2-readonly-1', credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, runId: 'controls', workspaceId: 'fixture', commandId: 'admit', createdAt: Date.now(), allowedTools: ['read'], model: 'simulator', maxOutputTokens: 100, authority: { testOnly: true }, context: {}, deadlineAt: Date.now() + 60000, maxModelAttempts: 3, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } });
      const bridge = journal.bridge(journal.claim('controls', 'fixture'));
      await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'SAVED_BEFORE_PAUSE' }], stopReason: 'stop' } });
      assert.equal(journal.command(pause).status, 'paused');
      console.log(JSON.stringify({ barrier: 'electron-committed' }));
      setTimeout(() => app.exit(91), 30000); return;
    }
    assert.equal(journal.get('controls', 'fixture').status, 'paused');
    assert.throws(() => journal!.claim('controls', 'fixture'), /paused/);
    const duplicate = journal.command(pause);
    assert.equal(duplicate.version, 4);
    journal.command({ ...pause, commandId: 'resume', expectedVersion: 4, action: 'resume' });
    const claim = journal.claim('controls', 'fixture');
    assert.equal(claim.epoch, 2); assert.equal(claim.controlRevision, 2);
    const bridge = journal.bridge(claim);
    const replay = await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
    assert.match(JSON.stringify(replay.cached), /SAVED_BEFORE_PAUSE/);
    await bridge.checkpoint({ kind: 'complete' });
    assert.equal(journal.get('controls', 'fixture').status, 'succeeded');
    journal.release(claim);
    console.log(JSON.stringify({ result: 'pass', implementation: 'durable-control', packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node, pausedAfterSIGKILL: true, duplicateReceipt: true, epoch: claim.epoch, controlRevision: claim.controlRevision, cachedModelReused: true }));
    journal.close(); app.exit(0);
  } catch (error) { console.error(error); journal?.close(); app.exit(1); }
});

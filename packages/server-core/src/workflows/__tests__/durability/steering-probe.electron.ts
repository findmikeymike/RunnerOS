/** Packaged steering persistence proof: synthetic authority and injected test key only. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST, type DurableSteeringCommand } from '../../../../../shared/src/protocol/durable-execution.ts';
const { app } = require('electron') as typeof import('electron');
const root = process.env.DURABILITY_FIXTURE_ROOT!;
app.setName('Artist OS Steering Fixture'); app.setPath('userData', join(root, 'electron-user-data')); app.setPath('sessionData', join(root, 'electron-session-data')); app.dock?.hide();
void app.whenReady().then(async () => {
  let journal: DurableJournal | undefined;
  try {
    assert.equal(app.isPackaged, true);
    journal = new DurableJournal({ configRoot: root, key: Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex') });
    const identity = 'a'.repeat(64);
    const authorization = { authorizeTool: async () => ({ principalId: 'fixture-principal', policyRevision: 'one', credentialIdentity: identity, allowed: true, requiresApproval: true, approvalExpiresAt: Date.now() + 60000 }) };
    const request = { kind: 'tool-start' as const, turn: 0, callId: 'read', tool: 'read', input: { path: 'fixture.txt' } };
    if (process.env.DURABILITY_FIXTURE_STAGE === 'write') {
      journal.admit({ engine: 'sqlite-v2-readonly-1', credentialIdentity: identity, runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, approvalPrincipalId: 'fixture-principal', runId: 'approval', workspaceId: 'fixture', commandId: 'admit', createdAt: Date.now(), allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, authority: {}, context: {}, deadlineAt: Date.now() + 60000, maxModelAttempts: 3, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 } });
      const bridge = journal.bridge(journal.claim('approval', 'fixture'), authorization);
      await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'fixture.txt' } }], stopReason: 'toolUse' } });
      await assert.rejects(bridge.checkpoint(request), /approval-required/);
      assert.equal(journal.get('approval', 'fixture').status, 'waiting-approval');
      for (const [index, text] of ['Focus on radio.', 'Only local stations.'].entries()) {
        const command: DurableSteeringCommand = { runId: 'approval', workspaceId: 'fixture', commandId: `steer-${index}`, expectedVersion: journal.get('approval', 'fixture').version, action: 'steer' as const, text };
        assert.deepEqual(journal.steer(command), journal.steer(command));
      }
      console.log(JSON.stringify({ barrier: 'electron-committed' })); setTimeout(() => app.exit(91), 30000); return;
    }
    const state = journal.get('approval', 'fixture');
    assert.equal(state.status, 'running');
    assert.equal(state.approvals![0]!.status, 'superseded');
    const claim = journal.claim('approval', 'fixture'); assert.equal(claim.epoch, 2);
    const bridge = journal.bridge(claim, authorization);
    assert.ok((await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } })).cached);
    assert.equal((await bridge.checkpoint({ kind: 'tool-disposition', turn: 0, callId: 'read', tool: 'read' })).skipped, true);
    assert.equal(journal.get('approval', 'fixture').turns[0]!.calls[0]!.attempts, 0);
    const selected = await bridge.checkpoint({ kind: 'turn-boundary', turn: 0 });
    assert.deepEqual(selected.steering?.map(entry => entry.text), ['Focus on radio.', 'Only local stations.']);
    assert.deepEqual(await bridge.checkpoint({ kind: 'turn-boundary', turn: 0 }), selected);
    await bridge.checkpoint({ kind: 'model-start', turn: 1, context: { messages: [] } });
    await bridge.checkpoint({ kind: 'model-result', turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } });
    await bridge.checkpoint({ kind: 'complete' });
    assert.equal(journal.get('approval', 'fixture').status, 'succeeded'); journal.release(claim);
    console.log(JSON.stringify({ result: 'pass', implementation: 'durable-steering', packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node, commandsSurvivedSIGKILL: true, orderedDelivery: true, skippedWithoutDispatch: true, epoch: claim.epoch }));
    journal.close(); app.exit(0);
  } catch (error) { console.error(error); journal?.close(); app.exit(1); }
});

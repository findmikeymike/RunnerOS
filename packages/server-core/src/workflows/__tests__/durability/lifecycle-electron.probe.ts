/** Actual OS-backed key protection + production host lifetime; synthetic checkpoint backend, no provider credentials. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DurableWorkflowHost } from '../../durable-workflow-host.ts';
import type { DurableReadInput, DurableReadRunnerOptions } from '../../durable-read-runner.ts';
const { app, safeStorage } = require('electron') as typeof import('electron');
const root = process.env.DURABILITY_FIXTURE_ROOT!;
console.log(JSON.stringify({ barrier: 'electron-probe-loaded' }));
app.setName('Artist OS Lifecycle Fixture');
app.setPath('userData', join(root, 'electron-user-data'));
app.setPath('sessionData', join(root, 'electron-session-data'));
app.dock?.hide();
void app.whenReady().then(async () => {
  try {
    console.log(JSON.stringify({ barrier: 'electron-ready-before-safeStorage-availability' }));
    assert.equal(app.isPackaged, true);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS safeStorage unavailable; lifecycle proof blocked');
    const input: DurableReadInput = { runId: 'ad013936-7037-4ac0-938f-b42c5b139e33', commandId: 'admit', workspaceId: 'fixture', connectionSlug: 'synthetic', model: 'synthetic', prompt: 'Synthetic lifetime checkpoint', systemPrompt: 'Synthetic test only', allowedTools: ['read'], maxOutputTokens: 100, maxModelAttempts: 4, deadlineAt: Number(process.env.DURABILITY_FIXTURE_DEADLINE), costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 }, approvalPrincipalId: 'fixture-principal' };
    let ready!: () => void, finish!: () => void, backends = 0;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const drain = new Promise<void>(resolve => { finish = resolve; });
    const runnerOptions: Omit<DurableReadRunnerOptions, 'journal'> = {
      hostRuntime: { appRootPath: root, isPackaged: true },
      resolveBinding: () => ({ credentialIdentity: 'a'.repeat(64), workspace: { id: 'fixture', name: 'fixture', slug: 'fixture', rootPath: root, createdAt: 1 }, context: { provider: 'pi', resolvedModel: 'synthetic', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'synthetic', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } }),
      createBackend: args => ({ async *chat() {
        backends++;
        if (process.env.DURABILITY_FIXTURE_STAGE === 'write') { ready(); await drain; return; }
        const bridge = args.coreConfig.durableExecution!;
        await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
        await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'synthetic completion' }], stopReason: 'stop' } });
        await bridge.checkpoint({ kind: 'complete' });
      }, async abort() { throw new Error('Quiesce must not cancel'); }, destroy() {} }),
    };
    const open = () => DurableWorkflowHost.open({ configRoot: join(root, 'config'), protection: safeStorage, runnerOptions, resolvePrincipal: () => 'fixture-principal' });
    console.log(JSON.stringify({ barrier: 'before-real-safeStorage-open', encryptionAvailable: safeStorage.isEncryptionAvailable() }));
    let host = open();
    console.log(JSON.stringify({ barrier: 'real-safeStorage-opened' }));
    if (process.env.DURABILITY_FIXTURE_STAGE === 'write') {
      const running = host.start(input); await started;
      const closing = host.close();
      await assert.rejects(host.start(input), /durable-host-closing/);
      finish(); assert.equal((await running).status, 'paused'); await closing;
      console.log(JSON.stringify({ result: 'closed-paused', keyProtection: 'actual-electron-safeStorage' }));
    } else {
      const state = await host.start(input); assert.equal(state.status, 'paused');
      await host.controls.control('fixture', input.runId, { action: 'resume', commandId: 'resume', expectedVersion: state.version }, { clientId: 'fixture-client', workspaceId: 'fixture' });
      assert.equal((await host.start(input)).status, 'succeeded'); await host.close();
      host = open(); assert.equal((await host.start(input)).status, 'succeeded'); await host.close();
      assert.equal(backends, 1);
      console.log(JSON.stringify({ result: 'pass', packaged: app.isPackaged, electron: process.versions.electron, keyProtection: 'actual-electron-safeStorage', separateProcessReopen: true, hostPausedAndDrained: true, completedReplayNoBackend: true, backend: 'synthetic-checkpoints-no-Pi-or-provider-proof' }));
    }
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});

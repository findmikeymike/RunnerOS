import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableJournal, loadDurableKey, type DurableSafeStorage } from '../../../shared/src/durable-execution/index.ts';
import { DurableWorkflowHost } from './durable-workflow-host.ts';
import { durableChildRunId, type DurableChildRequest } from './durable-child-runner.ts';
import type { DurableReadInput, DurableReadBinding } from './durable-read-runner.ts';
const protection: DurableSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`fixture:${value}`), decryptString: value => { const text = value.toString(); if (!text.startsWith('fixture:')) throw new Error('invalid fixture envelope'); return text.slice(8); } };
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-host-child-'));
  const parentReady = gate(), childReady = gate(), parentDrain = gate(), childDrain = gate();
  const destroyed: string[] = [], aborts: string[] = [];
  const input: DurableReadInput = { runId: '11111111-1111-4111-8111-111111111111', commandId: 'parent', workspaceId: 'w', connectionSlug: 'fixture', model: 'model', prompt: 'Parent', systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 100, maxModelAttempts: 6, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'verified-free', maxTotalUnits: 0, maxUnitsPerAttempt: 0 }, approvalPrincipalId: 'alice' };
  const request: DurableChildRequest = { slotId: 'child', mode: 'required', prompt: 'Child', systemPrompt: 'Read only', allowedTools: ['read'], maxOutputTokens: 100, maxModelAttempts: 2, deadlineAt: input.deadlineAt, costPolicy: input.costPolicy, outputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } };
  const binding: DurableReadBinding = { credentialIdentity: 'a'.repeat(64), workspace: { id: 'w', name: 'fixture', slug: 'fixture', rootPath: root, createdAt: 1 }, context: { provider: 'pi', resolvedModel: 'model', authType: 'api_key', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'fixture', name: 'fixture', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } } };
  const host = DurableWorkflowHost.open({ configRoot: root, protection, resolvePrincipal: () => 'alice', runnerOptions: {
    hostRuntime: { appRootPath: root, isPackaged: false }, resolveBinding: () => binding,
    createBackend: args => {
      const id = args.coreConfig.durableExecution!.descriptor.runId, parent = id === input.runId;
      return { async *chat() {
        const bridge = args.coreConfig.durableExecution!;
        await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
        (parent ? parentReady : childReady).release(); await (parent ? parentDrain : childDrain).promise;
        await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: parent ? 'parent done' : '{"summary":"child done"}' }] } });
        await bridge.checkpoint({ kind: 'complete' });
      }, async abort() { aborts.push(id); if (parent) parentDrain.release(); }, destroy() { destroyed.push(id); } };
    },
  } });
  const key = loadDurableKey(root, protection), observer = new DurableJournal({ configRoot: root, key }); key.fill(0);
  return { root, host, observer, input, request, parentReady, childReady, parentDrain, childDrain, destroyed, aborts,
    async cleanup() { parentDrain.release(); childDrain.release(); await host.close().catch(() => {}); observer.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('real host close pauses required parent and child, then waits for both backends before storage closes', async () => {
  const f = fixture();
  try {
    const parent = f.host.start(f.input); await f.parentReady.promise;
    const child = f.host.startChild(f.input.runId, 'w', f.request); await f.childReady.promise;
    const id = durableChildRunId('w', f.input.runId, 'child');
    let closed = false; const closing = f.host.close().then(() => { closed = true; });
    expect(f.observer.get(f.input.runId, 'w').status).toBe('paused'); expect(f.observer.get(id, 'w').status).toBe('paused');
    await expect(f.host.startChild(f.input.runId, 'w', f.request)).rejects.toThrow('durable-host-closing');
    f.parentDrain.release(); expect((await parent).status).toBe('paused');
    expect(closed).toBe(false); expect(f.destroyed).toEqual([f.input.runId]); expect(f.aborts).toEqual([]);
    f.childDrain.release(); expect((await child).status).toBe('waiting'); await closing;
    expect(f.destroyed).toContain(id); expect(f.observer.get(id, 'w').turns[0]!.message).toBeDefined();
    expect(f.observer.get(f.input.runId, 'w').children![0]!.status).toBe('admitted');
  } finally { await f.cleanup(); }
});

for (const mode of ['required', 'detached'] as const) test(`real host parent cancellation and close retain ${mode} child lifecycle ownership`, async () => {
  const f = fixture();
  try {
    const parent = f.host.start(f.input); await f.parentReady.promise;
    const child = f.host.startChild(f.input.runId, 'w', { ...f.request, mode }); void child.catch(() => {}); await f.childReady.promise;
    const id = durableChildRunId('w', f.input.runId, 'child');
    const cancelled = await f.host.controls.control('w', f.input.runId, { action: 'cancel', commandId: 'cancel-parent', expectedVersion: f.observer.get(f.input.runId, 'w').version }, { clientId: 'client', workspaceId: 'w' });
    expect(cancelled.state.status).toBe('cancelled'); expect(f.observer.get(id, 'w').status).toBe(mode === 'required' ? 'cancelled' : 'running');
    expect((await parent).status).toBe('cancelled');
    let closed = false; const closing = f.host.close().then(() => { closed = true; });
    expect(f.observer.get(id, 'w').status).toBe(mode === 'required' ? 'cancelled' : 'paused'); expect(closed).toBe(false);
    f.childDrain.release();
    if (mode === 'required') await expect(child).rejects.toThrow('child-cancelled'); else expect((await child).status).toBe('detached');
    await closing; expect(f.destroyed).toContain(id); expect(f.observer.get(f.input.runId, 'w').status).toBe('cancelled');
  } finally { await f.cleanup(); }
});

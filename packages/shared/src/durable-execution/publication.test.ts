import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DurableJournal, type DurableRunSpec } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function fixture(steps = false) {
 const root = mkdtempSync(join(tmpdir(), 'publication-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
 const journal = new DurableJournal({ configRoot: root, key: randomBytes(32) }); cleanup.push(() => journal.close());
 const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: 'r', workspaceId: 'w', commandId: 'admit', createdAt: Date.now(), credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 2, authority: {}, context: {}, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'model-requests', maxTotalUnits: 2, maxUnitsPerAttempt: 1 }, publication: { outputId: randomUUID(), kind: 'report', title: 'Report', stepId: 'final' }, ...(steps ? { workflowSteps: [{ id: 'final' }] } : {}) };
 return { journal, spec };
}
async function pending(f: ReturnType<typeof fixture>) {
 f.journal.admit(f.spec); const claim = f.journal.claim('r', 'w'), bridge = f.journal.bridge(claim);
 if (f.spec.workflowSteps) await bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: {} });
 await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
 await bridge.checkpoint({ kind: 'model-result', turn: 0, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Saved result' }] } });
 await bridge.checkpoint(f.spec.workflowSteps ? { kind: 'workflow-step-complete', step: 0 } : { kind: 'complete' });
 return { bridge, claim };
}
for (const steps of [false, true]) test(`publication is atomic with completion, stable on replay, and costs no model requests (${steps})`, async () => {
 const f = fixture(steps), { bridge } = await pending(f);
 const before = f.journal.get('r', 'w'); expect(before.status).toBe('running'); expect(before.publication).toEqual({ status: 'pending', content: 'Saved result', outputId: f.spec.publication!.outputId });
 if (steps) expect(before.workflowSteps![0]!.output).toBe('Saved result');
 await bridge.checkpoint(steps ? { kind: 'workflow-step-complete', step: 0 } : { kind: 'complete' });
 expect(f.journal.get('r', 'w')).toEqual(before);
 await expect(bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} })).rejects.toThrow('publication-model-finished');
 expect(() => f.journal.steer({ runId: 'r', workspaceId: 'w', commandId: 'steer', action: 'steer', expectedVersion: before.version, text: 'Too late' })).toThrow('publication-model-finished');
 await expect(bridge.checkpoint({ kind: 'output-published', outputId: randomUUID() })).rejects.toThrow('publication-mismatch');
 await bridge.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId });
 const after = f.journal.get('r', 'w'); expect(after.status).toBe('succeeded'); expect(after.publication!.status).toBe('published'); expect(after.modelAttempts).toBe(1); expect(after.reservedUnits).toBe(1);
 await bridge.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId }); expect(f.journal.get('r', 'w')).toEqual(after);
});
test('paused, cancelled and stale workers cannot receipt publication', async () => {
 const f = fixture(), { bridge, claim } = await pending(f);
 const command = (action: 'pause' | 'resume' | 'cancel') => f.journal.command({ action, commandId: randomUUID(), runId: 'r', workspaceId: 'w', expectedVersion: f.journal.get('r', 'w').version });
 command('pause'); await expect(bridge.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId })).rejects.toThrow('paused');
 command('resume'); await expect(bridge.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId })).rejects.toThrow('control-changed');
 f.journal.release(claim); const next = f.journal.bridge(f.journal.claim('r', 'w'));
 await expect(bridge.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId })).rejects.toThrow('stale-owner');
 command('cancel'); await expect(next.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId })).rejects.toThrow('dispatch-blocked');
 expect(f.journal.get('r', 'w').status).toBe('cancelled'); expect(f.journal.get('r', 'w').publication!.status).toBe('pending');
});
test('pending publication can resume and receipt after model deadline without opening model dispatch', async () => {
 const f = fixture(), { claim } = await pending(f); f.journal.release(claim);
 const realNow = Date.now; Date.now = () => f.spec.deadlineAt + 1;
 try {
  f.journal.command({ action: 'pause', commandId: 'pause', runId: 'r', workspaceId: 'w', expectedVersion: f.journal.get('r', 'w').version });
  f.journal.command({ action: 'resume', commandId: 'resume', runId: 'r', workspaceId: 'w', expectedVersion: f.journal.get('r', 'w').version });
  const bridge = f.journal.bridge(f.journal.claim('r', 'w'));
  await expect(bridge.checkpoint({ kind: 'model-start', turn: 1, context: {} })).rejects.toThrow('dispatch-blocked');
  await bridge.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId }); expect(f.journal.get('r', 'w').status).toBe('succeeded');
 } finally { Date.now = realNow; }
});
test('receipt without completed content is rejected', async () => {
 const f = fixture(); f.journal.admit(f.spec); const bridge = f.journal.bridge(f.journal.claim('r', 'w'));
 await expect(bridge.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId })).rejects.toThrow('publication-mismatch'); expect(f.journal.get('r', 'w').status).toBe('running');
});
test('backend failure after completion retains publication for fresh authorized resume', async () => {
 const f = fixture(), { bridge, claim } = await pending(f);
 await bridge.fail('late subprocess failure');
 const paused = f.journal.get('r', 'w');
 expect(paused.status).toBe('paused'); expect(paused.publication?.content).toBe('Saved result');
 await bridge.fail('repeated cleanup failure'); expect(f.journal.get('r', 'w')).toEqual(paused);
 f.journal.release(claim);
 f.journal.command({ action: 'resume', commandId: 'resume', runId: 'r', workspaceId: 'w', expectedVersion: paused.version });
 const next = f.journal.bridge(f.journal.claim('r', 'w'));
 await next.checkpoint({ kind: 'output-published', outputId: f.spec.publication!.outputId });
 expect(f.journal.get('r', 'w').status).toBe('succeeded'); expect(f.journal.get('r', 'w').modelAttempts).toBe(1);
});
test('publication admission validates metadata and the final step', () => {
 for (const patch of [{ outputId: '../file' }, { kind: 'image' }, { title: '' }, { summary: 1 }, { stepId: 'wrong' }, { extra: true }]) {
  const f = fixture(true); expect(() => f.journal.admit({ ...f.spec, publication: { ...f.spec.publication!, ...patch } } as DurableRunSpec)).toThrow('invalid-durable-publication'); expect(f.journal.listInternal('w')).toEqual([]);
 }
});

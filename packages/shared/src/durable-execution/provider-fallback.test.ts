import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal, type DurableRunSpec } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function fixture(maxModelAttempts = 4, fallback = true) {
  const root = mkdtempSync(join(tmpdir(), 'provider-fallback-')), key = randomBytes(32);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let journal = new DurableJournal({ configRoot: root, key });
  cleanup.push(() => journal.close());
  const candidates = [{ model: 'reasoner-a', credentialIdentity: 'a'.repeat(64), connectionSlug: 'a' }, { model: 'reasoner-b', credentialIdentity: 'b'.repeat(64), connectionSlug: 'b' }];
  const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: 'r', workspaceId: 'w', commandId: 'admit', createdAt: Date.now(), credentialIdentity: candidates[0]!.credentialIdentity, runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, allowedTools: ['read'], model: 'reasoner-a', maxOutputTokens: 100, maxModelAttempts, authority: {}, context: {}, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'model-requests', maxTotalUnits: maxModelAttempts, maxUnitsPerAttempt: 1 }, workflowSteps: [{ id: 'a' }, { id: 'b' }], fallbackPlan: { steps: [{ candidates }, { candidates }] } };
  if (!fallback) delete spec.fallbackPlan;
  journal.admit(spec);
  return { spec, get journal() { return journal; }, reopen() { journal.close(); journal = new DurableJournal({ configRoot: root, key }); } };
}
const message = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'saved' }] };

test('provider switch retains abandoned turns, fences late results and completes fresh context across reopen', async () => {
  const f = fixture(); let claim = f.journal.claim('r', 'w'), bridge = f.journal.bridge(claim);
  await bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: 'prompt' });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 0 }); bridge = f.journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { model: 'a' } });
  const oldBridge = bridge;
  claim = f.journal.recordProviderFailure(claim, { step: 0, candidateIndex: 0, code: 'credits-exhausted' });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 1 });
  await expect(oldBridge.checkpoint({ kind: 'model-result', turn: 0, message })).rejects.toThrow('control-changed');
  f.journal.release(claim); f.reopen(); claim = f.journal.claim('r', 'w'); bridge = f.journal.bridge(claim);
  expect(bridge.descriptor.model).toBe('reasoner-b'); expect(bridge.descriptor.credentialIdentity).toBe('b'.repeat(64));
  await bridge.checkpoint({ kind: 'turn-boundary', turn: 0 });
  await bridge.checkpoint({ kind: 'model-start', turn: 1, context: { model: 'b' } });
  await bridge.checkpoint({ kind: 'model-result', turn: 1, message });
  await bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 });
  await bridge.checkpoint({ kind: 'workflow-step-start', step: 1, input: 'second' });
  claim = f.journal.beginStepAttempt(claim, { step: 1, candidateIndex: 1 }); bridge = f.journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 2, context: {} });
  await bridge.checkpoint({ kind: 'model-result', turn: 2, message });
  await bridge.checkpoint({ kind: 'workflow-step-complete', step: 1 });
  const saved = f.journal.get('r', 'w');
  expect(saved.status).toBe('succeeded'); expect(saved.turns).toHaveLength(3);
  expect(saved.turns[0]!.message).toBeUndefined(); expect(saved.modelAttempts).toBe(3);
  expect(saved.providerAttempts?.[0]).toMatchObject({ startTurn: 0, endTurn: 1, error: 'credits-exhausted' });
  expect(saved.workflowSteps?.[0]).toMatchObject({ startTurn: 1, endTurn: 2, output: 'saved' });
});

test('temporary retry retains exact context, blocks early dispatch and is bounded', async () => {
  const f = fixture(); let claim = f.journal.claim('r', 'w');
  await f.journal.bridge(claim).checkpoint({ kind: 'workflow-step-start', step: 0, input: 'prompt' });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 0 });
  await f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
  claim = f.journal.recordProviderFailure(claim, { step: 0, candidateIndex: 0, code: 'rate-limit', retryAt: Date.now() + 40 });
  await expect(f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context: {} })).rejects.toThrow('attempt-blocked');
  await new Promise(resolve => setTimeout(resolve, 50));
  await expect(f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context: { changed: true } })).rejects.toThrow('context-changed');
  await f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
  expect(() => f.journal.recordProviderFailure(claim, { step: 0, candidateIndex: 0, code: 'rate-limit', retryAt: Date.now() + 50 })).toThrow('invalid-provider-retry');
  expect(f.journal.get('r', 'w').turns).toHaveLength(1); expect(f.journal.get('r', 'w').modelAttempts).toBe(2);
});

test('switches cannot reset global budget; exhaustion persists Needs you across reopen', async () => {
  const f = fixture(1); let claim = f.journal.claim('r', 'w');
  await f.journal.bridge(claim).checkpoint({ kind: 'workflow-step-start', step: 0, input: 'prompt' });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 0 });
  await f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
  expect(() => f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 1 })).toThrow('attempt-order');
  claim = f.journal.recordProviderFailure(claim, { step: 0, candidateIndex: 0, code: 'credits-exhausted' });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 1 });
  await expect(f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 1, context: {} })).rejects.toThrow('budget-exhausted');
  claim = f.journal.recordProviderFailure(claim, { step: 0, candidateIndex: 1, code: 'credits-exhausted', exhausted: true });
  f.journal.release(claim); f.reopen();
  const saved = f.journal.get('r', 'w'); expect(saved.status).toBe('paused'); expect(saved.providerAttention).toBe('credits-exhausted'); expect(saved.modelAttempts).toBe(1);
});

test('late abandoned-turn writes are refused even through the replacement bridge', async () => {
  const f = fixture(); let claim = f.journal.claim('r', 'w');
  await f.journal.bridge(claim).checkpoint({ kind: 'workflow-step-start', step: 0, input: 'prompt' });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 0 });
  await f.journal.bridge(claim).checkpoint({ kind: 'model-start', turn: 0, context: {} });
  claim = f.journal.recordProviderFailure(claim, { step: 0, candidateIndex: 0, code: 'credits-exhausted' });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 1 });
  await expect(f.journal.bridge(claim).checkpoint({ kind: 'model-result', turn: 0, message })).rejects.toThrow('attempt-abandoned');
  expect(() => f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 0 })).toThrow('attempt-order');
});

test('pause fences provider transitions and malformed candidate plans never admit', async () => {
  const f = fixture(); let claim = f.journal.claim('r', 'w');
  await f.journal.bridge(claim).checkpoint({ kind: 'workflow-step-start', step: 0, input: 'prompt' });
  claim = f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 0 });
  f.journal.command({ runId: 'r', workspaceId: 'w', commandId: 'pause', action: 'pause', expectedVersion: f.journal.get('r', 'w').version });
  expect(() => f.journal.recordProviderFailure(claim, { step: 0, candidateIndex: 0, code: 'credits-exhausted' })).toThrow();
  expect(() => f.journal.beginStepAttempt(claim, { step: 0, candidateIndex: 1 })).toThrow();
  for (const candidates of [[], [{ model: 'x', credentialIdentity: 'secret', connectionSlug: 'x' }], Array(10).fill(f.spec.fallbackPlan!.steps[0]!.candidates[0])]) {
    expect(() => f.journal.admit({ ...f.spec, runId: 'invalid', commandId: 'invalid', fallbackPlan: { steps: [{ candidates }, { candidates }] } })).toThrow('invalid-durable-fallback-plan');
  }
});

test('schema three upgrades while unopted saved runs retain their dispatch semantics', async () => {
  const f = fixture(4, false);
  const before = f.journal.get('r', 'w');
  (f.journal as any).db.exec('PRAGMA user_version=3');
  f.reopen();
  expect((f.journal as any).db.prepare('PRAGMA user_version').get().user_version).toBe(4);
  expect(f.journal.get('r', 'w')).toEqual(before);
  const bridge = f.journal.bridge(f.journal.claim('r', 'w'));
  await bridge.checkpoint({ kind: 'workflow-step-start', step: 0, input: 'old prompt' });
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} });
  await bridge.checkpoint({ kind: 'model-result', turn: 0, message });
  await bridge.checkpoint({ kind: 'workflow-step-complete', step: 0 });
  expect(f.journal.get('r', 'w').workflowSteps?.[0]?.output).toBe('saved');
});

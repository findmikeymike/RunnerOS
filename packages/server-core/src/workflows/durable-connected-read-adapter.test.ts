import { afterEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableJournal, type DurableOperationIntent } from '../../../shared/src/durable-execution';
import { DURABLE_RUNTIME_MANIFEST } from '../../../shared/src/protocol/durable-execution';
import { DurableEffectRunner } from './durable-effect-runner';
import { createDurableConnectedReadAdapter } from './durable-connected-read-adapter';
import type { DurableConnectedReadBinding } from './durable-connected-read-binding';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'connected-operation-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const key = randomBytes(32), journal = new DurableJournal({ configRoot: root, key }); cleanup.push(() => journal.close());
  journal.admit({ runId: 'run', workspaceId: 'workspace', commandId: 'admit', engine: 'sqlite-v2-readonly-1',
    credentialIdentity: 'a'.repeat(64), runtimeManifest: DURABLE_RUNTIME_MANIFEST, createdAt: Date.now(), deadlineAt: Date.now() + 120000,
    allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 2,
    costPolicy: { unit: 'trusted-upper-bound', maxTotalUnits: 5, maxUnitsPerAttempt: 1 }, authority: {}, context: {} });
  const binding: DurableConnectedReadBinding = { revision: 'workspace-bearer-read-1', workspaceId: 'workspace', sourceSlug: 'account',
    sourceIdentity: 'b'.repeat(64), credentialIdentity: 'c'.repeat(64), urls: ['https://api.example.com/v1/items'] };
  let allowed = true, current = true, calls = 0;
  const adapter = createDurableConnectedReadAdapter(binding, {
    isCertifiedRead: url => url === binding.urls[0], isAuthorized: () => allowed,
    bindingResolver: { assertCurrent: async () => { if (!current) throw new Error('secret raw failure'); } },
    transport: async (_binding, _url, authorize) => {
      if (!authorize()) return { ok: false, reason: 'not-authorized' };
      calls++; return { ok: true, data: { saved: 'private account data' } };
    },
  });
  const intent: DurableOperationIntent = { slotId: 'account-read', adapterId: adapter.id, adapterVersion: adapter.version,
    credentialIdentity: adapter.credentialIdentity, effectClass: 'read', idempotencyKey: 'read-one',
    input: { url: binding.urls[0]!, binding: JSON.parse(JSON.stringify(binding)) }, outputSchema: { id: adapter.outputSchema.id, version: adapter.outputSchema.version },
    maxAttempts: 2, maxUnitsPerAttempt: 1 };
  const claim = journal.claim('run', 'workspace'), runner = new DurableEffectRunner(journal, [adapter]);
  return { root, key, journal, claim, runner, adapter, binding, intent, calls: () => calls,
    setAllowed: (value: boolean) => { allowed = value; }, setCurrent: (value: boolean) => { current = value; } };
}

test('saved connected read replays without network and without creating approvals', async () => {
  const f = fixture();
  const first = await f.runner.execute(f.claim, f.intent);
  expect(first.status).toBe('succeeded');
  expect(first.attempts[0]!.outcome).toMatchObject({ kind: 'succeeded', output: { ok: true, untrusted: true, data: { saved: 'private account data' } } });
  expect(await f.runner.execute(f.claim, f.intent)).toEqual(first); expect(f.calls()).toBe(1);
  expect(f.journal.get('run', 'workspace').approvals ?? []).toEqual([]);
  expect(f.journal.get('run', 'workspace').reservedUnits).toBe(1);
});

test('saved read still requires current source credentials and policy access', async () => {
  const f = fixture(); await f.runner.execute(f.claim, f.intent);
  f.setAllowed(false); await expect(f.runner.execute(f.claim, f.intent)).rejects.toThrow('connected-read-unavailable');
  f.setAllowed(true); f.setCurrent(false);
  await expect(f.runner.execute(f.claim, f.intent)).rejects.toThrow('connected-read-unavailable');
  f.setCurrent(true); expect((await f.runner.execute(f.claim, f.intent)).status).toBe('succeeded'); expect(f.calls()).toBe(1);
});

test('changed bound URL list conflicts even when the original requested URL is unchanged', async () => {
  const f = fixture(); await f.runner.execute(f.claim, f.intent);
  const changed = structuredClone(f.intent);
  (changed.input as any).binding.urls.push('https://api.example.com/v1/other');
  await expect(f.runner.execute(f.claim, changed)).rejects.toThrow('intent-conflict'); expect(f.calls()).toBe(1);
});

test('pause during delayed transport authorization blocks the actual GET', async () => {
  const f = fixture(); let dispatches = 0, first = true;
  const adapter = createDurableConnectedReadAdapter(f.binding, {
    isCertifiedRead: () => true, isAuthorized: () => true, bindingResolver: { assertCurrent: async () => {} },
    transport: async (_binding, _url, authorize) => {
      if (first) { first = false; f.journal.command({ runId: 'run', workspaceId: 'workspace', action: 'pause', commandId: 'pause', expectedVersion: f.journal.get('run', 'workspace').version }); }
      try { if (authorize()) dispatches++; } catch { return { ok: false, reason: 'not-authorized' }; }
      return { ok: true, data: null };
    },
  });
  const result = await new DurableEffectRunner(f.journal, [adapter]).execute(f.claim, f.intent);
  expect(dispatches).toBe(0); expect(f.journal.get('run', 'workspace').status).toBe('paused');
  expect(result.status).toBe('intent');
  expect(result.attempts[0]!.outcome).toMatchObject({ kind: 'not-applied' });
  f.journal.command({ runId: 'run', workspaceId: 'workspace', action: 'resume', commandId: 'resume', expectedVersion: f.journal.get('run', 'workspace').version });
  f.journal.release(f.claim);
  const resumed = f.journal.claim('run', 'workspace');
  expect((await new DurableEffectRunner(f.journal, [adapter]).execute(resumed, f.intent)).status).toBe('succeeded');
  expect(dispatches).toBe(1);
});

test('unknown read result is made retryable without a GET during reconciliation; attempts stay bounded', async () => {
  const f = fixture(); let calls = 0;
  f.adapter.invoke = async () => { calls++; throw new Error('lost connection'); };
  expect((await f.runner.execute(f.claim, f.intent)).status).toBe('unknown');
  expect((await f.runner.execute(f.claim, f.intent)).status).toBe('intent'); expect(calls).toBe(1);
  expect((await f.runner.execute(f.claim, f.intent)).status).toBe('unknown');
  expect((await f.runner.execute(f.claim, f.intent)).status).toBe('intent');
  await expect(f.runner.execute(f.claim, f.intent)).rejects.toThrow('budget-exhausted'); expect(calls).toBe(2);
});

test('final journal fence rejects settled, stale and substituted attempt tokens', async () => {
  const f = fixture(); f.journal.reserveOperation(f.claim, f.intent);
  const started = f.journal.startOperation(f.claim, f.intent.slotId, 'start');
  f.journal.assertOperationDispatch(f.claim, started.attempt!);
  expect(() => f.journal.assertOperationDispatch(f.claim, { ...started.attempt!, commandId: 'other' })).toThrow('attempt-mismatch');
  f.journal.settleOperation(f.claim, started.attempt!, { kind: 'failed', reason: 'fixture done' });
  expect(() => f.journal.assertOperationDispatch(f.claim, started.attempt!)).toThrow('attempt-mismatch');
});

test('unsupported endpoint and revoked access reject before a network attempt', async () => {
  const f = fixture(); f.setAllowed(false);
  await expect(f.runner.execute(f.claim, f.intent)).rejects.toThrow('connected-read-unavailable'); expect(f.calls()).toBe(0);
  f.setAllowed(true); const bad = structuredClone(f.intent); (bad.input as any).url = 'https://api.example.com/v1/other';
  const fresh = fixture(); await expect(fresh.runner.execute(fresh.claim, bad)).rejects.toThrow('connected-read-unavailable');
  expect(fresh.calls()).toBe(0);
});

test('a source adapter cannot be used by a run in another workspace', async () => {
  const f = fixture(); f.adapter.workspaceId = 'other-workspace';
  await expect(f.runner.execute(f.claim, f.intent)).rejects.toThrow('adapter-binding-changed');
  expect(f.calls()).toBe(0); expect(f.journal.getOperation('run', 'workspace', f.intent.slotId)).toBeUndefined();
});

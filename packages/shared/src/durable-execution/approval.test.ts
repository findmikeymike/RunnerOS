import { afterEach, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableJournal, type DurableRunSpec, type DurableClaim, type DurableDecisionCommand, type DurableToolAuthorization } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
const model = { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'a' } }], stopReason: 'toolUse' };
const start = { kind: 'tool-start' as const, turn: 0, callId: 'read', tool: 'read', input: { path: '/normalized/a' } };
function fixture(principal: string | undefined = 'alice') {
  const root = mkdtempSync(join(tmpdir(), 'artist-approval-')), key = randomBytes(32);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let journal = new DurableJournal({ configRoot: root, key });
  cleanup.push(() => journal.close());
  const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, runId: 'run', commandId: 'admit', workspaceId: 'workspace', model: 'fixture', createdAt: Date.now(), allowedTools: ['read'], maxOutputTokens: 100, maxModelAttempts: 3, costPolicy: { unit: 'verified-free', maxUnitsPerAttempt: 0, maxTotalUnits: 0 }, context: {}, authority: {}, deadlineAt: Date.now() + 60000, ...(principal ? { approvalPrincipalId: principal } : {}) };
  journal.admit(spec);
  let claim: DurableClaim | undefined;
  const authorization: DurableToolAuthorization = { principalId: 'alice', policyRevision: 'policy-1', credentialIdentity: spec.credentialIdentity, allowed: true, requiresApproval: true, approvalExpiresAt: Date.now() + 50000 };
  let authorizations = 0;
  const snapshot = () => journal.get('run', 'workspace');
  return { get journal() { return journal; }, spec, authorization, snapshot, authorizations: () => authorizations,
    async bridge(custom?: (request: typeof start) => Promise<DurableToolAuthorization>) {
      if (claim) { journal.release(claim); claim = undefined; }
      claim = journal.claim('run', 'workspace');
      const bridge = journal.bridge(claim, { authorizeTool: custom ? (request => custom(request as typeof start)) : (async () => { authorizations++; return authorization; }) });
      await bridge.checkpoint({ kind: 'model-start', turn: 0, context: { messages: [] } });
      await bridge.checkpoint({ kind: 'model-result', turn: 0, message: model });
      return bridge;
    },
    release() { if (claim) { journal.release(claim); claim = undefined; } },
    reopen(maxPayloadBytes?: number) { if (claim) { journal.release(claim); claim = undefined; } journal.close(); journal = new DurableJournal({ configRoot: root, key, maxPayloadBytes }); },
    command(action: 'pause' | 'resume' | 'cancel') { return journal.command({ runId: 'run', workspaceId: 'workspace', commandId: randomUUID(), expectedVersion: snapshot().version, action }); },
    decision(action: 'approve' | 'deny' = 'approve'): DurableDecisionCommand { const approval = snapshot().approvals!.at(-1)!; return { runId: 'run', workspaceId: 'workspace', commandId: randomUUID(), expectedVersion: snapshot().version, action, approvalId: approval.id, inputDigest: approval.inputDigest, principalId: approval.principalId, policyRevision: approval.policyRevision, credentialIdentity: approval.credentialIdentity }; },
  };
}

test('pending approval and immutable decision receipt survive reopen; consumption and dispatch commit together', async () => {
  const f = fixture(); const first = await f.bridge();
  await expect(first.checkpoint(start)).rejects.toThrow('durable-approval-required');
  expect(f.snapshot().status).toBe('waiting-approval'); expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
  await first.fail('wait is not failure'); expect(f.snapshot().status).toBe('waiting-approval');
  const pending = f.snapshot().approvals![0]!;
  f.reopen(); expect(f.snapshot().approvals![0]).toEqual(pending); expect(() => f.journal.claim('run', 'workspace')).toThrow('approval-required');
  const command = f.decision(); const receipt = f.journal.decide(command);
  f.reopen(); expect(f.journal.decide(command)).toEqual(receipt);
  const resumed = await f.bridge(); await resumed.checkpoint(start);
  expect(f.snapshot().approvals![0]!.status).toBe('consumed'); expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(1);
  await resumed.checkpoint({ kind: 'tool-result', turn: 0, callId: 'read', result: { content: 'saved' } });
  f.authorization.approvalExpiresAt = 1;
  expect((await resumed.checkpoint(start)).cached).toEqual({ content: 'saved' });
  expect(f.authorizations()).toBe(3); expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(1);
});

test('pending approval cannot accept a result before a dispatch attempt', async () => {
  const f = fixture(), bridge = await f.bridge();
  await expect(bridge.checkpoint(start)).rejects.toThrow('approval-required');
  await expect(bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'read', result: 'not executed' })).rejects.toThrow('tool-not-started');
});

test('trusted already-authorized read needs no decision; missing resolver pauses required runs', async () => {
  const f = fixture(); f.authorization.requiresApproval = false;
  await (await f.bridge()).checkpoint(start); expect(f.snapshot().approvals).toEqual([]);
  const missing = fixture(); const claim = missing.journal.claim('run', 'workspace'), bridge = missing.journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} }); await bridge.checkpoint({ kind: 'model-result', turn: 0, message: model });
  await expect(bridge.checkpoint(start)).rejects.toThrow('authorization-blocked'); expect(missing.snapshot().status).toBe('paused');
});

for (const mutation of ['principalId', 'credentialIdentity', 'allowed']) {
  test(`current ${mutation} revocation pauses without consuming approved action`, async () => {
    const f = fixture(); await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
    f.journal.decide(f.decision());
    if (mutation === 'allowed') f.authorization.allowed = false;
    else f.authorization[mutation as 'principalId' | 'credentialIdentity'] = 'changed';
    await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('authorization-blocked');
    expect(f.snapshot().status).toBe('paused'); expect(f.snapshot().approvals![0]!.status).toBe('approved'); expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
  });
}

test('authorizer rejection preserves original cause after durable pause', async () => {
  const f = fixture(); const cause = new Error('trusted resolver unavailable');
  const bridge = await f.bridge(async () => { throw cause; });
  await expect(bridge.checkpoint(start)).rejects.toBe(cause);
  expect(f.snapshot().status).toBe('paused'); await bridge.fail('must not overwrite pause'); expect(f.snapshot().status).toBe('paused');
});

test('changed policy creates new approval; changed normalized input cannot consume old approval', async () => {
  const f = fixture(); await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
  const oldCommand = f.decision(); f.journal.decide(oldCommand); f.authorization.policyRevision = 'policy-2';
  await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
  expect(f.snapshot().approvals).toHaveLength(2); expect(f.snapshot().approvals![1]!.policyRevision).toBe('policy-2');
  expect(f.snapshot().approvals![1]!.id).not.toBe(f.snapshot().approvals![0]!.id);
  expect(() => f.journal.decide({ ...oldCommand, commandId: randomUUID(), expectedVersion: f.snapshot().version })).toThrow('decision-mismatch');
  f.journal.decide(f.decision()); const bridge = await f.bridge();
  await expect(bridge.checkpoint({ ...start, input: { path: '/different' } })).rejects.toThrow('input-changed');
  expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
});

test('exact decision binding rejects account, principal, policy, digest, and cross-workspace substitution', async () => {
  const f = fixture(); await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
  const command = f.decision();
  for (const key of ['credentialIdentity', 'principalId', 'policyRevision', 'inputDigest', 'approvalId', 'workspaceId'] as const) {
    expect(() => f.journal.decide({ ...command, [key]: 'changed' })).toThrow();
  }
  expect(f.snapshot().status).toBe('waiting-approval');
});

test('first pending expiry is frozen; expired decision persists and explicit resume reauthorizes', async () => {
  const f = fixture(); f.authorization.approvalExpiresAt = Date.now() + 40;
  await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
  const expiry = f.snapshot().approvals![0]!.expiresAt;
  f.authorization.approvalExpiresAt = Date.now() + 30000;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry - Date.now()) + 5));
  expect(() => f.journal.decide(f.decision())).toThrow('approval-expired');
  expect(f.snapshot().approvals![0]!.expiresAt).toBe(expiry); expect(f.snapshot().approvals![0]!.status).toBe('expired');
  expect(f.snapshot().status).toBe('waiting-approval'); f.command('resume');
  await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
  expect(f.snapshot().approvals).toHaveLength(2); expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
});

test('pause and resume cannot bypass pending approval; approved-while-paused stays paused and duplicate cannot revive cancellation', async () => {
  const f = fixture(); await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
  f.command('resume'); expect(f.snapshot().status).toBe('waiting-approval');
  f.command('pause'); const command = f.decision(), receipt = f.journal.decide(command); expect(receipt.status).toBe('paused');
  f.command('resume'); expect(f.snapshot().status).toBe('running'); f.command('cancel');
  expect(f.journal.decide(command)).toEqual(receipt); expect(f.snapshot().status).toBe('cancelled');
  expect(() => f.journal.decide({ ...command, commandId: randomUUID(), expectedVersion: f.snapshot().version })).toThrow('terminal');
});

test('denial cancels exactly once and late duplicate remains original receipt', async () => {
  const f = fixture(); await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
  const command = f.decision('deny'), receipt = f.journal.decide(command); f.reopen();
  expect(f.snapshot().status).toBe('cancelled'); expect(f.snapshot().approvals![0]!.status).toBe('denied'); expect(f.journal.decide(command)).toEqual(receipt);
});

test('bounded retry consumption is atomic and a newly expired current authorization cannot dispatch', async () => {
  const f = fixture(); await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required'); f.journal.decide(f.decision());
  const bridge = await f.bridge(); await bridge.checkpoint(start); await bridge.checkpoint(start); await bridge.checkpoint(start);
  await expect(bridge.checkpoint(start)).rejects.toThrow('attempts-exhausted');
  expect(f.snapshot().approvals![0]!.status).toBe('consumed'); expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(3);
  const g = fixture(); await expect((await g.bridge()).checkpoint(start)).rejects.toThrow('approval-required'); g.journal.decide(g.decision()); g.authorization.approvalExpiresAt = 1;
  await expect((await g.bridge()).checkpoint(start)).rejects.toThrow('approval-expired'); expect(g.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
});


test('undispatched pending tool result is rejected even after Pause or Cancel', async () => {
  for (const control of ['pause', 'cancel'] as const) {
    const f = fixture(), bridge = await f.bridge();
    await expect(bridge.checkpoint(start)).rejects.toThrow('approval-required');
    f.command(control);
    await expect(bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'read', result: 'forged' })).rejects.toThrow('tool-not-started');
    expect(f.snapshot().turns[0]!.calls[0]!.result).toBeUndefined();
  }
});

test('failed atomic dispatch save rolls back approval consumption and attempt count', async () => {
  const f = fixture(); await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required'); f.journal.decide(f.decision());
  f.reopen(100); const bridge = await f.bridge();
  await expect(bridge.checkpoint(start)).rejects.toThrow('payload-limit');
  expect(f.snapshot().approvals![0]!.status).toBe('approved'); expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
});

test('resolver cannot rewrite nested payload or call identity before granting access', async () => {
  for (const mutate of [
    (request: typeof start) => { request.input.path = '/public'; },
    (request: typeof start) => { request.callId = 'different'; },
  ]) {
    const f = fixture(); const bridge = await f.bridge(async request => { mutate(request); return f.authorization; });
    await expect(bridge.checkpoint({ ...start, input: { ...start.input } })).rejects.toThrow();
    expect(f.snapshot().status).toBe('paused'); expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
  }
});

test('caller mutation during awaited resolver does not alter approval binding', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const releasePromise = new Promise<void>(resolve => { release = resolve; });
  const bridge = await f.bridge(async request => { entered(); await releasePromise; expect(request.input.path).toBe('/normalized/a'); expect(request.callId).toBe('read'); return f.authorization; });
  const request = { ...start, input: { ...start.input } };
  const waiting = bridge.checkpoint(request); void waiting.catch(() => {});
  await enteredPromise; request.input.path = '/changed'; request.callId = 'changed'; release(); await expect(waiting).rejects.toThrow('approval-required');
  const approval = f.snapshot().approvals![0]!;
  expect(approval.callId).toBe('read'); expect(approval.inputDigest).toBe(f.snapshot().turns[0]!.calls[0]!.inputDigest!);
});

test('denial remains available after pending approval expiry', async () => {
  const f = fixture(); f.authorization.approvalExpiresAt = Date.now() + 40;
  await expect((await f.bridge()).checkpoint(start)).rejects.toThrow('approval-required');
  const expiresAt = f.snapshot().approvals![0]!.expiresAt;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now()) + 5));
  expect(f.journal.decide(f.decision('deny')).status).toBe('cancelled');
  expect(f.snapshot().approvals![0]!.status).toBe('denied');
});

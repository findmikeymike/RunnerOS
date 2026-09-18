import { afterEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableJournal } from '../../../shared/src/durable-execution';
import { DURABLE_RUNTIME_MANIFEST } from '../../../shared/src/protocol/durable-execution';
import { DurableEffectRunner } from './durable-effect-runner';
import { createDurableSingleAttemptWriteAdapter } from './durable-single-attempt-write';
import { startProcess } from './__tests__/durability/process-support';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'artist-single-write-')), key = randomBytes(32);
  const journal = new DurableJournal({ configRoot: root, key });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => journal.close());
  journal.admit({ runId: 'run', workspaceId: 'workspace', commandId: 'admit', engine: 'sqlite-v2-readonly-1', credentialIdentity: 'a'.repeat(64), runtimeManifest: DURABLE_RUNTIME_MANIFEST,
    createdAt: Date.now(), deadlineAt: Date.now() + 120000, allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 4,
    costPolicy: { unit: 'trusted-upper-bound', maxTotalUnits: 4, maxUnitsPerAttempt: 1 }, authority: {}, context: {} });
  const claim = journal.claim('run', 'workspace');
  const intent = { slotId: 'send', adapterId: 'fixture-send', adapterVersion: '1', credentialIdentity: 'a'.repeat(64), effectClass: 'single-attempt-write' as const,
    idempotencyKey: 'local-only', input: { message: 'synthetic fixture' }, outputSchema: { id: 'receipt', version: '1' }, maxAttempts: 1, maxUnitsPerAttempt: 1 };
  let calls = 0, allowed = true;
  const makeAdapter = (invoke = async () => { calls++; return { receipt: 'confirmed' }; }) => createDurableSingleAttemptWriteAdapter({
    id: intent.adapterId, version: '1', workspaceId: 'workspace', credentialIdentity: intent.credentialIdentity,
    outputSchema: { ...intent.outputSchema, validate: output => !!output && typeof output === 'object' && !Array.isArray(output) && typeof output.receipt === 'string' },
    authorize() { if (!allowed) throw new Error('access-revoked'); }, assertAuthorized() { if (!allowed) throw new Error('access-revoked'); }, invoke,
  });
  return { root, key, journal, claim, intent, makeAdapter, get calls() { return calls; }, revoke() { allowed = false; } };
}

test('confirmed write reuses its saved receipt and checks current access', async () => {
  const f = fixture(), adapter = f.makeAdapter();
  const runner = new DurableEffectRunner(f.journal, [adapter]);
  expect((await runner.execute(f.claim, f.intent)).status).toBe('succeeded');
  expect((await runner.execute(f.claim, f.intent)).status).toBe('succeeded');
  expect(f.calls).toBe(1);
  f.revoke(); await expect(runner.execute(f.claim, f.intent)).rejects.toThrow('access-revoked');
  expect(f.calls).toBe(1);
});

test('accepted write with lost receipt stays unknown through recovery without another attempt', async () => {
  const f = fixture(); let calls = 0;
  const adapter = f.makeAdapter(async () => { calls++; throw new Error('synthetic lost response'); });
  const runner = new DurableEffectRunner(f.journal, [adapter]);
  expect((await runner.execute(f.claim, f.intent)).status).toBe('unknown');
  f.journal.release(f.claim);
  const reopened = new DurableJournal({ configRoot: f.root, key: f.key }); cleanup.push(() => reopened.close());
  const recovered = reopened.claim('run', 'workspace'), recovery = new DurableEffectRunner(reopened, [adapter]);
  for (let i = 0; i < 3; i++) expect((await recovery.execute(recovered, f.intent)).status).toBe('unknown');
  expect(calls).toBe(1); expect(reopened.getOperation('run', 'workspace', 'send')!.attempts).toHaveLength(1);
  expect(reopened.get('run', 'workspace').reservedUnits).toBe(1);
  reopened.release(recovered);
});

test('unverified receipts never claim failure or authorize resend', async () => {
  const f = fixture(); let calls = 0;
  const adapter = f.makeAdapter(async () => { calls++; return { receipt: 123 } as never; });
  const runner = new DurableEffectRunner(f.journal, [adapter]);
  expect((await runner.execute(f.claim, f.intent)).status).toBe('unknown');
  expect((await runner.execute(f.claim, f.intent)).status).toBe('unknown');
  expect(calls).toBe(1);
});

test('pause while transport prepares fences the actual write', async () => {
  const f = fixture(); let calls = 0;
  const adapter = createDurableSingleAttemptWriteAdapter({ id: f.intent.adapterId, version: '1', workspaceId: 'workspace', credentialIdentity: f.intent.credentialIdentity,
    outputSchema: { ...f.intent.outputSchema, validate: () => true }, authorize() {}, assertAuthorized() {}, async invoke(_input, assertDispatch) {
      await Promise.resolve();
      f.journal.command({ runId: 'run', workspaceId: 'workspace', commandId: 'pause', expectedVersion: f.journal.get('run', 'workspace').version, action: 'pause' });
      assertDispatch(); calls++; return { receipt: 'must-not-write' };
    } });
  expect((await new DurableEffectRunner(f.journal, [adapter]).execute(f.claim, f.intent)).status).toBe('unknown');
  expect(calls).toBe(0); expect(f.journal.get('run', 'workspace').status).toBe('paused');
});

test('SIGKILL after external acceptance does not resend on fresh-process recovery', async () => {
  const f = fixture(); f.journal.release(f.claim);
  writeFileSync(join(f.root, 'synthetic-only'), 'single-write-fixture');
  const script = join(import.meta.dir, '__tests__/durability/single-write-worker.ts');
  const env = { DURABILITY_FIXTURE_KEY: f.key.toString('hex') };
  const child = startProcess([script, f.root, 'dispatch'], env);
  try {
    await child.line(line => line.includes('accepted'));
    child.child.kill('SIGKILL'); await child.done;
    const recovery = startProcess([script, f.root, 'recover'], env);
    const result = await recovery.done;
    expect({ code: result.code, error: result.code ? result.stderr : '' }).toEqual({ code: 0, error: '' });
    expect(result.stdout).toContain('"status":"unknown"');
    expect(readFileSync(join(f.root, 'external-writes'), 'utf8')).toBe('sent\n');
    expect(f.journal.getOperation('run', 'workspace', 'send')!.attempts).toHaveLength(1);
  } finally { if (child.child.exitCode === null) child.child.kill('SIGKILL'); }
}, 20000);


test('revoked access while transport prepares fences the final external write', async () => {
  const f = fixture(); let calls = 0, allowed = true;
  const adapter = createDurableSingleAttemptWriteAdapter({ id: f.intent.adapterId, version: '1', workspaceId: 'workspace', credentialIdentity: f.intent.credentialIdentity,
    outputSchema: { ...f.intent.outputSchema, validate: () => true }, authorize() {},
    assertAuthorized() { if (!allowed) throw new Error('access-revoked'); },
    async invoke(_input, assertDispatch) { await Promise.resolve(); allowed = false; assertDispatch(); calls++; return { receipt: 'must-not-write' }; },
  });
  expect((await new DurableEffectRunner(f.journal, [adapter]).execute(f.claim, f.intent)).status).toBe('unknown');
  expect(calls).toBe(0);
});

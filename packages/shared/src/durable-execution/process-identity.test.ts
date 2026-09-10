import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal, type DurableRunSpec } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';
import { readProcessIdentity, processIdentityProvesReplacement } from './process-identity.ts';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'process-owner-')), key = randomBytes(32);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const open = (identity: string | null, alive = true) => {
    const journal = new DurableJournal({ configRoot: root, key, processIdentity: () => identity, isProcessAlive: () => alive });
    cleanup.push(() => journal.close()); return journal;
  };
  const first = open('os:test:boot:first');
  const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: 'run', workspaceId: 'w', commandId: 'admit', createdAt: Date.now(), credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, allowedTools: ['read'], model: 'fixture', maxOutputTokens: 100, maxModelAttempts: 2, authority: {}, context: {}, deadlineAt: Date.now() + 60000, costPolicy: { unit: 'model-requests', maxTotalUnits: 2, maxUnitsPerAttempt: 1 } };
  first.admit(spec); return { first, open };
}
test('matching live process birth retains ownership, replaced birth permits takeover and fences old owner', async () => {
  const f = fixture(), claim = f.first.claim('run', 'w'), old = f.first.bridge(claim);
  expect(() => f.open('os:test:boot:first').claim('run', 'w')).toThrow('owned');
  const next = f.open('os:test:boot:second').claim('run', 'w');
  expect(next.epoch).toBe(claim.epoch + 1);
  await expect(old.checkpoint({ kind: 'model-start', turn: 0, context: {} })).rejects.toThrow('stale-owner');
});
test('unknown identity and legacy owner rows fail closed while PID lives; proven dead owner remains reclaimable', () => {
  const f = fixture(); f.first.claim('run', 'w');
  expect(() => f.open(null).claim('run', 'w')).toThrow('owned');
  (f.first as any).db.exec('UPDATE runs SET process_identity=NULL');
  expect(() => f.open('os:test:new').claim('run', 'w')).toThrow('owned');
  expect(f.open(null, false).claim('run', 'w').epoch).toBe(2);
});
test('observation takeover uses the same process birth fencing', () => {
  const f = fixture(), claim = f.first.claim('run', 'w'); f.first.cancel('run', 'w');
  expect(() => f.open('os:test:boot:first').claimObservation('run', 'w')).toThrow('owned');
  expect(f.open('os:test:boot:replacement').claimObservation('run', 'w').epoch).toBe(claim.epoch + 1);
});
test('schema-two legacy rows receive nullable process identity without discarding ownership', () => {
  const f = fixture(); f.first.claim('run', 'w');
  (f.first as any).db.exec('ALTER TABLE runs DROP COLUMN process_identity; PRAGMA user_version=2');
  const upgraded = f.open('os:test:new');
  expect((upgraded as any).db.prepare('PRAGMA table_info(runs)').all().some((column: any) => column.name === 'process_identity')).toBe(true);
  expect(() => upgraded.claim('run', 'w')).toThrow('owned');
  expect((upgraded as any).db.prepare('PRAGMA user_version').get().user_version).toBe(4);
});
test('self identity is stable; local fallback and unavailable identities never prove replacement', () => {
  expect(readProcessIdentity(process.pid)).toBe(readProcessIdentity(process.pid));
  expect(readProcessIdentity(process.pid)).toBeTruthy();
  expect(processIdentityProvesReplacement('local:old', 'os:new')).toBe(false);
  expect(processIdentityProvesReplacement('os:old', null)).toBe(false);
});

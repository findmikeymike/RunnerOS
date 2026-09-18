import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialManager } from './manager.ts';
import { credentialIdToAccount, type CredentialId, type StoredCredential } from './types.ts';

const id: CredentialId = { type: 'source_oauth', workspaceId: 'fixture', sourceId: 'account' };
function fixture() {
 const records = new Map<string, StoredCredential>();
 const backend = { name: 'fixture', get: async (key: CredentialId) => structuredClone(records.get(credentialIdToAccount(key)) ?? null),
  set: async (key: CredentialId, value: StoredCredential) => { records.set(credentialIdToAccount(key), structuredClone(value)); },
  delete: async (key: CredentialId) => records.delete(credentialIdToAccount(key)) };
 const manager = new CredentialManager(); Object.assign(manager, { initialized: true, backends: [backend], writeBackend: backend });
 return { manager, backend };
}
const original = { value: 'synthetic-access-token', refreshToken: 'synthetic-refresh-token' };

test('source identities opt in without changing legacy records and concurrent captures agree', async () => {
 const { manager } = fixture();
 expect(await manager.captureDurableSourceIdentity(id)).toBeNull();
 await expect(manager.captureDurableSourceIdentity({ type: 'llm_oauth', connectionSlug: 'model' })).rejects.toThrow('durable-source-credential-required');
 for (const type of ['source_oauth', 'source_bearer', 'source_apikey', 'source_basic'] as const) {
  const key = { ...id, type }; await manager.set(key, original); expect(await manager.get(key)).toEqual(original);
  const identities = await Promise.all(Array.from({ length: 8 }, () => manager.captureDurableSourceIdentity(key)));
  expect(new Set(identities).size).toBe(1); expect(identities[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(identities[0]).not.toContain('synthetic');
  expect(await manager.get(key)).toEqual({ ...original, durableAuthIdentity: identities[0]! });
 }
});

test('guarded refresh retains stored identity even when replacement omits or spoofs it', async () => {
 const { manager } = fixture(); await manager.set(id, original);
 const identity = await manager.captureDurableSourceIdentity(id);
 for (const patch of [{}, { durableAuthIdentity: 'spoofed-old-identity' }]) {
  const snapshot = await manager.captureSnapshot(id);
  const result = await manager.compareAndSetSnapshot(snapshot, { value: 'refreshed', refreshToken: 'next-refresh', ...patch });
  expect(result!.credential!.durableAuthIdentity).toBe(identity ?? undefined);
  expect(result!.credential).toEqual(await manager.get(id));
  expect(result!.authRevision).toBe(snapshot.authRevision);
  expect(await manager.withCurrentSnapshot(result!, () => true)).toBe(true);
 }
});

test('set and authenticated CAS replace identity and old snapshots cannot restore an account', async () => {
 const { manager } = fixture(); await manager.set(id, original); const first = await manager.captureDurableSourceIdentity(id);
 const stale = await manager.captureSnapshot(id);
 await manager.set(id, { ...original, durableAuthIdentity: first! });
 const second = (await manager.get(id))!.durableAuthIdentity!; expect(second).not.toBe(first);
 expect(await manager.compareAndSetSnapshot(stale, original)).toBeNull();
 const current = await manager.captureSnapshot(id);
 const signedIn = await manager.compareAndSetSnapshot(current, { ...original, durableAuthIdentity: second }, () => true, true);
 expect(signedIn!.credential!.durableAuthIdentity).not.toBe(second);
 expect(signedIn!.credential).toEqual(await manager.get(id));
 expect(await manager.withCurrentSnapshot(signedIn!, () => true)).toBe(true);
 await manager.delete(id);
 expect(await manager.captureDurableSourceIdentity(id)).toBeNull();
 expect(await manager.compareAndSetSnapshot(signedIn!, original)).toBeNull();
 await manager.set(id, { ...original, durableAuthIdentity: first! });
 const recreated = await manager.captureDurableSourceIdentity(id);
 expect(recreated).not.toBe(first); expect(recreated).not.toBe(second); expect(recreated).not.toBe(signedIn!.credential!.durableAuthIdentity);
});

test('unopted refresh cannot inject identity and delayed capture cannot undo replacement or signout', async () => {
 for (const mutation of ['replace', 'delete'] as const) {
  const { manager, backend } = fixture(); await manager.set(id, original);
  const refresh = await manager.compareAndSetSnapshot(await manager.captureSnapshot(id), { ...original, durableAuthIdentity: 'injected' });
  expect(refresh!.credential).toEqual(original);
  let entered!: () => void, finish!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { finish = resolve; });
  const set = backend.set;
  backend.set = async (key, value) => { entered(); await gate; await set(key, value); };
  const capture = manager.captureDurableSourceIdentity(id); await writing;
  const later = mutation === 'replace' ? manager.set(id, { value: 'different-account' }) : manager.delete(id);
  finish(); const priorIdentity = await capture; await later;
  const current = await manager.get(id);
  if (mutation === 'delete') expect(current).toBeNull();
  else { expect(current!.value).toBe('different-account'); expect(current!.durableAuthIdentity).not.toBe(priorIdentity); }
 }
});

test('capture fences an already captured refresh while pending authentication still rotates the current sign-in', async () => {
 const { manager } = fixture(); await manager.set(id, original);
 const beforeOptIn = await manager.captureSnapshot(id);
 const identity = await manager.captureDurableSourceIdentity(id);
 expect(await manager.compareAndSetSnapshot(beforeOptIn, { value: 'stale-refresh' })).toBeNull();
 const replaced = await manager.compareAndSetSnapshot(beforeOptIn, { value: 'authenticated-replacement' }, () => true, true);
 expect(replaced!.credential!.durableAuthIdentity).not.toBe(identity ?? undefined);
 expect(replaced!.credential).toEqual(await manager.get(id));
});

test('queued replacement or deletion wins after an opted-in guarded refresh write', async () => {
 for (const mutation of ['replace', 'delete'] as const) {
  const { manager, backend } = fixture(); await manager.set(id, original);
  const identity = await manager.captureDurableSourceIdentity(id); const snapshot = await manager.captureSnapshot(id);
  let entered!: () => void, finish!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { finish = resolve; });
  const set = backend.set;
  backend.set = async (key, value) => { entered(); await gate; await set(key, value); };
  const refresh = manager.compareAndSetSnapshot(snapshot, { value: 'refreshed' }); await writing;
  const later = mutation === 'replace' ? manager.set(id, { value: 'new-account' }) : manager.delete(id);
  finish(); const result = await refresh; await later;
  expect(result!.credential!.durableAuthIdentity).toBe(identity ?? undefined);
  expect(await manager.withCurrentSnapshot(result!, () => true)).toBe(false);
  const current = await manager.get(id);
  if (mutation === 'delete') expect(current).toBeNull();
  else { expect(current!.value).toBe('new-account'); expect(current!.durableAuthIdentity).not.toBe(identity ?? undefined); }
 }
});

test('identity persists encrypted across fresh processes and refresh, rotates on reconnect', () => {
 const root = mkdtempSync(join(tmpdir(), 'durable-source-identity-'));
 const managerPath = join(import.meta.dir, 'manager.ts');
 const run = (operation: string) => {
  const child = Bun.spawnSync([process.execPath, '-e', `import { CredentialManager } from ${JSON.stringify(managerPath)};
    const manager = new CredentialManager(); const id = ${JSON.stringify(id)};
    ${operation}
    console.log(JSON.stringify(await manager.captureDurableSourceIdentity(id)));`],
   { env: { ...process.env, CRAFT_CONFIG_DIR: root, CRAFT_PRODUCT_VARIANT: 'artist-os' }, stdout: 'pipe', stderr: 'pipe' });
  expect({ code: child.exitCode, error: child.exitCode ? child.stderr.toString() : '' }).toEqual({ code: 0, error: '' });
  return JSON.parse(child.stdout.toString().trim().split('\n').at(-1)!);
 };
 try {
  const first = run(`await manager.set(id, ${JSON.stringify(original)});`);
  expect(run('')).toBe(first);
  expect(run(`await manager.compareAndSetSnapshot(await manager.captureSnapshot(id), {value:'refreshed-synthetic-secret',refreshToken:'next-synthetic-refresh'});`)).toBe(first);
  const bytes = readFileSync(join(root, 'credentials.enc'));
  expect(bytes.includes(Buffer.from(first))).toBe(false); expect(bytes.includes(Buffer.from('refreshed-synthetic-secret'))).toBe(false);
  expect(run(`await manager.set(id, {value:'another-signin'});`)).not.toBe(first);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

import { expect, test } from 'bun:test';
import { CredentialManager } from './manager.ts';
import { credentialIdToAccount, type CredentialId, type StoredCredential } from './types.ts';

function fixture() {
  const records = new Map<string, StoredCredential>();
  const backend = {
    name: 'fixture',
    get: async (id: CredentialId) => records.get(credentialIdToAccount(id)) ?? null,
    set: async (id: CredentialId, credential: StoredCredential) => { records.set(credentialIdToAccount(id), credential); },
    delete: async (id: CredentialId) => records.delete(credentialIdToAccount(id)),
  };
  const manager = new CredentialManager();
  Object.assign(manager, { initialized: true, backends: [backend], writeBackend: backend });
  return { manager, backend };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('secret migration keeps conflicting aliases and removes only matching aliases', async () => {
  const { manager } = fixture();
  await manager.setUserSecret('CANONICAL', 'current');
  await manager.setUserSecret('MATCHING', 'current');
  await manager.setUserSecret('CONFLICTING', 'different');
  await manager.migrateUserSecretAliases('CANONICAL', ['MATCHING', 'CONFLICTING']);
  expect(await manager.getUserSecret('CANONICAL')).toBe('current');
  expect(await manager.getUserSecret('MATCHING')).toBeNull();
  expect(await manager.getUserSecret('CONFLICTING')).toBe('different');
});

for (const mutation of ['delete', 'replace'] as const) {
  test(`a delayed alias migration cannot undo a later ${mutation}`, async () => {
    const { manager, backend } = fixture();
    await manager.setUserSecret('LEGACY', 'old');
    const entered = gate(), finish = gate();
    const get = backend.get;
    let held = false;
    backend.get = async id => {
      if (id.name === 'LEGACY' && !held) { held = true; entered.release(); await finish.promise; }
      return get(id);
    };
    const migrating = manager.migrateUserSecretAliases('CANONICAL', ['LEGACY']);
    await entered.promise;
    const edit = mutation === 'delete' ? manager.deleteUserSecret('CANONICAL') : manager.setUserSecret('CANONICAL', 'new');
    finish.release();
    await Promise.all([migrating, edit]);
    expect(await manager.getUserSecret('CANONICAL')).toBe(mutation === 'delete' ? null : 'new');
    expect(await manager.getUserSecret('LEGACY')).toBeNull();
  });
}

test('a captured secret cannot publish after replacement or deletion', async () => {
  const { manager } = fixture();
  const id = { type: 'user_secret' as const, name: 'FIXTURE_SECRET' };
  await manager.setUserSecret(id.name, 'old');
  const snapshot = await manager.captureSnapshot(id);
  await manager.setUserSecret(id.name, 'new');
  let published = false;
  expect(await manager.withCurrentSnapshot(snapshot, () => { published = true; return true; })).toBe(false);
  const current = await manager.captureSnapshot(id);
  await manager.deleteUserSecret(id.name);
  expect(await manager.withCurrentSnapshot(current, () => { published = true; return true; })).toBe(false);
  expect(published).toBe(false);
});

import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CredentialId, StoredCredential } from '../../credentials/types.ts';
import { credentialIdToAccount } from '../../credentials/types.ts';
import type { LoadedSource } from '../types.ts';

const profile = mkdtempSync(join(tmpdir(), 'refresh-identity-'));
const priorProfile = process.env.CRAFT_CONFIG_DIR;
process.env.CRAFT_CONFIG_DIR = profile;
const store = new Map<string, { id: CredentialId; credential: StoredCredential }>();
mock.module('../../credentials/index.ts', () => ({
  getCredentialManager: () => ({
    get: async (id: CredentialId) => store.get(credentialIdToAccount(id))?.credential ?? null,
    set: async (id: CredentialId, credential: StoredCredential) => { store.set(credentialIdToAccount(id), { id, credential }); },
    list: async (filter: Partial<CredentialId>) => [...store.values()].map(x => x.id)
      .filter(id => Object.entries(filter).every(([key, value]) => id[key as keyof CredentialId] === value)),
  }),
}));
const { SourceCredentialManager } = await import('../credential-manager.ts');
const { GLOBAL_WORKSPACE_ID } = await import('../storage.ts');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
afterAll(() => {
  if (priorProfile === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = priorProfile;
  rmSync(profile, { recursive: true, force: true });
});
beforeEach(() => store.clear());

function source(workspaceId: string, global = false): LoadedSource {
  return {
    config: { id: 'fixture', slug: 'same-slug', name: 'Fixture', enabled: true, provider: 'custom', type: 'api',
      api: { baseUrl: 'https://fixture.invalid/', authType: 'bearer', renewEndpoint: { path: '/renew' } },
      createdAt: 1, updatedAt: 1 },
    workspaceId, workspaceRootPath: join(profile, workspaceId), folderPath: join(profile, workspaceId, 'sources/same-slug'),
    guide: null, ...(global ? { tier: 'global' as const } : {}),
  };
}
function set(manager: InstanceType<typeof SourceCredentialManager>, owner: LoadedSource, value: string, override = false) {
  const id = manager.getCredentialId(owner);
  store.set(credentialIdToAccount(id), { id, credential: { value, ...(override ? { override: true } : {}) } });
}
function delayedFetch() {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const token = new Headers(init?.headers).get('Authorization')!;
    calls.push(token);
    await gate;
    return new Response(JSON.stringify({ access_token: `fresh:${token}`, expires_in: 3600 }));
  }) as typeof fetch;
  return { calls, release };
}
async function startBoth(manager: InstanceType<typeof SourceCredentialManager>, a: LoadedSource, b: LoadedSource) {
  const deferred = delayedFetch();
  const first = manager.refresh(a), second = manager.refresh(b);
  // Drain credential lookup microtasks before releasing the provider response.
  await new Promise<void>(resolve => setImmediate(resolve));
  deferred.release();
  return { values: await Promise.all([first, second]), calls: deferred.calls };
}

test('same slug in separate workspaces refreshes each own credential', async () => {
  const manager = new SourceCredentialManager(), a = source('a'), b = source('b');
  set(manager, a, 'account-A'); set(manager, b, 'account-B');
  const result = await startBoth(manager, a, b);
  expect(result.calls).toHaveLength(2);
  expect(result.values).toEqual(['fresh:Bearer account-A', 'fresh:Bearer account-B']);
});

test('same workspace credential retains refresh deduplication', async () => {
  const manager = new SourceCredentialManager(), a = source('a');
  set(manager, a, 'shared');
  const result = await startBoth(manager, a, { ...a });
  expect(result.calls).toHaveLength(1);
  expect(result.values).toEqual(['fresh:Bearer shared', 'fresh:Bearer shared']);
});

test('borrowers of one global record share one refresh without workspace copies', async () => {
  const manager = new SourceCredentialManager(), a = source('a', true), b = source('b', true);
  set(manager, source(GLOBAL_WORKSPACE_ID, true), 'global');
  const result = await startBoth(manager, a, b);
  expect(result.calls).toHaveLength(1);
  expect(result.values).toEqual(['fresh:Bearer global', 'fresh:Bearer global']);
  expect(store.size).toBe(1);
});

test('workspace override never shares the global record refresh', async () => {
  const manager = new SourceCredentialManager(), a = source('a', true), b = source('b', true);
  set(manager, source(GLOBAL_WORKSPACE_ID, true), 'global'); set(manager, b, 'override-B', true);
  const result = await startBoth(manager, a, b);
  expect(result.calls).toHaveLength(2);
  expect(result.values).toEqual(['fresh:Bearer global', 'fresh:Bearer override-B']);
});


test('shared Google borrowers deduplicate against the actual workspace owner', async () => {
  const manager = new SourceCredentialManager();
  const google = (workspace: string) => {
    const result = source(workspace);
    result.config = { ...result.config, slug: 'gmail', provider: 'google' };
    return result;
  };
  const owner = google('owner');
  set(manager, owner, 'shared-google');
  const result = await startBoth(manager, google('a'), google('b'));
  expect(result.calls).toHaveLength(1);
  expect(result.values).toEqual(['fresh:Bearer shared-google', 'fresh:Bearer shared-google']);
  expect(store.size).toBe(1);
  expect(await manager.load(owner)).toMatchObject({ value: 'fresh:Bearer shared-google' });
});

test('global suppression does not inherit another caller refresh', async () => {
  const manager = new SourceCredentialManager(), a = source('a', true), b = source('b', true);
  set(manager, source(GLOBAL_WORKSPACE_ID, true), 'global');
  set(manager, b, '', true);
  const result = await startBoth(manager, a, b);
  expect(result.calls).toHaveLength(1);
  expect(result.values).toEqual(['fresh:Bearer global', null]);
});

test('different credential types in the same workspace do not deduplicate', async () => {
  const manager = new SourceCredentialManager(), a = source('a'), b = source('a');
  b.config = { ...b.config, api: { ...b.config.api!, authType: 'header', headerName: 'X-Key' } };
  set(manager, a, 'bearer'); set(manager, b, 'header');
  const result = await startBoth(manager, a, b);
  expect(result.calls).toHaveLength(2);
  expect(result.values).toEqual(['fresh:Bearer bearer', 'fresh:Bearer header']);
});

import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CredentialId, StoredCredential } from '../../credentials/types.ts';
import { credentialIdToAccount } from '../../credentials/types.ts';
import type { LoadedSource } from '../types.ts';

const profile = mkdtempSync(join(tmpdir(), 'refresh-identity-'));
const priorProfile = process.env.CRAFT_CONFIG_DIR;
process.env.CRAFT_CONFIG_DIR = profile;
const store = new Map<string, { id: CredentialId; credential: StoredCredential }>();
const { getCredentialManager } = await import('../../credentials/index.ts');
const backend = {
  get: async (id: CredentialId) => store.get(credentialIdToAccount(id))?.credential ?? null,
  set: async (id: CredentialId, credential: StoredCredential) => { store.set(credentialIdToAccount(id), { id, credential }); },
  delete: async (id: CredentialId) => store.delete(credentialIdToAccount(id)),
  list: async (filter: Partial<CredentialId>) => [...store.values()].map(x => x.id)
    .filter(id => Object.entries(filter).every(([key, value]) => id[key as keyof CredentialId] === value)),
};
Object.assign(getCredentialManager(), { initialized: true, backends: [backend], writeBackend: backend });
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
  }) as unknown as typeof fetch;
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

async function waitForProvider() {
  await new Promise<void>(resolve => setImmediate(resolve));
}

for (const mutation of ['delete', 'replace', 'same-token']) {
  test(`obsolete refresh cannot save or return tokens after ${mutation}`, async () => {
    const manager = new SourceCredentialManager(), a = source('race');
    await manager.save(a, { value: 'original' });
    const deferred = delayedFetch();
    const pending = manager.refresh(a).catch(error => error);
    await waitForProvider();
    if (mutation === 'delete') await manager.delete(a);
    else await manager.save(a, { value: mutation === 'replace' ? 'new-account' : 'original' });
    deferred.release();
    expect((await pending).name).toBe('SourceAuthSupersededError');
    expect((await manager.load(a))?.value ?? null).toBe(mutation === 'delete' ? null : mutation === 'replace' ? 'new-account' : 'original');
  });
}

test('reconnect starts a fresh refresh instead of joining the obsolete attempt', async () => {
  const manager = new SourceCredentialManager(), a = source('race');
  await manager.save(a, { value: 'original' });
  const deferred = delayedFetch();
  const first = manager.refresh(a).catch(error => error);
  await waitForProvider();
  await manager.save(a, { value: 'new-account' });
  const second = manager.refresh(a);
  await waitForProvider();
  expect(deferred.calls).toHaveLength(2);
  deferred.release();
  expect((await first).name).toBe('SourceAuthSupersededError');
  expect(await second).toBe('fresh:Bearer new-account');
});

const exchangeParams = { code: 'fixture-code', codeVerifier: 'fixture-verifier', tokenEndpoint: 'https://fixture.invalid/token', clientId: 'fixture-client', redirectUri: 'http://localhost/callback' };
function delayedExchange() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async () => { await gate; return new Response(JSON.stringify({ access_token: 'new-signin', refresh_token: 'new-refresh', expires_in: 3600 })); }) as unknown as typeof fetch;
  return release;
}

test('old OAuth completion cannot replace a newer sign-in intent', async () => {
  const manager = new SourceCredentialManager(), a = source('oauth');
  const intent = await manager.beginAuthentication(a);
  const release = delayedExchange();
  const pending = manager.exchangeAndStore(a, 'generic', exchangeParams, { authIntentRevision: intent });
  await waitForProvider();
  await manager.beginAuthentication(a);
  release();
  expect((await pending).success).toBe(false);
  expect(await manager.load(a)).toBeNull();
});

test('ordinary token refresh does not invalidate the latest OAuth sign-in', async () => {
  const manager = new SourceCredentialManager(), a = source('oauth');
  await manager.save(a, { value: 'old', refreshToken: 'old-refresh' });
  const intent = await manager.beginAuthentication(a);
  const release = delayedExchange();
  const pending = manager.exchangeAndStore(a, 'generic', exchangeParams, { authIntentRevision: intent });
  await waitForProvider();
  const credentials = getCredentialManager();
  const snapshot = await credentials.captureSnapshot(manager.getCredentialId(a));
  expect(await credentials.compareAndSetSnapshot(snapshot, { value: 'background-refreshed' })).not.toBeNull();
  release();
  expect((await pending).success).toBe(true);
  expect((await manager.load(a))?.value).toBe('new-signin');
});


for (const action of ['delete', 'recreate', 'change-route']) {
  test(`file-backed source ${action} prevents obsolete refresh publication`, async () => {
    const manager = new SourceCredentialManager(), a = source('file-' + action);
    mkdirSync(a.folderPath, { recursive: true });
    const configPath = join(a.folderPath, 'config.json');
    writeFileSync(configPath, JSON.stringify(a.config));
    await manager.save(a, { value: 'old' });
    const deferred = delayedFetch();
    const pending = manager.refresh(a).catch(error => error);
    await waitForProvider();
    if (action === 'delete') rmSync(a.folderPath, { recursive: true });
    else if (action === 'recreate') {
      rmSync(a.folderPath, { recursive: true }); mkdirSync(a.folderPath);
      writeFileSync(configPath, JSON.stringify({ ...a.config, id: 'replacement' }));
    } else writeFileSync(configPath, JSON.stringify({ ...a.config, api: { ...a.config.api, baseUrl: 'https://new.invalid/' } }));
    deferred.release();
    expect((await pending).name).toBe('SourceAuthSupersededError');
    expect((await manager.load(a))?.value).toBe('old');
    if (action !== 'delete') expect(JSON.parse(readFileSync(configPath, 'utf8')).connectionStatus).toBeUndefined();
  });
}

test('obsolete failure cannot mark reconnected source needs_auth or start cooldown', async () => {
  const { TokenRefreshManager } = await import('../token-refresh-manager.ts');
  const manager = new SourceCredentialManager(), a = source('failed');
  mkdirSync(a.folderPath, { recursive: true });
  const configPath = join(a.folderPath, 'config.json');
  writeFileSync(configPath, JSON.stringify({ ...a.config, isAuthenticated: true, connectionStatus: 'connected' }));
  await manager.save(a, { value: 'old' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async () => { await gate; return new Response('old account rejected', { status: 401 }); }) as unknown as typeof fetch;
  const refreshes = new TokenRefreshManager(manager);
  const pending = refreshes.ensureFreshToken(a);
  await waitForProvider();
  await manager.save(a, { value: 'new-account' });
  release();
  expect((await pending).success).toBe(false);
  expect(refreshes.isInCooldown(a.config.slug)).toBe(false);
  expect(JSON.parse(readFileSync(configPath, 'utf8')).connectionStatus).toBe('connected');
  expect((await manager.load(a))?.value).toBe('new-account');
});

test('cancelling an older flow cannot invalidate the newest sign-in intent', async () => {
  const manager = new SourceCredentialManager(), a = source('cancel');
  const old = await manager.beginAuthentication(a), latest = await manager.beginAuthentication(a);
  expect(await manager.cancelAuthentication(a, old)).toBe(false);
  expect(await manager.cancelAuthentication(a, latest)).toBe(true);
  const release = delayedExchange();
  const pending = manager.exchangeAndStore(a, 'generic', exchangeParams, { authIntentRevision: latest });
  release();
  expect((await pending).success).toBe(false);
  expect(await manager.load(a)).toBeNull();
});


for (const email of ['other@example.test', ' Original@Example.Test ']) {
  test(`OAuth refresh-token inheritance requires confirmed same account (${email})`, async () => {
    const manager = new SourceCredentialManager(), a = source('account-email');
    a.config = { ...a.config, provider: 'google' };
    await manager.save(a, { value: 'old-access', refreshToken: 'old-refresh', accountEmail: 'original@example.test' });
    globalThis.fetch = (async (url: string | URL | Request) => new Response(JSON.stringify(
      String(url).includes('token') ? { access_token: 'new-access', expires_in: 3600 } : { email },
    ))) as typeof fetch;
    const result = await manager.exchangeAndStore(a, 'google', exchangeParams);
    expect(result.success).toBe(true);
    expect((await manager.load(a))?.refreshToken).toBe(email.startsWith('other') ? undefined : 'old-refresh');
  });
}

test('disconnect status update never marks an already reconnected source', async () => {
  const manager = new SourceCredentialManager(), a = source('disconnect');
  mkdirSync(a.folderPath, { recursive: true });
  const configPath = join(a.folderPath, 'config.json');
  writeFileSync(configPath, JSON.stringify({ ...a.config, isAuthenticated: true, connectionStatus: 'connected' }));
  await manager.save(a, { value: 'new-account' });
  expect(await manager.markSourceNeedsReauthIfDisconnected(a, 'Disconnected')).toBe(false);
  expect(JSON.parse(readFileSync(configPath, 'utf8')).connectionStatus).toBe('connected');
  await manager.delete(a);
  expect(await manager.markSourceNeedsReauthIfDisconnected(a, 'Disconnected')).toBe(true);
  expect(JSON.parse(readFileSync(configPath, 'utf8')).connectionStatus).toBe('needs_auth');
});


test('stale LoadedSource cannot refresh the old route after disk configuration changed', async () => {
  const manager = new SourceCredentialManager(), a = source('stale-admission');
  mkdirSync(a.folderPath, { recursive: true });
  writeFileSync(join(a.folderPath, 'config.json'), JSON.stringify({ ...a.config, api: { ...a.config.api, baseUrl: 'https://replacement.invalid/' } }));
  await manager.save(a, { value: 'existing' });
  const deferred = delayedFetch();
  const result = await manager.refresh(a).catch(error => error);
  expect(result.name).toBe('SourceAuthSupersededError');
  expect(deferred.calls).toHaveLength(0);
  expect((await manager.load(a))?.value).toBe('existing');
});

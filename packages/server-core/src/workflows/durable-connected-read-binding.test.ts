import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSource } from '../../../shared/src/sources/storage';
import type { StoredCredential } from '../../../shared/src/credentials/types';
import { createDurableConnectedReadBindingResolver } from './durable-connected-read-binding';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'connected-binding-')); roots.push(root);
  const directory = join(root, 'sources', 'account'); mkdirSync(directory, { recursive: true });
  const workspace = { id: 'workspace', slug: 'workspace', name: 'Workspace', rootPath: root, createdAt: 1 };
  const config = { id: 'source', slug: 'account', name: 'Account', provider: 'fixture', type: 'api', enabled: true,
    isAuthenticated: true, api: { baseUrl: 'https://api.example.com/v1/', authType: 'bearer' } };
  const save = () => writeFileSync(join(directory, 'config.json'), JSON.stringify(config)); save();
  writeFileSync(join(directory, 'guide.md'), 'Private account guide');
  let credential: StoredCredential | null = { value: 'synthetic-account-secret' };
  const deps = { getWorkspaces: () => [workspace], loadSource,
    loadCredential: async () => credential, now: () => 1000 };
  const resolver = createDurableConnectedReadBindingResolver(deps);
  return { root, directory, workspace, config, save, deps, resolver, urls: ['https://api.example.com/v1/items'],
    setCredential: (value: StoredCredential | null) => credential = value };
}

test('captures source identity without secrets or guide text; serialized binding reopens unchanged', async () => {
  const f = fixture(), saved = await f.resolver.capture('workspace', 'account', f.urls);
  expect(saved.credentialIdentity).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(saved)).not.toContain('synthetic-account-secret');
  expect(JSON.stringify(saved)).not.toContain('Private account guide');
  expect(JSON.stringify(saved)).not.toContain(f.root);
  const reopened = createDurableConnectedReadBindingResolver(f.deps);
  await reopened.assertCurrent(JSON.parse(JSON.stringify(saved)));
});

for (const change of ['rotation', 'removal', 'expiry', 'disabled', 'unauthenticated', 'config', 'guide', 'root'] as const) {
  test(`persisted connection refuses ${change} before any future dispatch`, async () => {
    const f = fixture(), saved = await f.resolver.capture('workspace', 'account', f.urls);
    if (change === 'rotation') f.setCredential({ value: 'replacement-secret' });
    if (change === 'removal') f.setCredential(null);
    if (change === 'expiry') f.setCredential({ value: 'synthetic-account-secret', expiresAt: 1000 });
    if (change === 'disabled') { f.config.enabled = false; f.save(); }
    if (change === 'unauthenticated') { f.config.isAuthenticated = false; f.save(); }
    if (change === 'config') { f.config.name = 'Different account'; f.save(); }
    if (change === 'guide') writeFileSync(join(f.directory, 'guide.md'), 'Changed instructions');
    if (change === 'root') {
      const moved = f.root + '-old'; renameSync(f.root, moved); roots.push(moved);
      mkdirSync(f.directory, { recursive: true }); f.save();
      writeFileSync(join(f.directory, 'guide.md'), 'Private account guide');
    }
    await expect(f.resolver.assertCurrent(saved)).rejects.toThrow('durable-connected-read-binding-unavailable');
  });
}

test('rejects unsupported transports, auth and unsafe URL scopes', async () => {
  const f = fixture();
  for (const urls of [[], ['https://other.example.com/v1/items'], ['http://api.example.com/v1/items'],
    ['https://api.example.com/v10/items'], ['https://api.example.com/v1/items?token=secret'],
    ['https://api.example.com/v1/%2fadmin'], ['https://api.example.com/v1/../admin'],
    ['https://user:secret@api.example.com/v1/items'], ['https://api.example.com/v1/items#fragment']]) {
    await expect(f.resolver.capture('workspace', 'account', urls)).rejects.toThrow('binding-unavailable');
  }
  for (const patch of [{ type: 'mcp' }, { provider: 'google' }, { api: { ...f.config.api, authType: 'oauth' } },
    { api: { ...f.config.api, authScheme: 'Token' } }, { api: { ...f.config.api, defaultHeaders: {} } },
    { api: { ...f.config.api, renewEndpoint: {} } }]) {
    writeFileSync(join(f.directory, 'config.json'), JSON.stringify({ ...f.config, ...patch }));
    await expect(f.resolver.capture('workspace', 'account', f.urls)).rejects.toThrow('binding-unavailable');
  }
});

test('does not follow source/config symlinks or accept global-tier substitution', async () => {
  const f = fixture();
  const alternate = join(f.root, 'alternate.json'); renameSync(join(f.directory, 'config.json'), alternate);
  symlinkSync(alternate, join(f.directory, 'config.json'));
  await expect(f.resolver.capture('workspace', 'account', f.urls)).rejects.toThrow('binding-unavailable');
  rmSync(join(f.directory, 'config.json')); renameSync(alternate, join(f.directory, 'config.json'));
  const global = createDurableConnectedReadBindingResolver({ ...f.deps, loadSource: (...args) => ({ ...loadSource(...args)!, tier: 'global' }) });
  await expect(global.capture('workspace', 'account', f.urls)).rejects.toThrow('binding-unavailable');
  await expect(f.resolver.capture('workspace', '../account', f.urls)).rejects.toThrow('binding-unavailable');
});

test('rejects source mutation and credential rotation during awaited credential lookups', async () => {
  for (const change of ['source', 'credential'] as const) {
    const f = fixture(); let calls = 0;
    const resolver = createDurableConnectedReadBindingResolver({ ...f.deps, loadCredential: async () => {
      calls++;
      if (change === 'source') { f.config.api.baseUrl = 'https://replacement.example.com/v1/'; f.save(); }
      return { value: calls === 1 ? 'first-secret' : 'rotated-secret' };
    } });
    await expect(resolver.capture('workspace', 'account', f.urls)).rejects.toThrow('binding-unavailable');
  }
});

test('caller mutation during capture cannot widen the frozen URL list', async () => {
  const f = fixture(); const original = [...f.urls];
  const resolver = createDurableConnectedReadBindingResolver({ ...f.deps, loadCredential: async () => {
    f.urls.push('https://api.example.com/v1/other'); return { value: 'fixed-secret' };
  } });
  expect((await resolver.capture('workspace', 'account', f.urls)).urls).toEqual(original);
});

test('sanitizes loader errors and refuses malformed/expired/refreshable bearer records', async () => {
  const f = fixture();
  for (const credential of [{ value: 'bad\r\nAuthorization: injected' }, { value: '' }, { value: 'a'.repeat(8193) },
    { value: 'secret', expiresAt: NaN }, { value: 'secret', expiresAt: 999 }, { value: 'secret', refreshToken: 'refresh' }]) {
    f.setCredential(credential);
    await expect(f.resolver.capture('workspace', 'account', f.urls)).rejects.toThrow('binding-unavailable');
  }
  const resolver = createDurableConnectedReadBindingResolver({ ...f.deps, loadCredential: async () => { throw new Error('private account secret'); } });
  try { await resolver.capture('workspace', 'account', f.urls); throw new Error('expected rejection'); }
  catch (error) { expect((error as Error).message).toBe('durable-connected-read-binding-unavailable'); }
});

test('unreadable guides reject capture and recovery instead of silently becoming empty', async () => {
  const f = fixture(), saved = await f.resolver.capture('workspace', 'account', f.urls);
  const path = join(f.directory, 'guide.md'); chmodSync(path, 0);
  try {
    expect(loadSource(f.root, 'account')!.guide).toBeNull();
    await expect(f.resolver.capture('workspace', 'account', f.urls)).rejects.toThrow('binding-unavailable');
    await expect(f.resolver.assertCurrent(saved)).rejects.toThrow('binding-unavailable');
  } finally { chmodSync(path, 0o600); }
  await f.resolver.assertCurrent(saved);
});

test('an absent guide and an empty guide have different saved identities', async () => {
  const f = fixture(); rmSync(join(f.directory, 'guide.md'));
  const saved = await f.resolver.capture('workspace', 'account', f.urls);
  writeFileSync(join(f.directory, 'guide.md'), '');
  await expect(f.resolver.assertCurrent(saved)).rejects.toThrow('binding-unavailable');
});

import { expect, test } from 'bun:test';
import { createDurableReadBindingResolver } from './durable-read-binding';
import type { DurableReadBinding } from './durable-read-runner';
import { durableCredentialIdentity } from '../../../shared/src/protocol/durable-execution';
function fixture() {
  const workspace = { id: 'w', rootPath: '/tmp/fixture', name: 'Fixture', slug: 'fixture', createdAt: 1 };
  const context: DurableReadBinding['context'] = { provider: 'pi', authType: 'api_key', resolvedModel: 'model', capabilities: { needsHttpPoolServer: false }, connection: { slug: 'chosen', name: 'Chosen', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1 } };
  let key: string | null = 'synthetic-secret';
  const deps = { getWorkspaces: () => [workspace], resolveContext: () => context, getApiKey: async (slug: string) => { expect(slug).toBe('chosen'); return key; } };
  return { workspace, context, deps, resolve: createDurableReadBindingResolver(deps), setKey: (value: string | null) => key = value };
}

test('pins the exact route and returns a credential fingerprint without the key', async () => {
  const f = fixture(), result = await f.resolve('w', 'chosen', 'model');
  expect(result.credentialIdentity).toBe(await durableCredentialIdentity({ provider: 'openai', credential: { type: 'api_key', key: 'synthetic-secret' } }));
  expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  f.setKey('rotated'); expect((await f.resolve('w', 'chosen', 'model')).credentialIdentity).not.toBe(result.credentialIdentity);
});

test('rejects missing workspaces, substituted connections/models and unsupported auth', async () => {
  const f = fixture();
  await expect(f.resolve('unknown', 'chosen', 'model')).rejects.toThrow('local-workspace');
  await expect(f.resolve('w', 'missing', 'model')).rejects.toThrow('exact-route');
  await expect(f.resolve('w', 'chosen', 'other')).rejects.toThrow('exact-route');
  f.context.authType = 'oauth'; await expect(f.resolve('w', 'chosen', 'model')).rejects.toThrow('api-key');
});

test('rejects missing keys and configuration changes while credentials load', async () => {
  const f = fixture(); f.setKey(null);
  await expect(f.resolve('w', 'chosen', 'model')).rejects.toThrow('credential-required');
  const resolve = createDurableReadBindingResolver({ ...f.deps, getApiKey: async () => { f.workspace.rootPath = '/changed'; return 'key'; } });
  await expect(resolve('w', 'chosen', 'model')).rejects.toThrow('binding-changed');
});

test('OpenRouter and explicit custom endpoints match the Pi transport fingerprint', async () => {
  const f = fixture();
  for (const provider of ['openrouter', 'openai']) {
    f.context.connection!.piAuthProvider = provider;
    if (provider === 'openai') f.context.connection!.customEndpoint = { api: 'openai-completions' };
    expect((await f.resolve('w', 'chosen', 'model')).credentialIdentity).toBe(await durableCredentialIdentity({ provider: 'custom-endpoint', credential: { type: 'api_key', key: 'synthetic-secret' } }));
  }
});

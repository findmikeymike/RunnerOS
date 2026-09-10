import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CredentialBackend } from './backends/types.ts';
import type { CredentialId, StoredCredential } from './types.ts';
import type { LlmConnection } from '../config/llm-connections.ts';

const root = mkdtempSync(join(tmpdir(), 'provider-attention-reset-'));
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;
process.env.CRAFT_CONFIG_DIR = root;
const { CredentialManager } = await import('./manager.ts');
const { modelCooldownRegistry: cooldowns } = await import('../agent/model-fallback.ts');
const { updateLlmConnection } = await import('../config/storage.ts');
const { credentialIdToAccount } = await import('./types.ts');
const configPath = join(root, 'config.json');
const workspace = { id: 'fixture', name: 'Fixture', rootPath: join(root, 'workspace'), createdAt: 1 };
mkdirSync(workspace.rootPath);
const connection: LlmConnection = { slug: 'target', name: 'Target', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', createdAt: 1, models: ['model-a'], defaultModel: 'model-a' };

beforeEach(() => {
  cooldowns.clearAll();
  for (const slug of ['target', 'other', 'anthropic-api', 'claude-max']) {
    cooldowns.markFailure({ connectionSlug: slug, model: 'auth-model', reason: 'invalid_api_key' });
    cooldowns.markFailure({ connectionSlug: slug, model: 'billing-model', reason: 'billing_error' });
    cooldowns.markFailure({ connectionSlug: slug, model: 'network-model', reason: 'network_error' });
  }
  writeFileSync(configPath, JSON.stringify({ workspaces: [workspace], activeWorkspaceId: workspace.id, activeSessionId: null, defaultLlmConnection: 'target', llmConnections: [connection] }));
});
afterAll(() => {
  cooldowns.clearAll();
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
  rmSync(root, { recursive: true, force: true });
});

function memoryCredentials() {
  const values = new Map<string, StoredCredential>();
  let fail = false;
  const backend: CredentialBackend = {
    name: 'fixture', priority: 1, isAvailable: async () => true,
    get: async id => values.get(credentialIdToAccount(id)) ?? null,
    set: async (id, value) => { if (fail) throw new Error('Fixture write failed'); values.set(credentialIdToAccount(id), value); },
    delete: async id => { if (fail) throw new Error('Fixture delete failed'); return values.delete(credentialIdToAccount(id)); },
    list: async () => [],
  };
  const manager = new CredentialManager();
  Object.assign(manager, { initialized: true, backends: [backend], writeBackend: backend });
  return { manager, seed: (id: CredentialId) => values.set(credentialIdToAccount(id), { value: 'fixture' }), fail: () => { fail = true; } };
}
function expectAttention(slug: string, present: boolean) {
  expect(cooldowns.isCoolingDown(slug, 'auth-model')).toBe(present);
  expect(cooldowns.isCoolingDown(slug, 'billing-model')).toBe(present);
  expect(cooldowns.isCoolingDown(slug, 'network-model')).toBe(true);
}

describe('credential repairs clear only matching auth/billing cooldowns', () => {
  for (const type of ['llm_api_key', 'llm_oauth', 'llm_iam', 'llm_service_account'] as const) {
    for (const action of ['set', 'delete'] as const) {
      test(`${action} ${type} clears only the repaired connection`, async () => {
        const fixture = memoryCredentials();
        const id = { type, connectionSlug: 'target' };
        fixture.seed(id);
        if (action === 'set') await fixture.manager.set(id, { value: 'repaired' });
        else expect(await fixture.manager.delete(id)).toBe(true);
        expectAttention('target', false);
        expectAttention('other', true);
      });
    }
  }
  for (const type of ['anthropic_api_key', 'claude_oauth'] as const) {
    for (const action of ['set', 'delete'] as const) {
      test(`legacy ${type} ${action} clears only its conventional migrated route`, async () => {
        const fixture = memoryCredentials();
        fixture.seed({ type });
        if (action === 'set') await fixture.manager.set({ type }, { value: 'repaired' });
        else expect(await fixture.manager.delete({ type })).toBe(true);
        expectAttention(type === 'anthropic_api_key' ? 'anthropic-api' : 'claude-max', false);
        expectAttention(type === 'anthropic_api_key' ? 'claude-max' : 'anthropic-api', true);
        expectAttention('target', true);
        expectAttention('other', true);
      });
    }
  }
  test('failed writes, failed deletes, and absent deletes do not reset attention', async () => {
    const fixture = memoryCredentials();
    const id = { type: 'llm_api_key' as const, connectionSlug: 'target' };
    expect(await fixture.manager.delete(id)).toBe(false);
    fixture.seed(id); fixture.fail();
    await expect(fixture.manager.set(id, { value: 'failed' })).rejects.toThrow('Fixture write failed');
    expect(await fixture.manager.delete(id)).toBe(false);
    expectAttention('target', true);
  });
  test('source and user secret edits leave all provider attention intact', async () => {
    const fixture = memoryCredentials();
    for (const id of [{ type: 'user_secret' as const, name: 'FIXTURE' }, { type: 'source_apikey' as const, workspaceId: 'fixture', sourceId: 'source' }]) {
      await fixture.manager.set(id, { value: 'not-provider-auth' });
      expect(await fixture.manager.delete(id)).toBe(true);
    }
    expectAttention('target', true);
    expectAttention('other', true);
  });
});

describe('saved provider route repairs reset attention', () => {
  const routes: Partial<LlmConnection>[] = [
    { providerType: 'anthropic' }, { authType: 'oauth' }, { baseUrl: 'https://new.example' },
    { piAuthProvider: 'anthropic' }, { customEndpoint: { api: 'anthropic-messages' } },
  ];
  for (const update of routes) {
    test(`changing ${Object.keys(update)[0]} clears only repaired provider attention`, () => {
      expect(updateLlmConnection('target', update)).toBe(true);
      expectAttention('target', false);
      expectAttention('other', true);
      expect(JSON.parse(readFileSync(configPath, 'utf8')).llmConnections[0]).toMatchObject(update);
    });
  }
  test('successful connection test may explicitly clear attention even without a persisted warning', () => {
    expect(updateLlmConnection('target', { modelFallbackAttention: undefined })).toBe(true);
    expectAttention('target', false);
  });
  test('display/model edits, unchanged routes, and setting attention do not reset backoff', () => {
    expect(updateLlmConnection('target', { name: 'Renamed', models: ['model-b'], lastUsedAt: 2, providerType: 'pi', authType: 'api_key', piAuthProvider: 'openai', modelFallbackAttention: { reason: 'connection-auth-failed', errorCode: 'invalid_api_key', model: 'auth-model', observedAt: new Date().toISOString() } })).toBe(true);
    expectAttention('target', true);
  });
  test('missing connection and rejected fallback edit do not reset cooldowns', () => {
    expect(updateLlmConnection('absent', { baseUrl: 'https://new.example' })).toBe(false);
    expect(updateLlmConnection('target', { baseUrl: 'https://new.example', fallbackChain: { enabled: true, entries: [{ connectionSlug: 'target', model: 'model-a' }] } })).toBe(false);
    expectAttention('target', true);
  });
  test('failed config save retains attention despite a proposed route repair', () => {
    const original = readFileSync(configPath, 'utf8');
    const updates: Partial<LlmConnection> = {
      get baseUrl() {
        // Config was already read. Simulate the destination becoming unwritable
        // before commit, without mocking any filesystem implementation.
        rmSync(configPath, { recursive: true, force: true });
        mkdirSync(configPath);
        return 'https://new.example';
      },
    };
    try {
      expect(() => updateLlmConnection('target', updates)).toThrow();
      expectAttention('target', true);
    } finally {
      rmSync(configPath, { recursive: true, force: true });
      writeFileSync(configPath, original);
    }
  });

});

import { describe, expect, test } from 'bun:test';
import type { LlmConnectionWithStatus, ModelFallbackChain } from '../llm-connections.ts';
import {
  resolveModelFallbackChain,
  validateModelFallbackChain,
  updateModelFallbackProfile,
  selectModelFallbackProfile,
} from '../model-fallback.ts';

function connection(
  slug: string,
  model: string,
  options: Partial<LlmConnectionWithStatus> = {},
): LlmConnectionWithStatus {
  return {
    slug,
    name: slug,
    providerType: 'anthropic',
    authType: 'api_key',
    defaultModel: model,
    models: [model],
    createdAt: 1,
    isAuthenticated: true,
    ...options,
  };
}

describe('model fallback chain config', () => {
  test('rejects oversized, duplicate, blank, and primary-self entries', () => {
    const chain: ModelFallbackChain = {
      enabled: true,
      entries: [
        { connectionSlug: 'primary', model: 'model-a' },
        { connectionSlug: 'backup', model: '' },
        { connectionSlug: 'backup', model: '' },
      ],
    };

    expect(validateModelFallbackChain(chain, {
      connectionSlug: 'primary',
      model: 'model-a',
    })).toEqual(expect.arrayContaining([
      'too-many-entries',
      'missing-model',
      'duplicate-entry',
      'self-reference',
    ]));
  });

  test('uses a connection override before the global chain', () => {
    const primary = connection('primary', 'model-a', {
      fallbackChain: { enabled: true, entries: [{ connectionSlug: 'private-backup' }] },
    });
    const resolution = resolveModelFallbackChain({
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      connections: [primary, connection('private-backup', 'model-b'), connection('global-backup', 'model-c')],
      globalChain: { enabled: true, entries: [{ connectionSlug: 'global-backup' }] },
    });

    expect(resolution.candidates).toEqual([
      { connectionSlug: 'private-backup', model: 'model-b', chainIndex: 1 },
    ]);
  });

  test('disabled chains preserve fail-fast behavior', () => {
    expect(resolveModelFallbackChain({
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      connections: [connection('primary', 'model-a'), connection('backup', 'model-b')],
      globalChain: { enabled: false, entries: [{ connectionSlug: 'backup' }] },
    })).toEqual({ candidates: [], skipped: [] });
  });

  test('skips broken entries and resolves an omitted model from the connection default', () => {
    const resolution = resolveModelFallbackChain({
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      connections: [
        connection('primary', 'model-a'),
        connection('signed-out', 'model-b', { isAuthenticated: false }),
        connection('backup', 'model-c'),
      ],
      globalChain: {
        enabled: true,
        entries: [
          { connectionSlug: 'signed-out' },
          { connectionSlug: 'backup' },
        ],
      },
    });

    expect(resolution.skipped).toEqual([
      { entry: { connectionSlug: 'signed-out' }, chainIndex: 1, reason: 'unauthenticated-connection' },
    ]);
    expect(resolution.candidates).toEqual([
      { connectionSlug: 'backup', model: 'model-c', chainIndex: 2 },
    ]);
  });

  test('records deleted, self-referencing, duplicate, and model-less entries', () => {
    const noModel = connection('no-model', '', { defaultModel: undefined, models: [] });
    const connections = [connection('primary', 'model-a'), connection('backup', 'model-b'), noModel];

    expect(resolveModelFallbackChain({
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      connections,
      globalChain: { enabled: true, entries: [{ connectionSlug: 'missing' }] },
    }).skipped[0]?.reason).toBe('deleted-connection');

    expect(resolveModelFallbackChain({
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      connections,
      globalChain: { enabled: true, entries: [{ connectionSlug: 'primary', model: 'model-a' }] },
    }).skipped[0]?.reason).toBe('self-reference');

    expect(resolveModelFallbackChain({
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      connections,
      globalChain: { enabled: true, entries: [{ connectionSlug: 'no-model' }] },
    }).skipped[0]?.reason).toBe('missing-model');

    const duplicate = resolveModelFallbackChain({
      primaryConnectionSlug: 'primary',
      primaryModel: 'model-a',
      connections,
      globalChain: { enabled: true, entries: [
        { connectionSlug: 'backup', model: 'model-b' },
        { connectionSlug: 'backup', model: 'model-b' },
      ] },
    });
    expect(duplicate.candidates).toHaveLength(1);
    expect(duplicate.skipped[0]?.reason).toBe('duplicate-entry');
  });
});

describe('work-type fallback profiles', () => {
  const primary = connection('primary', 'model-a');
  const backup = connection('backup', 'model-b');
  const profile = { enabled: true, entries: [{ connectionSlug: 'backup', model: 'model-b' }] };
  const input = { primaryConnectionSlug: 'primary', primaryModel: 'model-a', connections: [primary, backup] };

  test('explicit work types never borrow general or another role', () => {
    expect(resolveModelFallbackChain({ ...input, role: 'reasoning', globalChain: profile }).candidates).toEqual([]);
    expect(resolveModelFallbackChain({ ...input, role: 'fast', globalChain: { ...profile, profiles: { reasoning: profile } } }).candidates).toEqual([]);
    expect(resolveModelFallbackChain({ ...input, globalChain: profile }).candidates).toHaveLength(1);
  });

  test('each role inherits independently and an explicit disabled override wins', () => {
    const local = { enabled: false, entries: [], profiles: { reasoning: { enabled: false, entries: [] } } };
    const args = { ...input, connections: [{ ...primary, fallbackChain: local }, backup], globalChain: { enabled: false, entries: [], profiles: { reasoning: profile, fast: profile } } };
    expect(resolveModelFallbackChain({ ...args, role: 'reasoning' }).candidates).toEqual([]);
    expect(resolveModelFallbackChain({ ...args, role: 'fast' }).candidates).toHaveLength(1);
  });

  test('role-only provider settings preserve general inheritance', () => {
    expect(resolveModelFallbackChain({ ...input, connections: [{ ...primary, fallbackChain: { enabled: false, entries: [], inheritGeneral: true, profiles: { reasoning: profile } } }, backup], globalChain: profile }).candidates).toHaveLength(1);
  });

  test('validates both profiles with the same limits', () => {
    expect(validateModelFallbackChain({ ...profile, profiles: { fast: { ...profile, entries: [...profile.entries, ...profile.entries, ...profile.entries] } } })).toEqual(expect.arrayContaining(['too-many-entries', 'duplicate-entry']));
    expect(validateModelFallbackChain({ ...profile, profiles: { reasoning: { enabled: true, entries: [{ connectionSlug: 'primary', model: 'model-a' }] } } }, { connectionSlug: 'primary', model: 'model-a' })).toContain('self-reference');
  });

  test('malformed runtime profiles fail closed without throwing or inheriting', () => {
    for (const malformed of [null, true, {}, { enabled: true, entries: null }, { enabled: true, entries: [null] }, { enabled: 'true', entries: [] }]) {
      const local = { ...profile, profiles: { reasoning: malformed } } as unknown as ModelFallbackChain;
      expect(validateModelFallbackChain(local)).toContain('invalid-chain');
      expect(selectModelFallbackProfile(local, { ...profile, profiles: { reasoning: profile } }, 'reasoning')).toBeUndefined();
      expect(resolveModelFallbackChain({ ...input, connections: [{ ...primary, fallbackChain: local }, backup], role: 'reasoning', globalChain: { ...profile, profiles: { reasoning: profile } } }).candidates).toEqual([]);
    }
  });
});


test('editing and removing one Settings work type preserves all siblings', () => {
  const general = { enabled: true, entries: [{ connectionSlug: 'general', model: 'g' }] };
  const reasoning = { enabled: true, entries: [{ connectionSlug: 'reasoning', model: 'r' }] };
  const fast = { enabled: true, entries: [{ connectionSlug: 'fast', model: 'f' }] };
  const original = { ...general, profiles: { reasoning, fast } };
  expect(updateModelFallbackProfile(original, 'reasoning', undefined)).toEqual({ ...general, profiles: { fast } });
  expect(updateModelFallbackProfile(original, undefined, undefined)).toEqual({ enabled: false, entries: [], inheritGeneral: true, profiles: { reasoning, fast } });
  expect(updateModelFallbackProfile(original, undefined, { enabled: false, entries: [] })?.profiles).toEqual({ reasoning, fast });
  const roleOnly = updateModelFallbackProfile(undefined, 'reasoning', reasoning);
  expect(roleOnly?.inheritGeneral).toBe(true);
  expect(updateModelFallbackProfile(roleOnly, 'reasoning', undefined)).toBeUndefined();
  expect(updateModelFallbackProfile(original, undefined, { ...general, profiles: { fast: { enabled: false, entries: [] } } } as ModelFallbackChain)?.profiles).toEqual({ reasoning, fast });
  expect(original).toEqual({ ...general, profiles: { reasoning, fast } });
});

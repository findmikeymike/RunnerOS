import { describe, expect, test } from 'bun:test';
import type { LlmConnectionWithStatus, ModelFallbackChain } from '../llm-connections.ts';
import {
  resolveModelFallbackChain,
  validateModelFallbackChain,
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

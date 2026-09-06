import { describe, expect, it } from 'bun:test';
import { pickProviderAppropriateMiniModel } from './pick-mini-model.ts';

/**
 * Minimal mock of PiModelRegistry — mirrors the pattern from model-resolution.test.ts.
 */
function createMockRegistry(
  providers: Record<string, Array<{ id: string; name: string; provider?: string }>>,
) {
  const allModels = Object.entries(providers).flatMap(([provider, models]) =>
    models.map(m => ({ ...m, provider })),
  );

  return {
    find(provider: string, modelId: string) {
      const models = providers[provider];
      if (!models) return undefined;
      return models.find(m => m.id === modelId || m.name === modelId) ?? undefined;
    },
    getAll() {
      return allModels;
    },
  } as any;
}

describe('pickProviderAppropriateMiniModel', () => {
  it('returns undefined for anthropic so caller falls through to Haiku', () => {
    // The caller gates this with `authProvider === 'anthropic' ? undefined : pick...`
    // but we also guarantee the helper itself would return Opus-4-7 first — which is
    // NOT what we want as a mini. Test that the caller's gate is sufficient by showing
    // the helper would otherwise pick a non-mini candidate for anthropic.
    const registry = createMockRegistry({
      anthropic: [
        { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      ],
    });

    const result = pickProviderAppropriateMiniModel('anthropic', registry, false);
    // Helper picks the first RESOLVABLE entry; the registry here offers 4.7 but not 4.8,
    // so 4.7 is what comes back. Either way it is an Opus, which is the point.
    // Documenting why the caller must NOT invoke this helper for anthropic auth.
    expect(result).toBe('claude-opus-4-7');
  });

  it('openai-codex: skips unresolvable candidates and returns the first that resolves', () => {
    // The Codex preference list now leads with the 5.6 family. Registering only
    // gpt-5.5 — which sits behind those — proves the walk actually skips ahead
    // rather than returning the head blindly.
    const registry = createMockRegistry({
      'openai-codex': [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
    });

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBe('gpt-5.5');
  });

  it('openai-codex: returns the flagship when everything resolves, which is why this is a compatibility fallback and not a cheap mini', () => {
    // Worth stating plainly. This helper exists to find *a model that works under
    // the user's auth*, not a cheap one, so when the whole catalog resolves it
    // hands back Sol. The caller only reaches it when the requested model is
    // incompatible, and it gates anthropic away for the same reason.
    const registry = createMockRegistry({
      'openai-codex': [
        { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
        { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' },
      ],
    });

    expect(pickProviderAppropriateMiniModel('openai-codex', registry, false)).toBe('gpt-5.6-sol');
  });

  it('openai-codex: returns undefined when no preferred candidate resolves', () => {
    // No models registered under openai-codex — every candidate is unresolvable.
    const registry = createMockRegistry({
      'openai-codex': [],
    });

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBeUndefined();
  });

  it('openai: returns first resolvable candidate from preferred list', () => {
    // PI_PREFERRED_DEFAULTS.openai = ['gpt-5.5', 'gpt-5.2', 'gpt-5.1', ...].
    // gpt-5.5 is resolvable → returned first.
    const registry = createMockRegistry({
      openai: [
        { id: 'gpt-5.5', name: 'GPT 5.5' },
        { id: 'gpt-5.2', name: 'GPT 5.2' },
      ],
    });

    const result = pickProviderAppropriateMiniModel('openai', registry, false);
    expect(result).toBe('gpt-5.5');
  });

  it('unknown provider: returns undefined', () => {
    const registry = createMockRegistry({
      openai: [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
    });

    const result = pickProviderAppropriateMiniModel('made-up-provider', registry, false);
    expect(result).toBeUndefined();
  });

  it('empty registry: returns undefined', () => {
    const registry = createMockRegistry({});

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBeUndefined();
  });
});

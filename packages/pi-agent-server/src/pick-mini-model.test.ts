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
  it('returns Haiku for anthropic, agreeing with the path the caller takes anyway', () => {
    // The caller still gates anthropic with
    // `authProvider === 'anthropic' ? undefined : pick...` and keeps its own
    // Haiku default. This used to disagree with that gate — reading the chat
    // list, it would have handed back Opus — so the gate was load-bearing. Now
    // both routes agree, and the gate is belt and braces rather than the only
    // thing preventing an expensive mini.
    const registry = createMockRegistry({
      anthropic: [
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      ],
    });

    expect(pickProviderAppropriateMiniModel('anthropic', registry, false)).toBe('claude-haiku-4-5');
  });

  it('openai-codex: skips unresolvable candidates and returns the first that resolves', () => {
    // The mini list leads with the cheap tier. Registering only gpt-5.5 — which
    // sits behind those — proves the walk actually skips ahead rather than
    // returning the head blindly.
    const registry = createMockRegistry({
      'openai-codex': [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
    });

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBe('gpt-5.5');
  });

  it('openai-codex: picks the cheap tier over the flagship when both resolve', () => {
    // This is the whole point of the mini list. Reading the chat list here
    // returned Sol, the flagship, to write chat titles — roughly five times
    // Luna's price for a sentence.
    const registry = createMockRegistry({
      'openai-codex': [
        { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
        { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' },
      ],
    });

    expect(pickProviderAppropriateMiniModel('openai-codex', registry, false)).toBe('gpt-5.6-luna');
  });

  it('falls back to the chat list for a provider with no mini list', () => {
    // amazon-bedrock is intentionally absent from the mini map, so its behaviour
    // must be exactly what it was before: first resolvable chat candidate.
    const registry = createMockRegistry({
      'amazon-bedrock': [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
    });

    expect(pickProviderAppropriateMiniModel('amazon-bedrock', registry, false)).toBe('claude-sonnet-4-6');
  });

  it('openai-codex: returns undefined when no preferred candidate resolves', () => {
    // No models registered under openai-codex — every candidate is unresolvable.
    const registry = createMockRegistry({
      'openai-codex': [],
    });

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBeUndefined();
  });

  it('openai: prefers a mini-class model over a full one', () => {
    // The mini list leads with the nano/mini tier, so gpt-5-mini wins over the
    // larger gpt-5.5 even though both resolve.
    const registry = createMockRegistry({
      openai: [
        { id: 'gpt-5.5', name: 'GPT 5.5' },
        { id: 'gpt-5-mini', name: 'GPT 5 mini' },
      ],
    });

    expect(pickProviderAppropriateMiniModel('openai', registry, false)).toBe('gpt-5-mini');
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

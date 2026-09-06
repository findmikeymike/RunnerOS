import { describe, it, expect } from 'bun:test';
import { getPiApiKeyProviders, getPiModelsForAuthProvider } from '../src/config/models-pi.ts';
import { PI_MINI_PREFERRED_DEFAULTS, PI_PREFERRED_DEFAULTS } from '../src/config/llm-connections.ts';

describe('models-pi filtering', () => {
  it('excludes codex-mini-latest for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.includes('pi/codex-mini-latest')).toBe(false);
  });

  it('excludes all gpt-4* models for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.some(id => id.startsWith('pi/gpt-4'))).toBe(false);
  });

  it('surfaces the current GPT 5.6 family for OpenAI API-key and ChatGPT subscription connections', () => {
    for (const provider of ['openai', 'openai-codex']) {
      const ids = getPiModelsForAuthProvider(provider).map(model => model.id);
      expect(ids).toContain('pi/gpt-5.6-luna');
      expect(ids).toContain('pi/gpt-5.6-sol');
      expect(ids).toContain('pi/gpt-5.6-terra');
    }
  });

  const servedIds = (provider: string) =>
    new Set(getPiModelsForAuthProvider(provider).map(m => m.id.replace(/^pi\//, '')));
  const resolves = (served: Set<string>, id: string) =>
    served.has(id) || [...served].some(s => s.startsWith(`${id}-`));

  it('starts every preference list with a model the provider actually serves', () => {
    // The head is what a new connection lands on, so it is the one entry that
    // must never be dead. Later entries are allowed to miss: both consumers walk
    // the list and skip anything unresolvable.
    for (const provider of ['openai', 'openai-codex', 'anthropic']) {
      const preferred = PI_PREFERRED_DEFAULTS[provider] ?? [];
      expect(preferred.length).toBeGreaterThan(0);
      expect(resolves(servedIds(provider), preferred[0]!)).toBe(true);
    }
  });

  it('keeps the Codex preference list free of models Codex does not serve', () => {
    // This guards a real defect. The Codex list used to be a copy of the plain
    // `openai` one, and six of its seven entries were models Codex has never
    // served — only gpt-5.5 ever matched, so the preference did almost nothing.
    // Codex serves a small catalog, so unlike the other providers this list can
    // and should be exactly right.
    const served = servedIds('openai-codex');
    const unserved = (PI_PREFERRED_DEFAULTS['openai-codex'] ?? []).filter(id => !resolves(served, id));
    expect(unserved).toEqual([]);
  });

  it('keeps every utility-model entry resolvable, with no exceptions', () => {
    // Unlike the chat lists, this map has no tolerated dead entries: it was
    // written by checking each id against the live catalog, and a provider with
    // nothing verifiable was left out entirely rather than guessed at. Bedrock
    // is the omitted one — its ids are region-prefixed — and omission falls back
    // to the chat list, so no provider loses behaviour.
    for (const [provider, list] of Object.entries(PI_MINI_PREFERRED_DEFAULTS)) {
      const served = servedIds(provider);
      expect({ provider, unserved: list.filter(id => !resolves(served, id)) })
        .toEqual({ provider, unserved: [] });
    }
  });

  it('leads every utility list with something cheaper than that provider\'s chat default', () => {
    // The regression this guards is subtle: both maps are hand-maintained, and
    // if the utility list ever starts with the chat flagship it silently stops
    // saving anything while still looking intentional.
    for (const provider of Object.keys(PI_MINI_PREFERRED_DEFAULTS)) {
      const chatHead = (PI_PREFERRED_DEFAULTS[provider] ?? [])[0];
      const miniHead = PI_MINI_PREFERRED_DEFAULTS[provider]![0];
      if (chatHead) expect(miniHead).not.toBe(chatHead);
    }
  });

  it('documents the two preference entries that intentionally do not resolve', () => {
    // Keeping these named means a future unresolvable entry stands out instead of
    // blending into an already-noisy list.
    expect((PI_PREFERRED_DEFAULTS['openai'] ?? []).filter(id => !resolves(servedIds('openai'), id)))
      // gpt-4o is served by OpenAI but filtered out of our catalog on purpose —
      // see the gpt-4* exclusion test above.
      .toEqual(['gpt-4o']);
    expect((PI_PREFERRED_DEFAULTS['anthropic'] ?? []).filter(id => !resolves(servedIds('anthropic'), id)))
      // Fable 5.1 is live on the direct Claude SDK path but has not reached the
      // Pi catalog yet. Listing it early is harmless and future-proof.
      .toEqual(['claude-fable-5-1']);
  });

  it('prefers the current GPT 5.6 generation for Codex, flagship first and a cheap tier present', () => {
    const preferred = PI_PREFERRED_DEFAULTS['openai-codex'] ?? [];
    // Sol is the flagship by upstream's cost basis and should be what a new
    // connection lands on. Luna is the cheap fast tier and must stay reachable.
    expect(preferred[0]).toBe('gpt-5.6-sol');
    expect(preferred).toContain('gpt-5.6-luna');
  });

  it('includes DeepSeek in the Pi API key provider list with a human-readable label', () => {
    const providers = getPiApiKeyProviders();
    expect(providers.some(provider => provider.key === 'deepseek' && provider.label === 'DeepSeek')).toBe(true);
  });

  it('returns current DeepSeek models from the Pi SDK catalog', () => {
    const models = getPiModelsForAuthProvider('deepseek');
    const ids = models.map(m => m.id);
    expect(ids).toContain('pi/deepseek-v4-flash');
    expect(ids).toContain('pi/deepseek-v4-pro');
  });
});

export interface PiModelInfo {
  id: string
  name: string
  costInput: number
  costOutput: number
  contextWindow: number
  reasoning: boolean
}

const PROVIDER_PREFERRED_TIERS: Record<string, { best: string; default_: string; cheap: string }> = {
  openrouter: {
    best: 'pi/moonshotai/kimi-k2.6',
    default_: 'pi/deepseek/deepseek-v4-pro',
    cheap: 'pi/openrouter/owl-alpha',
  },
  omniroute: {
    best: 'auto/best-free',
    default_: 'auto',
    cheap: 'auto/fast',
  },
}

/**
 * Routes a gateway answers but never lists in `/models`.
 *
 * OmniRoute's `/models` is a catalogue of concrete models. `auto` is the
 * general router, resolved server-side, so it serves requests happily while
 * never appearing in that catalogue — verified against the running gateway:
 * 477 models listed, `auto` absent, and a completion against `auto` returns
 * 200.
 *
 * Checking tiers against the catalogue alone therefore rejected the whole
 * OmniRoute preset and fell through to the generic cost picker, which handed
 * back arbitrary models from the 477.
 */
const PROVIDER_UNLISTED_ROUTES: Record<string, readonly string[]> = {
  omniroute: ['auto'],
}

/** Is this id usable on the provider, whether or not it is enumerated? */
function isUsableModel(id: string, listed: Set<string>, provider?: string): boolean {
  if (listed.has(id)) return true
  return provider ? (PROVIDER_UNLISTED_ROUTES[provider]?.includes(id) ?? false) : false
}

function pickProviderTierDefaults(
  models: PiModelInfo[],
  provider?: string,
): { best: string; default_: string; cheap: string } | null {
  if (!provider) return null
  const preferred = PROVIDER_PREFERRED_TIERS[provider]
  if (!preferred) return null

  const listed = new Set(models.map(m => m.id))
  const usable = (id: string) => isUsableModel(id, listed, provider)
  if (!usable(preferred.best) || !usable(preferred.default_) || !usable(preferred.cheap)) {
    return null
  }

  return preferred
}

/** Pick smart defaults for 3 tiers from a cost-sorted model list (expensive-first). */
export function pickTierDefaults(models: PiModelInfo[], provider?: string): { best: string; default_: string; cheap: string } {
  const providerDefaults = pickProviderTierDefaults(models, provider)
  if (providerDefaults) return providerDefaults

  if (models.length === 0) return { best: '', default_: '', cheap: '' }
  if (models.length === 1) return { best: models[0].id, default_: models[0].id, cheap: models[0].id }
  const best = models[0].id
  const cheap = models[models.length - 1].id
  // ~40% from the top gives a mid-expensive model (list is top-10 + bottom-10)
  const defaultIdx = Math.min(Math.floor(models.length * 0.4), models.length - 2)
  const default_ = models[defaultIdx].id
  return { best, default_, cheap }
}

export function resolveTierModels(models: PiModelInfo[], savedModels?: string[], provider?: string): { best: string; default_: string; cheap: string } {
  const defaults = pickTierDefaults(models, provider)
  const saved = (savedModels ?? []).filter(Boolean)
  if (saved.length === 0) return defaults

  // Same allowance as the defaults above: a saved `auto` is a working route,
  // not a stale id, so it must survive being reopened in settings. Without
  // this, opening the connection silently rewrote the middle tier to whatever
  // the generic picker chose and saving persisted it.
  const listed = new Set(models.map(m => m.id))
  const keep = (id: string | undefined) => Boolean(id) && isUsableModel(id!, listed, provider)
  const best = keep(saved[0]) ? saved[0]! : defaults.best
  const default_ = keep(saved[1]) ? saved[1]! : defaults.default_
  const cheap = keep(saved[2]) ? saved[2]! : defaults.cheap

  return { best, default_, cheap }
}

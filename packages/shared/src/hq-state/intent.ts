import type { HqOperationalScope } from './types.ts'

export interface HqIntentFingerprintInput {
  scope: HqOperationalScope
  worker?: string
  title: string
  intent?: string
  semanticIntentId?: string
}

export function hqIntentFingerprint(input: HqIntentFingerprintInput): string {
  const semanticIntentId = hqNormalizeSemanticIntentId(input.semanticIntentId)
  const scope = input.scope.type === 'campaign' ? `campaign:${input.scope.campaignId ?? 'unknown'}` : 'hq'
  const worker = cleanToken(input.worker) ?? 'unassigned'
  const intent = hqSemanticIntentId(input)
  return semanticIntentId ? `v2:${scope}:${semanticIntentId}` : `v1:${scope}:${worker}:${intent}`
}

export function hqNormalizeSemanticIntentId(value: string | undefined): string | undefined {
  return cleanToken(value)
}

export function hqSemanticIntentId(input: Pick<HqIntentFingerprintInput, 'title' | 'intent'>): string {
  const tokens = intentTokens(`${input.title} ${input.intent ?? ''}`)
  return intentCategory(tokens) ?? ([...new Set(tokens)].sort().slice(0, 6).join('-') || 'general')
}

export function hqIntentTokens(value: string): string[] {
  return intentTokens(value)
}

function intentCategory(tokens: string[]): string | undefined {
  const set = new Set(tokens)
  if (hasAny(set, ['cover', 'artwork'])) return 'cover-art'
  if (set.has('master')) return 'final-master'
  if (set.has('photo')) return 'press-photo'
  if (set.has('epk')) return 'epk'
  if (set.has('asset')) return 'release-assets-general'
  if (hasAny(set, ['approve', 'approval', 'review'])) return 'approval'
  if (hasAny(set, ['spotify', 'streaming', 'listeners'])) return 'spotify-intel'
  if (hasAny(set, ['outreach', 'contact', 'relationship', 'email'])) return 'outreach'
  if (hasAny(set, ['social', 'post', 'caption', 'publish'])) return 'social-content'
  if (hasAny(set, ['profile', 'identity', 'audience', 'branding'])) return 'artist-profile'
  if (hasAny(set, ['intel', 'research', 'report'])) return 'research'
  return undefined
}

function intentTokens(value: string): string[] {
  const ignored = new Set(['and', 'before', 'for', 'from', 'into', 'the', 'this', 'with', 'work', 'task', 'run', 'next', 'move'])
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !ignored.has(token))
}

function hasAny(tokens: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate))
}

function cleanToken(value: string | undefined): string | undefined {
  const clean = value?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return clean || undefined
}

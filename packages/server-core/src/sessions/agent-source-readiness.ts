import type { AgentListItem } from '@craft-agent/session-tools-core'

export interface SourceReadinessCandidate {
  slug: string
  enabled: boolean
  usable: boolean
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

export function resolveAgentSourceReadiness(
  requiredSourceSlugs: string[],
  optionalSourceSlugs: string[],
  candidates: SourceReadinessCandidate[],
): AgentListItem['sourceReadiness'] {
  const required = unique(requiredSourceSlugs)
  const requiredSet = new Set(required)
  const optional = unique(optionalSourceSlugs).filter(slug => !requiredSet.has(slug))
  const bySlug = new Map(candidates.map(candidate => [candidate.slug, candidate]))

  const sources = [...required, ...optional].map(slug => {
    const candidate = bySlug.get(slug)
    const requiredSource = requiredSet.has(slug)
    if (!candidate) return { slug, required: requiredSource, status: 'missing' as const }
    if (candidate.usable) return { slug, required: requiredSource, status: 'ready' as const }
    if (!candidate.enabled) return { slug, required: requiredSource, status: 'disabled' as const }
    return { slug, required: requiredSource, status: 'authentication-required' as const }
  })

  const blocked = sources.some(source => source.required && source.status !== 'ready')
  const degraded = sources.some(source => !source.required && source.status !== 'ready')
  return {
    status: blocked ? 'blocked' : degraded ? 'degraded' : 'ready',
    sources,
  }
}

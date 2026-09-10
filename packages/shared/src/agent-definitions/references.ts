import { CONCIERGE_SLUG, ORCHESTRATOR_SLUG } from './types.ts'
import { isSourceUsable } from '../sources/availability.ts'
import { isSystemGlobalSkillSlug } from '../skills/system.ts'
import type { LoadedSource } from '../sources/types.ts'

interface ReferenceAgent {
  slug: string
  metadata: { name: string; skills?: string[]; sources?: string[]; optionalSources?: string[] }
}
interface ReferenceSkill { slug: string; aliases?: string[]; available?: boolean }

export interface AgentReferenceResolution {
  /** Slugs that match an existing skill or source — safe to pass through. */
  resolvedSkills: string[]
  resolvedSources: string[]
  resolvedOptionalSources: string[]
  /** Slugs the agent declares but that don't exist in this workspace. */
  missingSkills: string[]
  missingSources: string[]
  unusableSources: string[]
}

export function resolveAgentReferences<TSkill extends ReferenceSkill>(
  agent: ReferenceAgent,
  skills: TSkill[],
  sources: LoadedSource[],
): AgentReferenceResolution {
  const skillSlugs = new Set(skills.filter(s => s.available !== false).flatMap(s => [s.slug, ...(s.aliases ?? [])]))
  // LoadedSource carries the slug on its nested config, not at the top level.
  const sourceBySlug = new Map(sources.map((s) => [s.config.slug, s]))

  const declaredSkills = agent.metadata.skills ?? []
  const declaredSources = agent.metadata.sources ?? []
  const declaredOptionalSources = agent.metadata.optionalSources ?? []
  const canUseSystemSkills = agent.slug === CONCIERGE_SLUG || agent.slug === ORCHESTRATOR_SLUG

  const resolvedSkills: string[] = []
  const missingSkills: string[] = []
  for (const slug of declaredSkills) {
    if (skillSlugs.has(slug)) resolvedSkills.push(slug)
    else if (canUseSystemSkills && isSystemGlobalSkillSlug(slug.replace(/^legacy:/, ''))) resolvedSkills.push(slug)
    else missingSkills.push(slug)
  }

  const resolvedSources: string[] = []
  const missingSources: string[] = []
  const unusableSources: string[] = []
  for (const slug of declaredSources) {
    const source = sourceBySlug.get(slug)
    if (!source) missingSources.push(slug)
    else if (!isSourceUsable(source)) unusableSources.push(slug)
    else resolvedSources.push(slug)
  }
  const requiredSourceSet = new Set(declaredSources)
  const resolvedOptionalSources = declaredOptionalSources.filter((slug) => {
    if (requiredSourceSet.has(slug)) return false
    const source = sourceBySlug.get(slug)
    return source ? isSourceUsable(source) : false
  })

  return {
    resolvedSkills,
    resolvedSources,
    resolvedOptionalSources,
    missingSkills,
    missingSources,
    unusableSources,
  }
}

/** Convenience flag: any references unresolvable on the current machine? */
export function hasMissingReferences(resolution: AgentReferenceResolution): boolean {
  return resolution.missingSkills.length > 0 || resolution.missingSources.length > 0 || resolution.unusableSources.length > 0
}

/** Build a one-line human summary of missing references for toast / banner copy. */
export function describeMissingReferences(resolution: AgentReferenceResolution): string | null {
  const parts: string[] = []
  if (resolution.missingSkills.length > 0) {
    const list = resolution.missingSkills.map((s) => `@${s}`).join(', ')
    parts.push(`missing skill${resolution.missingSkills.length === 1 ? '' : 's'}: ${list}`)
  }
  if (resolution.missingSources.length > 0) {
    const list = resolution.missingSources.map((s) => `@${s}`).join(', ')
    parts.push(`missing source${resolution.missingSources.length === 1 ? '' : 's'}: ${list}`)
  }
  if (resolution.unusableSources.length > 0) {
    parts.push(`disabled or disconnected: ${resolution.unusableSources.map(slug => `@${slug}`).join(', ')}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Interactive unfocused launches may omit unavailable bundles with a warning.
 * Focused and background work must fail before running with an incomplete recipe. */
export function assertAgentReferences(
  agent: ReferenceAgent,
  resolution: AgentReferenceResolution,
  mode: 'strict' | 'lenient',
  focusLabel?: string,
): void {
  if (mode === 'lenient') return
  const problems = [
    ...resolution.missingSkills.map(slug => `missing skill @${slug}`),
    ...resolution.missingSources.map(slug => `missing connection @${slug}`),
    ...resolution.unusableSources.map(slug => `disabled or disconnected @${slug}`),
  ]
  if (problems.length) throw new Error(`${agent.metadata.name}${focusLabel ? ` — ${focusLabel}` : ''} needs ${problems.join(', ')}. Fix the listed Skills or Connections, then retry${focusLabel ? ' this focus' : ''}.`)
}

/** One activation policy; callers retain their permission checks and storage transport. */
export function selectDeclaredSkillsToEnable(
  declaredSlugs: string[],
  activeSkills: ReferenceSkill[],
  isInstalled: (slug: string) => boolean,
): string[] {
  const activeSlugs = new Set(activeSkills.filter(skill => skill.available !== false)
    .flatMap(skill => [skill.slug, ...(skill.aliases ?? [])]))
  return [...new Set(declaredSlugs)].filter(slug => !activeSlugs.has(slug) && isInstalled(slug))
}

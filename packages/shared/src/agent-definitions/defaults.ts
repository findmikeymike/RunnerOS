import { registeredActivationSlugs, LAB_DEFAULT_WORKER_SLUGS, isRegisteredAgentAllowedInArtistWorkspace } from './registration.ts'

export const RELEASE_MANAGER_AGENT_SLUG = 'artist-os-release-manager'
export const ANYTHING_AGENT_SLUG = 'anything-agent'
export const RELEASE_MANAGER_SKILL_SLUGS = [
  'artist-os-release-operations',
  'artist-os-rights-and-credits',
  'artist-os-release-package-qa',
  'artist-os-dsp-editorial-pitch',
] as const

export function hasReleaseManagerIdentity(
  agent: { slug: string; metadata: { name: string } } | null | undefined,
): agent is { slug: string; metadata: { name: string } } {
  return agent != null && agent.slug === RELEASE_MANAGER_AGENT_SLUG && agent.metadata.name === 'Release Manager'
}

export function isReleaseManagerDefinition(
  agent: { slug: string; metadata: { name: string; skills?: string[] } } | null | undefined,
): boolean {
  if (!hasReleaseManagerIdentity(agent)) return false
  const installedSkills = new Set(agent.metadata.skills ?? [])
  return RELEASE_MANAGER_SKILL_SLUGS.every(slug => installedSkills.has(slug))
}

/** Historical defaults, retained for Runner migrations; not reapplied on Artist OS startup. */
export const DEFAULT_ACTIVATED_AGENT_SLUGS = registeredActivationSlugs('legacy')
export const CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS = registeredActivationSlugs('campaign')
export const HQ_DEFAULT_ACTIVATED_AGENT_SLUGS = registeredActivationSlugs('hq')
export const HQ_CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS = registeredActivationSlugs('hq-campaign')
export const LAB_DEFAULT_ACTIVATED_AGENT_SLUGS = LAB_DEFAULT_WORKER_SLUGS
export const isAgentAllowedInArtistWorkspace = isRegisteredAgentAllowedInArtistWorkspace

export function initialAgentSlugsForWorkspace(
  scope: 'hq' | 'campaign' | 'lab' | 'general' | undefined,
  rootAlreadyExisted: boolean,
): readonly string[] {
  if (rootAlreadyExisted) return []
  if (scope === 'lab') return LAB_DEFAULT_ACTIVATED_AGENT_SLUGS
  if (scope === 'campaign') return [
    RELEASE_MANAGER_AGENT_SLUG,
    ...HQ_CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS,
    ...CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS,
  ]
  if (scope === 'hq') return [
    ...HQ_CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS,
    ...HQ_DEFAULT_ACTIVATED_AGENT_SLUGS,
  ]
  return []
}

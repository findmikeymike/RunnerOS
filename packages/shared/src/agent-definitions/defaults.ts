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

export const DEFAULT_ACTIVATED_AGENT_SLUGS = [
  'ads-strategist',
  'ad-creative-agent',
  'ads-agent',
  'lyric-video-agent',
  'scroll-stopper',
  'ig-trending-power-up',
  'influencer-campaign-power-up',
  'playlisting-power-up',
  'record-doctor',
  'college-radio-agent',
  'spotify-playlist-creator',
  'youtube-intelligence-agent',
  'signal-scout-agent',
  'signal-analyst-agent',
  'x-editorial',
] as const

/** Workers that must be genuinely active in every Artist OS campaign workspace. */
export const CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS = [
  'anticipation-director',
] as const

/** Career-wide specialists that belong only in Artist HQ. */
export const HQ_DEFAULT_ACTIVATED_AGENT_SLUGS = [
  'catalog-royalty-agent',
  'legal-agent',
] as const

const HQ_ONLY_ARTIST_AGENT_SLUGS = new Set<string>(['legal-agent'])

export function isAgentAllowedInArtistWorkspace(
  agentSlug: string,
  scope: 'hq' | 'campaign' | 'lab' | 'general' | undefined,
): boolean {
  return !HQ_ONLY_ARTIST_AGENT_SLUGS.has(agentSlug) || scope === 'hq'
}

/** Fallback capability broker available in both Artist HQ and campaigns. */
export const HQ_CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS = [
  ANYTHING_AGENT_SLUG,
] as const

/** Initial Creative Lab team. Applied only when the app creates a new Lab root. */
export const LAB_DEFAULT_ACTIVATED_AGENT_SLUGS = [
  'the-excavator',
  'reverse-magic',
  'hooker',
  'legendary-writer',
  'reference-master',
  'record-doctor',
] as const

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
    RELEASE_MANAGER_AGENT_SLUG,
    ...HQ_CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS,
    ...HQ_DEFAULT_ACTIVATED_AGENT_SLUGS,
  ]
  return []
}

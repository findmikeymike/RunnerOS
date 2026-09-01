export const RELEASE_MANAGER_AGENT_SLUG = 'artist-os-release-manager'
export const RELEASE_MANAGER_SKILL_SLUGS = [
  'artist-os-release-operations',
  'artist-os-rights-and-credits',
  'artist-os-release-package-qa',
  'artist-os-dsp-editorial-pitch',
] as const

export function isReleaseManagerDefinition(
  agent: { slug: string; metadata: { name: string; skills?: string[] } } | null | undefined,
): boolean {
  if (!agent || agent.slug !== RELEASE_MANAGER_AGENT_SLUG || agent.metadata.name !== 'Release Manager') return false
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
  if (scope === 'hq' || scope === 'campaign') return [RELEASE_MANAGER_AGENT_SLUG]
  return []
}

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
  return !rootAlreadyExisted && scope === 'lab' ? LAB_DEFAULT_ACTIVATED_AGENT_SLUGS : []
}

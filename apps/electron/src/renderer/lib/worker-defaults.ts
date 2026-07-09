export const BASE_DEFAULT_WORKER_SLUGS = [
  'branding-agent',
  'world-builder',
  'college-radio-agent',
  'spotify-playlist-creator',
] as const

export const CAMPAIGN_DEFAULT_WORKER_SLUGS = [
  'content-genius',
  'scroll-stopper',
  'art-director',
  'ad-creative-agent',
  'ads-strategist',
  'ads-agent',
  'ig-trending-power-up',
  'influencer-campaign-power-up',
  'playlisting-power-up',
  'record-doctor',
  'industry-hunter',
] as const

export function defaultWorkerSlugs(includeCampaignWorkers: boolean): readonly string[] {
  return includeCampaignWorkers
    ? [...BASE_DEFAULT_WORKER_SLUGS, ...CAMPAIGN_DEFAULT_WORKER_SLUGS]
    : BASE_DEFAULT_WORKER_SLUGS
}

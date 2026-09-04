export const BASE_DEFAULT_WORKER_SLUGS = [
  'branding-agent',
  'world-builder',
  'site-builder',
  'college-radio-agent',
  'spotify-playlist-creator',
  'x-editorial',
] as const

export const HQ_DEFAULT_WORKER_SLUGS = [
  'update-system-agent',
  'catalog-royalty-agent',
  'legal-agent',
] as const

export const CAMPAIGN_DEFAULT_WORKER_SLUGS = [
  'artist-os-release-manager',
  'content-genius',
  'scroll-stopper',
  'anticipation-director',
  'content-director',
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

export { LAB_DEFAULT_ACTIVATED_AGENT_SLUGS as LAB_DEFAULT_WORKER_SLUGS } from '@craft-agent/shared/agent-definitions/defaults'

export function defaultWorkerSlugs(includeCampaignWorkers: boolean): readonly string[] {
  return includeCampaignWorkers
    ? [...BASE_DEFAULT_WORKER_SLUGS, ...CAMPAIGN_DEFAULT_WORKER_SLUGS]
    : [...BASE_DEFAULT_WORKER_SLUGS, ...HQ_DEFAULT_WORKER_SLUGS]
}

export function excludedWorkerSlugs(includeCampaignWorkers: boolean): readonly string[] {
  return includeCampaignWorkers
    ? ['legal-agent']
    : ['artist-os-release-manager']
}

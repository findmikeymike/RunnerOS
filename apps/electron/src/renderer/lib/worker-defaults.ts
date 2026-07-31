export const BASE_DEFAULT_WORKER_SLUGS = [
  'researcher',
  'triager',
  'critic',
] as const

export const CAMPAIGN_DEFAULT_WORKER_SLUGS = [
  'writer',
  'coder',
] as const

export function defaultWorkerSlugs(includeCampaignWorkers: boolean): readonly string[] {
  return includeCampaignWorkers
    ? [...BASE_DEFAULT_WORKER_SLUGS, ...CAMPAIGN_DEFAULT_WORKER_SLUGS]
    : BASE_DEFAULT_WORKER_SLUGS
}

/** Browser-safe registration policy. Availability never implies workspace activation.
 * Keep definitions in starter-templates.ts; this table owns recovery, defaults and scope.
 */
export type ArtistWorkspaceScope = 'hq' | 'campaign' | 'lab' | 'general' | undefined
export interface BuiltinAgentRegistration {
  slug: string
  required: boolean
  workerGroup?: 'base' | 'hq' | 'campaign'
  workerOrder?: number
  activationGroup?: 'legacy' | 'hq' | 'campaign' | 'hq-campaign'
  activationOrder?: number
  labOrder?: number
  labAllowed?: boolean
  onlyScope?: 'hq' | 'campaign'
}

export const BUILTIN_AGENT_REGISTRATIONS: readonly BuiltinAgentRegistration[] = [
  { slug: 'anything-agent', required: true, activationGroup: 'hq-campaign', activationOrder: 0 },
  { slug: 'concierge', required: true, labAllowed: true },
  { slug: 'setup-concierge', required: true, labAllowed: true },
  { slug: 'orchestrator', required: true, labAllowed: true },
  { slug: 'social-publisher', required: true },
  { slug: 'trypost-agent', required: true },
  { slug: 'postiz-agent', required: true },
  { slug: 'youtube-research-agent', required: true },
  { slug: 'youtube-intelligence-agent', required: true, activationGroup: 'legacy', activationOrder: 11 },
  { slug: 'signal-scout-agent', required: true, activationGroup: 'legacy', activationOrder: 12 },
  { slug: 'signal-analyst-agent', required: true, activationGroup: 'legacy', activationOrder: 13 },
  { slug: 'hypermotion-agent', required: true },
  { slug: 'video-director', required: true },
  { slug: 'lottie-animation-agent', required: true },
  { slug: 'video-editor-agent', required: true },
  { slug: 'lyric-video-agent', required: true, activationGroup: 'legacy', activationOrder: 3 },
  { slug: 'raw-video-editor', required: true },
  { slug: 'content-genius', required: true, workerGroup: 'campaign', workerOrder: 1 },
  { slug: 'scroll-stopper', required: true, workerGroup: 'campaign', workerOrder: 2, activationGroup: 'legacy', activationOrder: 4 },
  { slug: 'anticipation-director', required: true, workerGroup: 'campaign', workerOrder: 3, activationGroup: 'campaign', activationOrder: 0 },
  { slug: 'content-director', required: true, workerGroup: 'campaign', workerOrder: 4 },
  { slug: 'persona-agent', required: true },
  { slug: 'art-director', required: true, workerGroup: 'campaign', workerOrder: 5 },
  { slug: 'branding-agent', required: true, workerGroup: 'base', workerOrder: 0 },
  { slug: 'world-builder', required: true, workerGroup: 'base', workerOrder: 2 },
  { slug: 'artist-os-release-manager', required: true, workerGroup: 'campaign', workerOrder: 0, onlyScope: 'campaign' },
  { slug: 'comms-agent', required: true },
  { slug: 'outreach-agent', required: true },
  { slug: 'x-editorial', required: true, workerGroup: 'base', workerOrder: 6, activationGroup: 'legacy', activationOrder: 14 },
  { slug: 'catalog-royalty-agent', required: true, workerGroup: 'hq', workerOrder: 1, activationGroup: 'hq', activationOrder: 0 },
  { slug: 'legal-agent', required: true, workerGroup: 'hq', workerOrder: 2, activationGroup: 'hq', activationOrder: 1, onlyScope: 'hq' },
  { slug: 'industry-hunter', required: true, workerGroup: 'campaign', workerOrder: 13 },
  { slug: 'college-radio-agent', required: true, workerGroup: 'base', workerOrder: 4, activationGroup: 'legacy', activationOrder: 9 },
  { slug: 'record-doctor', required: true, workerGroup: 'campaign', workerOrder: 12, activationGroup: 'legacy', activationOrder: 8, labOrder: 5 },
  { slug: 'open-slide-agent', required: false },
  { slug: 'ads-strategist', required: true, workerGroup: 'campaign', workerOrder: 7, activationGroup: 'legacy', activationOrder: 0 },
  { slug: 'ad-creative-agent', required: true, workerGroup: 'campaign', workerOrder: 6, activationGroup: 'legacy', activationOrder: 1 },
  { slug: 'ads-agent', required: true, workerGroup: 'campaign', workerOrder: 8, activationGroup: 'legacy', activationOrder: 2 },
  { slug: 'ig-trending-power-up', required: true, workerGroup: 'campaign', workerOrder: 9, activationGroup: 'legacy', activationOrder: 5 },
  { slug: 'influencer-campaign-power-up', required: true, workerGroup: 'campaign', workerOrder: 10, activationGroup: 'legacy', activationOrder: 6 },
  { slug: 'playlisting-power-up', required: true, workerGroup: 'campaign', workerOrder: 11, activationGroup: 'legacy', activationOrder: 7 },
  { slug: 'spotify-playlist-creator', required: true, workerGroup: 'base', workerOrder: 5, activationGroup: 'legacy', activationOrder: 10 },
  { slug: 'shopify-agent', required: true },
  { slug: 'print-agent', required: true },
  { slug: 'update-system-agent', required: true, workerGroup: 'hq', workerOrder: 0 },
  { slug: 'researcher', required: false },
  { slug: 'community-agent', required: true },
  { slug: 'website-agent', required: true, activationGroup: 'hq-campaign', activationOrder: 3 },
  { slug: 'site-builder', required: true, workerGroup: 'base', workerOrder: 3, activationGroup: 'hq-campaign', activationOrder: 2 },
  { slug: 'writer', required: false },
  { slug: 'song-director', required: true, labAllowed: true },
  { slug: 'reverse-magic', required: true, labOrder: 1 },
  { slug: 'legendary-writer', required: true, labOrder: 3 },
  { slug: 'hooker', required: true, labOrder: 2 },
  { slug: 'reference-master', required: true, labOrder: 4 },
  { slug: 'the-excavator', required: true, labOrder: 0 },
  { slug: 'coder', required: false },
  { slug: 'triager', required: false },
  { slug: 'critic', required: false },
  { slug: 'spotify-analyst', required: true },
  { slug: 'scriptwriter', required: true, workerGroup: 'base', workerOrder: 1, activationGroup: 'hq-campaign', activationOrder: 1 },
]

const registrationsBySlug = new Map(BUILTIN_AGENT_REGISTRATIONS.map(entry => [entry.slug, entry]))
export const REQUIRED_BUILTIN_AGENT_SLUGS: readonly string[] = BUILTIN_AGENT_REGISTRATIONS
  .filter(entry => entry.required).map(entry => entry.slug)

function workerSlugs(group: BuiltinAgentRegistration['workerGroup']): readonly string[] {
  return BUILTIN_AGENT_REGISTRATIONS.filter(entry => entry.workerGroup === group)
    .sort((a, b) => a.workerOrder! - b.workerOrder!).map(entry => entry.slug)
}
export function registeredActivationSlugs(group: NonNullable<BuiltinAgentRegistration['activationGroup']>): readonly string[] {
  return BUILTIN_AGENT_REGISTRATIONS.filter(entry => entry.activationGroup === group)
    .sort((a, b) => a.activationOrder! - b.activationOrder!).map(entry => entry.slug)
}
export const BASE_DEFAULT_WORKER_SLUGS = workerSlugs('base')
export const HQ_DEFAULT_WORKER_SLUGS = workerSlugs('hq')
export const CAMPAIGN_DEFAULT_WORKER_SLUGS = workerSlugs('campaign')
export const LAB_DEFAULT_WORKER_SLUGS: readonly string[] = BUILTIN_AGENT_REGISTRATIONS
  .filter(entry => entry.labOrder !== undefined).sort((a, b) => a.labOrder! - b.labOrder!).map(entry => entry.slug)

export function defaultWorkerSlugs(includeCampaignWorkers: boolean): readonly string[] {
  return [...BASE_DEFAULT_WORKER_SLUGS, ...(includeCampaignWorkers ? CAMPAIGN_DEFAULT_WORKER_SLUGS : HQ_DEFAULT_WORKER_SLUGS)]
}
export function excludedWorkerSlugs(includeCampaignWorkers: boolean): readonly string[] {
  const scope = includeCampaignWorkers ? 'campaign' : 'hq'
  return BUILTIN_AGENT_REGISTRATIONS.filter(entry => entry.onlyScope && entry.onlyScope !== scope).map(entry => entry.slug)
}
export function isRegisteredAgentAllowedInArtistWorkspace(agentSlug: string, scope: ArtistWorkspaceScope): boolean {
  const entry = registrationsBySlug.get(agentSlug)
  // Unknown slugs may be user-created workers; never silently redefine their scope.
  if (!entry) return true
  if (entry.onlyScope && entry.onlyScope !== scope) return false
  if (scope === 'lab') return entry.labAllowed === true || entry.labOrder !== undefined
  return true
}

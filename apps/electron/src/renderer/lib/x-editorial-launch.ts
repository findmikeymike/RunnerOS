import type { ContextDocDTO } from '../../shared/types'
import { MISSION_BRIEF_CONTEXT_SLUG, missionReleaseDateKey, parseMissionBriefDoc } from '@/lib/mission-brief'
import { resolveCampaignFocusByReleaseDate } from '@craft-agent/shared/hq-state'
import type { XEditorialCampaignWeight } from '@craft-agent/shared/x-editorial'

const X_EDITORIAL_CAMPAIGN_CONTEXT_SLUGS = new Set([
  'mission-brief',
  'campaign-worker-context',
  'campaign-state-of-play',
  'campaign-calendar',
])

/**
 * Keep X Editorial's durable history in HQ while pinning only the small,
 * agent-visible Campaign context needed for this launch.
 */
export function buildXEditorialCampaignLaunchContext(
  hqDocs: ContextDocDTO[],
  campaignDocs: ContextDocDTO[],
  campaign: { id: string; name: string },
  options: {
    origin?: 'pinned' | 'automatic'
    campaignWeight?: XEditorialCampaignWeight
    releaseDate?: string
  } = {},
): ContextDocDTO[] {
  const origin = options.origin ?? 'pinned'
  const campaignWeight = options.campaignWeight ?? (origin === 'pinned' ? 'focus' : 'light')
  const combined = new Map(hqDocs.map((doc) => [doc.slug, doc]))
  for (const doc of campaignDocs) {
    if (X_EDITORIAL_CAMPAIGN_CONTEXT_SLUGS.has(doc.slug)) combined.set(doc.slug, doc)
  }

  const workspaceRootPath = hqDocs[0]?.workspaceRootPath ?? campaignDocs[0]?.workspaceRootPath ?? ''
  combined.set('x-editorial-launch-context', {
    slug: 'x-editorial-launch-context',
    metadata: {
      name: 'X Editorial Campaign Launch',
      description: 'Pins the Campaign selected when this HQ-owned X Editorial session was opened.',
      routing: { mode: 'targeted', agents: ['x-editorial'] },
      enabled: true,
    },
    body: [
      `${origin === 'pinned' ? 'Pinned' : 'Current'} Campaign: ${campaign.name}`,
      `Campaign workspace id: ${campaign.id}`,
      `Campaign influence: ${campaignWeight}.`,
      options.releaseDate ? `Release date: ${options.releaseDate}.` : null,
      origin === 'pinned'
        ? 'The artist opened X Editorial from this Campaign. Use it as the release focus for this run.'
        : 'Artist OS selected this as the current or nearest release Campaign. Let it influence the slate only where the connection is natural.',
      'This is still one HQ-owned X Editorial history and schedule, not a second Campaign strategy.',
      `Use read-only Campaign and Release Kit tools with campaignWorkspaceId \`${campaign.id}\` when exact release context or approved assets are needed.`,
    ].filter(Boolean).join('\n\n'),
    path: `${workspaceRootPath}/context/x-editorial-launch-context/CONTEXT.md`,
    workspaceRootPath,
  })

  return [...combined.values()]
}

export function selectXEditorialCampaignContext(
  campaigns: Array<{ id: string; name: string; primary?: boolean; docs: ContextDocDTO[] }>,
  now = new Date(),
): { campaign: { id: string; name: string }; docs: ContextDocDTO[]; releaseDate?: string; weight: XEditorialCampaignWeight } | null {
  const focus = resolveCampaignFocusByReleaseDate(campaigns.map((campaign) => {
    const brief = parseMissionBriefDoc(campaign.docs.find((doc) => doc.slug === MISSION_BRIEF_CONTEXT_SLUG))
    return {
      id: campaign.id,
      name: campaign.name,
      primary: campaign.primary,
      releaseDate: brief ? missionReleaseDateKey(brief) : undefined,
    }
  }), now)
  if (!focus) return null
  const selected = campaigns.find((campaign) => campaign.id === focus.id)
  if (!selected) return null
  return {
    campaign: { id: selected.id, name: selected.name },
    docs: selected.docs,
    releaseDate: focus.releaseDate,
    weight: focus.days !== undefined && Math.abs(focus.days) <= 14 ? 'focus' : 'light',
  }
}

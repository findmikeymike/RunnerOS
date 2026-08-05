import type { ContextDocDTO, ContextDocMetadata, MissionAssetManifest } from '../../shared/types'

export const RELEASE_BOARD_CONTEXT_SLUG = 'release-board'

export type ReleaseBoardItemStatus = 'needed' | 'done' | 'skipped'
type MissionAssetKind = MissionAssetManifest['files'][number]['kind']

export interface ReleaseBoardItem {
  id: string
  label: string
  status: ReleaseBoardItemStatus
  assetKinds?: MissionAssetKind[]
  linkedAssetId?: string
  notes?: string
  updatedAt?: string
}

export interface ReleaseBoardCategory {
  id: 'music' | 'visuals' | 'setup' | 'content' | 'promotion' | 'team'
  label: string
  detail: string
  items: ReleaseBoardItem[]
}

export interface ReleaseBoard {
  version: 1
  workspaceId: string
  categories: ReleaseBoardCategory[]
  updatedAt: string
}

export interface ReleaseBoardItemAction {
  kind: 'agent' | 'workflow' | 'tool'
  targetSlug: string
  targetName: string
  instruction: string
}

const DEFAULT_CATEGORIES: Omit<ReleaseBoardCategory, 'items'>[] = [
  { id: 'music', label: 'Foundation', detail: 'Music, context, and the release world' },
  { id: 'visuals', label: 'Visuals', detail: 'Artwork, photos, and motion' },
  { id: 'content', label: 'Content', detail: 'Short-form pieces and copy' },
  { id: 'setup', label: 'Release Setup', detail: 'Links, metadata, and delivery' },
  { id: 'promotion', label: 'Promotion', detail: 'Audience push and spend' },
]

const DEFAULT_ITEMS: Record<ReleaseBoardCategory['id'], ReleaseBoardItem[]> = {
  music: [
    { id: 'master', label: 'Master File', status: 'needed', assetKinds: ['master'] },
    { id: 'clean-version', label: 'Clean Version', status: 'needed' },
    { id: 'lyrics', label: 'Lyrics', status: 'needed', assetKinds: ['lyrics'] },
    { id: 'song-world', label: 'Creative World', status: 'needed' },
    { id: 'release-identity', label: 'Campaign Branding', status: 'needed' },
  ],
  visuals: [
    { id: 'cover-art', label: 'Single Art', status: 'needed', assetKinds: ['cover-art'] },
    { id: 'canvas', label: 'Spotify Canvas', status: 'needed' },
    { id: 'press-photos', label: 'Press Photos', status: 'needed', assetKinds: ['press-photo'] },
  ],
  setup: [
    { id: 'distributor', label: 'Distributor Upload', status: 'needed' },
    { id: 'presave', label: 'Pre-Save Link', status: 'needed' },
    { id: 'metadata', label: 'Credits and Metadata', status: 'needed' },
    { id: 'social-schedule', label: 'Social Rollout', status: 'needed' },
  ],
  content: [
    { id: 'idea-generation', label: 'Idea Generation', status: 'needed' },
    { id: 'lyric-clips', label: 'Lyric Clips', status: 'needed' },
    { id: 'viral-clips', label: 'Viral Clips', status: 'needed' },
    { id: 'ugc-clips', label: 'UGC Clips', status: 'needed' },
    { id: 'video-production', label: 'Video Extras', status: 'needed' },
  ],
  promotion: [
    { id: 'budget', label: 'Budget Set', status: 'needed' },
    { id: 'ad-creatives', label: 'Ad Creatives', status: 'needed' },
    { id: 'paid-campaign', label: 'Paid Campaign Plan', status: 'needed' },
    { id: 'playlist-targets', label: 'Playlist Targets', status: 'needed' },
    { id: 'press-list', label: 'Press List', status: 'needed', assetKinds: ['press-doc'] },
    { id: 'college-radio', label: 'College Radio', status: 'needed' },
    { id: 'influencer-campaign', label: 'Influencer Campaign', status: 'needed' },
    { id: 'ig-trending', label: 'IG Music Campaign', status: 'needed' },
    { id: 'artist-playlist', label: 'Artist Playlist', status: 'needed' },
  ],
  team: [],
}

const ITEM_ACTIONS: Record<string, ReleaseBoardItemAction> = {
  'music:lyrics': {
    kind: 'tool',
    targetSlug: 'transcribe-lyrics',
    targetName: 'Lyrics Transcription',
    instruction: 'Transcribe the campaign master into editable lyrics for review and approval.',
  },
  'music:song-world': {
    kind: 'agent',
    targetSlug: 'world-builder',
    targetName: 'World Builder',
    instruction: 'Build the song-specific creative world: its central premise, setting, emotional logic, recurring motifs, characters or forces, scenes, and practical campaign spokes. Focus on the universe itself, not its graphic-design system.',
  },
  'music:release-identity': {
    kind: 'agent',
    targetSlug: 'branding-agent',
    targetName: 'Branding Agent',
    instruction: 'Translate the song and its creative world into a memorable campaign branding system: colors, typography, symbols, tagline, language, audience signal, and repeatable asset rules. Focus on public packaging, not inventing a second narrative world.',
  },
  'visuals:cover-art': {
    kind: 'agent',
    targetSlug: 'art-director',
    targetName: 'Art Director',
    instruction: 'Develop the single artwork. Begin with a small set of genuinely distinct art directions, recommend the strongest, and create a reviewable Output before any paid generation.',
  },
  'visuals:canvas': {
    kind: 'agent',
    targetSlug: 'hypermotion-agent',
    targetName: 'Hypermotion',
    instruction: 'Create a Spotify Canvas concept and production-ready silent vertical loop using the campaign assets and visual world. Follow Spotify Canvas constraints.',
  },
  'visuals:press-photos': {
    kind: 'agent',
    targetSlug: 'art-director',
    targetName: 'Art Director',
    instruction: 'Create a press-photo art direction and shot plan for this release, including framing, styling, locations, lighting, must-have crops, and reference-safe production notes.',
  },
  'setup:metadata': {
    kind: 'agent',
    targetSlug: 'comms-agent',
    targetName: 'Comms Agent',
    instruction: 'Compile a fact-checked credits and release-metadata packet from the saved campaign materials. Clearly flag every missing or unverified field.',
  },
  'setup:social-schedule': {
    kind: 'agent',
    targetSlug: 'social-publisher',
    targetName: 'Social Publisher',
    instruction: 'Build the complete social rollout, including the launch announcement, from this campaign\'s approved Finals and release timeline. First determine whether the user wants Artist OS native posting, Postiz, or TryPost. Draft and validate freely, but do not schedule or publish without exact approval.',
  },
  'content:idea-generation': {
    kind: 'workflow',
    targetSlug: 'content-mastermind',
    targetName: 'Content Mastermind',
    instruction: 'Run the full Content Mastermind: independent native, anticipation, and absurdity ideation followed by ruthless Content Director selection and fusion.',
  },
  'content:lyric-clips': {
    kind: 'agent',
    targetSlug: 'lyric-video-agent',
    targetName: 'Lyric Visuals',
    instruction: 'Create reviewable lyric-led visuals from the approved lyrics, master audio, and campaign world. Default to the strongest short clips, but expand into a complete lyric video when the user requests or the concept clearly earns the full-song format.',
  },
  'content:viral-clips': {
    kind: 'agent',
    targetSlug: 'scroll-stopper',
    targetName: 'Scroll Stopper',
    instruction: 'Create the strongest absurd, instantly readable vertical AI-video concepts for this release, with cover frames and paste-ready generation prompts.',
  },
  'content:ugc-clips': {
    kind: 'agent',
    targetSlug: 'content-genius',
    targetName: 'Content Genius',
    instruction: 'Create artist-native UGC-style concepts for this release. Make each idea shootable, platform-native, and specific about the opening beat and performance.',
  },
  'content:video-production': {
    kind: 'agent',
    targetSlug: 'video-director',
    targetName: 'Video Director',
    instruction: 'Create the strongest useful supporting video beyond the dedicated lyric, viral, and UGC lanes—for example a visualizer, performance piece, behind-the-scenes concept, teaser, trailer, or alternate-format video. Recommend only what this campaign actually needs and stop before paid generation until approved.',
  },
  'promotion:budget': {
    kind: 'agent',
    targetSlug: 'ads-strategist',
    targetName: 'Ads Strategist',
    instruction: 'Recommend a realistic promotion budget and allocation for this campaign, with assumptions, priorities, and a no-spend review packet.',
  },
  'promotion:ad-creatives': {
    kind: 'agent',
    targetSlug: 'ad-creative-agent',
    targetName: 'Ad Creative',
    instruction: 'Build the campaign ad creative packet: strongest angles, hooks, formats, variants, and execution handoff. Do not launch or spend.',
  },
  'promotion:paid-campaign': {
    kind: 'workflow',
    targetSlug: 'paid-campaign-builder',
    targetName: 'Paid Campaign Builder',
    instruction: 'Run the coordinated strategy, creative, and approval-ready ad execution workflow. It must stop before publishing, launch, budget changes, or spend.',
  },
  'promotion:playlist-targets': {
    kind: 'agent',
    targetSlug: 'industry-hunter',
    targetName: 'Industry Hunter',
    instruction: 'Research and rank credible independent playlist editors, curators, and playlist-adjacent discovery targets that genuinely fit this release. Include public evidence, fit rationale, contact path, confidence, and any submission rules. Do not buy placement or send outreach.',
  },
  'promotion:press-list': {
    kind: 'agent',
    targetSlug: 'industry-hunter',
    targetName: 'Industry Hunter',
    instruction: 'Research and rank journalists, music writers, blogs, local media, podcasts, and other credible press targets that genuinely fit this release. Include public evidence, fit rationale, contact path, confidence, and coverage angle. Do not contact anyone.',
  },
  'promotion:college-radio': {
    kind: 'workflow',
    targetSlug: 'college-radio-campaign',
    targetName: 'College Radio Campaign',
    instruction: 'Run the verified college-radio targeting and approval-ready outreach workflow. Do not send or submit anything.',
  },
  'promotion:influencer-campaign': {
    kind: 'agent',
    targetSlug: 'influencer-campaign-power-up',
    targetName: 'Influencer Campaign',
    instruction: 'Build the influencer-campaign inquiry and handoff packet from the saved release context. Do not send or book anything.',
  },
  'promotion:ig-trending': {
    kind: 'agent',
    targetSlug: 'ig-trending-power-up',
    targetName: 'IG Music Trending',
    instruction: 'Build the Instagram music campaign inquiry and handoff packet from the saved release context. Do not send or book anything.',
  },
  'promotion:artist-playlist': {
    kind: 'agent',
    targetSlug: 'spotify-playlist-creator',
    targetName: 'Spotify Playlist Creator',
    instruction: 'Build the release-adjacency Spotify playlist strategy, exact track plan, title, description, and cover concept. Do not create or publish it without approval.',
  },
}

export function getReleaseBoardItemAction(
  categoryId: ReleaseBoardCategory['id'],
  itemId: string,
): ReleaseBoardItemAction | null {
  return ITEM_ACTIONS[`${categoryId}:${itemId}`] ?? null
}

export function buildReleaseBoardItemActionPrompt(input: {
  campaignTitle: string
  categoryLabel: string
  itemLabel: string
  action: ReleaseBoardItemAction
}): string {
  return [
    `Create the "${input.itemLabel}" deliverable for the "${input.campaignTitle}" campaign.`,
    '',
    input.action.instruction,
    '',
    `Release Board lane: ${input.categoryLabel}`,
    'Use the existing Artist HQ and campaign context before asking me to repeat anything.',
    'Create a durable, reviewable Runner Output and clearly state what remains before this board item can be marked done.',
    'Do not publish, send outreach, spend money, or take any other public action.',
  ].join('\n')
}

export function buildReleaseBoardWorkflowInputs(
  action: ReleaseBoardItemAction,
  campaignBrief: string,
): Record<string, unknown> {
  switch (action.targetSlug) {
    case 'content-mastermind':
      return {
        campaign_brief: campaignBrief,
        locked_elements: 'Use the campaign brief and approved assets as locked elements. Do not invent missing facts.',
        production_context: 'Use saved campaign assets and context. Assume a lean production by default, while preserving one unconstrained Big Swing.',
      }
    case 'paid-campaign-builder':
      return {
        campaign_brief: campaignBrief,
      }
    case 'college-radio-campaign':
      return {
        release_brief: campaignBrief,
      }
    default:
      return { campaign_brief: campaignBrief }
  }
}

export function buildDefaultReleaseBoard(workspaceId: string): ReleaseBoard {
  const now = new Date().toISOString()
  return {
    version: 1,
    workspaceId,
    categories: DEFAULT_CATEGORIES.map((category) => ({
      ...category,
      items: DEFAULT_ITEMS[category.id].map((item) => ({ ...item })),
    })),
    updatedAt: now,
  }
}

export function releaseBoardMetadata(board: ReleaseBoard): ContextDocMetadata {
  return {
    name: 'Release Board',
    description: 'Campaign-scoped checklist of release pieces, assets, and handoffs.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: 'active',
    priority: getBoardTotals(board).done > 0 ? 'high' : 'normal',
  }
}

export function serializeReleaseBoardBody(board: ReleaseBoard): string {
  const totals = getBoardTotals(board)
  const summary = board.categories.flatMap((category) => {
    const progress = getCategoryProgress(category)
    return [
      `- ${category.label}: ${progress.done}/${progress.total} done`,
      ...category.items.map((item) => `  - ${item.label}: ${item.status}`),
    ]
  })

  return [
    'This context is the release board for the current campaign. Treat it as campaign-scoped execution context: what exists, what is handled, and what still needs attention.',
    '',
    '```json',
    JSON.stringify(board, null, 2),
    '```',
    '',
    '## Summary',
    '',
    `${totals.done}/${totals.total} release pieces are marked done.`,
    ...summary,
  ].join('\n')
}

export function parseReleaseBoardDoc(doc: ContextDocDTO | undefined | null): ReleaseBoard | null {
  if (!doc) return null
  const fenced = doc.body.match(/```json\s*([\s\S]*?)\s*```/i)
  const raw = fenced?.[1]
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ReleaseBoard>
    if (!parsed || parsed.version !== 1 || !parsed.workspaceId || !Array.isArray(parsed.categories)) return null
    return normalizeReleaseBoard(parsed.workspaceId, parsed)
  } catch {
    return null
  }
}

export function mergeReleaseBoardWithAssets(board: ReleaseBoard, manifest: MissionAssetManifest | null): ReleaseBoard {
  const files = manifest?.files.filter((file) => file.status === 'available') ?? []
  if (files.length === 0) return board

  let changed = false
  const categories = board.categories.map((category) => ({
    ...category,
    items: category.items.map((item) => {
      if (item.status === 'done' || item.status === 'skipped' || !item.assetKinds?.length) return item
      const asset = files.find((file) => assetSatisfiesItem(file, item))
      if (!asset) return item
      changed = true
      return {
        ...item,
        status: 'done' as const,
        linkedAssetId: asset.id,
        updatedAt: new Date().toISOString(),
      }
    }),
  }))

  return changed ? { ...board, categories, updatedAt: new Date().toISOString() } : board
}

function assetSatisfiesItem(asset: MissionAssetManifest['files'][number], item: ReleaseBoardItem): boolean {
  if (!item.assetKinds?.includes(asset.kind)) return false
  if (item.id === 'lyrics') return Boolean(asset.lyrics && !asset.lyrics.reviewRequired)
  return true
}

export function toggleReleaseBoardItem(board: ReleaseBoard, categoryId: ReleaseBoardCategory['id'], itemId: string): ReleaseBoard {
  const currentStatus = findReleaseBoardItem(board, categoryId, itemId)?.status
  return updateReleaseBoardItemStatus(
    board,
    categoryId,
    itemId,
    currentStatus === 'needed' ? 'done' : 'needed',
  )
}

export function updateReleaseBoardItemStatus(
  board: ReleaseBoard,
  categoryId: ReleaseBoardCategory['id'],
  itemId: string,
  status: ReleaseBoardItemStatus,
): ReleaseBoard {
  const now = new Date().toISOString()
  return {
    ...board,
    updatedAt: now,
    categories: board.categories.map((category) => {
      if (category.id !== categoryId) return category
      return {
        ...category,
        items: category.items.map((item) => (
          item.id === itemId ? { ...item, status, updatedAt: now } : item
        )),
      }
    }),
  }
}

export function getCategoryProgress(category: ReleaseBoardCategory): { done: number; total: number } {
  const actionable = category.items.filter((item) => item.status !== 'skipped')
  return {
    done: actionable.filter((item) => item.status === 'done').length,
    total: actionable.length,
  }
}

export function getBoardTotals(board: ReleaseBoard): { done: number; total: number } {
  return board.categories.reduce(
    (totals, category) => {
      const progress = getCategoryProgress(category)
      return {
        done: totals.done + progress.done,
        total: totals.total + progress.total,
      }
    },
    { done: 0, total: 0 },
  )
}

function findReleaseBoardItem(board: ReleaseBoard, categoryId: ReleaseBoardCategory['id'], itemId: string): ReleaseBoardItem | null {
  return board.categories.find((category) => category.id === categoryId)?.items.find((item) => item.id === itemId) ?? null
}

function normalizeReleaseBoard(workspaceId: string, input: Partial<ReleaseBoard>): ReleaseBoard {
  const fallback = buildDefaultReleaseBoard(workspaceId)
  const categories = fallback.categories.map((fallbackCategory) => {
    const existingCategory = input.categories?.find((category) => category.id === fallbackCategory.id)
    return {
      ...fallbackCategory,
      detail: existingCategory?.detail || fallbackCategory.detail,
      items: fallbackCategory.items.map((fallbackItem) => {
        const existingItem = existingCategory?.items?.find((item) => item.id === fallbackItem.id)
        return existingItem
          ? {
              ...existingItem,
              ...fallbackItem,
              status: normalizeStatus(existingItem.status),
            }
          : {
              ...fallbackItem,
              // Existing campaigns gain access to new checklist items without
              // having their historical completion totals silently reduced.
              status: 'skipped' as const,
            }
      }),
    }
  })

  return {
    version: 1,
    workspaceId,
    categories,
    updatedAt: input.updatedAt || fallback.updatedAt,
  }
}

function normalizeStatus(status: unknown): ReleaseBoardItemStatus {
  return status === 'done' || status === 'skipped' ? status : 'needed'
}

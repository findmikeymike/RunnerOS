import type { MissionAssetManifest } from '../mission-assets/types.ts'
import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts'

export const RELEASE_BOARD_CONTEXT_SLUG = 'release-board'

export type ReleaseBoardItemStatus = 'needed' | 'in-progress' | 'review' | 'done' | 'skipped'
export type ReleaseBoardItemTier = 'core' | 'optional' | 'conditional'
type MissionAssetKind = MissionAssetManifest['files'][number]['kind']

export interface ReleaseBoardItem {
  id: string
  label: string
  status: ReleaseBoardItemStatus
  tier: ReleaseBoardItemTier
  included?: boolean
  assetKinds?: MissionAssetKind[]
  linkedAssetId?: string
  linkedSessionId?: string
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

export type ReleaseBoardParseResult =
  | { ok: true; board: ReleaseBoard }
  | { ok: false; board: null; error: string }

const DEFAULT_CATEGORIES: Omit<ReleaseBoardCategory, 'items'>[] = [
  { id: 'music', label: 'Foundation', detail: 'Music, context, and the release world' },
  { id: 'visuals', label: 'Visuals', detail: 'Artwork, photos, and motion' },
  { id: 'content', label: 'Content', detail: 'Short-form pieces and copy' },
  { id: 'setup', label: 'Release Ready', detail: 'Links, metadata, rights, and delivery' },
  { id: 'promotion', label: 'Promotion', detail: 'Audience push and spend' },
]

const DEFAULT_ITEMS: Record<ReleaseBoardCategory['id'], ReleaseBoardItem[]> = {
  music: [
    { id: 'master', label: 'Master File', status: 'needed', tier: 'core', assetKinds: ['master'] },
    { id: 'lyrics', label: 'Lyrics', status: 'needed', tier: 'core', assetKinds: ['lyrics'] },
    { id: 'song-world', label: 'Creative World', status: 'needed', tier: 'core' },
    { id: 'release-identity', label: 'Branding', status: 'needed', tier: 'core' },
    { id: 'clean-version', label: 'Clean Version', status: 'needed', tier: 'conditional', included: false },
    { id: 'instrumental', label: 'Instrumental', status: 'needed', tier: 'optional', included: false },
    { id: 'stems', label: 'Stems', status: 'needed', tier: 'optional', included: false },
    { id: 'record-doctor', label: 'Record Doctor Review', status: 'needed', tier: 'optional', included: false },
  ],
  visuals: [
    { id: 'cover-art', label: 'Single Art', status: 'needed', tier: 'core', assetKinds: ['cover-art'] },
    { id: 'canvas', label: 'Spotify Canvas', status: 'needed', tier: 'core' },
    { id: 'press-photos', label: 'Release Photos', status: 'needed', tier: 'core', assetKinds: ['press-photo'] },
    { id: 'merch-design', label: 'Merch Design', status: 'needed', tier: 'optional', included: false },
    { id: 'posters-graphics', label: 'Posters & Graphics', status: 'needed', tier: 'optional', included: false },
    { id: 'visualizer', label: 'Visualizer', status: 'needed', tier: 'optional', included: false },
  ],
  setup: [
    { id: 'distributor', label: 'Distributor Upload', status: 'needed', tier: 'core' },
    { id: 'presave', label: 'Pre-Save Link', status: 'needed', tier: 'core' },
    { id: 'metadata', label: 'Credits & Metadata', status: 'needed', tier: 'core' },
    { id: 'social-schedule', label: 'Social Rollout', status: 'needed', tier: 'core' },
    { id: 'rights-splits', label: 'Rights & Splits', status: 'needed', tier: 'core' },
    { id: 'release-qa', label: 'Final Release QA', status: 'needed', tier: 'core' },
    { id: 'dsp-pitch', label: 'DSP Pitch', status: 'needed', tier: 'optional', included: false },
    { id: 'epk', label: 'EPK / Press Kit', status: 'needed', tier: 'optional', included: false },
  ],
  content: [
    { id: 'idea-generation', label: 'Idea Generation', status: 'needed', tier: 'core' },
    { id: 'lyric-clips', label: 'Lyric Clips', status: 'needed', tier: 'core' },
    { id: 'performance-clips', label: 'Performance Clips', status: 'needed', tier: 'core' },
    { id: 'viral-clips', label: 'Viral Clips', status: 'needed', tier: 'core' },
    { id: 'ugc-clips', label: 'UGC Clips', status: 'needed', tier: 'optional', included: false },
    { id: 'merch-clips', label: 'Merch Clips', status: 'needed', tier: 'optional', included: false },
    { id: 'video-production', label: 'Video Extras', status: 'needed', tier: 'optional', included: false },
    { id: 'memes', label: 'Memes', status: 'needed', tier: 'optional', included: false },
  ],
  promotion: [
    { id: 'budget', label: 'Promotion Plan & Budget', status: 'needed', tier: 'core' },
    { id: 'ad-creatives', label: 'Ad Creatives', status: 'needed', tier: 'core' },
    { id: 'press-list', label: 'Press List', status: 'needed', tier: 'core' },
    { id: 'artist-playlist', label: 'Artist Playlist', status: 'needed', tier: 'core' },
    { id: 'paid-campaign', label: 'Paid Campaign Workflow', status: 'needed', tier: 'optional', included: false },
    { id: 'influencer-campaign', label: 'Influencer Campaign', status: 'needed', tier: 'optional', included: false },
    { id: 'ig-trending', label: 'IG Music Campaign', status: 'needed', tier: 'optional', included: false },
    { id: 'college-radio', label: 'College Radio', status: 'needed', tier: 'optional', included: false },
    { id: 'playlist-targets', label: 'Independent Playlist Outreach', status: 'needed', tier: 'optional', included: false },
  ],
  team: [],
}

const ITEM_ACTIONS: Record<string, ReleaseBoardItemAction> = {
  'music:lyrics': {
    kind: 'tool',
    targetSlug: 'transcribe-lyrics',
    targetName: 'Lyrics Transcription',
    instruction: 'I want an accurate, editable lyric draft from the campaign master that I can review and correct before approving it.',
  },
  'music:song-world': {
    kind: 'agent',
    targetSlug: 'world-builder',
    targetName: 'World Builder',
    instruction: 'I want to discover the song-specific creative world: its central premise, setting, emotional logic, recurring motifs, characters or forces, scenes, and practical campaign spokes. I want to focus on the universe itself before turning it into a graphic-design system.',
  },
  'music:release-identity': {
    kind: 'agent',
    targetSlug: 'branding-agent',
    targetName: 'Branding Agent',
    instruction: 'I want to turn the song and its creative world into a memorable campaign branding system: colors, typography, symbols, tagline, language, audience signal, and repeatable asset rules. This should package the existing world rather than invent a second one.',
  },
  'music:record-doctor': {
    kind: 'agent',
    targetSlug: 'record-doctor',
    targetName: 'Record Doctor',
    instruction: 'I want a focused producer review of the song using the saved artist context. Help me prepare the right handoff, but do not send anything without my exact approval.',
  },
  'visuals:cover-art': {
    kind: 'agent',
    targetSlug: 'art-director',
    targetName: 'Art Director',
    instruction: 'I want to develop the single artwork by exploring a small set of genuinely distinct art directions, understanding which is strongest, and reviewing the direction before any paid generation.',
  },
  'visuals:canvas': {
    kind: 'agent',
    targetSlug: 'hypermotion-agent',
    targetName: 'Hypermotion',
    instruction: 'I want a strong Spotify Canvas concept and production-ready silent vertical loop built from the campaign assets and visual world, within Spotify Canvas constraints.',
  },
  'visuals:press-photos': {
    kind: 'agent',
    targetSlug: 'art-director',
    targetName: 'Art Director',
    instruction: 'I want a release-specific photo direction and practical shot plan covering framing, styling, locations, lighting, must-have crops, and reference-safe production notes.',
  },
  'visuals:merch-design': {
    kind: 'agent',
    targetSlug: 'print-agent',
    targetName: 'Print Agent',
    instruction: 'I want release-native merch concepts grounded in the approved campaign world and artwork, with a design and production brief I can review before any store or print action.',
  },
  'visuals:posters-graphics': {
    kind: 'agent',
    targetSlug: 'art-director',
    targetName: 'Art Director',
    instruction: 'I want a coherent poster and campaign-graphics system drawn from the approved release identity, with useful formats and production-ready direction.',
  },
  'visuals:visualizer': {
    kind: 'agent',
    targetSlug: 'video-director',
    targetName: 'Video Director',
    instruction: 'I want to find the strongest production-ready visualizer concept using the approved master, artwork, and campaign world. Do not begin paid generation until I approve the direction.',
  },
  'setup:metadata': {
    kind: 'agent',
    targetSlug: 'comms-agent',
    targetName: 'Comms Agent',
    instruction: 'I want a fact-checked credits and release-metadata packet built from the saved campaign materials, with every missing or unverified field made obvious.',
  },
  'setup:social-schedule': {
    kind: 'agent',
    targetSlug: 'social-publisher',
    targetName: 'Social Publisher',
    instruction: 'I want to shape the complete social rollout, including the launch announcement, from this campaign\'s approved Finals and release timeline. We can draft and validate freely, but nothing should be scheduled or published without my exact approval.',
  },
  'setup:epk': {
    kind: 'agent',
    targetSlug: 'comms-agent',
    targetName: 'Comms Agent',
    instruction: 'I want a concise release EPK built only from verified artist, campaign, music, image, and contact materials, with every missing fact or asset clearly flagged.',
  },
  'content:idea-generation': {
    kind: 'workflow',
    targetSlug: 'content-mastermind',
    targetName: 'Content Mastermind',
    instruction: 'I want to explore strong native, anticipation-led, and absurd content directions, then pressure-test and fuse the best ideas instead of settling for the first batch.',
  },
  'content:lyric-clips': {
    kind: 'agent',
    targetSlug: 'lyric-video-agent',
    targetName: 'Lyric Visuals',
    instruction: 'I want to create the strongest possible lyric-led visuals from the approved lyrics, master audio, and campaign world. Short clips are the priority, though a complete lyric video could make sense if the concept genuinely earns it.',
  },
  'content:performance-clips': {
    kind: 'agent',
    targetSlug: 'raw-video-editor',
    targetName: 'Raw Video Editor',
    instruction: 'I want strong vertical performance clips from the campaign footage. First help me confirm whether the right footage exists; if it does not, I want the exact shoot plan rather than a pretend edit.',
  },
  'content:viral-clips': {
    kind: 'agent',
    targetSlug: 'scroll-stopper',
    targetName: 'Scroll Stopper',
    instruction: 'I want the strongest absurd, instantly readable vertical video concepts this release can support, with clear cover frames and generation-ready direction.',
  },
  'content:ugc-clips': {
    kind: 'agent',
    targetSlug: 'content-genius',
    targetName: 'Content Genius',
    instruction: 'I want artist-native UGC-style concepts that feel natural to this release. Each idea should be shootable, platform-native, and specific about the opening beat and performance.',
  },
  'content:merch-clips': {
    kind: 'agent',
    targetSlug: 'video-director',
    targetName: 'Video Director',
    instruction: 'I want a product-led merch clip plan grounded in approved merch assets and the release world. Do not invent products or act as if a finished clip exists without usable product assets.',
  },
  'content:video-production': {
    kind: 'agent',
    targetSlug: 'video-director',
    targetName: 'Video Director',
    instruction: 'I want to identify the strongest useful supporting video beyond the dedicated lyric, viral, and UGC lanes—only if this campaign actually needs one. Do not begin paid generation until I approve the direction.',
  },
  'content:memes': {
    kind: 'agent',
    targetSlug: 'content-genius',
    targetName: 'Content Genius',
    instruction: 'I want artist-native meme formats drawn from the song, campaign world, and audience truth. They should be specific, editable, and genuinely shareable.',
  },
  'promotion:budget': {
    kind: 'agent',
    targetSlug: 'ads-strategist',
    targetName: 'Ads Strategist',
    instruction: 'I want to understand a realistic promotion budget and allocation for this campaign, including the assumptions, priorities, and tradeoffs, before spending anything.',
  },
  'promotion:ad-creatives': {
    kind: 'agent',
    targetSlug: 'ad-creative-agent',
    targetName: 'Ad Creative',
    instruction: 'I want to develop the strongest campaign ad angles, hooks, formats, and variants, then review a clear execution handoff before anything launches or spends.',
  },
  'promotion:paid-campaign': {
    kind: 'workflow',
    targetSlug: 'paid-campaign-builder',
    targetName: 'Paid Campaign Builder',
    instruction: 'I want to shape a coordinated paid-campaign strategy and creative plan, then review the execution package before publishing, launch, budget changes, or spend.',
  },
  'promotion:playlist-targets': {
    kind: 'agent',
    targetSlug: 'playlisting-power-up',
    targetName: 'Playlisting',
    instruction: 'I want to prepare a credible independent-playlist outreach handoff for this release, including the exact inquiry, without sending or purchasing anything.',
  },
  'promotion:press-list': {
    kind: 'agent',
    targetSlug: 'industry-hunter',
    targetName: 'Industry Hunter',
    instruction: 'I want to find and rank journalists, music writers, blogs, local media, podcasts, and other credible press targets that genuinely fit this release, with evidence, fit rationale, contact path, confidence, and a real coverage angle. Do not contact anyone.',
  },
  'promotion:college-radio': {
    kind: 'workflow',
    targetSlug: 'college-radio-campaign',
    targetName: 'College Radio Campaign',
    instruction: 'I want to explore verified college-radio targets and prepare an outreach plan I can approve. Do not send or submit anything.',
  },
  'promotion:influencer-campaign': {
    kind: 'agent',
    targetSlug: 'influencer-campaign-power-up',
    targetName: 'Influencer Campaign',
    instruction: 'I want to explore an influencer campaign using the saved release context and prepare the right inquiry and handoff without sending or booking anything.',
  },
  'promotion:ig-trending': {
    kind: 'agent',
    targetSlug: 'ig-trending-power-up',
    targetName: 'IG Music Trending',
    instruction: 'I want to explore an Instagram music campaign using the saved release context and prepare the right inquiry and handoff without sending or booking anything.',
  },
  'promotion:artist-playlist': {
    kind: 'agent',
    targetSlug: 'spotify-playlist-creator',
    targetName: 'Spotify Playlist Creator',
    instruction: 'I want to develop a release-adjacent Spotify playlist strategy, including the track plan, title, description, and cover concept, without creating or publishing it until I approve it.',
  },
}

export function getReleaseBoardItemAction(
  categoryId: ReleaseBoardCategory['id'],
  itemId: string,
): ReleaseBoardItemAction | null {
  return ITEM_ACTIONS[`${categoryId}:${itemId}`] ?? null
}

export function getReleaseBoardActionLabel(action: ReleaseBoardItemAction): string {
  if (action.kind === 'tool') return 'Transcribe'
  if (action.kind === 'workflow') return 'Run workflow'
  return 'Start worker'
}

export function isReleaseBoardItemIncluded(item: ReleaseBoardItem): boolean {
  return item.tier === 'core' || item.included === true
}

export function buildReleaseBoardItemActionPrompt(input: {
  campaignTitle: string
  categoryLabel: string
  itemLabel: string
  action: ReleaseBoardItemAction
}): string {
  return [
    `I want to work on "${input.itemLabel}" for my "${input.campaignTitle}" campaign.`,
    '',
    input.action.instruction,
    '',
    `This sits in the ${input.categoryLabel} area of my Essentials board. Please use the existing Artist HQ and campaign context before asking me to repeat anything already saved.`,
    '',
    'Where is the most intelligent place to start? Ask me only the key questions that would materially improve the direction. If the saved context already answers them, recommend the strongest first move instead.',
    '',
    'Once we agree on the direction, I want durable outputs I can review and iterate on in Artist OS and Canvas. Keep me clear on what would still remain before this Essentials item is truly done.',
    'Nothing should be published, sent, booked, purchased, or put into motion publicly without my exact approval.',
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
    const activeItems = category.items.filter(isReleaseBoardItemIncluded)
    const availableOptions = category.items.filter((item) => !isReleaseBoardItemIncluded(item))
    return [
      `- ${category.label}: ${progress.done}/${progress.total} done`,
      ...activeItems.map((item) => `  - ${item.label}: ${item.status}`),
      ...(availableOptions.length > 0
        ? [`  - More available: ${availableOptions.map((item) => item.label).join(', ')}`]
        : []),
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

export function parseReleaseBoardDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined | null,
): ReleaseBoardParseResult {
  if (!doc?.body.trim()) return { ok: false, board: null, error: 'Release Board is missing.' }
  const fenced = doc.body.match(/```json\s*([\s\S]*?)\s*```/i)
  const raw = fenced?.[1]
  if (!raw) return { ok: false, board: null, error: 'Release Board JSON block is missing.' }
  try {
    const parsed = JSON.parse(raw) as Partial<ReleaseBoard>
    if (!parsed || parsed.version !== 1 || typeof parsed.workspaceId !== 'string' || !Array.isArray(parsed.categories)) {
      return { ok: false, board: null, error: 'Release Board JSON has an unsupported shape.' }
    }
    if (!isIsoTimestamp(parsed.updatedAt)) {
      return { ok: false, board: null, error: 'Release Board updatedAt is missing or invalid.' }
    }
    return { ok: true, board: normalizeReleaseBoard(parsed.workspaceId, parsed, parsed.updatedAt) }
  } catch {
    return { ok: false, board: null, error: 'Release Board JSON is malformed.' }
  }
}

export function parseReleaseBoardDoc(
  doc: Pick<LoadedContextDoc, 'body'> | undefined | null,
): ReleaseBoard | null {
  const result = parseReleaseBoardDocResult(doc)
  return result.ok ? result.board : null
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
    currentStatus === 'done' || currentStatus === 'skipped' ? 'needed' : 'done',
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

export function setReleaseBoardItemIncluded(
  board: ReleaseBoard,
  categoryId: ReleaseBoardCategory['id'],
  itemId: string,
  included: boolean,
): ReleaseBoard {
  const now = new Date().toISOString()
  return {
    ...board,
    updatedAt: now,
    categories: board.categories.map((category) => {
      if (category.id !== categoryId) return category
      return {
        ...category,
        items: category.items.map((item) => {
          if (item.id !== itemId || item.tier === 'core') return item
          return {
            ...item,
            included,
            status: included && item.status === 'skipped' ? 'needed' as const : item.status,
            updatedAt: now,
          }
        }),
      }
    }),
  }
}

export function linkReleaseBoardItemSession(
  board: ReleaseBoard,
  categoryId: ReleaseBoardCategory['id'],
  itemId: string,
  sessionId: string,
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
          item.id === itemId
            ? { ...item, status: 'in-progress' as const, linkedSessionId: sessionId, updatedAt: now }
            : item
        )),
      }
    }),
  }
}

export function getCategoryProgress(category: ReleaseBoardCategory): { done: number; total: number } {
  const actionable = category.items.filter((item) => isReleaseBoardItemIncluded(item) && item.status !== 'skipped')
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

function normalizeReleaseBoard(
  workspaceId: string,
  input: Partial<ReleaseBoard>,
  updatedAt: string,
): ReleaseBoard {
  const fallback = buildDefaultReleaseBoard(workspaceId)
  const categories = fallback.categories.map((fallbackCategory) => {
    const existingCategory = input.categories?.find((category) => category.id === fallbackCategory.id)
    return {
      ...fallbackCategory,
      detail: existingCategory?.detail || fallbackCategory.detail,
      items: fallbackCategory.items.map((fallbackItem) => {
        const existingItem = existingCategory?.items?.find((item) => item.id === fallbackItem.id)
        if (existingItem) {
          const status = normalizeStatus(existingItem.status)
          return {
            ...existingItem,
            ...fallbackItem,
            status,
            included: fallbackItem.tier === 'core'
              ? true
              : existingItem.included === true || status === 'done' || status === 'in-progress' || status === 'review',
          }
        }
        return {
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
    updatedAt,
  }
}

function normalizeStatus(status: unknown): ReleaseBoardItemStatus {
  return status === 'done' || status === 'skipped' || status === 'in-progress' || status === 'review'
    ? status
    : 'needed'
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value))
}

import type { SharedIntelAgentCatalogEntry, SharedIntelCandidate } from './types.ts'

export const YOUTUBE_INTEL_FENCE = 'youtube-intel'

export type YouTubeIntelCategory =
  | 'branding'
  | 'content'
  | 'rollout'
  | 'audience'
  | 'outreach'
  | 'creative'
  | 'operations'

export interface YouTubeIntelNugget {
  category: YouTubeIntelCategory
  title: string
  summary: string
  whyItMatters: string
  evidence: string
  sourceUrls: string[]
}

export interface YouTubeIntelProcessedVideo {
  channelUrl: string
  videoId: string
  publishedAt: string
  sourceUrl: string
}

export interface YouTubeIntelReportData {
  nuggets: YouTubeIntelNugget[]
  processedVideos: YouTubeIntelProcessedVideo[]
}

const CATEGORY_TARGETS: Record<YouTubeIntelCategory, string[]> = {
  branding: ['branding-agent', 'world-builder'],
  content: ['content-genius', 'scroll-stopper', 'social-publisher'],
  rollout: ['ads-strategist', 'ad-creative-agent', 'college-radio-agent'],
  audience: ['spotify-analyst', 'youtube-research-agent'],
  outreach: ['industry-hunter', 'college-radio-agent', 'outreach-agent'],
  creative: ['art-director', 'world-builder', 'record-doctor'],
  operations: ['orchestrator', 'concierge'],
}

const CATEGORIES = new Set<YouTubeIntelCategory>(Object.keys(CATEGORY_TARGETS) as YouTubeIntelCategory[])

export function parseYouTubeIntelNuggets(markdown: string): YouTubeIntelNugget[] {
  return parseYouTubeIntelReportData(markdown)?.nuggets ?? []
}

export function parseYouTubeIntelReportData(markdown: string): YouTubeIntelReportData | null {
  const match = markdown.match(/```youtube-intel\s*\n([\s\S]*?)\n```/)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1]) as { version?: unknown; nuggets?: unknown; processedVideos?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.nuggets) || !Array.isArray(parsed.processedVideos)) return null
    return {
      nuggets: parsed.nuggets.map(parseNugget).filter((item): item is YouTubeIntelNugget => Boolean(item)).slice(0, 8),
      processedVideos: parsed.processedVideos.map(parseProcessedVideo).filter((item): item is YouTubeIntelProcessedVideo => Boolean(item)).slice(0, 20),
    }
  } catch {
    return null
  }
}

export function buildYouTubeIntelCandidates(
  nuggets: YouTubeIntelNugget[],
  catalog: SharedIntelAgentCatalogEntry[],
): SharedIntelCandidate[] {
  const active = new Set(catalog.filter((agent) => agent.active !== false).map((agent) => agent.slug))
  return nuggets.flatMap((nugget) => {
    const targetAgents = CATEGORY_TARGETS[nugget.category].filter((slug) => active.has(slug))
    if (targetAgents.length === 0) return []
    return [{
      title: nugget.title,
      summary: nugget.summary,
      whyItMatters: nugget.whyItMatters,
      tags: ['youtube-intelligence', nugget.category],
      targetAgents,
      confidence: 'high' as const,
      evidence: [nugget.evidence, ...nugget.sourceUrls].filter(Boolean).join(' | '),
    }]
  })
}

function parseNugget(value: unknown): YouTubeIntelNugget | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const category = clean(input.category) as YouTubeIntelCategory
  const title = clean(input.title)
  const summary = clean(input.summary)
  const whyItMatters = clean(input.whyItMatters)
  const evidence = clean(input.evidence)
  if (!CATEGORIES.has(category) || !title || !summary || !whyItMatters || !evidence) return null
  const sourceUrls = Array.isArray(input.sourceUrls)
    ? input.sourceUrls.map(clean).filter((url) => /^https:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url)).slice(0, 6)
    : []
  if (sourceUrls.length === 0) return null
  return { category, title, summary, whyItMatters, evidence, sourceUrls }
}

function parseProcessedVideo(value: unknown): YouTubeIntelProcessedVideo | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const channelUrl = clean(input.channelUrl)
  const videoId = clean(input.videoId)
  const publishedAt = clean(input.publishedAt)
  const sourceUrl = clean(input.sourceUrl)
  if (!/^https:\/\/(?:www\.)?youtube\.com\/@/i.test(channelUrl)) return null
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null
  if (Number.isNaN(Date.parse(publishedAt))) return null
  if (!/^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(sourceUrl)) return null
  return { channelUrl, videoId, publishedAt, sourceUrl }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

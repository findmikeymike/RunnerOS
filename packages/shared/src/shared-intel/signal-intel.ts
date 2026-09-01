import type { SharedIntelAgentCatalogEntry, SharedIntelCandidate } from './types.ts'
import {
  buildCategorizedIntelCandidates,
  type IntelCategory,
} from './youtube-intel.ts'

export const SIGNAL_INTEL_FENCE = 'signal-intel'
export const MAX_SIGNAL_INTEL_ITEMS = 8

export type SignalIntelLane = 'platform' | 'industry'

export interface SignalIntelItem {
  category: IntelCategory
  title: string
  summary: string
  whyItMatters: string
  evidence: string
  sourceUrls: string[]
}

export interface SignalIntelReportData {
  lane: SignalIntelLane
  items: SignalIntelItem[]
}

const LANES = new Set<SignalIntelLane>(['platform', 'industry'])
const CATEGORIES = new Set<IntelCategory>([
  'branding',
  'content',
  'rollout',
  'audience',
  'outreach',
  'creative',
  'operations',
])

export function parseSignalIntelReportData(
  markdown: string,
  expectedLane?: SignalIntelLane,
): SignalIntelReportData | null {
  const match = markdown.match(/```signal-intel\s*\n([\s\S]*?)\n```/i)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1]) as { version?: unknown; lane?: unknown; items?: unknown }
    const lane = clean(parsed.lane) as SignalIntelLane
    if (parsed.version !== 1 || !LANES.has(lane) || !Array.isArray(parsed.items)) return null
    if (expectedLane && lane !== expectedLane) return null
    const items = parsed.items
      .map(parseItem)
      .filter((item): item is SignalIntelItem => Boolean(item))
      .slice(0, MAX_SIGNAL_INTEL_ITEMS)
    if (parsed.items.length > 0 && items.length === 0) return null
    return {
      lane,
      items,
    }
  } catch {
    return null
  }
}

export function buildSignalIntelCandidates(
  report: SignalIntelReportData,
  catalog: SharedIntelAgentCatalogEntry[],
): SharedIntelCandidate[] {
  return buildCategorizedIntelCandidates(
    report.items,
    catalog,
    ['weekly-signals', `${report.lane}-intelligence`],
  )
}

function parseItem(value: unknown): SignalIntelItem | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const category = clean(input.category) as IntelCategory
  const title = bounded(input.title, 160)
  const summary = bounded(input.summary, 700)
  const whyItMatters = bounded(input.whyItMatters, 700)
  const evidence = bounded(input.evidence, 700)
  if (!CATEGORIES.has(category) || !title || !summary || !whyItMatters || !evidence) return null
  const sourceUrls = Array.isArray(input.sourceUrls)
    ? input.sourceUrls
      .map(clean)
      .filter(isPublicHttpUrl)
      .slice(0, 6)
    : []
  if (sourceUrls.length === 0) return null
  return { category, title, summary, whyItMatters, evidence, sourceUrls }
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

function bounded(value: unknown, max: number): string {
  return clean(value).slice(0, max)
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'
import type { QueueWorkAction } from '@craft-agent/shared/automations'

export const ARTIST_INTEL_CONFIG_CONTEXT_SLUG = 'artist-intel-config'
export const ARTIST_INTEL_REPORT_CONTEXT_SLUG = 'artist-intel-report'
export const YOUTUBE_INTELLIGENCE_AGENT_SLUG = 'youtube-intelligence-agent'
export const SIGNAL_SCOUT_AGENT_SLUG = 'signal-scout-agent'
export const SIGNAL_ANALYST_AGENT_SLUG = 'signal-analyst-agent'
export const WEEKLY_SIGNAL_SCAN_SLUG = 'weekly-signal-scan'

export interface ArtistIntelSource {
  id: string
  name: string
  url: string
  priority: 'high' | 'medium' | 'low'
  notes?: string
}

export interface ArtistIntelConfig {
  version: 1
  enabled: boolean
  cadence: 'manual' | 'weekly'
  maxPerChannel: number
  sinceDays: number
  sources: ArtistIntelSource[]
  updatedAt: string
}

export interface ArtistIntelRun {
  id: string
  status: 'queued' | 'ready' | 'failed'
  sessionId?: string
  workOrderId?: string
  outputId?: string
  title?: string
  summary?: string
  generatedAt: string
  videoCount?: number
  nuggetCount?: number
}

export interface ArtistIntelReport {
  version: 1
  status: 'idle' | 'queued' | 'ready' | 'failed'
  title?: string
  summary?: string
  sessionId?: string
  outputId?: string
  generatedAt?: string
  sourceCount: number
  videoCount?: number
  nuggetCount?: number
  runs: ArtistIntelRun[]
  updatedAt: string
}

export type ArtistIntelConfigParseResult =
  | { ok: true; config: ArtistIntelConfig }
  | { ok: false; config: ArtistIntelConfig; error: string }

export type ArtistIntelReportParseResult =
  | { ok: true; report: ArtistIntelReport }
  | { ok: false; report: ArtistIntelReport; error: string }

export const DEFAULT_ARTIST_INTEL_SOURCES: ArtistIntelSource[] = [
  {
    id: 'managers-playbook',
    name: 'Managers Playbook',
    url: 'https://www.youtube.com/@managersplaybook',
    priority: 'high',
    notes: 'Manager/operator intelligence for artist career strategy.',
  },
  {
    id: 'viral-vsn',
    name: 'Viral VSN',
    url: 'https://www.youtube.com/@Viralvsn',
    priority: 'high',
    notes: 'Viral trends, artist branding, social strategy, and campaign angles.',
  },
  {
    id: 'no-labels-necessary',
    name: 'No Labels Necessary',
    url: 'https://www.youtube.com/@NoLabelsNecessaryOfficial',
    priority: 'high',
    notes: 'Independent music marketing, release strategy, fan growth, and music-business operating plays.',
  },
  {
    id: 'neighborhood-art-supply',
    name: 'Neighborhood Art Supply',
    url: 'https://www.youtube.com/@NeighborhoodArtSupply',
    priority: 'high',
    notes: 'Artist branding and creative identity signals.',
  },
  {
    id: 'its21master',
    name: 'Its21Master',
    url: 'https://www.youtube.com/@its21master',
    priority: 'high',
    notes: 'Independent music marketing, paid social strategy, ad formats, and campaign execution.',
  },
]

export function artistIntelConfigMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Intel Pulse Config',
    description: 'Standing YouTube channel watchlist and cadence for HQ Intel Pulse.',
    routing: { mode: 'targeted', agents: ['youtube-research-agent', 'youtube-intelligence-agent'] },
    enabled: true,
  }
}

export function artistIntelReportMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Intel Report',
    description: 'Latest HQ YouTube Intel Pulse run status and report summary.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistIntelConfig(): ArtistIntelConfig {
  return {
    version: 1,
    enabled: false,
    cadence: 'weekly',
    maxPerChannel: 1,
    sinceDays: 7,
    sources: DEFAULT_ARTIST_INTEL_SOURCES,
    updatedAt: new Date().toISOString(),
  }
}

export function emptyArtistIntelReport(): ArtistIntelReport {
  return {
    version: 1,
    status: 'idle',
    sourceCount: 0,
    runs: [],
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistIntelConfigDocResult(doc: ContextDocDTO | undefined): ArtistIntelConfigParseResult {
  if (!doc?.body.trim()) return { ok: true, config: emptyArtistIntelConfig() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      config: emptyArtistIntelConfig(),
      error: 'Artist Intel config exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistIntelConfig>
    if (parsed.version !== 1) {
      return {
        ok: false,
        config: emptyArtistIntelConfig(),
        error: 'Artist Intel config JSON has an unsupported shape.',
      }
    }
    return { ok: true, config: normalizeIntelConfig(parsed) }
  } catch {
    return {
      ok: false,
      config: emptyArtistIntelConfig(),
      error: 'Artist Intel config JSON is malformed.',
    }
  }
}

export function parseArtistIntelReportDocResult(doc: ContextDocDTO | undefined): ArtistIntelReportParseResult {
  if (!doc?.body.trim()) return { ok: true, report: emptyArtistIntelReport() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      report: emptyArtistIntelReport(),
      error: 'Artist Intel report exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistIntelReport>
    if (parsed.version !== 1) {
      return {
        ok: false,
        report: emptyArtistIntelReport(),
        error: 'Artist Intel report JSON has an unsupported shape.',
      }
    }
    return { ok: true, report: normalizeIntelReport(parsed) }
  } catch {
    return {
      ok: false,
      report: emptyArtistIntelReport(),
      error: 'Artist Intel report JSON is malformed.',
    }
  }
}

export function serializeArtistIntelConfigBody(config: ArtistIntelConfig): string {
  return [
    'HQ Intel Pulse configuration. These are the standing YouTube sources the artist wants watched.',
    '',
    '```json',
    JSON.stringify(normalizeIntelConfig(config), null, 2),
    '```',
  ].join('\n')
}

export function serializeArtistIntelReportBody(report: ArtistIntelReport): string {
  return [
    'Latest HQ Intel Pulse report status. The linked session contains the full working run.',
    '',
    '```json',
    JSON.stringify(normalizeIntelReport(report), null, 2),
    '```',
  ].join('\n')
}

export function createIntelRunPrompt(config: ArtistIntelConfig, artistName: string): string {
  const sources = config.sources
    .filter((source) => source.name.trim() && source.url.trim() && isValidYouTubeChannelUrl(source.url))
    .map((source, index) => `${index + 1}. ${source.name} (${source.url}) - ${source.notes || source.priority}`)
    .join('\n')

  return [
    `Run the HQ YouTube Intel Pulse for ${artistName || 'this artist'}.`,
    '',
    'Watchlist:',
    sources || '- No configured sources. Ask the user to add YouTube channels first.',
    '',
    `Scan window: last ${config.sinceDays} days. Hard limit: only the newest upload per channel.`,
    '',
    'Use YouTube Intelligence with the connected YouTube Research API source.',
    'Read artist-intel-state when present. Check only the newest upload per configured channel.',
    'Fetch a transcript only when that newest video ID is not already recorded. Never ingest an older fallback video.',
    '',
    'Report shape:',
    '1. What changed or is worth noticing',
    '2. Source/video links',
    '3. Why it matters for this artist',
    '4. Suggested campaign/content/brand moves',
    '5. Confidence and missing data',
    '',
    'End the Output with the required fenced youtube-intel JSON block containing processedVideos and categorized nuggets.',
    'Reject generic music-business filler. Do not publish, comment, upload, or modify any YouTube account.',
  ].join('\n')
}

export function createScheduledIntelRunPrompt(artistName: string): string {
  return [
    `Run the scheduled HQ YouTube Intel Pulse for ${artistName || 'this artist'}.`,
    '',
    `First read the current workspace context doc at context/${ARTIST_INTEL_CONFIG_CONTEXT_SLUG}/CONTEXT.md.`,
    'Then read context/artist-intel-state/CONTEXT.md when it exists.',
    'Use its JSON config as the source of truth for enabled, cadence, scan window, max videos per channel, and source URLs.',
    'If enabled is false, stop and report that Intel Pulse was disabled before execution.',
    '',
    'Use YouTube Intelligence with the connected YouTube Research API source.',
    'For each configured YouTube channel, inspect only its newest upload. Fetch its transcript only when its video ID is not already in state. Never ingest an older fallback video.',
    'Create exactly one HQ report Output titled "Weekly YouTube Intelligence Report". A no-new-videos report is a valid completion.',
    '',
    'Report shape:',
    '1. What changed or is worth noticing',
    '2. Source/video links',
    '3. Why it matters for this artist',
    '4. Suggested campaign/content/brand moves',
    '5. Confidence and missing data',
    '',
    'End the Output with the required fenced youtube-intel JSON block containing processedVideos and categorized nuggets. The scheduler handles deduplication state, dashboard, and agent-context routing.',
    '',
    'Reject generic music-business filler. Do not publish, comment, upload, or modify any YouTube account.',
  ].join('\n')
}

export function createIntelQueueWorkAction(workspaceName: string, brief: string): QueueWorkAction {
  return {
    type: 'queue-work',
    ownerScope: 'hq',
    calendarVisibility: 'hidden',
    title: `Weekly YouTube Intelligence - ${workspaceName}`,
    execution: {
      type: 'agent-task',
      agentSlug: YOUTUBE_INTELLIGENCE_AGENT_SLUG,
      brief,
      permissionMode: 'safe',
      expectedOutput: { requirement: 'required', kind: 'report', title: 'Weekly YouTube Intelligence Report' },
      postProcess: 'youtube-intelligence',
    },
  }
}

export function createSignalScanQueueWorkAction(
  workspaceName: string,
  workflowDigest: string,
  config: Pick<ArtistIntelConfig, 'sinceDays'>,
): QueueWorkAction {
  return {
    type: 'queue-work',
    ownerScope: 'hq',
    calendarVisibility: 'hidden',
    title: `Weekly Signal Scan - ${workspaceName}`,
    intentId: 'artist-hq:weekly-signal-scan',
    execution: {
      type: 'workflow-run',
      workflowSlug: WEEKLY_SIGNAL_SCAN_SLUG,
      workflowDigest,
      triggerInputs: {
        artist_name: workspaceName,
        lookback_days: config.sinceDays,
      },
    },
  }
}

export function createQueuedIntelRun(report: ArtistIntelReport, input: {
  sessionId?: string
  workOrderId?: string
  sourceCount: number
  generatedAt?: string
}): ArtistIntelReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const run: ArtistIntelRun = {
    id: slugify(`run-${generatedAt}-${input.sessionId ?? input.workOrderId ?? 'manual'}`),
    status: 'queued',
    sessionId: input.sessionId,
    workOrderId: input.workOrderId,
    title: 'YouTube Intel Pulse queued',
    summary: `Watching ${input.sourceCount} configured channel${input.sourceCount === 1 ? '' : 's'}.`,
    generatedAt,
  }
  return normalizeIntelReport({
    ...report,
    status: 'queued',
    title: run.title,
    summary: run.summary,
    sessionId: input.sessionId,
    sourceCount: input.sourceCount,
    generatedAt,
    updatedAt: generatedAt,
    runs: [run, ...(report.runs ?? [])].slice(0, 10),
  })
}

export function isValidYouTubeChannelUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host !== 'youtube.com') return false
    return /^\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)(\/(videos|shorts|streams|featured|community|about))?\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

function normalizeIntelConfig(config: Partial<ArtistIntelConfig>): ArtistIntelConfig {
  const sinceDays = Number.isInteger(config.sinceDays) ? Number(config.sinceDays) : 7
  const sources = Array.isArray(config.sources)
    ? config.sources.map(normalizeSource).filter((source) => source.name && source.url && isValidYouTubeChannelUrl(source.url))
    : DEFAULT_ARTIST_INTEL_SOURCES

  return {
    version: 1,
    enabled: Boolean(config.enabled),
    cadence: config.cadence === 'manual' ? 'manual' : 'weekly',
    maxPerChannel: 1,
    sinceDays: clamp(sinceDays, 1, 30),
    sources: sources.length ? sources : DEFAULT_ARTIST_INTEL_SOURCES,
    updatedAt: clean(config.updatedAt) || new Date().toISOString(),
  }
}

function normalizeIntelReport(report: Partial<ArtistIntelReport>): ArtistIntelReport {
  const status = report.status === 'queued' || report.status === 'ready' || report.status === 'failed'
    ? report.status
    : 'idle'
  return {
    version: 1,
    status,
    title: clean(report.title),
    summary: clean(report.summary),
    sessionId: clean(report.sessionId),
    outputId: clean(report.outputId),
    generatedAt: clean(report.generatedAt),
    sourceCount: Number.isInteger(report.sourceCount) ? Math.max(0, Number(report.sourceCount)) : 0,
    videoCount: Number.isInteger(report.videoCount) ? Math.max(0, Number(report.videoCount)) : undefined,
    nuggetCount: Number.isInteger(report.nuggetCount) ? Math.max(0, Number(report.nuggetCount)) : undefined,
    runs: normalizeRuns(report.runs),
    updatedAt: clean(report.updatedAt) || new Date().toISOString(),
  }
}

function normalizeRuns(value: unknown): ArtistIntelRun[] {
  if (!Array.isArray(value)) return []
  return value
    .map((run, index) => normalizeRun(run as Partial<ArtistIntelRun>, index))
    .filter((run) => run.generatedAt)
    .slice(0, 10)
}

function normalizeRun(run: Partial<ArtistIntelRun>, index: number): ArtistIntelRun {
  const status = run.status === 'ready' || run.status === 'failed' ? run.status : 'queued'
  return {
    id: clean(run.id) || `run-${index + 1}`,
    status,
    sessionId: clean(run.sessionId),
    workOrderId: clean(run.workOrderId),
    outputId: clean(run.outputId),
    title: clean(run.title),
    summary: clean(run.summary),
    generatedAt: clean(run.generatedAt) || new Date().toISOString(),
    videoCount: Number.isInteger(run.videoCount) ? Math.max(0, Number(run.videoCount)) : undefined,
    nuggetCount: Number.isInteger(run.nuggetCount) ? Math.max(0, Number(run.nuggetCount)) : undefined,
  }
}

function normalizeSource(source: Partial<ArtistIntelSource>, index: number): ArtistIntelSource {
  const name = clean(source.name) || ''
  const url = clean(source.url) || ''
  const priority = source.priority === 'medium' || source.priority === 'low' ? source.priority : 'high'
  return {
    id: clean(source.id) || slugify(name || url || `source-${index + 1}`),
    name,
    url,
    priority,
    notes: clean(source.notes),
  }
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return body.slice(start, end + 1)
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'source'
}

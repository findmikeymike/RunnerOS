import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts'

export const MISSION_BRIEF_CONTEXT_SLUG = 'mission-brief'

export type MissionStatus = 'empty' | 'light' | 'full'
export type MissionType = 'single' | 'ep' | 'album' | 'other'
export type CampaignDateStatus = 'target' | 'locked'

export interface CampaignDateStatuses {
  start?: CampaignDateStatus
  release?: CampaignDateStatus
  finish?: CampaignDateStatus
}

export interface MissionCampaignWindow {
  startDate?: string
  releaseDate?: string
  finishDate?: string
  statuses: CampaignDateStatuses
}

export interface MissionReference {
  type: 'artist' | 'song' | 'visual' | 'brand' | 'other'
  value: string
}

export interface MissionBrief {
  id: string
  workspaceId: string
  status: MissionStatus
  completeness: number
  missionType?: MissionType
  title?: string
  goal?: string
  timeline?: string
  campaignStartDate?: string
  releaseDate?: string
  campaignFinishDate?: string
  campaignDateStatuses?: CampaignDateStatuses
  promoBudget?: string
  genre?: string
  bpm?: number
  sonicReferences?: string[]
  theme?: string
  energy?: string
  keyMoments?: string
  mood?: string
  visualWorld?: string
  references?: MissionReference[]
  targetListener?: string
  channels?: string[]
  openQuestions?: string[]
  rawNotes?: string
  confirmedAt?: string
  updatedAt: string
}

export interface MissionExtraction {
  brief: Partial<MissionBrief>
  missing: string[]
  enhancedSummary: string
}

export type MissionBriefParseResult =
  | { ok: true; brief: MissionBrief }
  | { ok: false; brief: null; error: string }

const REQUIRED_FIELDS: Array<keyof MissionBrief> = ['missionType', 'title', 'goal', 'timeline']
const RECOMMENDED_FIELDS: Array<keyof MissionBrief> = ['promoBudget', 'mood', 'visualWorld', 'references', 'targetListener', 'channels']

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed || undefined
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function inferMissionType(text: string): MissionType | undefined {
  const lower = text.toLowerCase()
  if (/\b(ep)\b/.test(lower)) return 'ep'
  if (/\balbum\b/.test(lower)) return 'album'
  if (/\bsingle\b|\bsong\b|\btrack\b/.test(lower)) return 'single'
  return undefined
}

function inferTitle(text: string): string | undefined {
  const quoted = text.match(/["']([^"']{2,80})["']/)
  if (quoted?.[1]) return clean(quoted[1])

  const named = text.match(/\b(?:called|named|titled|title is|song is|single is|ep is|album is)\s+([A-Z0-9][A-Za-z0-9 '&!-]{1,80})/i)
  if (named?.[1]) {
    return clean(named[1].replace(/\b(?:and|with|for|about|on|by)\b.*$/i, ''))
  }

  return undefined
}

function inferTimeline(text: string): string | undefined {
  const date = text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i)
    ?? text.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/)
    ?? text.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (date?.[0]) return clean(date[0])

  const relative = text.match(/\b(?:next week|this week|next month|this month|in \d+ weeks?|in \d+ days?|release week|pre-save|presave)\b/i)
  return clean(relative?.[0])
}

function inferGoal(text: string): string | undefined {
  const goal = text.match(/\b(?:goal is|trying to|want to|need to|mission is|focus is)\s+([^.!?]{8,180})/i)
  if (goal?.[1]) return clean(goal[1])
  if (text.length > 18) return clean(text.slice(0, 180))
  return undefined
}

function inferMood(text: string): string | undefined {
  const mood = text.match(/\b(?:feels like|mood is|vibe is|about|ethos is|make people feel|should feel like)\s+([^.!?]{5,160})/i)
  return clean(mood?.[1])
}

function inferVisualWorld(text: string): string | undefined {
  const visual = text.match(/\b(?:visuals?|looks like|world is|aesthetic is|imagery is)\s+([^.!?]{5,180})/i)
  return clean(visual?.[1])
}

function inferReferences(text: string): MissionReference[] | undefined {
  const refMatch = text.match(/\b(?:references?|similar to|inspired by)\s+([^.!?]{3,180})/i)
    ?? text.match(/\blike\s+([^.!?]{3,180})/i)
  const raw = refMatch?.[1]
  if (!raw) return undefined
  const values = unique(
    raw
      .split(/,| and | plus |\/|\s\+\s/i)
      .map((value) => value.replace(/^(?:like|similar to|inspired by)\s+/i, ''))
      .slice(0, 6),
  )
  if (values.length === 0) return undefined
  return values.map((value) => ({ type: 'other', value }))
}

function inferTargetListener(text: string): string | undefined {
  const target = text.match(/\b(?:for|target listener is|audience is|listener is)\s+([^.!?]{8,160})/i)
  return clean(target?.[1])
}

function inferChannels(text: string): string[] | undefined {
  const channels = unique(
    ['tiktok', 'instagram', 'youtube', 'spotify', 'apple music', 'x', 'twitter', 'soundcloud']
      .filter((channel) => text.toLowerCase().includes(channel)),
  )
  return channels.length > 0 ? channels : undefined
}

export function calculateMissionCompleteness(brief: Partial<MissionBrief>): number {
  const requiredScore = REQUIRED_FIELDS.filter((field) => (
    field === 'timeline' ? Boolean(brief.timeline || brief.releaseDate) : Boolean(brief[field])
  )).length / REQUIRED_FIELDS.length
  const recommendedScore = RECOMMENDED_FIELDS.filter((field) => {
    const value = brief[field]
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  }).length / RECOMMENDED_FIELDS.length
  return Math.round((requiredScore * 0.7 + recommendedScore * 0.3) * 100)
}

export function getMissionStatus(brief: Partial<MissionBrief>): MissionStatus {
  const completeness = calculateMissionCompleteness(brief)
  if (completeness >= 70) return 'full'
  if (completeness > 0) return 'light'
  return 'empty'
}

export function hasSaveableMissionBrief(brief: Partial<MissionBrief>): boolean {
  return Boolean(clean(brief.title) || clean(brief.goal))
}

export function extractMissionBrief(text: string, existing: Partial<MissionBrief> = {}): MissionExtraction {
  const extracted: Partial<MissionBrief> = {
    ...existing,
    missionType: existing.missionType ?? inferMissionType(text),
    title: existing.title ?? inferTitle(text),
    goal: existing.goal ?? inferGoal(text),
    timeline: existing.timeline ?? inferTimeline(text),
    releaseDate: existing.releaseDate ?? inferTimeline(text),
    campaignDateStatuses: existing.campaignDateStatuses,
    mood: existing.mood ?? inferMood(text),
    visualWorld: existing.visualWorld ?? inferVisualWorld(text),
    references: existing.references?.length ? existing.references : inferReferences(text),
    targetListener: existing.targetListener ?? inferTargetListener(text),
    channels: existing.channels?.length ? existing.channels : inferChannels(text),
    rawNotes: clean([existing.rawNotes, text].filter(Boolean).join('\n\n')),
  }
  const completeness = calculateMissionCompleteness(extracted)
  const status = getMissionStatus(extracted)
  const missing = [...REQUIRED_FIELDS, ...RECOMMENDED_FIELDS]
    .filter((field) => {
      if (field === 'timeline') return !extracted.timeline && !extracted.releaseDate
      const value = extracted[field]
      return Array.isArray(value) ? value.length === 0 : !value
    })
    .map((field) => field.toString())

  return {
    brief: {
      ...extracted,
      completeness,
      status,
    },
    missing,
    enhancedSummary: buildEnhancedSummary(extracted, missing),
  }
}

export function buildMissionBrief(workspaceId: string, input: Partial<MissionBrief>): MissionBrief {
  const now = new Date().toISOString()
  return normalizeMissionBrief(workspaceId, input, now, clean(input.confirmedAt) ?? now)
}

function normalizeMissionBrief(
  workspaceId: string,
  input: Partial<MissionBrief>,
  updatedAt: string,
  confirmedAt?: string,
): MissionBrief {
  const completeness = calculateMissionCompleteness(input)
  const campaignStartDate = normalizeDeadline(input.campaignStartDate)
  const releaseDate = normalizeDeadline(input.releaseDate) ?? normalizeDeadline(input.timeline)
  const campaignFinishDate = normalizeDeadline(input.campaignFinishDate)
  const campaignDateStatuses = normalizeCampaignDateStatuses(
    input.campaignDateStatuses,
    { startDate: campaignStartDate, releaseDate, finishDate: campaignFinishDate },
  )
  return {
    id: input.id || MISSION_BRIEF_CONTEXT_SLUG,
    workspaceId,
    status: getMissionStatus(input),
    completeness,
    missionType: input.missionType,
    title: clean(input.title),
    goal: clean(input.goal),
    timeline: clean(input.timeline),
    campaignStartDate,
    releaseDate,
    campaignFinishDate,
    campaignDateStatuses,
    promoBudget: clean(input.promoBudget),
    genre: clean(input.genre),
    bpm: normalizeBpm(input.bpm),
    sonicReferences: input.sonicReferences ? unique(input.sonicReferences) : undefined,
    theme: clean(input.theme),
    energy: clean(input.energy),
    keyMoments: clean(input.keyMoments),
    mood: clean(input.mood),
    visualWorld: clean(input.visualWorld),
    references: input.references?.filter((ref) => clean(ref.value)),
    targetListener: clean(input.targetListener),
    channels: input.channels?.filter(Boolean),
    openQuestions: input.openQuestions?.filter(Boolean),
    rawNotes: clean(input.rawNotes),
    confirmedAt,
    updatedAt,
  }
}

export function missionBriefMetadata(brief: MissionBrief): ContextDocMetadata {
  return {
    name: brief.title ? `Campaign Brief: ${brief.title}` : 'Campaign Brief',
    description: 'Current creative campaign context for command center and workers.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: brief.status === 'empty' ? undefined : 'active',
    priority: brief.status === 'full' ? 'high' : 'normal',
    deadline: normalizeDeadline(brief.releaseDate) ?? normalizeDeadline(brief.timeline),
  }
}

export function serializeMissionBriefBody(brief: MissionBrief): string {
  return [
    'This context is the current creative campaign brief. Treat it as campaign-scoped context, not global creator identity.',
    '',
    '```json',
    JSON.stringify(brief, null, 2),
    '```',
    '',
    '## Working Summary',
    '',
    buildEnhancedSummary(brief, brief.openQuestions ?? []),
  ].join('\n')
}

export function missionBriefContentKey(brief: MissionBrief): string {
  return JSON.stringify({
    missionType: brief.missionType ?? null,
    title: brief.title ?? null,
    goal: brief.goal ?? null,
    timeline: brief.timeline ?? null,
    campaignStartDate: brief.campaignStartDate ?? null,
    releaseDate: brief.releaseDate ?? null,
    campaignFinishDate: brief.campaignFinishDate ?? null,
    campaignDateStatuses: brief.campaignDateStatuses ?? null,
    promoBudget: brief.promoBudget ?? null,
    genre: brief.genre ?? null,
    bpm: brief.bpm ?? null,
    sonicReferences: brief.sonicReferences ?? [],
    theme: brief.theme ?? null,
    energy: brief.energy ?? null,
    keyMoments: brief.keyMoments ?? null,
    mood: brief.mood ?? null,
    visualWorld: brief.visualWorld ?? null,
    references: brief.references ?? [],
    targetListener: brief.targetListener ?? null,
    channels: brief.channels ?? [],
    openQuestions: brief.openQuestions ?? [],
    rawNotes: brief.rawNotes ?? null,
  })
}

export function missionReleaseDateKey(brief: Pick<MissionBrief, 'releaseDate' | 'timeline'>): string | undefined {
  return normalizeDeadline(brief.releaseDate) ?? normalizeDeadline(brief.timeline)
}

export function missionCampaignWindow(
  brief: Pick<MissionBrief, 'campaignStartDate' | 'releaseDate' | 'timeline' | 'campaignFinishDate' | 'campaignDateStatuses'>,
): MissionCampaignWindow {
  const startDate = normalizeDeadline(brief.campaignStartDate)
  const releaseDate = missionReleaseDateKey(brief)
  const finishDate = normalizeDeadline(brief.campaignFinishDate)
  return {
    startDate,
    releaseDate,
    finishDate,
    statuses: normalizeCampaignDateStatuses(
      brief.campaignDateStatuses,
      { startDate, releaseDate, finishDate },
    ) ?? {},
  }
}

export function missionCampaignWindowError(
  brief: Pick<MissionBrief, 'campaignStartDate' | 'releaseDate' | 'timeline' | 'campaignFinishDate' | 'campaignDateStatuses'>,
): string | undefined {
  const { startDate, releaseDate, finishDate } = missionCampaignWindow(brief)
  if (startDate && releaseDate && startDate > releaseDate) {
    return 'Campaign start must be on or before the release date.'
  }
  if (releaseDate && finishDate && releaseDate > finishDate) {
    return 'Campaign finish must be on or after the release date.'
  }
  if (!releaseDate && startDate && finishDate && startDate > finishDate) {
    return 'Campaign finish must be on or after the campaign start.'
  }
  return undefined
}

export function parseMissionBriefDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined | null,
): MissionBriefParseResult {
  if (!doc?.body.trim()) return { ok: false, brief: null, error: 'Campaign Brief is missing.' }
  const fenced = doc.body.match(/```json\s*([\s\S]*?)\s*```/i)
  const raw = fenced?.[1]
  if (!raw) return { ok: false, brief: null, error: 'Campaign Brief JSON block is missing.' }
  try {
    const parsed = JSON.parse(raw) as Partial<MissionBrief>
    const workspaceId = clean(parsed?.workspaceId)
    if (!parsed || typeof parsed !== 'object' || !workspaceId) {
      return { ok: false, brief: null, error: 'Campaign Brief JSON has an unsupported shape.' }
    }
    if (!isIsoTimestamp(parsed.updatedAt)) {
      return { ok: false, brief: null, error: 'Campaign Brief updatedAt is missing or invalid.' }
    }
    const brief = normalizeMissionBrief(
      workspaceId,
      parsed,
      parsed.updatedAt,
      isIsoTimestamp(parsed.confirmedAt) ? parsed.confirmedAt : undefined,
    )
    const campaignWindowError = missionCampaignWindowError(brief)
    if (campaignWindowError) {
      return { ok: false, brief: null, error: campaignWindowError }
    }
    return {
      ok: true,
      brief,
    }
  } catch {
    return { ok: false, brief: null, error: 'Campaign Brief JSON is malformed.' }
  }
}

export function parseMissionBriefDoc(
  doc: Pick<LoadedContextDoc, 'body'> | undefined | null,
): MissionBrief | null {
  const result = parseMissionBriefDocResult(doc)
  return result.ok ? result.brief : null
}

export function emptyMissionBrief(workspaceId: string): MissionBrief {
  return buildMissionBrief(workspaceId, {
    status: 'empty',
    completeness: 0,
    openQuestions: ['What are we building toward?'],
  })
}

function normalizeDeadline(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? trimmed
    : undefined
}

function normalizeCampaignDateStatuses(
  input: CampaignDateStatuses | undefined,
  dates: { startDate?: string; releaseDate?: string; finishDate?: string },
): CampaignDateStatuses | undefined {
  const statuses: CampaignDateStatuses = {
    start: dates.startDate ? normalizeCampaignDateStatus(input?.start) : undefined,
    release: dates.releaseDate ? normalizeCampaignDateStatus(input?.release) : undefined,
    finish: dates.finishDate ? normalizeCampaignDateStatus(input?.finish) : undefined,
  }
  return statuses.start || statuses.release || statuses.finish ? statuses : undefined
}

function normalizeCampaignDateStatus(value: unknown): CampaignDateStatus {
  return value === 'locked' ? 'locked' : 'target'
}

function normalizeBpm(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  return rounded >= 20 && rounded <= 300 ? rounded : undefined
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value))
}

function buildEnhancedSummary(brief: Partial<MissionBrief>, missing: string[]): string {
  const lines = [
    brief.title ? `Campaign: ${brief.title}` : 'Campaign: untitled',
    brief.missionType ? `Type: ${brief.missionType}` : null,
    brief.goal ? `Goal: ${brief.goal}` : null,
    brief.campaignStartDate ? `Campaign start: ${brief.campaignStartDate} (${brief.campaignDateStatuses?.start ?? 'target'})` : null,
    brief.releaseDate ? `Release date: ${brief.releaseDate} (${brief.campaignDateStatuses?.release ?? 'target'})` : null,
    brief.campaignFinishDate ? `Campaign finish: ${brief.campaignFinishDate} (${brief.campaignDateStatuses?.finish ?? 'target'})` : null,
    brief.timeline ? `Release target: ${brief.timeline}` : null,
    brief.promoBudget ? `Promo budget: ${brief.promoBudget}` : null,
    brief.genre ? `Genre: ${brief.genre}` : null,
    brief.bpm ? `BPM: ${brief.bpm}` : null,
    brief.sonicReferences?.length ? `Similar sonics: ${brief.sonicReferences.join(', ')}` : null,
    brief.theme ? `Theme: ${brief.theme}` : null,
    brief.energy ? `Energy and movement: ${brief.energy}` : null,
    brief.keyMoments ? `Key song moments: ${brief.keyMoments}` : null,
    brief.mood ? `Mood: ${brief.mood}` : null,
    brief.visualWorld ? `Visual world: ${brief.visualWorld}` : null,
    brief.targetListener ? `Target listener: ${brief.targetListener}` : null,
    brief.references?.length ? `References: ${brief.references.map((ref) => ref.value).join(', ')}` : null,
    missing.length ? `Missing: ${missing.slice(0, 5).join(', ')}` : 'Missing: none blocking',
  ].filter(Boolean)
  return lines.join('\n')
}

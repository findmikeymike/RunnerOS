import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts'

export const ARTIST_RELEASE_HORIZON_CONTEXT_SLUG = 'artist-release-horizon'

export type ArtistReleaseEventType = 'release' | 'promotion' | 'live' | 'creation' | 'business'

export interface ArtistReleaseMonthPlan {
  title: string
  event: ArtistReleaseEventType
  plan: string
  keyGoal: string
}

export interface ArtistReleaseHorizon {
  version: 2
  months: Record<string, ArtistReleaseMonthPlan>
  updatedAt: string
}

export type ArtistReleaseHorizonParseResult =
  | { ok: true; horizon: ArtistReleaseHorizon }
  | { ok: false; horizon: ArtistReleaseHorizon; error: string }

const UNKNOWN_UPDATED_AT = '1970-01-01T00:00:00.000Z'

export function emptyArtistReleaseHorizon(): ArtistReleaseHorizon {
  return {
    version: 2,
    months: {},
    updatedAt: new Date().toISOString(),
  }
}

export function artistReleaseHorizonMetadata(): ContextDocMetadata {
  return {
    name: 'Release Horizon',
    description: 'Rolling twelve-month artist release plan and monthly planning notes.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function parseArtistReleaseHorizonDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
): ArtistReleaseHorizonParseResult {
  if (!doc?.body.trim()) {
    return {
      ok: false,
      horizon: { version: 2, months: {}, updatedAt: UNKNOWN_UPDATED_AT },
      error: 'Release Horizon is missing.',
    }
  }
  const fenced = doc.body.match(/```json\s*([\s\S]*?)```/i)
  const raw = fenced?.[1]
  if (!raw) {
    return {
      ok: false,
      horizon: { version: 2, months: {}, updatedAt: UNKNOWN_UPDATED_AT },
      error: 'Release Horizon JSON block is missing.',
    }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ArtistReleaseHorizon> & { monthNotes?: Record<string, string> }
    const months = normalizeMonths(parsed.months)
    for (const [key, value] of Object.entries(parsed.monthNotes ?? {})) {
      if (!/^\d{4}-\d{2}$/.test(key) || typeof value !== 'string' || !value.trim() || months[key]) continue
      const note = value.trim()
      months[key] = {
        title: note.split(/[.!?\n]/)[0]?.trim().slice(0, 64) || 'Monthly plan',
        event: 'creation',
        plan: note,
        keyGoal: '',
      }
    }
    const horizon: ArtistReleaseHorizon = {
      version: 2,
      months,
      updatedAt: isIsoTimestamp(parsed.updatedAt) ? parsed.updatedAt : UNKNOWN_UPDATED_AT,
    }
    return isIsoTimestamp(parsed.updatedAt)
      ? { ok: true, horizon }
      : { ok: false, horizon, error: 'Release Horizon updatedAt is missing or invalid.' }
  } catch {
    return {
      ok: false,
      horizon: { version: 2, months: {}, updatedAt: UNKNOWN_UPDATED_AT },
      error: 'Release Horizon JSON is malformed.',
    }
  }
}

export function parseArtistReleaseHorizon(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
): ArtistReleaseHorizon {
  return parseArtistReleaseHorizonDocResult(doc).horizon
}

export function serializeArtistReleaseHorizon(plan: ArtistReleaseHorizon): string {
  return [
    'This is the rolling twelve-month release horizon for Artist HQ.',
    '',
    '```json',
    JSON.stringify({ ...plan, version: 2 }, null, 2),
    '```',
  ].join('\n')
}

function normalizeMonths(value: unknown): Record<string, ArtistReleaseMonthPlan> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, month]) => /^\d{4}-\d{2}$/.test(key) && month && typeof month === 'object')
      .map(([key, month]) => {
        const raw = month as Partial<ArtistReleaseMonthPlan>
        return [key, {
          title: clean(raw.title),
          event: isEventType(raw.event) ? raw.event : 'creation',
          plan: clean(raw.plan),
          keyGoal: clean(raw.keyGoal),
        } satisfies ArtistReleaseMonthPlan]
      })
      .filter(([, month]) => {
        const value = month as ArtistReleaseMonthPlan
        return Boolean(value.title || value.plan || value.keyGoal)
      }),
  )
}

function isEventType(value: unknown): value is ArtistReleaseEventType {
  return value === 'release' || value === 'promotion' || value === 'live' || value === 'creation' || value === 'business'
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value))
}

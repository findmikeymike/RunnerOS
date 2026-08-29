import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

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

export function parseArtistReleaseHorizon(doc: ContextDocDTO | undefined): ArtistReleaseHorizon {
  if (!doc?.body.trim()) return emptyArtistReleaseHorizon()
  const fenced = doc.body.match(/```json\s*([\s\S]*?)```/i)
  const raw = fenced?.[1]
  if (!raw) return emptyArtistReleaseHorizon()
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
    return {
      version: 2,
      months,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return emptyArtistReleaseHorizon()
  }
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

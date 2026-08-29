import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG = 'artist-instagram-snapshot'

export interface ArtistInstagramSnapshot {
  version: 1
  dataSource: 'instagram-insights-browser'
  snapshotDate: string
  windowDays?: number
  profile: {
    profile: string
    handle?: string
    accountUrl?: string
  }
  metrics: {
    followers?: number
    followerDelta?: number
    accountsReached?: number
    accountsEngaged?: number
    interactions?: number
    profileVisits?: number
    likes?: number
    comments?: number
  }
  partial?: boolean
  errors?: string[]
  updatedAt: string
}

export interface ArtistInstagramGrowthPoint {
  date: string
  followerDelta: number
}

export type ArtistInstagramSnapshotParseResult =
  | { ok: true; snapshot: ArtistInstagramSnapshot | null }
  | { ok: false; snapshot: null; error: string }

export function artistInstagramSnapshotMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Instagram Snapshot',
    description: 'Latest Instagram Insights snapshot for Artist HQ Social Pulse.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function parseArtistInstagramSnapshotDocResult(doc: ContextDocDTO | undefined): ArtistInstagramSnapshotParseResult {
  if (!doc?.body.trim()) return { ok: true, snapshot: null }
  return parseArtistInstagramSnapshotJsonResult(doc.body)
}

export function parseArtistInstagramSnapshotJsonResult(body: string): ArtistInstagramSnapshotParseResult {
  const json = extractJson(body)
  if (!json) return { ok: false, snapshot: null, error: 'Instagram Snapshot exists, but no JSON block could be read.' }

  try {
    const parsed = JSON.parse(json) as Partial<ArtistInstagramSnapshot>
    const snapshotDate = clean(parsed.snapshotDate)
    const profileId = clean(parsed.profile?.profile)
    if (!snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !profileId || !parsed.metrics || typeof parsed.metrics !== 'object') {
      return { ok: false, snapshot: null, error: 'Instagram Snapshot JSON has an unsupported shape.' }
    }

    return {
      ok: true,
      snapshot: {
        version: 1,
        dataSource: 'instagram-insights-browser',
        snapshotDate,
        windowDays: positiveInteger(parsed.windowDays),
        profile: {
          profile: profileId,
          handle: clean(parsed.profile?.handle),
          accountUrl: clean(parsed.profile?.accountUrl),
        },
        metrics: {
          followers: nonNegativeNumber(parsed.metrics.followers),
          followerDelta: finiteNumber(parsed.metrics.followerDelta),
          accountsReached: nonNegativeNumber(parsed.metrics.accountsReached),
          accountsEngaged: nonNegativeNumber(parsed.metrics.accountsEngaged),
          interactions: nonNegativeNumber(parsed.metrics.interactions),
          profileVisits: nonNegativeNumber(parsed.metrics.profileVisits),
          likes: nonNegativeNumber(parsed.metrics.likes),
          comments: nonNegativeNumber(parsed.metrics.comments),
        },
        partial: Boolean(parsed.partial),
        errors: Array.isArray(parsed.errors) ? parsed.errors.map(String).filter(Boolean) : [],
        updatedAt: clean(parsed.updatedAt) ?? new Date().toISOString(),
      },
    }
  } catch {
    return { ok: false, snapshot: null, error: 'Instagram Snapshot JSON is malformed.' }
  }
}

export function buildArtistInstagramGrowthHistory(
  snapshots: ArtistInstagramSnapshot[],
  limit = 8,
): ArtistInstagramGrowthPoint[] {
  const ordered = [...snapshots]
    .filter((snapshot) => typeof snapshot.metrics.followerDelta === 'number')
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
  const latest = ordered.at(-1)
  if (!latest) return []

  const byDate = new Map<string, ArtistInstagramGrowthPoint>()
  for (const snapshot of ordered) {
    if (snapshot.dataSource !== latest.dataSource
      || snapshot.windowDays !== latest.windowDays
      || snapshot.profile.profile !== latest.profile.profile) continue
    byDate.set(snapshot.snapshotDate, {
      date: snapshot.snapshotDate,
      followerDelta: snapshot.metrics.followerDelta!,
    })
  }
  return [...byDate.values()].slice(-Math.max(1, limit))
}

export function serializeArtistInstagramSnapshotBody(snapshot: ArtistInstagramSnapshot): string {
  return [
    'This is the latest read-only Instagram Insights snapshot. Treat it as dated performance context.',
    '',
    '```json',
    JSON.stringify({ ...snapshot, version: 1, dataSource: 'instagram-insights-browser' }, null, 2),
    '```',
  ].join('\n')
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1]
  const firstBrace = body.indexOf('{')
  const lastBrace = body.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) return null
  return body.slice(firstBrace, lastBrace + 1)
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed || undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value)
  return number !== undefined && number >= 0 ? number : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const number = finiteNumber(value)
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined
}

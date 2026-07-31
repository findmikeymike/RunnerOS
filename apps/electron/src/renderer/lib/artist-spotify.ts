import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG = 'artist-spotify-snapshot'

export interface ArtistSpotifySnapshot {
  version: 1
  dataSource?: 'spotify-web-api' | 'spotify-for-artists-browser' | 'manual'
  snapshotDate: string
  windowDays?: number
  artist: {
    name?: string
    spotifyArtistId?: string
    spotifyUrl?: string
    genres?: string[]
    imageUrl?: string
  }
  metrics: {
    streams?: number
    listeners?: number
    followers?: number
    saves?: number
    popularity?: number
    saveRate?: number
    skipRate?: number
  }
  geo?: {
    topCities?: Array<{ city: string; country?: string; listeners?: number }>
  }
  tracks?: Array<{ id?: string; name: string; streams?: number; saves?: number; playlistAdds?: number }>
  playlistsDriving?: Array<{ name: string; type?: string; listeners?: number; addedDate?: string | null }>
  sources?: Record<string, number>
  partial?: boolean
  errors?: string[]
  updatedAt: string
}

type SpotifyTrack = NonNullable<ArtistSpotifySnapshot['tracks']>[number]
type SpotifyPlaylist = NonNullable<ArtistSpotifySnapshot['playlistsDriving']>[number]

export type ArtistSpotifySnapshotParseResult =
  | { ok: true; snapshot: ArtistSpotifySnapshot | null }
  | { ok: false; snapshot: null; error: string }

export interface ArtistSpotifyHistoryPoint {
  date: string
  streams: number
}

export function artistSpotifySnapshotMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Spotify Snapshot',
    description: 'Latest Spotify for Artists analytics snapshot for Artist HQ widgets and workers.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function parseArtistSpotifySnapshotDocResult(doc: ContextDocDTO | undefined): ArtistSpotifySnapshotParseResult {
  if (!doc?.body.trim()) return { ok: true, snapshot: null }
  return parseArtistSpotifySnapshotJsonResult(doc.body)
}

export function parseArtistSpotifySnapshotJsonResult(body: string): ArtistSpotifySnapshotParseResult {
  const json = extractJson(body)
  if (!json) {
    return { ok: false, snapshot: null, error: 'Spotify Snapshot exists, but no JSON block could be read.' }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistSpotifySnapshot>
    const snapshotDate = clean(parsed.snapshotDate)
    if (!snapshotDate || !parsed.metrics || typeof parsed.metrics !== 'object') {
      return { ok: false, snapshot: null, error: 'Spotify Snapshot JSON has an unsupported shape.' }
    }
    return {
      ok: true,
      snapshot: {
        version: 1,
        snapshotDate,
        windowDays: toNumber(parsed.windowDays),
        artist: {
          name: clean(parsed.artist?.name),
          spotifyArtistId: clean(parsed.artist?.spotifyArtistId),
          spotifyUrl: clean(parsed.artist?.spotifyUrl),
          genres: Array.isArray(parsed.artist?.genres) ? parsed.artist.genres.map(String).filter(Boolean) : undefined,
          imageUrl: clean(parsed.artist?.imageUrl),
        },
        metrics: {
          streams: toNumber(parsed.metrics.streams),
          listeners: toNumber(parsed.metrics.listeners),
          followers: toNumber(parsed.metrics.followers),
          saves: toNumber(parsed.metrics.saves),
          popularity: toNumber(parsed.metrics.popularity),
          saveRate: toNumber(parsed.metrics.saveRate),
          skipRate: toNumber(parsed.metrics.skipRate),
        },
        dataSource: normalizeDataSource(parsed.dataSource),
        geo: normalizeGeo(parsed.geo),
        tracks: normalizeTracks(parsed.tracks),
        playlistsDriving: normalizePlaylists(parsed.playlistsDriving),
        sources: parsed.sources && typeof parsed.sources === 'object' ? parsed.sources as Record<string, number> : undefined,
        partial: Boolean(parsed.partial),
        errors: Array.isArray(parsed.errors) ? parsed.errors.map(String) : [],
        updatedAt: clean(parsed.updatedAt) ?? new Date().toISOString(),
      },
    }
  } catch {
    return { ok: false, snapshot: null, error: 'Spotify Snapshot JSON is malformed.' }
  }
}

export function buildArtistSpotifyStreamHistory(
  snapshots: ArtistSpotifySnapshot[],
  limit = 8,
): ArtistSpotifyHistoryPoint[] {
  const ordered = [...snapshots]
    .filter((snapshot) => typeof snapshot.metrics.streams === 'number')
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
  const latest = ordered.at(-1)
  if (!latest) return []

  const compatible = ordered.filter((snapshot) =>
    snapshot.dataSource === latest.dataSource
    && snapshot.windowDays === latest.windowDays,
  )
  const byDate = new Map<string, ArtistSpotifyHistoryPoint>()
  for (const snapshot of compatible) {
    byDate.set(snapshot.snapshotDate, {
      date: snapshot.snapshotDate,
      streams: snapshot.metrics.streams!,
    })
  }
  return [...byDate.values()].slice(-Math.max(1, limit))
}

export function serializeArtistSpotifySnapshotBody(snapshot: Omit<ArtistSpotifySnapshot, 'version' | 'updatedAt'> | ArtistSpotifySnapshot): string {
  const normalized = {
    version: 1,
    ...snapshot,
    updatedAt: new Date().toISOString(),
  }
  return [
    'This is the latest global Spotify for Artists analytics snapshot. Treat it as dated performance context.',
    '',
    '```json',
    JSON.stringify(normalized, null, 2),
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

function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function normalizeDataSource(value: unknown): ArtistSpotifySnapshot['dataSource'] {
  if (value === 'spotify-web-api' || value === 'spotify-for-artists-browser' || value === 'manual') return value
  if (value === 'spotify-for-artists') return 'spotify-for-artists-browser'
  return undefined
}

function normalizeGeo(value: unknown): ArtistSpotifySnapshot['geo'] {
  const candidate = value as ArtistSpotifySnapshot['geo']
  if (!Array.isArray(candidate?.topCities)) return undefined
  return {
    topCities: candidate.topCities
      .filter((city) => clean(city.city))
      .map((city) => ({
        city: city.city,
        country: clean(city.country),
        listeners: toNumber(city.listeners),
      })),
  }
}

function normalizeTracks(value: unknown): ArtistSpotifySnapshot['tracks'] {
  if (!Array.isArray(value)) return undefined
  return value
    .filter((track) => clean((track as SpotifyTrack).name))
    .map((track) => {
      const candidate = track as SpotifyTrack
      return {
        id: clean(candidate.id),
        name: candidate.name,
        streams: toNumber(candidate.streams),
        saves: toNumber(candidate.saves),
        playlistAdds: toNumber(candidate.playlistAdds),
      }
    })
}

function normalizePlaylists(value: unknown): ArtistSpotifySnapshot['playlistsDriving'] {
  if (!Array.isArray(value)) return undefined
  return value
    .filter((playlist) => clean((playlist as SpotifyPlaylist).name))
    .map((playlist) => {
      const candidate = playlist as SpotifyPlaylist
      return {
        name: candidate.name,
        type: clean(candidate.type),
        listeners: toNumber(candidate.listeners),
        addedDate: clean(candidate.addedDate) ?? null,
      }
    })
}

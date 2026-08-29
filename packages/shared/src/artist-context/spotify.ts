import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import { buildContextDocBody } from './json-block.ts';
import { parseArtistSnapshotBody, type ArtistSnapshotParse } from './snapshot-doc.ts';
import { isIsoDateString, normalizeInlineText, toFiniteNumber } from './text.ts';

export const ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG = 'artist-spotify-snapshot';

const SPOTIFY_PREAMBLE = [
  'This is the latest global Spotify for Artists analytics snapshot. Treat it as dated performance context.',
];

export type ArtistSpotifyDataSource =
  | 'spotify-web-api'
  | 'spotify-for-artists-browser'
  | 'manual';

export interface ArtistSpotifySnapshot {
  version: 1;
  dataSource?: ArtistSpotifyDataSource;
  snapshotDate: string;
  windowDays?: number;
  artist: {
    name?: string;
    spotifyArtistId?: string;
    spotifyUrl?: string;
    genres?: string[];
    imageUrl?: string;
  };
  metrics: {
    streams?: number;
    listeners?: number;
    followers?: number;
    saves?: number;
    popularity?: number;
    saveRate?: number;
    skipRate?: number;
  };
  dailyStreams?: Array<{ date: string; streams: number }>;
  geo?: {
    topCities?: Array<{ city: string; country?: string; listeners?: number }>;
  };
  tracks?: Array<{ id?: string; name: string; streams?: number; saves?: number; playlistAdds?: number }>;
  playlistsDriving?: Array<{ name: string; type?: string; listeners?: number; addedDate?: string | null }>;
  sources?: Record<string, number>;
  partial?: boolean;
  errors?: string[];
  updatedAt: string;
}

type SpotifyTrack = NonNullable<ArtistSpotifySnapshot['tracks']>[number];
type SpotifyPlaylist = NonNullable<ArtistSpotifySnapshot['playlistsDriving']>[number];

export type ArtistSpotifySnapshotParseResult = ArtistSnapshotParse<ArtistSpotifySnapshot>;

export interface ArtistSpotifyHistoryPoint {
  date: string;
  streams: number;
  listeners?: number;
}

export interface ArtistSpotifyGrowth {
  comparisonDate: string;
  streamsDelta: number;
  streamsPercent?: number;
  listenersDelta?: number;
  listenersPercent?: number;
}

export function artistSpotifySnapshotMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Spotify Snapshot',
    description: 'Latest Spotify for Artists analytics snapshot for Artist HQ widgets and workers.',
    routing: { mode: 'broadcast' },
    enabled: true,
  };
}

export function parseArtistSpotifySnapshotDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
): ArtistSpotifySnapshotParseResult {
  if (!doc?.body.trim()) return { ok: true, snapshot: null };
  return parseArtistSpotifySnapshotJsonResult(doc.body);
}

export function parseArtistSpotifySnapshotJsonResult(body: string): ArtistSpotifySnapshotParseResult {
  return parseArtistSnapshotBody<Partial<ArtistSpotifySnapshot>, ArtistSpotifySnapshot>(
    'Spotify Snapshot',
    body,
    (parsed) => {
      const snapshotDate = normalizeInlineText(parsed.snapshotDate);
      if (!snapshotDate || !parsed.metrics || typeof parsed.metrics !== 'object') return null;
      return {
        version: 1,
        snapshotDate,
        windowDays: toFiniteNumber(parsed.windowDays),
        artist: {
          name: normalizeInlineText(parsed.artist?.name),
          spotifyArtistId: normalizeInlineText(parsed.artist?.spotifyArtistId),
          spotifyUrl: normalizeInlineText(parsed.artist?.spotifyUrl),
          genres: Array.isArray(parsed.artist?.genres)
            ? parsed.artist.genres.map(String).filter(Boolean)
            : undefined,
          imageUrl: normalizeInlineText(parsed.artist?.imageUrl),
        },
        metrics: {
          streams: toFiniteNumber(parsed.metrics.streams),
          listeners: toFiniteNumber(parsed.metrics.listeners),
          followers: toFiniteNumber(parsed.metrics.followers),
          saves: toFiniteNumber(parsed.metrics.saves),
          popularity: toFiniteNumber(parsed.metrics.popularity),
          saveRate: toFiniteNumber(parsed.metrics.saveRate),
          skipRate: toFiniteNumber(parsed.metrics.skipRate),
        },
        dailyStreams: normalizeDailyStreams(parsed.dailyStreams),
        dataSource: normalizeDataSource(parsed.dataSource),
        geo: normalizeGeo(parsed.geo),
        tracks: normalizeTracks(parsed.tracks),
        playlistsDriving: normalizePlaylists(parsed.playlistsDriving),
        sources:
          parsed.sources && typeof parsed.sources === 'object'
            ? (parsed.sources as Record<string, number>)
            : undefined,
        partial: Boolean(parsed.partial),
        errors: Array.isArray(parsed.errors) ? parsed.errors.map(String) : [],
        updatedAt: normalizeInlineText(parsed.updatedAt) ?? new Date().toISOString(),
      };
    },
  );
}

/**
 * Stream points for the trend chart, oldest first.
 *
 * Only snapshots sharing the newest snapshot's `dataSource` and `windowDays` are
 * included: a 7-day browser scrape and a 28-day API pull are not comparable, and
 * plotting them together would invent growth that did not happen.
 */
export function buildArtistSpotifyStreamHistory(
  snapshots: ArtistSpotifySnapshot[],
  limit = 8,
): ArtistSpotifyHistoryPoint[] {
  const ordered = [...snapshots]
    .filter((snapshot) => typeof snapshot.metrics.streams === 'number')
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
  const latest = ordered.at(-1);
  if (!latest) return [];

  const compatible = ordered.filter(
    (snapshot) =>
      snapshot.dataSource === latest.dataSource && snapshot.windowDays === latest.windowDays,
  );
  const byDate = new Map<string, ArtistSpotifyHistoryPoint>();
  for (const snapshot of compatible) {
    byDate.set(snapshot.snapshotDate, {
      date: snapshot.snapshotDate,
      streams: snapshot.metrics.streams!,
      listeners: snapshot.metrics.listeners,
    });
  }
  return [...byDate.values()].slice(-Math.max(1, limit));
}

export function calculateArtistSpotifyGrowth(
  history: ArtistSpotifyHistoryPoint[],
): ArtistSpotifyGrowth | null {
  if (history.length < 2) return null;
  const previous = history.at(-2)!;
  const current = history.at(-1)!;
  const bothListeners =
    typeof current.listeners === 'number' && typeof previous.listeners === 'number';
  return {
    comparisonDate: previous.date,
    streamsDelta: current.streams - previous.streams,
    streamsPercent:
      previous.streams > 0
        ? ((current.streams - previous.streams) / previous.streams) * 100
        : undefined,
    listenersDelta: bothListeners ? current.listeners! - previous.listeners! : undefined,
    listenersPercent:
      bothListeners && previous.listeners! > 0
        ? ((current.listeners! - previous.listeners!) / previous.listeners!) * 100
        : undefined,
  };
}

export function serializeArtistSpotifySnapshotBody(
  snapshot: Omit<ArtistSpotifySnapshot, 'version' | 'updatedAt'> | ArtistSpotifySnapshot,
): string {
  return buildContextDocBody(SPOTIFY_PREAMBLE, {
    version: 1,
    ...snapshot,
    updatedAt: new Date().toISOString(),
  });
}

/** `spotify-for-artists` is the pre-rename value still present in older docs. */
function normalizeDataSource(value: unknown): ArtistSpotifyDataSource | undefined {
  if (value === 'spotify-web-api' || value === 'spotify-for-artists-browser' || value === 'manual') {
    return value;
  }
  if (value === 'spotify-for-artists') return 'spotify-for-artists-browser';
  return undefined;
}

function normalizeGeo(value: unknown): ArtistSpotifySnapshot['geo'] {
  const candidate = value as ArtistSpotifySnapshot['geo'];
  if (!Array.isArray(candidate?.topCities)) return undefined;
  return {
    topCities: candidate.topCities
      .filter((city) => normalizeInlineText(city.city))
      .map((city) => ({
        city: city.city,
        country: normalizeInlineText(city.country),
        listeners: toFiniteNumber(city.listeners),
      })),
  };
}

function normalizeTracks(value: unknown): ArtistSpotifySnapshot['tracks'] {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((track) => normalizeInlineText((track as SpotifyTrack).name))
    .map((track) => {
      const candidate = track as SpotifyTrack;
      return {
        id: normalizeInlineText(candidate.id),
        name: candidate.name,
        streams: toFiniteNumber(candidate.streams),
        saves: toFiniteNumber(candidate.saves),
        playlistAdds: toFiniteNumber(candidate.playlistAdds),
      };
    });
}

function normalizePlaylists(value: unknown): ArtistSpotifySnapshot['playlistsDriving'] {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((playlist) => normalizeInlineText((playlist as SpotifyPlaylist).name))
    .map((playlist) => {
      const candidate = playlist as SpotifyPlaylist;
      return {
        name: candidate.name,
        type: normalizeInlineText(candidate.type),
        listeners: toFiniteNumber(candidate.listeners),
        addedDate: normalizeInlineText(candidate.addedDate) ?? null,
      };
    });
}

/** Deduplicates by date and drops malformed or negative entries. */
function normalizeDailyStreams(value: unknown): ArtistSpotifySnapshot['dailyStreams'] {
  if (!Array.isArray(value)) return undefined;
  const byDate = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { date?: unknown; streams?: unknown };
    const date = normalizeInlineText(candidate.date);
    const streams = toFiniteNumber(candidate.streams);
    if (!date || !isIsoDateString(date) || streams === undefined || streams < 0) continue;
    byDate.set(date, streams);
  }
  const points = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, streams]) => ({ date, streams }));
  return points.length > 0 ? points : undefined;
}

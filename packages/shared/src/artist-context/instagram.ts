import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import { buildContextDocBody } from './json-block.ts';
import { parseArtistSnapshotBody, type ArtistSnapshotParse } from './snapshot-doc.ts';
import {
  isIsoDateString,
  normalizeInlineText,
  toFiniteNumber,
  toNonNegativeNumber,
  toPositiveInteger,
} from './text.ts';

export const ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG = 'artist-instagram-snapshot';

/** Instagram Insights is read-only scraping; there is no API-backed variant. */
const INSTAGRAM_DATA_SOURCE = 'instagram-insights-browser';

const INSTAGRAM_PREAMBLE = [
  'This is the latest read-only Instagram Insights snapshot. Treat it as dated performance context.',
];

export interface ArtistInstagramSnapshot {
  version: 1;
  dataSource: typeof INSTAGRAM_DATA_SOURCE;
  snapshotDate: string;
  windowDays?: number;
  profile: {
    profile: string;
    handle?: string;
    accountUrl?: string;
  };
  metrics: {
    followers?: number;
    followerDelta?: number;
    accountsReached?: number;
    accountsEngaged?: number;
    interactions?: number;
    profileVisits?: number;
    likes?: number;
    comments?: number;
  };
  partial?: boolean;
  errors?: string[];
  updatedAt: string;
  /** True only when an old snapshot lacked updatedAt and snapshotDate was used instead. */
  updatedAtInferred?: true;
}

export interface ArtistInstagramGrowthPoint {
  date: string;
  followerDelta: number;
}

export type ArtistInstagramSnapshotParseResult = ArtistSnapshotParse<ArtistInstagramSnapshot>;

export function artistInstagramSnapshotMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Instagram Snapshot',
    description: 'Latest Instagram Insights snapshot for Artist HQ Social Pulse.',
    routing: { mode: 'broadcast' },
    enabled: true,
  };
}

export function parseArtistInstagramSnapshotDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
): ArtistInstagramSnapshotParseResult {
  if (!doc?.body.trim()) return { ok: true, snapshot: null };
  return parseArtistInstagramSnapshotJsonResult(doc.body);
}

export function parseArtistInstagramSnapshotJsonResult(
  body: string,
): ArtistInstagramSnapshotParseResult {
  return parseArtistSnapshotBody<Partial<ArtistInstagramSnapshot>, ArtistInstagramSnapshot>(
    'Instagram Snapshot',
    body,
    (parsed) => {
      const snapshotDate = normalizeInlineText(parsed.snapshotDate);
      const profileId = normalizeInlineText(parsed.profile?.profile);
      if (
        !snapshotDate
        || !isIsoDateString(snapshotDate)
        || !profileId
        || !parsed.metrics
        || typeof parsed.metrics !== 'object'
      ) {
        return null;
      }
      return {
        version: 1,
        dataSource: INSTAGRAM_DATA_SOURCE,
        snapshotDate,
        windowDays: toPositiveInteger(parsed.windowDays),
        profile: {
          profile: profileId,
          handle: normalizeInlineText(parsed.profile?.handle),
          accountUrl: normalizeInlineText(parsed.profile?.accountUrl),
        },
        metrics: {
          followers: toNonNegativeNumber(parsed.metrics.followers),
          // Deltas may legitimately be negative.
          followerDelta: toFiniteNumber(parsed.metrics.followerDelta),
          accountsReached: toNonNegativeNumber(parsed.metrics.accountsReached),
          accountsEngaged: toNonNegativeNumber(parsed.metrics.accountsEngaged),
          interactions: toNonNegativeNumber(parsed.metrics.interactions),
          profileVisits: toNonNegativeNumber(parsed.metrics.profileVisits),
          likes: toNonNegativeNumber(parsed.metrics.likes),
          comments: toNonNegativeNumber(parsed.metrics.comments),
        },
        partial: Boolean(parsed.partial),
        errors: Array.isArray(parsed.errors) ? parsed.errors.map(String).filter(Boolean) : [],
        updatedAt: normalizeTimestamp(parsed.updatedAt) ?? `${snapshotDate}T00:00:00.000Z`,
        updatedAtInferred: normalizeTimestamp(parsed.updatedAt) ? undefined : true,
      };
    },
  );
}

function normalizeTimestamp(value: unknown): string | undefined {
  const timestamp = normalizeInlineText(value);
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : undefined;
}

/**
 * Follower-delta points for the Social Pulse chart, oldest first.
 *
 * Restricted to snapshots matching the newest one's data source, window, and
 * profile so a second account or a changed window cannot distort the trend.
 */
export function buildArtistInstagramGrowthHistory(
  snapshots: ArtistInstagramSnapshot[],
  limit = 8,
): ArtistInstagramGrowthPoint[] {
  const ordered = [...snapshots]
    .filter((snapshot) => typeof snapshot.metrics.followerDelta === 'number')
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
  const latest = ordered.at(-1);
  if (!latest) return [];

  const byDate = new Map<string, ArtistInstagramGrowthPoint>();
  for (const snapshot of ordered) {
    if (
      snapshot.dataSource !== latest.dataSource
      || snapshot.windowDays !== latest.windowDays
      || snapshot.profile.profile !== latest.profile.profile
    ) {
      continue;
    }
    byDate.set(snapshot.snapshotDate, {
      date: snapshot.snapshotDate,
      followerDelta: snapshot.metrics.followerDelta!,
    });
  }
  return [...byDate.values()].slice(-Math.max(1, limit));
}

export function serializeArtistInstagramSnapshotBody(snapshot: ArtistInstagramSnapshot): string {
  return buildContextDocBody(INSTAGRAM_PREAMBLE, {
    ...snapshot,
    version: 1,
    dataSource: INSTAGRAM_DATA_SOURCE,
  });
}

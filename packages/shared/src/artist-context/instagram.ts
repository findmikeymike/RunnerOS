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
  monthlyFollowers?: ArtistInstagramMonthlyFollower[];
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

export interface ArtistInstagramMonthlyFollower {
  month: string;
  followers?: number;
  net?: number;
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
        monthlyFollowers: normalizeMonthlyFollowers(parsed.monthlyFollowers),
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

/**
 * Combines provider-backed monthly history with local month-end snapshots.
 * Missing follower totals may be directionally reconstructed from current
 * followers and captured net movement when possible.
 */
export function buildArtistInstagramMonthlyFollowers(
  snapshots: ArtistInstagramSnapshot[],
  now = new Date(),
): ArtistInstagramMonthlyFollower[] {
  const ordered = [...snapshots]
    .filter((snapshot) => isIsoDateString(snapshot.snapshotDate))
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
  const latest = ordered.at(-1);
  if (!latest) return [];

  const compatible = ordered.filter(
    (snapshot) => snapshot.profile.profile === latest.profile.profile,
  );
  const byMonth = new Map<string, ArtistInstagramMonthlyFollower>();

  for (const snapshot of compatible) {
    for (const point of normalizeMonthlyFollowers(snapshot.monthlyFollowers) ?? []) {
      byMonth.set(point.month, { ...byMonth.get(point.month), ...point });
    }
    if (typeof snapshot.metrics.followers === 'number') {
      const month = snapshot.snapshotDate.slice(0, 7);
      const existing = byMonth.get(month) ?? { month };
      byMonth.set(month, { ...existing, followers: snapshot.metrics.followers });
    }
  }

  const currentMonth = Number.isNaN(now.getTime())
    ? new Date().toISOString().slice(0, 7)
    : now.toISOString().slice(0, 7);
  const points = [...byMonth.values()]
    .filter((point) => point.month < currentMonth)
    .sort((left, right) => left.month.localeCompare(right.month))
    .slice(-12);

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    if (
      typeof point.net !== 'number'
      && typeof point.followers === 'number'
      && typeof previous.followers === 'number'
    ) {
      point.net = point.followers - previous.followers;
    }
  }

  const latestFollowers = latest.metrics.followers;
  const lastPoint = points.at(-1);
  if (lastPoint && typeof lastPoint.followers !== 'number' && typeof latestFollowers === 'number') {
    lastPoint.followers = latestFollowers;
  }
  for (let index = points.length - 1; index > 0; index -= 1) {
    const current = points[index]!;
    const previous = points[index - 1]!;
    if (
      typeof previous.followers !== 'number'
      && typeof current.followers === 'number'
      && typeof current.net === 'number'
    ) {
      previous.followers = current.followers - current.net;
    }
  }

  return points;
}

export function serializeArtistInstagramSnapshotBody(snapshot: ArtistInstagramSnapshot): string {
  return buildContextDocBody(INSTAGRAM_PREAMBLE, {
    ...snapshot,
    version: 1,
    dataSource: INSTAGRAM_DATA_SOURCE,
  });
}

function normalizeMonthlyFollowers(value: unknown): ArtistInstagramSnapshot['monthlyFollowers'] {
  if (!Array.isArray(value)) return undefined;
  const byMonth = new Map<string, ArtistInstagramMonthlyFollower>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { month?: unknown; followers?: unknown; net?: unknown };
    const month = normalizeInlineText(candidate.month);
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
    const followers = toNonNegativeNumber(candidate.followers);
    const net = toFiniteNumber(candidate.net);
    if (followers === undefined && net === undefined) continue;
    byMonth.set(month, { month, followers, net });
  }
  const points = [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month));
  return points.length > 0 ? points : undefined;
}

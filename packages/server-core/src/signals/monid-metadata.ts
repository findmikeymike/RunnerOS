import { normalizeSignalChannelUrl, normalizeSignalVideoUrl, SIGNAL_CHANNEL_ID, SIGNAL_VIDEO_ID, type SignalChannel, type SignalVideoMetadata } from '@craft-agent/shared/shared-intel';
import { runMonidSignalOperation } from './monid-transcript';

// Pinned public contract: https://apify.com/streamers/youtube-scraper/input-schema
// Monid still inspects current schema/pricing before every new paid operation.
const ENDPOINT = '/streamers/youtube-scraper';
const RECENT_LIMIT = 50;
const SINGLE_CAP_USD = 0.02;
const LIST_CAP_USD = 0.25;
interface MetadataDeps { run?: typeof runMonidSignalOperation; attemptScope?: string }
type Row = Record<string, unknown>;
function fail(): never { throw new Error('Monid YouTube metadata could not be verified. Use a canonical channel URL or check the source in Connections > Services.'); }
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Row;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail();
  return value.trim();
}
function channelUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return fail();
  const normalized = normalizeSignalChannelUrl(value.startsWith('@') ? `https://www.youtube.com/${value}` : value);
  if (!normalized) return fail();
  const path = new URL(normalized).pathname;
  try {
    const segment = decodeURIComponent(path.split('/').at(-1)!);
    if (!/^(?:@?[\p{L}\p{N}_.-]{1,100})$/u.test(segment)) return fail();
  } catch { return fail(); }
  return normalized;
}
function canonicalId(url: string): string | undefined { return new URL(url).pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})$/)?.[1]; }
function channel(row: Row): { id: string; url: string } {
  const url = channelUrl(row.channelUrl);
  const fromUrl = canonicalId(url);
  const id = row.channelId ?? fromUrl;
  if (typeof id !== 'string' || !SIGNAL_CHANNEL_ID.test(id) || fromUrl && fromUrl !== id) return fail();
  return { id, url };
}
function absoluteDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.test(value)) return fail();
  const calendar = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(parsed)) return fail();
  return new Date(parsed).toISOString();
}
function video(row: Row): SignalVideoMetadata {
  const id = row.id;
  if (typeof id !== 'string' || !SIGNAL_VIDEO_ID.test(id)) return fail();
  if (row.url !== undefined && (typeof row.url !== 'string' || row.url.length > 2048 || normalizeSignalVideoUrl(row.url)?.videoId !== id)) return fail();
  return { videoId: id, channelId: channel(row).id, title: text(row.title, 500), publishedAt: absoluteDate(row.date), sourceUrl: `https://www.youtube.com/watch?v=${id}` };
}
function rows(value: unknown, maximum: number): Row[] {
  if (!Array.isArray(value) || value.length > maximum) return fail();
  return value.map(record);
}
function actorInput(url: string, maximum: number): Row {
  return { startUrls: [{ url }], maxResults: maximum, maxResultsShorts: 0, maxResultStreams: 0,
    sortVideosBy: 'NEWEST', downloadSubtitles: false, aiVideoDescription: false, aiVideoSummary: false };
}

/** Fail closed if the live actor contract can no longer enforce this request. */
export function validateMonidMetadataInspection(inspection: Row, input: Row): void {
  const schema = record(record(inspection.input).body);
  const properties = record(schema.properties);
  if (schema.type !== 'object') return fail();
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !(key in input)))) return fail();
  for (const [name, value] of Object.entries(input)) {
    const field = record(properties[name]);
    const expected = Array.isArray(value) ? 'array' : typeof value === 'number' ? 'integer' : typeof value;
    if (field.type !== expected) return fail();
    if (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.includes(value))) return fail();
    if (typeof value === 'number' && (typeof field.minimum === 'number' && value < field.minimum || typeof field.maximum === 'number' && value > field.maximum)) return fail();
  }
  const sort = record(properties.sortVideosBy);
  if (!Array.isArray(sort.enum) || !sort.enum.includes('NEWEST')) return fail();
  const items = record(record(properties.startUrls).items);
  if (items.type !== 'object' || record(record(items.properties).url).type !== 'string') return fail();
}

export async function monidResolveChannel(root: string, url: string, deps: MetadataDeps = {}): Promise<SignalChannel> {
  const normalized = channelUrl(url);
  const input = actorInput(`${normalized}/videos`, 1);
  return (deps.run ?? runMonidSignalOperation)(root, {
    key: 'youtube-channel-identity-v1', endpoint: ENDPOINT, input, maxCostUsd: SINGLE_CAP_USD, maxOutputRows: 1, cacheTtlMs: 24 * 60 * 60_000,
    attemptScope: deps.attemptScope,
    validateInspection: inspection => validateMonidMetadataInspection(inspection, input),
    parseOutput: output => {
      const [row] = rows(output, 1); if (!row) return fail();
      const resolved = channel(row);
      const knownId = canonicalId(normalized);
      if (knownId ? resolved.id !== knownId : ![row.channelUrl, row.inputChannelUrl, typeof row.channelUsername === 'string' ? `https://www.youtube.com/@${row.channelUsername.replace(/^@/, '')}` : undefined]
        .some(value => { try { return typeof value === 'string' && channelUrl(value).toLowerCase() === normalized.toLowerCase(); } catch { return false; } })) return fail();
      return { channelId: resolved.id, url: `https://www.youtube.com/channel/${resolved.id}`, name: text(row.channelName, 200), priority: 'medium' as const };
    },
  });
}

export async function monidRecentVideos(root: string, channelId: string, signal?: AbortSignal, deps: MetadataDeps = {}): Promise<{ videos: SignalVideoMetadata[]; complete: boolean }> {
  signal?.throwIfAborted();
  if (!SIGNAL_CHANNEL_ID.test(channelId)) return fail();
  const input = actorInput(`https://www.youtube.com/channel/${channelId}/videos`, RECENT_LIMIT);
  return (deps.run ?? runMonidSignalOperation)(root, {
    key: 'youtube-recent-videos-v1', endpoint: ENDPOINT, input, maxCostUsd: LIST_CAP_USD, maxOutputRows: RECENT_LIMIT, cacheTtlMs: 15 * 60_000,
    attemptScope: deps.attemptScope,
    validateInspection: inspection => validateMonidMetadataInspection(inspection, input),
    parseOutput: output => {
      const videos = rows(output, RECENT_LIMIT).map(video);
      if (videos.some(item => item.channelId !== channelId) || new Set(videos.map(item => item.videoId)).size !== videos.length) return fail();
      videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.videoId.localeCompare(b.videoId));
      // No rows alone cannot prove an empty channel; reaching the cap is partial.
      return { videos, complete: videos.length > 0 && videos.length < RECENT_LIMIT };
    },
  }, signal);
}

export async function monidVideoMetadata(root: string, id: string, signal?: AbortSignal, deps: MetadataDeps = {}): Promise<SignalVideoMetadata> {
  signal?.throwIfAborted();
  if (!SIGNAL_VIDEO_ID.test(id)) return fail();
  const input = actorInput(`https://www.youtube.com/watch?v=${id}`, 1);
  return (deps.run ?? runMonidSignalOperation)(root, {
    key: 'youtube-video-metadata-v1', endpoint: ENDPOINT, input, maxCostUsd: SINGLE_CAP_USD, maxOutputRows: 1, cacheTtlMs: 24 * 60 * 60_000,
    attemptScope: deps.attemptScope,
    validateInspection: inspection => validateMonidMetadataInspection(inspection, input),
    parseOutput: output => {
      const [row] = rows(output, 1); if (!row) return fail();
      const item = video(row); if (item.videoId !== id) return fail(); return item;
    },
  }, signal);
}

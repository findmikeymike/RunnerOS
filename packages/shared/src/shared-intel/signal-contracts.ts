import { z } from 'zod';

/** This marker selects a format, never grants permission or proves provenance. */
export const SIGNAL_CONTRACT = 'signals-v1' as const;
export const SIGNAL_LIMITS = { channels: 20, perChannel: 3, selectedVideos: 20, links: 10, findings: 12, ideas: 5, topics: 8, excerpt: 600 } as const;
export type SignalTrack = 'industry' | 'your-world';
export type SignalMode = 'scan' | 'links';
export type SignalTemporalKind = 'time-sensitive' | 'evergreen' | 'unknown';

const nonempty = z.string().trim().min(1).max(200);
export const SIGNAL_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const SIGNAL_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const videoId = z.string().regex(SIGNAL_VIDEO_ID);
const timestamp = z.string().datetime({ offset: true });
export const signalRunIdentitySchema = z.object({
  version: z.literal(1), hqWorkspaceId: nonempty, track: z.enum(['industry', 'your-world']),
  mode: z.enum(['scan', 'links']), runId: nonempty, workflowRunId: nonempty,
  configRevision: nonempty, requestedVideoIds: z.array(videoId).max(20),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.requestedVideoIds).size !== value.requestedVideoIds.length) ctx.addIssue({ code: 'custom', message: 'Duplicate requested video IDs' });
  if (value.mode === 'links' && (value.requestedVideoIds.length < 1 || value.requestedVideoIds.length > 10)) ctx.addIssue({ code: 'custom', message: 'Links mode requires 1-10 videos' });
});
export type SignalRunIdentity = z.infer<typeof signalRunIdentitySchema>;

export const signalChannelSchema = z.object({
  channelId: z.string().regex(SIGNAL_CHANNEL_ID), url: z.string().url(), name: nonempty,
  priority: z.enum(['high', 'medium', 'low']), notes: z.string().max(2000).optional(),
  lastScannedAt: timestamp.optional(),
}).strict();
export type SignalChannel = z.infer<typeof signalChannelSchema>;
export const signalTrackConfigSchema = z.object({
  version: z.literal(1), track: z.enum(['industry', 'your-world']), enabled: z.boolean(),
  cadence: z.enum(['manual', 'weekly']), sinceDays: z.number().int().min(1).max(14),
  maxPerChannel: z.number().int().min(1).max(3), sources: z.array(signalChannelSchema).max(20),
  revision: nonempty, updatedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.sources.map(source => source.channelId)).size !== value.sources.length) ctx.addIssue({ code: 'custom', message: 'Duplicate canonical channels in track' });
  if (value.track === 'your-world' && value.enabled && !value.sources.length) ctx.addIssue({ code: 'custom', message: 'Your World needs a channel before enabling scans' });
  for (const source of value.sources) {
    if (!normalizeSignalChannelUrl(source.url)) ctx.addIssue({ code: 'custom', message: 'Invalid YouTube channel URL' });
    const canonical = source.url.match(/\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/)?.[1];
    if (canonical && canonical !== source.channelId) ctx.addIssue({ code: 'custom', message: 'Channel URL and canonical ID disagree' });
  }
});
export type SignalTrackConfig = z.infer<typeof signalTrackConfigSchema>;
export interface SignalRunSummary {
  runId: string; track: SignalTrack; mode: SignalMode;
  status: 'queued' | 'running' | 'report' | 'no-change' | 'partial' | 'failed' | 'cancelled';
  workflowRunId?: string; orderIds: string[]; outputId?: string;
  createdAt: string; updatedAt: string; error?: string;
}
export interface SignalState {
  hqWorkspaceId: string; tracks: Record<SignalTrack, SignalTrackConfig>; runs: SignalRunSummary[];
  legacyIndustry?: { requiresReview: true; configBody: string | null };
}
export interface SignalQueueResult { hqWorkspaceId: string; runId: string; orderIds: string[]; reused: boolean }
export function validateSignalTrackConfig(value: unknown): SignalTrackConfig { return signalTrackConfigSchema.parse(value); }
export function validateSignalRunIdentity(value: unknown): SignalRunIdentity { return signalRunIdentitySchema.parse(value); }

export interface SignalVideoMetadata {
  videoId: string; channelId: string; publishedAt: string; sourceUrl: string; title: string;
}
/** Provider/host facts, never deserialized from an agent's claimed completion. */
export interface SignalSourceCoverage {
  sourceId: string; status: 'checked' | 'unavailable' | 'incomplete'; checkedAt: string;
  /** Eligible in-window discovery, including IDs subsequently skipped by the scoped ledger. */
  candidateVideoIds: string[]; reportableFindingCount?: number; message?: string;
}
export interface SignalEvidenceReceipt {
  version: 1; hqWorkspaceId: string; track: SignalTrack; runId: string; sourceId: string;
  videoId?: string; packetId: string; contentHash: string;
  status: 'finding' | 'examined-no-finding' | 'unavailable'; checkedAt: string;
  sourcePublishedAt?: string; error?: string;
}
export interface SignalLedgerEntry {
  hqWorkspaceId: string; track: SignalTrack; videoId: string; runId: string;
  outcome: 'included' | 'examined-no-finding'; finalizedAt: string;
  outputId?: string; evidencePacketId: string;
}
export interface SignalVideoLink { videoId: string; canonicalUrl: string; timestampSeconds?: number }
export type SignalLinksResult = { ok: true; videos: SignalVideoLink[] } | { ok: false; errors: Array<{ index: number; input: string; message: string }> };

function youtubeUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname.toLowerCase())) return null;
    return url;
  } catch { return null; }
}

/** Syntactic normalization only. The provider must resolve aliases to canonical IDs. */
export function normalizeSignalChannelUrl(input: string): string | null {
  const url = youtubeUrl(input);
  if (!url || /youtu\.be$/.test(url.hostname)) return null;
  const path = url.pathname.replace(/\/(?:videos|shorts|streams|featured)\/?$/, '').replace(/\/$/, '');
  if (!/^\/(?:channel\/UC[A-Za-z0-9_-]{22}|@[\p{L}\p{N}_.%-]{1,100}|(?:c|user)\/[A-Za-z0-9_.%-]{1,100})$/u.test(path)) return null;
  return `https://www.youtube.com${path}`;
}

export function normalizeSignalVideoUrl(input: string): SignalVideoLink | null {
  const url = youtubeUrl(input);
  if (!url) return null;
  let id: string | null = null;
  if (/youtu\.be$/.test(url.hostname)) id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
  else if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v');
  else id = url.pathname.match(/^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
  if (!id || !SIGNAL_VIDEO_ID.test(id)) return null;
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start') ?? url.hash.match(/^#t=(.+)$/)?.[1];
  let seconds: number | undefined;
  if (raw) {
    if (/^\d+$/.test(raw)) seconds = Number(raw);
    else {
      const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      if (match && match[0]) seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    }
    if (seconds === undefined || !Number.isSafeInteger(seconds) || seconds > 604800) return null;
  }
  return { videoId: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}`, ...(seconds !== undefined ? { timestampSeconds: seconds } : {}) };
}

/** Reject the entire mixed batch, but return per-input errors for the dialog. */
export function normalizeSignalVideoLinks(inputs: readonly string[]): SignalLinksResult {
  if (!inputs.length || inputs.length > 100) return { ok: false, errors: [{ index: -1, input: '', message: 'Supply 1-10 unique YouTube video links.' }] };
  const errors: Array<{ index: number; input: string; message: string }> = [];
  const videos = new Map<string, SignalVideoLink>();
  inputs.forEach((input, index) => {
    const video = normalizeSignalVideoUrl(input);
    if (!video) errors.push({ index, input, message: 'Use a valid watch, Shorts, live-video, or youtu.be URL.' });
    else if (!videos.has(video.videoId)) videos.set(video.videoId, video);
    else if (videos.get(video.videoId)?.timestampSeconds === undefined && video.timestampSeconds !== undefined) videos.set(video.videoId, video);
  });
  if (videos.size > 10) errors.push({ index: -1, input: '', message: 'At most 10 unique videos per review.' });
  return errors.length ? { ok: false, errors } : { ok: true, videos: [...videos.values()] };
}

export function signalCoverageKey(hqWorkspaceId: string, track: SignalTrack, videoId: string): string {
  return JSON.stringify([hqWorkspaceId, track, videoId]);
}

export function signalWorkflowFor(track: SignalTrack, mode: SignalMode): string {
  return mode === 'links' ? 'signal-video-review' : track === 'your-world' ? 'weekly-world-scan' : 'signals-industry-scan';
}

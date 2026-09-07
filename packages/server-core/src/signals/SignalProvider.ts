import { execFile } from 'node:child_process';
import { readFile, mkdir, stat, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { normalizeSignalChannelUrl, SIGNAL_CHANNEL_ID, SIGNAL_VIDEO_ID, type SignalChannel, type SignalVideoMetadata } from '@craft-agent/shared/shared-intel';
import { collectSignalWebsite, type SignalWebsitePacket, type SignalWebsiteCollectorDeps } from './website-collector';
import { zeroSignalTranscript } from './zero-transcript';
import { monidSignalTranscript, isMonidSignalFallbackBlocked } from './monid-transcript';
import { monidResolveChannel, monidRecentVideos, monidVideoMetadata } from './monid-metadata';
import { resolveSignalToolPath } from './tool-path';

export interface SignalTranscript { videoId: string; segments: Array<{ start: number; end: number; text: string }>; provider: string }
export interface SignalProvider {
  resolveChannel(url: string, root?: string, attemptScope?: string): Promise<SignalChannel>;
  recent(channelId: string, signal?: AbortSignal, root?: string, attemptScope?: string): Promise<{ videos: SignalVideoMetadata[]; complete: boolean }>;
  video(videoId: string, signal?: AbortSignal, root?: string, attemptScope?: string): Promise<SignalVideoMetadata>;
  transcript(root: string, videoId: string, signal?: AbortSignal, attemptScope?: string): Promise<SignalTranscript>;
  website?(url: string, window: { sinceDays: number; now: string }, signal?: AbortSignal): Promise<SignalWebsitePacket>;
}
const execute = promisify(execFile);
function rows(value: any): any[] {
  const result = Array.isArray(value) ? value : value?.results?.items ?? value?.items ?? value?.videos ?? value?.data?.items ?? value?.data?.videos ?? value?.data;
  if (!Array.isArray(result)) throw new Error('YouTube returned unsupported metadata.');
  return result;
}
function metadata(row: any, parentChannelId?: string): SignalVideoMetadata {
  if (!row || typeof row !== 'object') throw new Error('YouTube metadata is incomplete.');
  const videoId = row.videoId ?? row.video_id ?? row.contentDetails?.videoId ?? row.snippet?.resourceId?.videoId ?? row.id;
  const channelId = row.channelId ?? row.channel_id ?? row.snippet?.videoOwnerChannelId ?? row.snippet?.channelId ?? parentChannelId;
  const publishedAt = row.publishedAt ?? row.published_at ?? row.contentDetails?.videoPublishedAt ?? row.snippet?.publishedAt;
  const title = row.title ?? row.snippet?.title;
  if (typeof videoId !== 'string' || !SIGNAL_VIDEO_ID.test(videoId) || typeof channelId !== 'string' || !SIGNAL_CHANNEL_ID.test(channelId)
    || typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt)) || typeof title !== 'string' || !title.trim()) throw new Error('YouTube metadata is incomplete.');
  return { videoId, channelId, publishedAt: new Date(publishedAt).toISOString(), title: title.slice(0, 500), sourceUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

/** Adapter only: discovery and transcripts remain in the existing bundled tools. */
export class LocalSignalProvider implements SignalProvider {
  constructor(private readonly websiteDeps?: SignalWebsiteCollectorDeps, private readonly deps: {
    command?: (name: string, args: string[], signal?: AbortSignal) => Promise<unknown>;
    monidTranscript?: typeof monidSignalTranscript;
    monidResolveChannel?: typeof monidResolveChannel;
    monidRecentVideos?: typeof monidRecentVideos;
    monidVideoMetadata?: typeof monidVideoMetadata;
    zeroTranscript?: (root: string, videoId: string, signal?: AbortSignal) => Promise<SignalTranscript>;
  } = {}) {}
  async website(url: string, window: { sinceDays: number; now: string }, signal?: AbortSignal): Promise<SignalWebsitePacket> {
    return collectSignalWebsite({ url, ...window, signal }, this.websiteDeps);
  }
  private async call(name: string, args: string[], signal?: AbortSignal): Promise<any> {
    try {
      signal?.throwIfAborted();
      if (this.deps.command) return await this.deps.command(name, args, signal);
      const apiKey = await getCredentialManager().getUserSecret('YOUTUBE_API_KEY');
      const { stdout } = await execute(process.execPath, [resolveSignalToolPath(name), ...args], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CRAFT_INTEGRATION_CACHE_ROOT: RUNTIME_IDENTITY.integrationCacheRoot, ...(apiKey ? { YOUTUBE_API_KEY: apiKey } : {}) },
        timeout: 120_000, maxBuffer: 8 * 1024 * 1024, signal,
      });
      return JSON.parse(stdout);
    } catch { signal?.throwIfAborted(); throw new Error(name === 'youtube-research'
      ? 'Native YouTube metadata is unavailable. Configure a YouTube Data API source in Connections > Services and retry.'
      : 'YouTube transcript evidence is unavailable. Check transcript access and retry.'); }
  }
  async resolveChannel(input: string, root?: string, attemptScope?: string): Promise<SignalChannel> {
    const url = normalizeSignalChannelUrl(input.startsWith('@') ? `https://www.youtube.com/${input}` : input);
    if (!url) throw new Error('Enter a YouTube channel URL or handle.');
    const path = new URL(url).pathname;
    const flag = path.startsWith('/channel/') ? '--id' : path.startsWith('/@') ? '--for-handle' : path.startsWith('/user/') ? '--for-username' : null;
    if (!flag) throw new Error('Use this channel\'s @handle or canonical channel URL.');
    const value = path.startsWith('/@') ? path.slice(1) : path.split('/')[2]!;
    try {
      const item = rows(await this.call('youtube-research', ['youtube', 'channels-list', flag, value, '--part', 'snippet', '--json', '--no-input', '--data-source', 'live']))[0];
      if (!item || !SIGNAL_CHANNEL_ID.test(item.id)) throw new Error('YouTube channel could not be resolved.');
      if (flag === '--id' && item.id !== value) throw new Error('Channel evidence identity mismatch.');
      return { channelId: item.id, url: `https://www.youtube.com/channel/${item.id}`, name: String(item.snippet?.title ?? item.name ?? item.id).slice(0, 200), priority: 'medium' };
    } catch (error) {
      if (!root) throw error;
      return (this.deps.monidResolveChannel ?? monidResolveChannel)(root, url, { attemptScope });
    }
  }
  async recent(channelId: string, signal?: AbortSignal, root?: string, attemptScope?: string): Promise<{ videos: SignalVideoMetadata[]; complete: boolean }> {
    if (!SIGNAL_CHANNEL_ID.test(channelId)) throw new Error('Invalid canonical channel.');
    try {
      const result = await this.call('youtube-research', ['youtube', 'channel-uploads', channelId, '--top', '50', '--json', '--no-input', '--data-source', 'live'], signal);
      // channel-uploads puts channel identity on the envelope, not each upload.
      const hasUploadsEnvelope = result && typeof result === 'object' && !Array.isArray(result) && 'uploads' in result;
      if (hasUploadsEnvelope && (result.channelId !== channelId || !Array.isArray(result.uploads))) throw new Error('Channel evidence identity mismatch.');
      const uploads = hasUploadsEnvelope ? result.uploads : rows(result);
      if (uploads.length > 50) throw new Error('YouTube exceeded the requested upload limit.');
      const videos = uploads.map((row: unknown) => metadata(row, hasUploadsEnvelope ? result.channelId : undefined));
      if (videos.some((video: SignalVideoMetadata) => video.channelId !== channelId)) throw new Error('Channel evidence identity mismatch.');
      return { videos, complete: videos.length < 50 };
    } catch (error) {
      signal?.throwIfAborted();
      if (!root) throw error;
      return (this.deps.monidRecentVideos ?? monidRecentVideos)(root, channelId, signal, { attemptScope });
    }
  }
  async video(videoId: string, signal?: AbortSignal, root?: string, attemptScope?: string): Promise<SignalVideoMetadata> {
    if (!SIGNAL_VIDEO_ID.test(videoId)) throw new Error('Invalid video.');
    try {
      const value = metadata(rows(await this.call('youtube-research', ['youtube', 'videos-list', '--id', videoId, '--part', 'snippet', '--json', '--no-input', '--data-source', 'live'], signal))[0]);
      if (value.videoId !== videoId) throw new Error('Video evidence identity mismatch.');
      return value;
    } catch (error) {
      signal?.throwIfAborted();
      if (!root) throw error;
      return (this.deps.monidVideoMetadata ?? monidVideoMetadata)(root, videoId, signal, { attemptScope });
    }
  }
  async transcript(root: string, videoId: string, signal?: AbortSignal, attemptScope?: string): Promise<SignalTranscript> {
    if (!SIGNAL_VIDEO_ID.test(videoId)) throw new Error('Invalid video.');
    const directory = join(root, 'signals', 'evidence', videoId);
    await mkdir(directory, { recursive: true });
    signal?.throwIfAborted();
    try { const cached = await this.readTranscript(join(directory, 'raw-transcript.json'), videoId); signal?.throwIfAborted(); return cached; }
    catch { signal?.throwIfAborted(); }
    try {
      const result = await this.call('youtube-intelligence', ['prepare', '--video', `https://www.youtube.com/watch?v=${videoId}`, '--provider', 'auto', '--cache-dir', join(root, 'signals', 'transcript-cache'), '--out', directory], signal);
      if (result.ok !== true || result.videoId !== videoId) throw new Error('Transcript packet identity mismatch.');
      const transcript = await this.readTranscript(join(directory, 'raw-transcript.json'), videoId);
      signal?.throwIfAborted(); return transcript;
    } catch { signal?.throwIfAborted(); }
    // Each helper owns its allowance, durable paid-attempt receipts and cache.
    let monidTranscript: SignalTranscript | undefined;
    try {
      monidTranscript = await (this.deps.monidTranscript ?? monidSignalTranscript)(root, videoId, signal, { attemptScope });
    } catch (error) {
      signal?.throwIfAborted();
      if (isMonidSignalFallbackBlocked(error)) throw error;
    }
    if (monidTranscript) {
      await this.cacheTranscript(directory, monidTranscript);
      signal?.throwIfAborted(); return monidTranscript;
    }
    try {
      const transcript = await (this.deps.zeroTranscript ?? zeroSignalTranscript)(root, videoId, signal);
      await this.cacheTranscript(directory, transcript);
      signal?.throwIfAborted(); return transcript;
    } catch (error) { signal?.throwIfAborted(); throw error; }
  }
  private async cacheTranscript(directory: string, transcript: SignalTranscript): Promise<void> {
    const target = join(directory, 'raw-transcript.json');
    const temporary = `${target}.${randomUUID()}.tmp`;
    // Share verified paid evidence across tracks and providers, not only one helper's cache.
    try { await writeFile(temporary, JSON.stringify(transcript), { flag: 'wx', mode: 0o600 }); await rename(temporary, target); }
    finally { await rm(temporary, { force: true }); }
  }
  private async readTranscript(path: string, videoId: string): Promise<SignalTranscript> {
    if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error('Transcript exceeds supported size.');
    const raw = await readFile(path);
    if (raw.length > 2 * 1024 * 1024) throw new Error('Transcript exceeds supported size.');
    const value = JSON.parse(raw.toString('utf8'));
    if (value.videoId !== videoId || !Array.isArray(value.segments) || !value.segments.length || value.segments.length > 20000
      || value.segments.some((s: any) => typeof s.text !== 'string' || !s.text.trim() || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end < s.start)) throw new Error('Transcript packet is invalid.');
    return { videoId, provider: String(value.provider ?? 'local'), segments: value.segments };
  }
}

import { execFile } from 'node:child_process';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { normalizeSignalChannelUrl, SIGNAL_CHANNEL_ID, SIGNAL_VIDEO_ID, type SignalChannel, type SignalVideoMetadata } from '@craft-agent/shared/shared-intel';
import { collectSignalWebsite, type SignalWebsitePacket, type SignalWebsiteCollectorDeps } from './website-collector';
import { zeroSignalTranscript } from './zero-transcript';
import { resolveSignalToolPath } from './tool-path';

export interface SignalTranscript { videoId: string; segments: Array<{ start: number; end: number; text: string }>; provider: string }
export interface SignalProvider {
  resolveChannel(url: string): Promise<SignalChannel>;
  recent(channelId: string, signal?: AbortSignal): Promise<{ videos: SignalVideoMetadata[]; complete: boolean }>;
  video(videoId: string, signal?: AbortSignal): Promise<SignalVideoMetadata>;
  transcript(root: string, videoId: string, signal?: AbortSignal): Promise<SignalTranscript>;
  website?(url: string, window: { sinceDays: number; now: string }, signal?: AbortSignal): Promise<SignalWebsitePacket>;
}
const execute = promisify(execFile);
function rows(value: any): any[] {
  const result = Array.isArray(value) ? value : value?.items ?? value?.videos ?? value?.data?.items ?? value?.data?.videos ?? value?.data;
  if (!Array.isArray(result)) throw new Error('YouTube returned unsupported metadata.');
  return result;
}
function metadata(row: any): SignalVideoMetadata {
  const videoId = row.videoId ?? row.video_id ?? row.contentDetails?.videoId ?? row.snippet?.resourceId?.videoId ?? row.id;
  const channelId = row.channelId ?? row.channel_id ?? row.snippet?.videoOwnerChannelId ?? row.snippet?.channelId;
  const publishedAt = row.publishedAt ?? row.published_at ?? row.contentDetails?.videoPublishedAt ?? row.snippet?.publishedAt;
  const title = row.title ?? row.snippet?.title;
  if (!SIGNAL_VIDEO_ID.test(videoId) || !SIGNAL_CHANNEL_ID.test(channelId) || !Number.isFinite(Date.parse(publishedAt)) || typeof title !== 'string') throw new Error('YouTube metadata is incomplete.');
  return { videoId, channelId, publishedAt: new Date(publishedAt).toISOString(), title: title.slice(0, 500), sourceUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

/** Adapter only: discovery and transcripts remain in the existing bundled tools. */
export class LocalSignalProvider implements SignalProvider {
  constructor(private readonly websiteDeps?: SignalWebsiteCollectorDeps, private readonly deps: {
    command?: (name: string, args: string[], signal?: AbortSignal) => Promise<unknown>;
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
  async resolveChannel(input: string): Promise<SignalChannel> {
    const url = normalizeSignalChannelUrl(input.startsWith('@') ? `https://www.youtube.com/${input}` : input);
    if (!url) throw new Error('Enter a YouTube channel URL or handle.');
    const path = new URL(url).pathname;
    const flag = path.startsWith('/channel/') ? '--id' : path.startsWith('/@') ? '--for-handle' : path.startsWith('/user/') ? '--for-username' : null;
    if (!flag) throw new Error('Use this channel\'s @handle or canonical channel URL.');
    const value = path.startsWith('/@') ? path.slice(1) : path.split('/')[2]!;
    const item = rows(await this.call('youtube-research', ['youtube', 'channels-list', flag, value, '--part', 'snippet', '--json', '--no-input', '--data-source', 'live']))[0];
    if (!item || !SIGNAL_CHANNEL_ID.test(item.id)) throw new Error('YouTube channel could not be resolved.');
    return { channelId: item.id, url: `https://www.youtube.com/channel/${item.id}`, name: String(item.snippet?.title ?? item.name ?? item.id).slice(0, 200), priority: 'medium' };
  }
  async recent(channelId: string, signal?: AbortSignal): Promise<{ videos: SignalVideoMetadata[]; complete: boolean }> {
    if (!SIGNAL_CHANNEL_ID.test(channelId)) throw new Error('Invalid canonical channel.');
    const result = await this.call('youtube-research', ['youtube', 'channel-uploads', channelId, '--top', '50', '--json', '--no-input', '--data-source', 'live'], signal);
    const videos = rows(result).map(metadata);
    if (videos.some(video => video.channelId !== channelId)) throw new Error('Channel evidence identity mismatch.');
    return { videos, complete: videos.length < 50 };
  }
  async video(videoId: string, signal?: AbortSignal): Promise<SignalVideoMetadata> {
    if (!SIGNAL_VIDEO_ID.test(videoId)) throw new Error('Invalid video.');
    const value = metadata(rows(await this.call('youtube-research', ['youtube', 'videos-list', '--id', videoId, '--part', 'snippet', '--json', '--no-input', '--data-source', 'live'], signal))[0]);
    if (value.videoId !== videoId) throw new Error('Video evidence identity mismatch.');
    return value;
  }
  async transcript(root: string, videoId: string, signal?: AbortSignal): Promise<SignalTranscript> {
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
    // The helper owns allowance checks, paid-attempt receipts and retry suppression.
    try {
      const transcript = await (this.deps.zeroTranscript ?? zeroSignalTranscript)(root, videoId, signal);
      signal?.throwIfAborted(); return transcript;
    } catch (error) { signal?.throwIfAborted(); throw error; }
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

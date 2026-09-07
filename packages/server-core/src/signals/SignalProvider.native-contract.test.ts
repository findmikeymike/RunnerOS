import { expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { LocalSignalProvider } from './SignalProvider';

const execute = promisify(execFile);

test('bundled native metadata envelopes round-trip through the Signals adapter using only a loopback fixture', async () => {
  const home = mkdtempSync(join(tmpdir(), 'signal-native-contract-'));
  const channelId = `UC${'a'.repeat(22)}`;
  const videoId = 'abcdefghijk';
  const publishedAt = '2026-09-07T12:00:00Z';
  const calls: string[] = [];
  const unexpected: string[] = [];
  let uploadCount = 1;
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request) {
      const url = new URL(request.url);
      calls.push(url.pathname);
      if (url.searchParams.get('key') !== 'fixture-only-not-a-real-key') unexpected.push('credential');
      const snippet = { title: 'Native fixture', channelId, publishedAt };
      if (url.pathname.endsWith('/channels')) return Response.json({ items: [{
        id: channelId, snippet, contentDetails: { relatedPlaylists: { uploads: 'UUfixture' } },
      }] });
      if (url.pathname.endsWith('/videos')) return Response.json({ items: [{ id: videoId, snippet }] });
      if (url.pathname.endsWith('/playlistItems')) return Response.json({ items: Array.from({ length: uploadCount }, (_, index) => ({
        id: `playlist-item-${index}`, snippet: { ...snippet, resourceId: { videoId: index ? String(index).padStart(11, '0') : videoId }, videoOwnerChannelId: channelId },
        contentDetails: { videoId: index ? String(index).padStart(11, '0') : videoId, videoPublishedAt: publishedAt },
      })) });
      unexpected.push(url.pathname);
      return Response.json({ error: { message: 'Unexpected fixture request' } }, { status: 400 });
    },
  });
  try {
    const binary = resolve(import.meta.dir, '../../../../tools/youtube-research/bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'youtube-pp-cli.exe' : 'youtube-pp-cli');
    const provider = new LocalSignalProvider(undefined, { command: async (name, args) => {
      expect(name).toBe('youtube-research');
      const invocationHome = mkdtempSync(join(home, 'invocation-'));
      const { stdout } = await execute(binary, args, {
        cwd: invocationHome, timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
        // Do not inherit real credentials, proxy settings, or user configuration.
        env: { HOME: invocationHome, XDG_CONFIG_HOME: invocationHome, XDG_CACHE_HOME: invocationHome,
          YOUTUBE_BASE_URL: `http://127.0.0.1:${server.port}`, YOUTUBE_API_KEY: 'fixture-only-not-a-real-key' },
      });
      const value = JSON.parse(stdout);
      if (args[1] === 'channel-uploads') {
        expect(value.channelId).toBe(channelId);
        expect(Array.isArray(value.uploads)).toBe(true);
      } else expect(Array.isArray(value.results.items)).toBe(true);
      return value;
    } });
    expect(await provider.resolveChannel('@fixture')).toMatchObject({ channelId, name: 'Native fixture' });
    expect(await provider.video(videoId)).toMatchObject({ videoId, channelId, publishedAt: '2026-09-07T12:00:00.000Z' });
    expect(await provider.recent(channelId)).toMatchObject({ complete: true, videos: [{ videoId, channelId }] });
    uploadCount = 0;
    expect(await provider.recent(channelId)).toEqual({ complete: true, videos: [] });
    uploadCount = 50;
    const capped = await provider.recent(channelId);
    expect(capped.videos).toHaveLength(50);
    expect(capped.complete).toBe(false);
    expect(calls.some(path => path.endsWith('/channels'))).toBe(true);
    expect(calls.some(path => path.endsWith('/videos'))).toBe(true);
    expect(calls.some(path => path.endsWith('/playlistItems'))).toBe(true);
    expect(unexpected).toEqual([]);
  } finally {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 45_000);

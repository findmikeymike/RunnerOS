import { expect, test, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalSignalProvider } from './SignalProvider';
import { MonidSignalError } from './monid-transcript';

const channelId = 'UC' + 'a'.repeat(22);
const videoId = 'abcdefghijk';
const publishedAt = '2026-09-07T12:00:00.000Z';
const snippet = { title: 'Fixture', channelId, publishedAt };

test('native CLI channels-list and videos-list results envelopes resolve real identities', async () => {
  const provider = new LocalSignalProvider(undefined, { command: async (_name, args) => ({
    meta: { source: 'live' }, results: { items: [{ id: args[1] === 'channels-list' ? channelId : videoId, snippet }] },
  }) });
  expect(await provider.resolveChannel('@fixture')).toMatchObject({ channelId, name: 'Fixture' });
  expect(await provider.video(videoId)).toMatchObject({ videoId, channelId, publishedAt });
});

test('native channel-uploads inherits only a validated envelope identity', async () => {
  const upload = { videoId, title: 'Fixture', publishedAt, watchUrl: `https://www.youtube.com/watch?v=${videoId}` };
  let response: unknown = { channelId, channelTitle: 'Fixture', returned: 1, uploads: [upload] };
  const provider = new LocalSignalProvider(undefined, { command: async () => response });
  expect(await provider.recent(channelId)).toEqual({ videos: [{ videoId, channelId, publishedAt, title: 'Fixture', sourceUrl: upload.watchUrl }], complete: true });
  response = { channelId, uploads: [] };
  expect(await provider.recent(channelId)).toEqual({ videos: [], complete: true });
  response = { channelId, uploads: Array(50).fill(upload) };
  expect((await provider.recent(channelId)).complete).toBe(false);
  for (const invalid of [
    { uploads: [upload] },
    { channelId: 'UC' + 'b'.repeat(22), uploads: [upload] },
    { channelId, uploads: [{ ...upload, channelId: 'UC' + 'b'.repeat(22) }] },
    { channelId, uploads: Array(51).fill(upload) },
    { channelId, uploads: [null] },
    { channelId, uploads: [{ ...upload, publishedAt: null }] },
  ]) { response = invalid; await expect(provider.recent(channelId)).rejects.toThrow(); }
});

test('native missing or wrong video results fail instead of accepting unrelated evidence', async () => {
  for (const response of [{ results: { items: [] } }, { results: { items: [{ id: 'zyxwvutsrqp', snippet }] } }]) {
    const provider = new LocalSignalProvider(undefined, { command: async () => response });
    await expect(provider.video(videoId)).rejects.toThrow();
  }
});

test('validated full cached transcript is reused without running a provider', async () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-provider-'));
  const videoId = 'abcdefghijk';
  try {
    const directory = join(root, 'signals/evidence', videoId); mkdirSync(directory, { recursive: true });
    const value = { videoId, provider: 'cached', segments: [{ start: 0, end: 1200, text: 'Full evidence '.repeat(5000) }] };
    writeFileSync(join(directory, 'raw-transcript.json'), JSON.stringify(value));
    const command = mock(async () => { throw new Error('unexpected command'); });
    const zeroTranscript = mock(async () => { throw new Error('unexpected fallback'); });
    const provider = new LocalSignalProvider(undefined, { command, zeroTranscript, monidTranscript: async () => { throw new Error('unexpected Monid fallback'); } });
    expect(await provider.transcript(root, videoId)).toEqual(value);
    expect(command).toHaveBeenCalledTimes(0); expect(zeroTranscript).toHaveBeenCalledTimes(0);
    const controller = new AbortController(); controller.abort();
    await expect(provider.transcript(root, videoId, controller.signal)).rejects.toThrow();
    await expect(provider.transcript(root, '../invalid')).rejects.toThrow('Invalid video');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const localWorks of [true, false]) test(`guarded Zero fallback is ${localWorks ? 'not used after native success' : 'used once after native and Monid failure'}`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-provider-'));
  const videoId = 'abcdefghijk';
  const transcript = { videoId, provider: 'fixture', segments: [{ start: 1, end: 3, text: 'Evidence' }] };
  const sequence: string[] = [];
  try {
    const command = mock(async (name: string) => {
      sequence.push(name);
      if (!localWorks) throw new Error('local unavailable');
      writeFileSync(join(root, 'signals/evidence', videoId, 'raw-transcript.json'), JSON.stringify(transcript));
      return { ok: true, videoId };
    });
    const zeroTranscript = mock(async (hq: string, id: string) => { expect(hq).toBe(root); expect(id).toBe(videoId); sequence.push('zero'); return transcript; });
    const provider = new LocalSignalProvider(undefined, { command, zeroTranscript, monidTranscript: async () => { sequence.push('monid'); throw new MonidSignalError('Monid unavailable', true); } });
    expect(await provider.transcript(root, videoId)).toEqual(transcript);
    expect(sequence).toEqual(localWorks ? ['youtube-intelligence'] : ['youtube-intelligence', 'monid', 'zero']);
    expect(zeroTranscript).toHaveBeenCalledTimes(localWorks ? 0 : 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cancellation during local failure prevents paid fallback and preserves abort', async () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-provider-'));
  const controller = new AbortController();
  const reason = new Error('cancelled by artist');
  const zeroTranscript = mock(async () => { throw new Error('must not pay'); });
  try {
    const provider = new LocalSignalProvider(undefined, { command: async () => { controller.abort(reason); throw new Error('local exited'); }, zeroTranscript });
    await expect(provider.transcript(root, 'abcdefghijk', controller.signal)).rejects.toBe(reason);
    expect(zeroTranscript).toHaveBeenCalledTimes(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fallback errors are not retried or hidden, and metadata never uses Zero', async () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-provider-'));
  const error = new Error('A previous paid transcript attempt needs review.');
  const zeroTranscript = mock(async () => { throw error; });
  try {
    const provider = new LocalSignalProvider(undefined, { command: async () => { throw new Error('offline'); }, zeroTranscript, monidTranscript: async () => { throw new MonidSignalError('No connection', true); } });
    await expect(provider.transcript(root, 'abcdefghijk')).rejects.toBe(error);
    expect(zeroTranscript).toHaveBeenCalledTimes(1);
    await expect(provider.recent('UC' + 'a'.repeat(22))).rejects.toThrow('YouTube Data API');
    expect(zeroTranscript).toHaveBeenCalledTimes(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Monid success stops the transcript fallback chain before Zero', async () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-provider-'));
  const sequence: string[] = [];
  const result = { videoId, provider: 'monid', segments: [{ start: 0, end: 2, text: 'Evidence' }] };
  try {
    const provider = new LocalSignalProvider(undefined, {
      command: async () => { sequence.push('native'); throw new Error('unavailable'); },
      monidTranscript: async (hq, id, _signal, deps) => { expect(hq).toBe(root); expect(id).toBe(videoId); expect(deps?.attemptScope).toBe('authorized-scan'); sequence.push('monid'); return result; },
      zeroTranscript: async () => { sequence.push('zero'); throw new Error('must not run'); },
    });
    expect(await provider.transcript(root, videoId, undefined, 'authorized-scan')).toEqual(result);
    // A later track/run reuses the same verified packet before trying any provider.
    expect(await provider.transcript(root, videoId)).toEqual(result);
    expect(sequence).toEqual(['native', 'monid']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an uncertain Monid run cannot cause a second charge through Zero', async () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-provider-'));
  const error = new MonidSignalError('Submitted run needs reconciliation', false, 'run-fixture');
  const zeroTranscript = mock(async () => { throw new Error('must not run'); });
  try {
    const provider = new LocalSignalProvider(undefined, { command: async () => { throw new Error('native unavailable'); },
      monidTranscript: async () => { throw error; }, zeroTranscript });
    await expect(provider.transcript(root, videoId)).rejects.toBe(error);
    expect(zeroTranscript).toHaveBeenCalledTimes(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('metadata uses the matching HQ-scoped Monid operation, never the transcript fallback', async () => {
  const root = '/fixture/hq';
  const sequence: string[] = [];
  const resolved = { channelId, url: `https://www.youtube.com/channel/${channelId}`, name: 'Fixture', priority: 'medium' as const };
  const found = { videoId, channelId, title: 'Fixture', publishedAt, sourceUrl: `https://www.youtube.com/watch?v=${videoId}` };
  const zeroTranscript = mock(async () => { throw new Error('must not run'); });
  const provider = new LocalSignalProvider(undefined, {
    command: async () => { sequence.push('native'); throw new Error('not configured'); }, zeroTranscript,
    monidResolveChannel: async (hq, url, deps) => { expect(hq).toBe(root); expect(url).toBe('https://www.youtube.com/@fixture'); expect(deps?.attemptScope).toBe('authorized-scan'); sequence.push('channel'); return resolved; },
    monidRecentVideos: async (hq, id, _signal, deps) => { expect(hq).toBe(root); expect(id).toBe(channelId); expect(deps?.attemptScope).toBe('authorized-scan'); sequence.push('recent'); return { videos: [found], complete: true }; },
    monidVideoMetadata: async (hq, id, _signal, deps) => { expect(hq).toBe(root); expect(id).toBe(videoId); expect(deps?.attemptScope).toBe('authorized-scan'); sequence.push('video'); return found; },
  });
  expect(await provider.resolveChannel('@fixture', root, 'authorized-scan')).toEqual(resolved);
  expect(await provider.recent(channelId, undefined, root, 'authorized-scan')).toEqual({ videos: [found], complete: true });
  expect(await provider.video(videoId, undefined, root, 'authorized-scan')).toEqual(found);
  expect(sequence).toEqual(['native', 'channel', 'native', 'recent', 'native', 'video']);
  expect(zeroTranscript).toHaveBeenCalledTimes(0);
});

test('cancelled native metadata work does not start Monid', async () => {
  const controller = new AbortController();
  const fallback = mock(async () => { throw new Error('must not pay'); });
  const provider = new LocalSignalProvider(undefined, { command: async () => { controller.abort(); throw new Error('cancelled'); },
    monidRecentVideos: fallback, monidVideoMetadata: fallback });
  await expect(provider.recent(channelId, controller.signal, '/fixture/hq')).rejects.toThrow();
  await expect(provider.video(videoId, controller.signal, '/fixture/hq')).rejects.toThrow();
  expect(fallback).toHaveBeenCalledTimes(0);
});

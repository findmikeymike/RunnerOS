import { expect, test, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalSignalProvider } from './SignalProvider';

test('validated full cached transcript is reused without running a provider', async () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-provider-'));
  const videoId = 'abcdefghijk';
  try {
    const directory = join(root, 'signals/evidence', videoId); mkdirSync(directory, { recursive: true });
    const value = { videoId, provider: 'cached', segments: [{ start: 0, end: 1200, text: 'Full evidence '.repeat(5000) }] };
    writeFileSync(join(directory, 'raw-transcript.json'), JSON.stringify(value));
    const command = mock(async () => { throw new Error('unexpected command'); });
    const zeroTranscript = mock(async () => { throw new Error('unexpected fallback'); });
    const provider = new LocalSignalProvider(undefined, { command, zeroTranscript });
    expect(await provider.transcript(root, videoId)).toEqual(value);
    expect(command).toHaveBeenCalledTimes(0); expect(zeroTranscript).toHaveBeenCalledTimes(0);
    const controller = new AbortController(); controller.abort();
    await expect(provider.transcript(root, videoId, controller.signal)).rejects.toThrow();
    await expect(provider.transcript(root, '../invalid')).rejects.toThrow('Invalid video');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const localWorks of [true, false]) test(`guarded Zero fallback is ${localWorks ? 'not used after local success' : 'used once after local failure'}`, async () => {
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
    const provider = new LocalSignalProvider(undefined, { command, zeroTranscript });
    expect(await provider.transcript(root, videoId)).toEqual(transcript);
    expect(sequence).toEqual(localWorks ? ['youtube-intelligence'] : ['youtube-intelligence', 'zero']);
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
    const provider = new LocalSignalProvider(undefined, { command: async () => { throw new Error('offline'); }, zeroTranscript });
    await expect(provider.transcript(root, 'abcdefghijk')).rejects.toBe(error);
    expect(zeroTranscript).toHaveBeenCalledTimes(1);
    await expect(provider.recent('UC' + 'a'.repeat(22))).rejects.toThrow('YouTube Data API');
    expect(zeroTranscript).toHaveBeenCalledTimes(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

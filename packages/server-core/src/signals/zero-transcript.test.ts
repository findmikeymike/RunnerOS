import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zeroSignalTranscript } from './zero-transcript';

const roots: string[] = [];
const videoId = 'abcdefghijk';
const capability = 'youtube-transcript-captions-chapters-19f9ac9d';
const metadata = {
  uid: 'cap_fixture',
  slug: capability, url: 'https://youtube.use.x402atlas.com/transcript', method: 'GET',
  availabilityStatus: 'healthy', displayCostAsset: 'USDC', displayCostAmount: '0.02',
  bodySchema: { properties: {
    input: { properties: { queryParams: { type: 'object', required: ['v'], properties: { v: { type: 'string' } } } } },
    output: { properties: { example: { properties: { segments: { items: { properties: { start_ms: { type: 'integer' }, text: { type: 'string' } } } } } } } },
  } },
};
function setup(options: { allowance?: any; metadata?: any; response?: any; failPaid?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'signals-zero-')); roots.push(root);
  const calls: string[][] = [];
  const command = async (_file: string, args: string[]) => {
    calls.push(args);
    if (args.includes('status')) return options.allowance ?? { ok: true, configured: true, remainingUsd: 1 };
    if (args[0] === 'get') return options.metadata ?? metadata;
    if (options.failPaid) throw new Error('fixture paid failure');
    return options.response ?? { ok: true, providerResult: { ok: true, body: { video_id: videoId, segments: [{ start_ms: 1250, end_ms: 2500, text: 'A real finding.' }] } } };
  };
  return { root, calls, command, deps: { command, guardPath: '/fixture/guard.mjs', zeroPath: '/fixture/zero' } };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('Zero fallback preflights live metadata, uses guard query, and caches across tracks', async () => {
  const s = setup();
  const result = await zeroSignalTranscript(s.root, videoId, undefined, s.deps);
  expect(result.segments).toEqual([{ start: 1.25, end: 2.5, text: 'A real finding.' }]);
  const digest = createHash('sha256').update(JSON.stringify({
    uid: metadata.uid, slug: metadata.slug, url: metadata.url, method: metadata.method,
    availabilityStatus: metadata.availabilityStatus, displayCostAmount: metadata.displayCostAmount,
    displayCostAsset: metadata.displayCostAsset, bodySchema: metadata.bodySchema,
  })).digest('hex');
  expect(s.calls[2]).toEqual(['/fixture/guard.mjs', 'fetch', '--capability', capability, '--max-pay', '0.02', '--query-json', '{"v":"abcdefghijk"}', '--expected-read-contract', digest, '--json']);
  expect(await zeroSignalTranscript(s.root, videoId, undefined, s.deps)).toEqual(result);
  expect(s.calls).toHaveLength(3);
});

test('no allowance means no marketplace lookup or paid call', async () => {
  for (const allowance of [{ ok: true, configured: false, remainingUsd: 0 }, { ok: true, configured: true, remainingUsd: 0.019 }]) {
    const s = setup({ allowance });
    await expect(zeroSignalTranscript(s.root, videoId, undefined, s.deps)).rejects.toThrow('weekly allowance');
    expect(s.calls).toHaveLength(1);
  }
});

test('changed health, price, endpoint, method or schema stops before spending', async () => {
  for (const change of [
    { availabilityStatus: 'unhealthy' }, { displayCostAmount: '0.03' }, { displayCostAsset: 'USD' },
    { url: 'https://different.example/transcript' }, { method: 'POST' }, { bodySchema: {} },
  ]) {
    const s = setup({ metadata: { ...metadata, ...change } });
    await expect(zeroSignalTranscript(s.root, videoId, undefined, s.deps)).rejects.toThrow('No paid call');
    expect(s.calls).toHaveLength(2);
  }
});

test('paid failure persists a review barrier instead of retrying on the next scan', async () => {
  const s = setup({ failPaid: true });
  await expect(zeroSignalTranscript(s.root, videoId, undefined, s.deps)).rejects.toThrow('fixture paid failure');
  await expect(zeroSignalTranscript(s.root, videoId, undefined, s.deps)).rejects.toThrow('previous paid');
  expect(s.calls).toHaveLength(3);
});

test('sample, wrong-video and malformed timestamp responses cannot enter evidence', async () => {
  for (const body of [
    { video_id: videoId, note: 'sample', segments: [{ start_ms: 0, text: 'sample' }] },
    { video_id: 'XXXXXXXXXXX', segments: [{ start_ms: 0, text: 'wrong' }] },
    { video_id: videoId, segments: [{ start_ms: -1, text: 'bad' }] },
    { video_id: videoId, segments: [null] },
    { video_id: videoId, text: 'Untimed text only.' },
  ]) {
    const s = setup({ response: { ok: true, providerResult: { ok: true, body } } });
    await expect(zeroSignalTranscript(s.root, videoId, undefined, s.deps)).rejects.toThrow();
    await expect(zeroSignalTranscript(s.root, videoId, undefined, s.deps)).rejects.toThrow('previous paid');
    expect(s.calls).toHaveLength(3);
  }
});

test('concurrent same-HQ requests use one paid attempt', async () => {
  const s = setup();
  const [a, b] = await Promise.all([zeroSignalTranscript(s.root, videoId, undefined, s.deps), zeroSignalTranscript(s.root, videoId, undefined, s.deps)]);
  expect(a).toEqual(b);
  expect(s.calls.filter(args => args.includes('fetch'))).toHaveLength(1);
});

test('invalid IDs and pre-cancelled calls perform no commands', async () => {
  const s = setup();
  await expect(zeroSignalTranscript(s.root, '../bad', undefined, s.deps)).rejects.toThrow('Invalid');
  await expect(zeroSignalTranscript(s.root, videoId, AbortSignal.abort(), s.deps)).rejects.toThrow();
  expect(s.calls).toHaveLength(0);
});

test('real command adapter accepts a valid duplicated CLI envelope larger than 3 MiB', async () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-zero-envelope-')); roots.push(root);
  const executable = join(root, 'fixture-zero.mjs');
  writeFileSync(executable, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'get') console.log(JSON.stringify(${JSON.stringify(metadata)}));
else if (args[0] === 'status') console.log(JSON.stringify({ok:true,configured:true,remainingUsd:1}));
else {
  const body = {video_id:'${videoId}',segments:[{start_ms:1000,text:'x'.repeat(1_800_000)}]};
  console.log(JSON.stringify({ok:true,providerResult:{ok:true,body,bodyRaw:JSON.stringify(body)}}));
}
`);
  chmodSync(executable, 0o700);
  const value = await zeroSignalTranscript(root, videoId, undefined, { guardPath: executable, zeroPath: executable });
  expect(value.segments[0]!.text).toHaveLength(1_800_000);
});

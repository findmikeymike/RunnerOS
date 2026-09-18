import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MonidBudgetStore, type PoolClient } from '@craft-agent/shared/mcp';
import { runMonidSignalOperation } from './monid-transcript';
import monidTools from './__fixtures__/monid-tools.json';
import { monidResolveChannel, monidRecentVideos, monidVideoMetadata, validateMonidMetadataInspection } from './monid-metadata';

const channelId = `UC${'a'.repeat(22)}`;
const videoId = 'abcdefghijk';
const row = () => ({ id: videoId, title: 'An actual video', date: '2026-09-06', channelId, channelName: 'Example creator', channelUrl: `https://www.youtube.com/channel/${channelId}`, channelUsername: 'example', url: `https://www.youtube.com/watch?v=${videoId}` });
const inspection = () => ({ input: { body: { type: 'object', properties: {
  // Sanitized live Monid inspection: the actor supplies an editor, not items.
  startUrls: { type: 'array', editor: 'requestListSources', default: [], example: [{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] },
  maxResults: { type: 'integer', minimum: 0, maximum: 999999 },
  maxResultsShorts: { type: 'integer', minimum: 0 }, maxResultStreams: { type: 'integer', minimum: 0 },
  sortVideosBy: { type: 'string', enum: ['NEWEST', 'POPULAR', 'OLDEST'] },
  transcriptionAndSubtitle: { type: 'string', default: 'NONE', enum: ['NONE', 'ALWAYS_SUBTITLES', 'TRANSCRIPTION_AS_FALLBACK', 'ALWAYS_TRANSCRIBE'] }, aiVideoDescription: { type: 'boolean' }, aiVideoSummary: { type: 'boolean' },
} } } });
type Run = NonNullable<NonNullable<Parameters<typeof monidResolveChannel>[2]>['run']>;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(output: unknown = [row()]) {
  const calls: Array<{ root: string; operation: Parameters<Run>[1]; signal?: AbortSignal }> = [];
  const run: Run = async (root, operation, signal) => {
    calls.push({ root, operation, signal }); signal?.throwIfAborted();
    operation.validateInspection(inspection()); return operation.parseOutput(output);
  };
  return { calls, deps: { run } };
}

test('pins one URL, exact official input casing and conservative operation caps', async () => {
  const f = fixture(); const signal = new AbortController().signal;
  await monidResolveChannel('/hq', '@example', f.deps);
  await monidRecentVideos('/hq', channelId, signal, f.deps);
  await monidVideoMetadata('/hq', videoId, signal, f.deps);
  expect(f.calls.map(call => call.root)).toEqual(['/hq', '/hq', '/hq']);
  expect(f.calls.map(call => call.operation.maxCostUsd)).toEqual([0.02, 0.25, 0.02]);
  expect(f.calls.map(call => call.operation.input.maxResults)).toEqual([1, 5, 1]);
  expect(f.calls[1]!.signal).toBe(signal);
  for (const { operation } of f.calls) {
    expect(operation.endpoint).toBe('/streamers/youtube-scraper');
    expect(operation.input).toMatchObject({ maxResultsShorts: 0, maxResultStreams: 0, sortVideosBy: 'NEWEST', transcriptionAndSubtitle: 'NONE', aiVideoDescription: false, aiVideoSummary: false });
    expect(operation.input).not.toHaveProperty('maxResultsStreams');
    expect(operation.input).not.toHaveProperty('downloadSubtitles');
    expect(operation.input.startUrls).toHaveLength(1);
    expect(operation.cacheTtlMs).toBeGreaterThan(0);
  }
  expect(f.calls[0]!.operation.input.startUrls).toEqual([{ url: 'https://www.youtube.com/@example/videos' }]);
  expect(f.calls[1]!.operation.cacheTtlMs).toBe(15 * 60_000);
});
test('forwards optional host attempt scope to the executor without changing provider input', async () => {
  const f = fixture();
  const deps = { ...f.deps, attemptScope: 'host-request-123' };
  await monidResolveChannel('/hq', '@example', deps);
  await monidRecentVideos('/hq', channelId, undefined, deps);
  await monidVideoMetadata('/hq', videoId, undefined, deps);
  expect(f.calls.map(call => call.operation.attemptScope)).toEqual(Array(3).fill(deps.attemptScope));
  for (const call of f.calls) expect(call.operation.input).not.toHaveProperty('attemptScope');
  await monidResolveChannel('/hq', '@example', f.deps);
  await monidRecentVideos('/hq', channelId, undefined, f.deps);
  await monidVideoMetadata('/hq', videoId, undefined, f.deps);
  expect(f.calls.slice(3).map(call => call.operation.attemptScope)).toEqual([undefined, undefined, undefined]);
});
test('resolves attested handles and canonical IDs without inventing channel names', async () => {
  const f = fixture();
  expect(await monidResolveChannel('/hq', '@example', f.deps)).toEqual({ channelId, name: 'Example creator', url: `https://www.youtube.com/channel/${channelId}`, priority: 'medium' });
  expect((await monidResolveChannel('/hq', `https://youtube.com/channel/${channelId}`, f.deps)).channelId).toBe(channelId);
  await expect(monidResolveChannel('/hq', '@someoneelse', f.deps)).rejects.toThrow('could not be verified');
  await expect(monidResolveChannel('/hq', '@example', fixture([{ ...row(), channelName: undefined }]).deps)).rejects.toThrow();
  await expect(monidResolveChannel('/hq', '@example', fixture([]).deps)).rejects.toThrow();
});
test('supports documented alias fields but refuses unsupported alias assertions', async () => {
  const viaUrl = { ...row(), channelUsername: undefined, channelUrl: 'https://www.youtube.com/@example' };
  expect((await monidResolveChannel('/hq', '@example', fixture([viaUrl]).deps)).channelId).toBe(channelId);
  const viaInput = { ...row(), channelUsername: undefined, inputChannelUrl: 'https://www.youtube.com/@example/videos' };
  expect((await monidResolveChannel('/hq', '@example', fixture([viaInput]).deps)).channelId).toBe(channelId);
  await expect(monidResolveChannel('/hq', '@example', fixture([{ ...row(), channelUsername: undefined }]).deps)).rejects.toThrow();
});
test('validates channel identity from canonical URLs and rejects conflicting IDs', async () => {
  expect((await monidVideoMetadata('/hq', videoId, undefined, fixture([{ ...row(), channelId: undefined }]).deps)).channelId).toBe(channelId);
  await expect(monidVideoMetadata('/hq', videoId, undefined, fixture([{ ...row(), channelId: `UC${'b'.repeat(22)}` }]).deps)).rejects.toThrow();
  await expect(monidVideoMetadata('/hq', videoId, undefined, fixture([{ ...row(), channelId: undefined, channelUrl: 'https://youtube.com/@example' }]).deps)).rejects.toThrow();
});
test('single video metadata is exact and ignores unrelated provider fields', async () => {
  const value = await monidVideoMetadata('/hq', videoId, undefined, fixture([{ ...row(), secret: 'do-not-return' }]).deps);
  expect(value).toEqual({ videoId, channelId, title: 'An actual video', publishedAt: '2026-09-06T00:00:00.000Z', sourceUrl: `https://www.youtube.com/watch?v=${videoId}` });
  await expect(monidVideoMetadata('/hq', 'xxxxxxxxxxx', undefined, fixture().deps)).rejects.toThrow();
  await expect(monidVideoMetadata('/hq', videoId, undefined, fixture([{ ...row(), url: 'https://www.youtube.com/watch?v=xxxxxxxxxxx' }]).deps)).rejects.toThrow();
});
test('accepts finite absolute dates only, including real leap days and timezone offsets', async () => {
  for (const date of ['2024-02-29', '2026-09-06T03:04:05Z', '2026-09-06T03:04:05.123+02:00']) {
    expect((await monidVideoMetadata('/hq', videoId, undefined, fixture([{ ...row(), date }]).deps)).publishedAt).toBe(new Date(date).toISOString());
  }
  for (const date of ['10 months ago', 'yesterday', '2026-02-30', '2026-02-30T12:00:00Z', '2026-09-06T25:00:00Z', '2026-09-06T24:00:00Z', '2026-09-06T01:00:00', 'September 6, 2026', '2026', '', null, Infinity, 1788696000000]) {
    await expect(monidVideoMetadata('/hq', videoId, undefined, fixture([{ ...row(), date }]).deps)).rejects.toThrow('could not be verified');
  }
});
test('recent list enforces channel identity, uniqueness, limit and truthful completeness', async () => {
  const f = fixture([{ ...row(), id: 'xxxxxxxxxxx', url: undefined, date: '2026-09-01' }, row()]);
  const recent = await monidRecentVideos('/hq', channelId, undefined, f.deps);
  expect(recent.complete).toBe(true); expect(recent.videos[0]!.videoId).toBe(videoId);
  expect(await monidRecentVideos('/hq', channelId, undefined, fixture([]).deps)).toEqual({ videos: [], complete: false });
  const five = Array.from({ length: 5 }, (_, i) => ({ ...row(), id: String(i).padStart(11, '0'), url: undefined }));
  expect((await monidRecentVideos('/hq', channelId, undefined, fixture(five).deps)).complete).toBe(true);
  for (const output of [[...five, row()], [row(), row()], [{ ...row(), channelId: `UC${'b'.repeat(22)}`, channelUrl: `https://youtube.com/channel/UC${'b'.repeat(22)}` }]]) {
    await expect(monidRecentVideos('/hq', channelId, undefined, fixture(output).deps)).rejects.toThrow();
  }
});
test('rejects invalid input before any guarded executor or paid work', async () => {
  const f = fixture();
  for (const url of ['https://evil.example/@example', 'https://youtube.com/watch?v=abcdefghijk', 'https://user:password@youtube.com/@example', '@%2Fprivate', '@%zz', 'x'.repeat(2049)]) {
    await expect(monidResolveChannel('/hq', url, f.deps)).rejects.toThrow();
  }
  await expect(monidRecentVideos('/hq', 'bad-channel', undefined, f.deps)).rejects.toThrow();
  await expect(monidVideoMetadata('/hq', '../../secret', undefined, f.deps)).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});
test('abort is preserved before invoking executor', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await expect(monidRecentVideos('/hq', channelId, controller.signal, f.deps)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(monidVideoMetadata('/hq', videoId, controller.signal, f.deps)).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.calls).toHaveLength(0);
});
test('malformed/error/provider envelopes cannot masquerade as successful metadata', async () => {
  for (const output of [{ items: [row()] }, { error: 'private provider error' }, null, '[]', [null], [row(), row()]]) {
    await expect(monidVideoMetadata('/hq', videoId, undefined, fixture(output).deps)).rejects.toThrow('could not be verified');
  }
});
test('runtime inspection must still enforce the exact pinned actor schema', async () => {
  const f = fixture(); await monidResolveChannel('/hq', '@example', f.deps);
  const input = f.calls[0]!.operation.input;
  expect(() => validateMonidMetadataInspection(inspection(), input)).not.toThrow();
  for (const patch of [
    (schema: ReturnType<typeof inspection>) => { schema.input.body.properties.sortVideosBy.enum = ['POPULAR']; },
    (schema: ReturnType<typeof inspection>) => { schema.input.body.properties.maxResults.maximum = 0; },
    (schema: ReturnType<typeof inspection>) => { schema.input.body.properties.maxResultStreams.minimum = 1; },
    (schema: ReturnType<typeof inspection>) => { schema.input.body.properties.transcriptionAndSubtitle.enum = ['ALWAYS_TRANSCRIBE']; },
  ]) { const schema = inspection(); patch(schema); expect(() => validateMonidMetadataInspection(schema, input)).toThrow(); }
  expect(() => validateMonidMetadataInspection({}, input)).toThrow();
  expect(() => validateMonidMetadataInspection({ input: { body: { ...inspection().input.body, required: ['searchQueries'] } } }, input)).toThrow();
});

test('live request-list editor accepts one URL while rejecting imports, extra work and unknown schemas', async () => {
  const f = fixture(); await monidResolveChannel('/hq', '@example', f.deps);
  const input = f.calls[0]!.operation.input;
  const schema = inspection();
  expect(() => validateMonidMetadataInspection(schema, input)).not.toThrow();
  for (const patch of [
    { startUrls: [] },
    { startUrls: [...input.startUrls as unknown[], ...input.startUrls as unknown[]] },
    { startUrls: [{ requestsFromUrl: 'https://example.com/list.csv' }] },
    { startUrls: [{ url: 'https://www.youtube.com/@example/videos', requestsFromUrl: 'https://example.com/list.csv' }] },
    { startUrls: [{ url: 'https://example.com/list.csv' }] },
    { maxResults: 0 }, { maxResults: 51 }, { maxResults: 1.5 },
    { maxResultsShorts: 1 }, { maxResultStreams: 1 },
    { transcriptionAndSubtitle: 'ALWAYS_SUBTITLES' }, { transcriptionAndSubtitle: 'ALWAYS_TRANSCRIBE' },
    { aiVideoDescription: true }, { aiVideoSummary: true }, { searchQueries: ['extra search'] },
  ]) expect(() => validateMonidMetadataInspection(schema, { ...input, ...patch })).toThrow();
  schema.input.body.properties.startUrls.editor = 'stringList';
  expect(() => validateMonidMetadataInspection(schema, input)).toThrow();
  const explicitItems = { ...inspection().input.body.properties.startUrls, items: { type: 'object', properties: { url: { type: 'string' } } } };
  const withItems = { input: { body: { ...inspection().input.body, properties: { ...inspection().input.body.properties, startUrls: explicitItems } } } };
  expect(() => validateMonidMetadataInspection(withItems, input)).not.toThrow();
  explicitItems.items.properties.url.type = 'number';
  expect(() => validateMonidMetadataInspection(withItems, input)).toThrow();
});

function guardedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'monid-metadata-test-')); roots.push(root);
  let now = Date.parse('2026-09-07T12:00:00Z');
  const budget = new MonidBudgetStore(join(root, 'budget.json'), () => now);
  const calls: string[] = [];
  let clientsCreated = 0;
  const controls = { unitPrice: 0.004, ambiguous: false, output: [row()] as unknown, abortPoll: undefined as AbortController | undefined };
  const client: PoolClient = {
    listTools: async (): ReturnType<PoolClient['listTools']> => monidTools as unknown as Awaited<ReturnType<PoolClient['listTools']>>,
    callTool: async (name, args) => {
      calls.push(name);
      if (name === 'monid_inspect') return { provider: 'apify', endpoint: args.endpoint, input: { ...inspection().input, bodyType: 'json' }, metrics: { status: 'healthy' }, price: { type: 'PER_RESULT', amount: { value: controls.unitPrice, currency: 'USD' } } };
      if (name !== 'monid_run' && name !== 'monid_get_run') throw new Error('Unexpected metadata operation');
      if (name === 'monid_get_run') expect(args).toEqual({ runId: 'run-1' });
      if (name === 'monid_get_run' && controls.abortPoll) { controls.abortPoll.abort(); return new Promise<never>(() => {}); }
      if (name === 'monid_run' && controls.ambiguous) throw new Error('Connection closed after submitting');
      return { provider: 'apify', endpoint: '/streamers/youtube-scraper', runId: 'run-1', status: controls.abortPoll ? 'RUNNING' : 'COMPLETED', cost: { value: controls.unitPrice, currency: 'USD' }, output: controls.output };
    },
    close: async () => {},
  };
  const run: Run = (root, operation, signal) => runMonidSignalOperation(root, operation, signal, { createClient: async () => { clientsCreated++; return client; }, budget, now: () => now, pollDelayMs: 0 });
  return { root, controls, calls, budget, deps: { run }, clientsCreated: () => clientsCreated, advance: (ms: number) => { now += ms; } };
}
test('channel resolution cancellation preserves the paid receipt and retry only polls its known run', async () => {
  const f = guardedFixture();
  const controller = new AbortController(); f.controls.abortPoll = controller;
  await expect(monidResolveChannel(f.root, '@example', { ...f.deps, signal: controller.signal })).rejects.toThrow('submitted run remains recorded');
  expect(f.calls).toEqual(['monid_inspect', 'monid_run', 'monid_get_run']);
  f.controls.abortPoll = undefined;
  expect((await monidResolveChannel(f.root, '@example', f.deps)).channelId).toBe(channelId);
  expect(f.calls).toEqual(['monid_inspect', 'monid_run', 'monid_get_run', 'monid_get_run']);
  expect(f.budget.getStatus().spentLast7DaysUsd).toBe(0.004);
});
test('real guard deduplicates paid metadata work and reuses validated success without another inspect', async () => {
  const f = guardedFixture();
  const results = await Promise.all(Array.from({ length: 3 }, () => monidVideoMetadata(f.root, videoId, undefined, f.deps)));
  expect(results.every(result => result.videoId === videoId)).toBe(true);
  await monidVideoMetadata(f.root, videoId, undefined, f.deps);
  expect(f.calls).toEqual(['monid_inspect', 'monid_run']);
  expect(f.budget.getStatus().spentLast7DaysUsd).toBe(0.004);
});
test('expired metadata polls within its scope and permits fresh guarded work only in a new scope', async () => {
  const f = guardedFixture();
  const first = { ...f.deps, attemptScope: 'workflow-1' };
  await monidRecentVideos(f.root, channelId, undefined, first);
  f.advance(15 * 60_000 + 1);
  await monidRecentVideos(f.root, channelId, undefined, first);
  expect(f.calls).toEqual(['monid_inspect', 'monid_run', 'monid_get_run']);
  expect(f.budget.getStatus().spentLast7DaysUsd).toBe(0.004);
  f.advance(15 * 60_000 + 1);
  await monidRecentVideos(f.root, channelId, undefined, { ...f.deps, attemptScope: 'workflow-2' });
  expect(f.calls).toEqual(['monid_inspect', 'monid_run', 'monid_get_run', 'monid_inspect', 'monid_run']);
  expect(f.budget.getStatus().spentLast7DaysUsd).toBe(0.008);
});
test('current price, operation ceiling and user budget block before any paid run', async () => {
  const expensive = guardedFixture(); expensive.controls.unitPrice = 0.051;
  await expect(monidRecentVideos(expensive.root, channelId, undefined, expensive.deps)).rejects.toThrow();
  expect(expensive.calls).toEqual(['monid_inspect']);
  const single = guardedFixture(); single.controls.unitPrice = 0.021;
  await expect(monidVideoMetadata(single.root, videoId, undefined, single.deps)).rejects.toThrow();
  expect(single.calls).toEqual(['monid_inspect']);
  const userLimit = guardedFixture(); userLimit.budget.updateLimits(0.001, 10);
  await expect(monidVideoMetadata(userLimit.root, videoId, undefined, userLimit.deps)).rejects.toThrow();
  expect(userLimit.calls).toEqual(['monid_inspect']);
  const weekly = guardedFixture(); weekly.budget.updateLimits(0.5, 0.001);
  await expect(monidVideoMetadata(weekly.root, videoId, undefined, weekly.deps)).rejects.toThrow();
  expect(weekly.calls).toEqual(['monid_inspect']);
});
test('ambiguous paid metadata attempt remains recorded and cannot auto-repeat', async () => {
  const f = guardedFixture(); f.controls.ambiguous = true;
  await expect(monidVideoMetadata(f.root, videoId, undefined, f.deps)).rejects.toThrow();
  f.controls.ambiguous = false;
  await expect(monidVideoMetadata(f.root, videoId, undefined, f.deps)).rejects.toThrow();
  expect(f.calls).toEqual(['monid_inspect', 'monid_run']);
  expect(f.clientsCreated()).toBe(1);
  expect(f.budget.getStatus().spentLast7DaysUsd).toBe(0.004);
});
test('invalid metadata resumes only the known run and caches only revalidated output', async () => {
  const f = guardedFixture(); f.controls.output = [{ ...row(), date: '10 months ago' }];
  await expect(monidVideoMetadata(f.root, videoId, undefined, f.deps)).rejects.toThrow();
  await expect(monidVideoMetadata(f.root, videoId, undefined, f.deps)).rejects.toThrow();
  expect(f.calls).toEqual(['monid_inspect', 'monid_run', 'monid_get_run']);
  f.controls.output = [row()];
  expect((await monidVideoMetadata(f.root, videoId, undefined, f.deps)).videoId).toBe(videoId);
  expect(f.calls).toEqual(['monid_inspect', 'monid_run', 'monid_get_run', 'monid_get_run']);
  await monidVideoMetadata(f.root, videoId, undefined, f.deps);
  expect(f.calls).toEqual(['monid_inspect', 'monid_run', 'monid_get_run', 'monid_get_run']);
  expect(f.budget.getStatus().spentLast7DaysUsd).toBe(0.004);
});

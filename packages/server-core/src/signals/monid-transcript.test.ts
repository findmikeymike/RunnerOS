import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MonidBudgetStore, type PoolClient } from '@craft-agent/shared/mcp';
import { monidSignalTranscript, isMonidSignalFallbackBlocked, monidSignalToken } from './monid-transcript';
import { getMonidSource } from '@craft-agent/shared/sources';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const id = 'abcdefghijk';
const endpoint = '/starvibe/youtube-video-transcript';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'monid-transcript-')); roots.push(root);
  const calls: string[] = [];
  const budget = new MonidBudgetStore(join(root, 'budget.json'));
  const inspection = { provider: 'apify', endpoint, metrics: { status: 'healthy' },
    price: { type: 'PER_RESULT', amount: { value: 0.01, currency: 'USD' } },
    input: { bodyType: 'json', body: { type: 'object', required: ['youtube_url'], properties: {
      youtube_url: { type: 'string' }, language: { type: 'string', enum: ['en'] },
    } } } };
  const completed = { provider: 'apify', endpoint, runId: 'saved-run', status: 'COMPLETED',
    cost: { value: 0.01, currency: 'USD' }, output: [{ video_id: id, status: 'success', transcript: [{ start: 0, end: 2, text: 'Real dated evidence.' }] }] };
  let run: () => unknown = () => completed;
  let poll: () => unknown = () => completed;
  const client: PoolClient = {
    listTools: async () => ['inspect', 'run', 'get_run'].map(name => ({ name, inputSchema: { type: 'object' as const, properties: { runId: { type: 'string' } } } })),
    callTool: async (name, args) => {
      calls.push(name);
      if (name === 'inspect') return inspection;
      if (name === 'run') { expect(args).toEqual({ provider: 'apify', endpoint, input: { youtube_url: `https://www.youtube.com/watch?v=${id}`, language: 'en' } }); return run(); }
      expect(args).toEqual({ runId: 'saved-run' }); return poll();
    }, close: async () => {},
  };
  return { root, calls, budget, inspection, completed, setRun: (fn: () => unknown) => { run = fn; }, setPoll: (fn: () => unknown) => { poll = fn; }, deps: { budget, createClient: async () => client, pollDelayMs: 0, maxPolls: 0 } };
}
test('singleton transcript validates timestamps and uses durable cache', async () => {
  const f = fixture();
  expect((await monidSignalTranscript(f.root, id, undefined, f.deps)).segments).toEqual([{ start: 0, end: 2, text: 'Real dated evidence.' }]);
  await monidSignalTranscript(f.root, id, undefined, f.deps);
  expect(f.calls).toEqual(['inspect', 'run']);
});
test('interrupted known run resumes by polling, never inspecting or paying again', async () => {
  const f = fixture(); f.setRun(() => ({ ...f.completed, status: 'RUNNING', output: undefined }));
  const failure = await monidSignalTranscript(f.root, id, undefined, f.deps).catch(error => error);
  expect(isMonidSignalFallbackBlocked(failure)).toBe(true);
  const spent = f.budget.getStatus().spentLast7DaysUsd;
  await monidSignalTranscript(f.root, id, undefined, f.deps);
  expect(f.calls).toEqual(['inspect', 'run', 'get_run']);
  expect(f.budget.getStatus().spentLast7DaysUsd).toBe(spent);
});
test('lost acknowledgment is sanitized and blocks a second paid submission', async () => {
  const f = fixture(); f.setRun(() => { throw new Error('Bearer SECRET upstream private body'); });
  for (let i = 0; i < 2; i++) {
    const error = await monidSignalTranscript(f.root, id, undefined, f.deps).catch(error => error);
    expect(isMonidSignalFallbackBlocked(error)).toBe(true); expect(error.message).not.toContain('SECRET');
  }
  expect(f.calls).toEqual(['inspect', 'run']);
});
test('cancelled caller cannot fall back, saved known work remains resumable', async () => {
  const f = fixture(); const abort = new AbortController();
  f.deps.maxPolls = 1;
  f.setRun(() => ({ ...f.completed, status: 'RUNNING' }));
  f.setPoll(() => { abort.abort(); return f.completed; });
  const error = await monidSignalTranscript(f.root, id, abort.signal, f.deps).catch(error => error);
  expect(isMonidSignalFallbackBlocked(error)).toBe(true);
  await monidSignalTranscript(f.root, id, undefined, f.deps);
  expect(f.calls).toEqual(['inspect', 'run', 'get_run', 'get_run']);
});
test('refreshes only saved refreshable credentials needing refresh', async () => {
  const source = getMonidSource('workspace', '/tmp/example');
  let refreshes = 0;
  const manager: Parameters<typeof monidSignalToken>[1] = {
    loadEffective: async () => null, needsRefresh: () => true,
    refresh: async () => { refreshes++; return 'fresh'; }, getToken: async () => null,
  };
  expect(await monidSignalToken(source, manager)).toBeNull();
  expect(refreshes).toBe(0);
  manager.loadEffective = async () => ({ value: 'expired', refreshToken: 'saved', expiresAt: 1 });
  expect(await monidSignalToken(source, manager)).toBe('fresh');
  expect(refreshes).toBe(1);
  manager.needsRefresh = () => false; manager.getToken = async () => 'current';
  expect(await monidSignalToken(source, manager)).toBe('current');
  expect(refreshes).toBe(1);
});
test('cancellation during unacknowledged run returns without permitting fallback', async () => {
  const f = fixture(); const abort = new AbortController();
  f.setRun(() => { setTimeout(() => abort.abort(), 1); return new Promise(() => {}); });
  const error = await monidSignalTranscript(f.root, id, abort.signal, f.deps).catch(error => error);
  expect(isMonidSignalFallbackBlocked(error)).toBe(true);
  await expect(monidSignalTranscript(f.root, id, undefined, f.deps)).rejects.toThrow();
  expect(f.calls).toEqual(['inspect', 'run']);
});
test('lower user cap and unhealthy inspection prevent paid work', async () => {
  const f = fixture(); f.budget.updateLimits(0.001, 1);
  await expect(monidSignalTranscript(f.root, id, undefined, f.deps)).rejects.toThrow();
  f.budget.updateLimits(0.02, 1); f.inspection.metrics.status = 'unknown';
  await expect(monidSignalTranscript(f.root, id, undefined, f.deps)).rejects.toThrow();
  expect(f.calls).toEqual(['inspect', 'inspect']);
});
test('wrong video output is rejected, subsequent recovery only polls', async () => {
  const f = fixture(); f.completed.output[0]!.video_id = 'xxxxxxxxxxx';
  await expect(monidSignalTranscript(f.root, id, undefined, f.deps)).rejects.toThrow();
  await expect(monidSignalTranscript(f.root, id, undefined, f.deps)).rejects.toThrow();
  expect(f.calls).toEqual(['inspect', 'run', 'get_run']);
});
test('changed poll run identity holds fallback', async () => {
  const f = fixture(); f.setRun(() => ({ ...f.completed, status: 'RUNNING' }));
  await expect(monidSignalTranscript(f.root, id, undefined, f.deps)).rejects.toThrow();
  f.setPoll(() => ({ ...f.completed, runId: 'someone-else' }));
  expect(isMonidSignalFallbackBlocked(await monidSignalTranscript(f.root, id, undefined, f.deps).catch(error => error))).toBe(true);
});
test('new scope authorizes fresh paid work only after terminal known-cost settlement', async () => {
  const f = fixture();
  f.setRun(() => ({ ...f.completed, status: 'FAILED' }));
  f.setPoll(() => ({ ...f.completed, status: 'FAILED' }));
  const run = (attemptScope: string) => monidSignalTranscript(f.root, id, undefined, { ...f.deps, attemptScope });
  await expect(run('workflow-1')).rejects.toThrow();
  await expect(run('workflow-1')).rejects.toThrow();
  expect(f.calls).toEqual(['inspect', 'run', 'get_run']);
  await expect(run('workflow-2')).rejects.toThrow();
  expect(f.calls).toEqual(['inspect', 'run', 'get_run', 'inspect', 'run']);
  await expect(run('workflow-1')).rejects.toThrow();
  expect(f.calls.at(-1)).toBe('get_run');
  expect(readdirSync(join(f.root, 'signals', 'monid-cache')).filter(name => name.endsWith('.attempt.json'))).toHaveLength(2);
  expect(f.budget.getStatus().spentLast7DaysUsd).toBe(0.02);
});
test('new scope cannot reset unknown charge or pending work', async () => {
  for (const state of ['FAILED', 'RUNNING', 'lost-ack']) {
    const f = fixture();
    const result = { ...f.completed, status: state, cost: undefined };
    f.setRun(() => { if (state === 'lost-ack') throw new Error('lost'); return result; });
    f.setPoll(() => result);
    for (const attemptScope of ['workflow-1', 'workflow-2']) {
      await expect(monidSignalTranscript(f.root, id, undefined, { ...f.deps, attemptScope })).rejects.toThrow();
    }
    expect(f.calls.filter(name => name === 'run')).toHaveLength(1);
    expect(readdirSync(join(f.root, 'signals', 'monid-cache')).filter(name => name.endsWith('.attempt.json'))).toHaveLength(1);
  }
});
test('successful canonical cache ignores attempt scope without another charge', async () => {
  const f = fixture();
  for (const attemptScope of ['workflow-1', 'workflow-2']) {
    await monidSignalTranscript(f.root, id, undefined, { ...f.deps, attemptScope });
  }
  expect(f.calls).toEqual(['inspect', 'run']);
  expect(readdirSync(join(f.root, 'signals', 'monid-cache')).filter(name => name.endsWith('.attempt.json'))).toHaveLength(1);
});


test('preflight and completed paid failures block provider switching', async () => {
  const disconnected = fixture();
  const disconnectedError = await monidSignalTranscript(disconnected.root, id, undefined, {
    ...disconnected.deps, createClient: async () => { throw new Error('No credential'); },
  }).catch(error => error);
  expect(isMonidSignalFallbackBlocked(disconnectedError)).toBe(true);
  expect(disconnected.calls).toEqual([]);

  const capped = fixture(); capped.budget.updateLimits(0.001, 1);
  expect(isMonidSignalFallbackBlocked(await monidSignalTranscript(capped.root, id, undefined, capped.deps).catch(error => error))).toBe(true);
  expect(capped.calls).toEqual(['inspect']);

  const unhealthy = fixture(); unhealthy.inspection.metrics.status = 'unknown';
  expect(isMonidSignalFallbackBlocked(await monidSignalTranscript(unhealthy.root, id, undefined, unhealthy.deps).catch(error => error))).toBe(true);
  expect(unhealthy.calls).toEqual(['inspect']);

  const failed = fixture(); failed.setRun(() => ({ ...failed.completed, status: 'FAILED' }));
  expect(isMonidSignalFallbackBlocked(await monidSignalTranscript(failed.root, id, undefined, failed.deps).catch(error => error))).toBe(true);
  expect(failed.calls).toEqual(['inspect', 'run']);
  expect(failed.budget.getStatus().spentLast7DaysUsd).toBe(0.01);
});

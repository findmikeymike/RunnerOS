import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity';
import { SIGNAL_VIDEO_ID } from '@craft-agent/shared/shared-intel';
import type { SignalTranscript } from './SignalProvider';

const execute = promisify(execFile);
const CAPABILITY = 'youtube-transcript-captions-chapters-19f9ac9d';
const ENDPOINT = 'https://youtube.use.x402atlas.com/transcript';
const MAX_PAY = 0.02;
type Json = Record<string, any>;
type Command = (file: string, args: string[], signal?: AbortSignal) => Promise<Json>;

async function command(file: string, args: string[], signal?: AbortSignal): Promise<Json> {
  try {
    const { stdout } = await execute(file, args, {
      // The CLI returns both parsed body and bodyRaw; match the guard's envelope bound.
      timeout: 90_000, maxBuffer: 20 * 1024 * 1024, signal,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CRAFT_CONFIG_DIR: RUNTIME_IDENTITY.dataRoot },
    });
    return JSON.parse(stdout);
  } catch { throw new Error('Zero transcript retrieval failed. Review the saved Zero receipt before retrying.'); }
}

function parseTranscript(value: Json, videoId: string): SignalTranscript {
  if (value.video_id !== videoId || value.note || !Array.isArray(value.segments)
    || !value.segments.length || value.segments.length > 20_000) throw new Error('Zero returned no verified transcript for this video.');
  const segments = value.segments.map((part: Json) => {
    if (!part || typeof part !== 'object' || typeof part.text !== 'string' || !part.text.trim() || !Number.isFinite(part.start_ms) || part.start_ms < 0
      || (part.end_ms !== undefined && (!Number.isFinite(part.end_ms) || part.end_ms < part.start_ms))) throw new Error('Zero transcript timing is invalid.');
    return { start: part.start_ms / 1000, end: (part.end_ms ?? part.start_ms) / 1000, text: part.text };
  });
  if (segments.reduce((sum, part) => sum + part.text.length, 0) > 2_000_000) throw new Error('Zero transcript exceeds supported size.');
  return { videoId, provider: `zero:${CAPABILITY}`, segments };
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

const pending = new Map<string, Promise<SignalTranscript>>();

/** One inspected, timestamped fallback through the existing allowance; no marketplace or paid retry loop. */
export async function zeroSignalTranscript(root: string, videoId: string, signal?: AbortSignal, deps: {
  command?: Command; guardPath?: string; zeroPath?: string;
} = {}): Promise<SignalTranscript> {
  if (!SIGNAL_VIDEO_ID.test(videoId)) throw new Error('Invalid video.');
  signal?.throwIfAborted();
  const directory = join(root, 'signals', 'transcript-cache');
  const cachePath = join(directory, `zero-${videoId}.json`);
  const failedPath = join(directory, `zero-${videoId}.attempt.json`);
  const existing = pending.get(cachePath);
  if (existing) return existing;
  const task = (async () => {
    await mkdir(directory, { recursive: true });
    try {
      const cached = await readFile(cachePath);
      if (cached.length > 3 * 1024 * 1024) throw new Error('Cached transcript exceeds supported size.');
      return parseTranscript(JSON.parse(cached.toString('utf8')), videoId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cached Zero evidence is invalid. Review it before retrieving again.');
    }
    try {
      await readFile(failedPath);
      throw new Error('A previous paid transcript attempt needs review. Automatic retries are paused for this video.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const run = deps.command ?? command;
    const guard = deps.guardPath ?? join(RUNTIME_IDENTITY.skillsDir, 'zero', 'scripts', 'zero-budget.mjs');
    const allowance = await run(process.execPath, [guard, 'status', '--json'], signal);
    if (allowance.ok !== true || allowance.configured !== true || !Number.isFinite(allowance.remainingUsd)
      || allowance.remainingUsd < MAX_PAY) throw new Error('Configure a Zero weekly allowance with at least $0.02 remaining, or restore the local transcript service.');
    const metadata = await run(deps.zeroPath ?? process.env.ZERO_CLI ?? 'zero', ['get', CAPABILITY, '--agent', 'anything-agent'], signal);
    const query = metadata.bodySchema?.properties?.input?.properties?.queryParams;
    const segmentSchema = metadata.bodySchema?.properties?.output?.properties?.example?.properties?.segments?.items?.properties;
    const price = Number(metadata.displayCostAmount);
    if (typeof metadata.uid !== 'string' || !metadata.uid || metadata.slug !== CAPABILITY || metadata.url !== ENDPOINT || metadata.method !== 'GET'
      || metadata.availabilityStatus !== 'healthy' || metadata.displayCostAsset !== 'USDC'
      || !Number.isFinite(price) || price < 0 || price > MAX_PAY
      || query?.type !== 'object' || query.properties?.v?.type !== 'string'
      || segmentSchema?.start_ms?.type !== 'integer' || segmentSchema?.text?.type !== 'string'
      || !Array.isArray(query.required) || !query.required.includes('v') || query.required.some((key: string) => key !== 'v')) {
      throw new Error('The timestamped Zero transcript fallback is unavailable or changed. No paid call was made.');
    }
    const readContract = createHash('sha256').update(JSON.stringify({
      uid: metadata.uid, slug: metadata.slug, url: metadata.url, method: metadata.method,
      availabilityStatus: metadata.availabilityStatus, displayCostAmount: metadata.displayCostAmount,
      displayCostAsset: metadata.displayCostAsset, bodySchema: metadata.bodySchema,
    })).digest('hex');
    signal?.throwIfAborted();
    // Persist before execution: interrupted/uncertain paid calls cannot silently repeat.
    await atomicJson(failedPath, { videoId, capability: CAPABILITY, attemptedAt: new Date().toISOString(), status: 'pending-review' });
    const result = await run(process.execPath, [guard, 'fetch', '--capability', CAPABILITY, '--max-pay', String(MAX_PAY), '--query-json', JSON.stringify({ v: videoId }), '--expected-read-contract', readContract, '--json'], signal);
    if (result.ok !== true || result.providerResult?.ok !== true) throw new Error('Zero transcript retrieval did not succeed. Review the saved Zero receipt before retrying.');
    // Zero CLI's JSON contract carries the upstream response in body.
    const payload = result.providerResult.body;
    if (Buffer.byteLength(JSON.stringify(payload ?? null)) > 3 * 1024 * 1024) throw new Error('Zero transcript exceeds supported evidence size.');
    const transcript = parseTranscript(payload ?? {}, videoId);
    await atomicJson(cachePath, payload);
    await rm(failedPath, { force: true });
    signal?.throwIfAborted();
    return transcript;
  })();
  pending.set(cachePath, task);
  try { return await task; } finally { if (pending.get(cachePath) === task) pending.delete(cachePath); }
}

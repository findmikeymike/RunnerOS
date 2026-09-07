import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CraftMcpClient, monidBudgetStore, evaluateMonidSpendLimit, type PoolClient, type MonidBudgetStore } from '@craft-agent/shared/mcp';
import { getMonidSource, getSourceCredentialManager, getSourcesBySlugs } from '@craft-agent/shared/sources';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { SIGNAL_VIDEO_ID } from '@craft-agent/shared/shared-intel';
import type { SignalTranscript } from './SignalProvider';

const TRANSCRIPT = '/starvibe/youtube-video-transcript';
const METADATA = '/streamers/youtube-scraper';
const MAX_BYTES = 3 * 1024 * 1024;
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'BLOCKED', 'STOPPED', 'TIMED_OUT']);
type Json = Record<string, any>;

/** False means another paid fallback must NOT be attempted for this operation. */
export class MonidSignalError extends Error {
  constructor(message: string, readonly fallbackAllowed: boolean, readonly runId?: string) {
    super(message); this.name = 'MonidSignalError';
  }
}
export function isMonidSignalFallbackBlocked(error: unknown): boolean {
  return error instanceof MonidSignalError ? !error.fallbackAllowed : error instanceof Error && error.name === 'AbortError';
}

export async function createMonidSignalClient(root: string): Promise<PoolClient> {
  const config = loadWorkspaceConfig(root);
  if (!config) throw new MonidSignalError('Monid requires a valid Artist workspace.', true);
  const source = getSourcesBySlugs(root, ['monid'])[0] ?? getMonidSource(config.id, root);
  if (source.config.enabled === false) throw new MonidSignalError('Enable Monid in Connections > Services.', true);
  const manager = getSourceCredentialManager();
  const token = await monidSignalToken(source, manager);
  if (!token) throw new MonidSignalError('Connect Monid in Connections > Services.', true);
  return new CraftMcpClient({ transport: 'http', url: 'https://mcp.monid.ai/v1', headers: { Authorization: `Bearer ${token}` } });
}

export async function monidSignalToken(source: Parameters<ReturnType<typeof getSourceCredentialManager>['getToken']>[0],
  manager: Pick<ReturnType<typeof getSourceCredentialManager>, 'loadEffective' | 'needsRefresh' | 'refresh' | 'getToken'>): Promise<string | null> {
  const credential = await manager.loadEffective(source);
  return credential?.refreshToken && manager.needsRefresh(credential)
    ? await manager.refresh(source) : await manager.getToken(source);
}

export interface MonidSignalOperation<T> {
  attemptScope?: string;
  key: string;
  endpoint: string;
  input: Record<string, unknown>;
  maxCostUsd: number;
  maxOutputRows: number;
  cacheTtlMs?: number;
  validateInspection: (inspection: Json) => void;
  parseOutput: (output: unknown) => T;
}
export interface MonidSignalDeps {
  attemptScope?: string;
  createClient?: (root: string) => Promise<PoolClient>;
  budget?: Pick<MonidBudgetStore, 'getStatus' | 'reserve' | 'commit' | 'release'>;
  now?: () => number;
  pollDelayMs?: number;
  maxPolls?: number;
}

function object(value: unknown): value is Json { return !!value && typeof value === 'object' && !Array.isArray(value); }
function jsonResult(value: unknown): Json {
  if (!object(value) || value.isError) throw new Error('Monid returned an MCP error.');
  let result: unknown = value;
  if (object(value.structuredContent)) result = value.structuredContent;
  else if (Array.isArray(value.content)) {
    const texts = value.content.filter((block: Json) => block.type === 'text' && typeof block.text === 'string');
    if (texts.length !== 1 || Buffer.byteLength(texts[0].text) > MAX_BYTES) throw new Error('Monid response is missing or too large.');
    result = JSON.parse(texts[0].text);
  }
  if (!object(result) || Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) throw new Error('Monid response exceeds its supported shape or size.');
  return result;
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
async function readJson(path: string): Promise<Json | null> {
  try {
    const bytes = await readFile(path);
    if (bytes.length > MAX_BYTES) throw new Error('Saved Monid evidence exceeds its bound.');
    const result = JSON.parse(bytes.toString('utf8'));
    if (!object(result)) throw new Error('Saved Monid evidence is invalid.');
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new MonidSignalError('Saved Monid evidence needs review before retrying.', false);
  }
}
function requiredOnly(schema: Json, allowed: string[]): boolean {
  return schema.type === 'object' && (!schema.required || Array.isArray(schema.required) && schema.required.every((key: unknown) => typeof key === 'string' && allowed.includes(key)));
}
function validateInspection(inspection: Json, operation: MonidSignalOperation<unknown>): void {
  if (inspection.provider !== 'apify' || inspection.endpoint !== operation.endpoint
    || inspection.input?.bodyType !== 'json' || !requiredOnly(inspection.input?.body ?? {}, Object.keys(operation.input))) throw new Error('Monid endpoint input contract changed.');
  for (const place of ['pathParams', 'queryParams']) {
    if (inspection.input?.[place]?.required?.length) throw new Error('Monid endpoint now requires additional parameters.');
  }
  const health = inspection.metrics?.status;
  if (health !== 'healthy' && health !== 'stable') throw new Error('Monid endpoint health is not verified healthy or stable.');
  operation.validateInspection(inspection);
}
function actualCost(result: Json): number | undefined {
  const cost = result.cost;
  if (object(cost) && cost.currency === 'USD' && typeof cost.value === 'number' && Number.isFinite(cost.value) && cost.value >= 0) return cost.value;
  const billed = result.billing?.reportedCost;
  if (object(billed) && billed.currency === 'USD' && billed.unit === 'MICRO_DOLLAR'
    && typeof billed.value === 'number' && Number.isFinite(billed.value) && billed.value >= 0) return billed.value / 1_000_000;
  return undefined;
}

const pending = new Map<string, Promise<unknown>>();

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new MonidSignalError('Monid operation cancelled; submitted work remains recorded.', false));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** Host-only executor for the two deliberately pinned Signals endpoints, never discovery. */
export async function runMonidSignalOperation<T>(root: string, operation: MonidSignalOperation<T>, signal?: AbortSignal, deps: MonidSignalDeps = {}): Promise<T> {
  const attemptScope = operation.attemptScope ?? deps.attemptScope;
  if (attemptScope !== undefined && (typeof attemptScope !== 'string' || !attemptScope.trim() || attemptScope.length > 256)) {
    throw new MonidSignalError('Invalid Monid attempt scope.', false);
  }
  if (![TRANSCRIPT, METADATA].includes(operation.endpoint) || !operation.key || !Number.isFinite(operation.maxCostUsd)
    || operation.maxCostUsd < 0 || operation.maxCostUsd > (operation.endpoint === TRANSCRIPT ? 0.02 : 0.25)
    || !Number.isInteger(operation.maxOutputRows) || operation.maxOutputRows < 1 || operation.maxOutputRows > (operation.endpoint === TRANSCRIPT ? 1 : 50)
    || operation.cacheTtlMs !== undefined && (!Number.isFinite(operation.cacheTtlMs) || operation.cacheTtlMs <= 0)) throw new MonidSignalError('Invalid bounded Monid operation.', true);
  signal?.throwIfAborted();
  const identity = JSON.stringify({ version: 1, key: operation.key, endpoint: operation.endpoint, input: operation.input });
  const hash = createHash('sha256').update(identity).digest('hex');
  const directory = join(resolve(root), 'signals', 'monid-cache');
  const cachePath = join(directory, `${hash}.json`);
  let attemptPath = join(directory, `${hash}.attempt.json`);
  const existing = pending.get(cachePath);
  if (existing) { const result = await abortable(existing, signal) as T; signal?.throwIfAborted(); return result; }
  const task = (async () => {
    const now = deps.now ?? Date.now;
    const budget = deps.budget ?? monidBudgetStore;
    let client: PoolClient | undefined;
    let reservation: string | undefined;
    let started = false;
    let ownsAttempt = false;
    let runId: string | undefined;
    let terminal = false;
    let projectedMaxUsd = 0;
    try {
      await mkdir(directory, { recursive: true });
      const cache = await readJson(cachePath);
      if (cache) {
        if (cache.identity !== identity || !Number.isFinite(cache.savedAt)) throw new Error('Cached Monid identity is invalid.');
        if (operation.cacheTtlMs === undefined || now() - cache.savedAt < operation.cacheTtlMs) return operation.parseOutput(cache.output);
      }
      let prior = await readJson(attemptPath);
      // Append-only successor paths preserve old scopes and atomically arbitrate competing new scopes.
      for (let depth = 0; prior && prior.attemptScope !== attemptScope; depth++) {
        if (prior.identity !== identity || depth >= 1000) throw new MonidSignalError('Saved Monid attempt history needs review.', false);
        if (!attemptScope || !TERMINAL.has(prior.status) || prior.settled !== true
          || !Number.isFinite(prior.actualCostUsd) || prior.actualCostUsd < 0) break;
        attemptPath = join(directory, `${createHash('sha256').update(attemptPath).digest('hex')}.attempt.json`);
        prior = await readJson(attemptPath);
      }
      if (prior) {
        started = true;
        if (prior.identity !== identity || typeof prior.runId !== 'string' || !prior.runId
          || typeof prior.reservation !== 'string' || !Number.isFinite(prior.projectedMaxUsd) || prior.projectedMaxUsd < 0) {
          throw new MonidSignalError('A previous Monid submission needs review; no new paid run was started.', false);
        }
        runId = prior.runId;
        reservation = prior.reservation;
        projectedMaxUsd = prior.projectedMaxUsd;
      }
      signal?.throwIfAborted();
      client = await (deps.createClient ?? createMonidSignalClient)(root);
      const tools = await abortable(client.listTools(), signal);
      const call = (name: string, args: Record<string, unknown>) => abortable(client!.callTool(name, args), signal);
      const inspect = tools.find(tool => tool.name === 'inspect');
      const run = tools.find(tool => tool.name === 'run');
      const polls = tools.filter(tool => /^(get_run|runs_get|run_get|getRun)$/.test(tool.name)
        && requiredOnly(tool.inputSchema as Json, ['runId']) && (tool.inputSchema as Json).properties?.runId?.type === 'string');
      if (polls.length !== 1 || !prior && (!inspect || !run || !requiredOnly(inspect.inputSchema as Json, ['provider', 'endpoint'])
        || !requiredOnly(run.inputSchema as Json, ['provider', 'endpoint', 'input']))) throw new Error('Monid MCP contract is unavailable.');
      const args = { provider: 'apify', endpoint: operation.endpoint, input: operation.input };
      let result: Json;
      if (prior) {
        result = jsonResult(await call(polls[0]!.name, { runId }));
      } else {
      const inspection = jsonResult(await call('inspect', { provider: 'apify', endpoint: operation.endpoint }));
      validateInspection(inspection, operation);
      const status = budget.getStatus();
      const cap = Math.min(operation.maxCostUsd, status.singleCallCapUsd);
      const decision = evaluateMonidSpendLimit(inspection, args, cap);
      if (!decision.allowed) throw new Error(decision.reason);
      if (decision.projectedMaxUsd > status.remainingWeeklyUsd) throw new Error('Monid weekly allowance is exhausted.');
      projectedMaxUsd = decision.projectedMaxUsd;
      signal?.throwIfAborted();
      // Exclusive creation also prevents a second process from starting the same paid operation.
      await writeFile(attemptPath, JSON.stringify({ identity, attemptScope, status: 'PREPARED', attemptedAt: now() }), { flag: 'wx', mode: 0o600 });
      ownsAttempt = true;
      reservation = budget.reserve(decision.projectedMaxUsd);
      await atomicJson(attemptPath, { identity, attemptScope, status: 'PENDING_REVIEW', reservation, projectedMaxUsd: decision.projectedMaxUsd, attemptedAt: now() });
      signal?.throwIfAborted();
      started = true;
      result = jsonResult(await call('run', args));
      }
      for (let poll = 0; ; poll++) {
        if (result.provider !== 'apify' || result.endpoint !== operation.endpoint || typeof result.runId !== 'string' || !result.runId
          || runId && result.runId !== runId) throw new Error('Monid run identity could not be verified.');
        runId = result.runId;
        const completed = TERMINAL.has(result.status);
        await atomicJson(attemptPath, { identity, attemptScope: prior ? prior.attemptScope : attemptScope, status: completed ? result.status : 'PENDING_REVIEW', providerStatus: result.status,
          runId, reservation, projectedMaxUsd, attemptedAt: now() });
        terminal = completed;
        if (terminal) break;
        signal?.throwIfAborted();
        if (!['READY', 'RUNNING', 'STOPPING'].includes(result.status) || poll >= (deps.maxPolls ?? 24)) throw new Error('Monid run is still active or its status is unknown.');
        await delay(deps.pollDelayMs ?? 5000, undefined, { signal });
        result = jsonResult(await call(polls[0]!.name, { runId }));
      }
      const charged = actualCost(result);
      if (reservation) budget.commit(reservation, charged);
      await atomicJson(attemptPath, { identity, attemptScope: prior ? prior.attemptScope : attemptScope, status: result.status,
        runId, reservation, projectedMaxUsd, actualCostUsd: charged, settled: charged !== undefined, attemptedAt: now() });
      reservation = undefined;
      signal?.throwIfAborted();
      if (result.status !== 'COMPLETED') throw new MonidSignalError(`Monid transcript run ended ${result.status}.`, true, runId);
      if (result.providerResponse?.httpStatus !== undefined && (!Number.isInteger(result.providerResponse.httpStatus)
        || result.providerResponse.httpStatus < 200 || result.providerResponse.httpStatus >= 300)) throw new Error('Monid provider returned no usable data.');
      if (!Array.isArray(result.output) || result.output.length > operation.maxOutputRows) throw new Error('Monid output exceeded the single-operation result bound.');
      const parsed = operation.parseOutput(result.output);
      await atomicJson(cachePath, { identity, savedAt: now(), runId, output: result.output });
      return parsed;
    } catch (error) {
      if (!started && ownsAttempt) {
        if (reservation) budget.release(reservation);
        await rm(attemptPath, { force: true });
      }
      if (signal?.aborted) throw new MonidSignalError('Monid operation cancelled; any submitted run remains recorded for review.', false, runId);
      if (error instanceof MonidSignalError) {
        if (started && !terminal && error.fallbackAllowed) throw new MonidSignalError('The saved Monid run could not be resumed. Retry after restoring the connection.', false, runId);
        throw error;
      }
      const collision = (error as NodeJS.ErrnoException).code === 'EEXIST';
      throw new MonidSignalError(started && !terminal ? 'Monid run is pending or unverified. Retry to resume known work; no new paid run was started.'
        : 'Monid data unavailable: connection, endpoint contract, allowance, or returned data could not be verified.', !collision && (!started || terminal), runId);
    } finally {
      if (client) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([client.close().catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
        if (timer) clearTimeout(timer);
      }
    }
  })();
  pending.set(cachePath, task);
  try { return await task; } finally { if (pending.get(cachePath) === task) pending.delete(cachePath); }
}

export function monidSignalTranscript(root: string, videoId: string, signal?: AbortSignal, deps: MonidSignalDeps = {}): Promise<SignalTranscript> {
  if (!SIGNAL_VIDEO_ID.test(videoId)) return Promise.reject(new MonidSignalError('Invalid video.', true));
  return runMonidSignalOperation(root, {
    key: `transcript-en-v1:${videoId}`, endpoint: TRANSCRIPT,
    input: { youtube_url: `https://www.youtube.com/watch?v=${videoId}`, language: 'en' }, maxCostUsd: 0.02, maxOutputRows: 1,
    validateInspection: inspection => {
      const properties = inspection.input.body.properties;
      if (properties?.youtube_url?.type !== 'string' || properties?.language?.type !== 'string'
        || properties.language.enum && !properties.language.enum.includes('en')
        || properties.channel_url?.default) throw new Error('Monid single-video transcript schema changed.');
    },
    parseOutput: output => {
      if (!Array.isArray(output) || output.length !== 1) throw new Error('Monid returned no single-video transcript.');
      const row = output[0];
      if (!object(row) || row.video_id !== videoId || row.status !== 'success' || !Array.isArray(row.transcript)
        || !row.transcript.length || row.transcript.length > 20_000) throw new Error('Monid returned no verified transcript for this video.');
      let total = 0;
      const segments = row.transcript.map((part: unknown) => {
        if (!object(part) || typeof part.text !== 'string' || !part.text.trim() || !Number.isFinite(part.start) || part.start < 0
          || !Number.isFinite(part.end) || part.end < part.start) throw new Error('Monid transcript has invalid timestamps.');
        total += part.text.length;
        if (total > 2_000_000) throw new Error('Monid transcript is too large.');
        return { start: part.start, end: part.end, text: part.text };
      });
      return { videoId, segments, provider: `monid:apify${TRANSCRIPT}` };
    },
  }, signal, deps);
}

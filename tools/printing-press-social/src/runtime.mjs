import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Shared runtime for the Printing Press social CLIs.
 *
 * Holds the safety-critical primitives that must behave identically across
 * every platform CLI: per-profile execution locks (so two live actions never
 * drive the same persistent browser session at once) and an idempotency ledger
 * (so retries / agent loops never double-post). Keep these here, not copied
 * into each platform CLI, so the guarantees cannot drift.
 */

export class RuntimeError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const LOCK_STALE_MS = 15 * 60 * 1000;
const DEFAULT_IDEMPOTENCY_WINDOW_MS = 6 * 60 * 60 * 1000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeMtimeMs(target) {
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return 0;
  }
}

function lockDirFor(homeDir, action) {
  return path.join(homeDir, 'locks', `${action.platform}-${action.profile}.lock`);
}

/**
 * Acquire an exclusive per-profile lock via atomic mkdir. A stale lock (older
 * than LOCK_STALE_MS, e.g. from a crashed run) is reclaimed once.
 */
export function acquireProfileLock(homeDir, action) {
  const dir = lockDirFor(homeDir, action);
  ensureDir(path.dirname(dir));

  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const age = Date.now() - safeMtimeMs(dir);
    if (age <= LOCK_STALE_MS) {
      throw new RuntimeError(
        `Profile ${action.platform}/${action.profile} is busy with another live action. Retry when it finishes.`,
        'PROFILE_LOCKED',
      );
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
  }

  try {
    fs.writeFileSync(
      path.join(dir, 'owner.json'),
      `${JSON.stringify({ pid: process.pid, actionId: action.actionId, at: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Ownership metadata is best-effort; the directory itself is the lock.
  }

  return dir;
}

export function releaseProfileLock(lockDir) {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Best-effort release.
  }
}

function idempotencyKeyFor(action) {
  const explicit = action?.options?.idempotencyKey;
  if (explicit) return { explicit: true, key: String(explicit) };
  const digest = createHash('sha256')
    .update(JSON.stringify({
      platform: action.platform,
      profile: action.profile,
      verb: action.verb,
      payload: action.payload,
    }))
    .digest('hex');
  return { explicit: false, key: digest };
}

function ledgerPathFor(homeDir, key) {
  const safe = createHash('sha256').update(key).digest('hex');
  return path.join(homeDir, 'idempotency', `${safe}.json`);
}

/**
 * Returns the prior ledger record if this exact live action already ran (and,
 * for auto-derived keys, ran recently). `--allow-duplicate` bypasses the check.
 */
export function checkIdempotency(homeDir, action, flags = {}) {
  if (flags['allow-duplicate']) return null;
  const { explicit, key } = idempotencyKeyFor(action);
  const file = ledgerPathFor(homeDir, key);
  if (!fs.existsSync(file)) return null;

  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }

  const age = Date.now() - Date.parse(record.at || 0);
  if (!explicit && Number.isFinite(age) && age > DEFAULT_IDEMPOTENCY_WINDOW_MS) return null;
  return record;
}

export function recordIdempotency(homeDir, action, result) {
  const { key } = idempotencyKeyFor(action);
  const file = ledgerPathFor(homeDir, key);
  ensureDir(path.dirname(file));
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      actionId: action.actionId,
      platform: action.platform,
      profile: action.profile,
      verb: action.verb,
      ok: Boolean(result && result.ok),
      at: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/**
 * Execute a single live platform action with duplicate protection and a
 * per-profile lock. `run` performs the actual browser work and resolves to a
 * result object shaped like `{ ok, ... }`. Only successful results are
 * recorded in the idempotency ledger, so failures are safe to retry.
 */
export async function runLiveAction({ homeDir, action, flags = {}, run }) {
  const prior = checkIdempotency(homeDir, action, flags);
  if (prior) {
    return {
      ok: true,
      status: 'duplicate',
      deduped: true,
      priorActionId: prior.actionId || null,
      note: 'Idempotent duplicate detected; no second live action was executed. Pass --allow-duplicate to override.',
      artifacts: [],
    };
  }

  const lockDir = acquireProfileLock(homeDir, action);
  try {
    const result = await run();
    if (result && result.ok) recordIdempotency(homeDir, action, result);
    return result;
  } finally {
    releaseProfileLock(lockDir);
  }
}

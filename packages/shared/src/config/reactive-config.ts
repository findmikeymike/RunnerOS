/**
 * Reactive Config — TTL-cached, file-watcher-backed hot-reload wrapper
 * around `loadStoredConfig()` from ./storage.ts.
 *
 * Concept-only re-implementation from OpenHuman heartbeat pattern (GPL-3.0) —
 * no source code copied. Behavior derived from research note
 * `.planning/research/04-openhuman-concepts.md` (Upgrade 6).
 *
 * Design:
 *   - Pull-based by default: callers invoke `getConfigCached(ttlMs)` at tick
 *     boundaries. Within the TTL window the cached value is returned without
 *     touching disk. After expiry the next call refreshes from disk.
 *   - Push opt-in: `subscribeConfigChanges(cb)` registers a callback fired
 *     after a debounced file-change event invalidates the cache. Useful for
 *     services that need lower-than-TTL latency on config changes.
 *   - File watcher is started lazily on first read/subscribe; it never
 *     blocks the read path (debounced + async refresh).
 */

import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { CONFIG_DIR } from './paths.ts';
import { loadStoredConfig, registerPostSaveConfigHook, type StoredConfig } from './storage.ts';
import { debug } from '../utils/debug.ts';

const DEFAULT_TTL_MS = 10_000;
const DEBOUNCE_MS = 200;

type Subscriber = (cfg: StoredConfig) => void;

interface CacheEntry {
  value: StoredConfig;
  fetchedAt: number;
}

let cached: CacheEntry | null = null;
let watcher: FSWatcher | null = null;
let watcherPath: string | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
const subscribers = new Set<Subscriber>();

// Path resolver — allows tests to override via `_setConfigPathForTests`.
let configPathOverride: string | null = null;

function resolveConfigPath(): string {
  return configPathOverride ?? join(CONFIG_DIR, 'config.json');
}

function readConfig(): StoredConfig | null {
  if (configPathOverride) {
    // Test path: read the override file directly.
    try {
      if (!existsSync(configPathOverride)) return null;
      return JSON.parse(readFileSync(configPathOverride, 'utf-8')) as StoredConfig;
    } catch (err) {
      debug('[reactive-config] override read failed:', err);
      return null;
    }
  }
  return loadStoredConfig();
}

function notifySubscribers(cfg: StoredConfig): void {
  for (const cb of subscribers) {
    try {
      cb(cfg);
    } catch (err) {
      debug('[reactive-config] subscriber threw:', err);
    }
  }
}

function ensureWatcher(): void {
  const targetPath = resolveConfigPath();
  if (watcher && watcherPath === targetPath) return;

  // Path changed (test override) — tear down prior watcher.
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
    watcher = null;
    watcherPath = null;
  }

  const dir = dirname(targetPath);
  const fileName = basename(targetPath);

  try {
    // Watch the parent directory — file-level watches break on atomic
    // rename writes (common editor save pattern). Filter by filename.
    watcher = watch(dir, (_event, changed) => {
      // Node returns a string by default, while Bun may return a Buffer-like
      // value. Normalize before filtering or valid config changes are lost.
      if (changed && String(changed) !== fileName) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        // Invalidate cache and reload, then fan out to subscribers.
        cached = null;
        const fresh = readConfig();
        if (fresh) {
          cached = { value: fresh, fetchedAt: Date.now() };
          notifySubscribers(fresh);
        }
      }, DEBOUNCE_MS);
    });
    watcherPath = targetPath;
    // Detach from event loop — config watcher should never keep process alive.
    watcher.unref?.();
  } catch (err) {
    debug('[reactive-config] watch() failed (continuing without push):', err);
    watcher = null;
    watcherPath = null;
  }
}

/**
 * Get the current stored config, using a TTL-bounded in-memory cache.
 * Within `ttlMs` of the previous read this returns the cached value
 * without touching disk. After expiry the next call reloads.
 *
 * @param ttlMs Cache window in milliseconds. Default 10s.
 * @returns The current StoredConfig, or null if config is missing/invalid.
 */
export function getConfigCached(ttlMs: number = DEFAULT_TTL_MS): StoredConfig | null {
  ensureWatcher();
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ttlMs) {
    return cached.value;
  }
  const fresh = readConfig();
  if (!fresh) {
    // Don't poison cache with null — leave previous entry in place if any.
    return cached?.value ?? null;
  }
  cached = { value: fresh, fetchedAt: now };
  return fresh;
}

/**
 * Subscribe to file-watcher-driven config-change notifications.
 * Callback fires after the file-watcher detects a change to config.json
 * (debounced by ~{@link DEBOUNCE_MS}ms). Returns an unsubscribe function.
 *
 * Subscribers are best-effort: a throwing callback is logged and other
 * subscribers still receive the update.
 */
export function subscribeConfigChanges(cb: Subscriber): () => void {
  ensureWatcher();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * Force the next `getConfigCached()` call to reload from disk.
 *
 * @internal Deliberate escape hatch — intended for tests and the
 * `storage.saveConfig()` write path (so post-write reads see fresh
 * data without waiting for the debounced file-watcher). Not part of
 * the package's public API surface.
 */
export function invalidateConfigCache(): void {
  cached = null;
}

// Wire into storage.saveConfig — when config is written through the official
// API, drop the cache so the next read sees fresh data immediately (no wait
// for the debounced file-watcher).
registerPostSaveConfigHook(() => {
  invalidateConfigCache();
});

// ────────────────────────────────────────────────────────────────────────────
// Test-only helpers (not exported from the package index)
// ────────────────────────────────────────────────────────────────────────────

/** @internal — test hook. Override the config file path. Pass null to clear. */
export function _setConfigPathForTests(path: string | null): void {
  configPathOverride = path;
  // Force watcher rebind / cache invalidation when the source changes.
  invalidateConfigCache();
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
    watcher = null;
    watcherPath = null;
  }
}

/** @internal — test hook. Tear everything down. */
export async function _shutdownForTests(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
  }
  watcher = null;
  watcherPath = null;
  cached = null;
  subscribers.clear();
  configPathOverride = null;
}

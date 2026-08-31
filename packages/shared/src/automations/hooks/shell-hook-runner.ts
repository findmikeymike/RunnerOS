/**
 * Polyglot shell-hook runner.
 *
 * Ported from NousResearch/hermes-agent (MIT) `agent/shell_hooks.py` (the
 * `_spawn` / `_make_callback` / `_parse_response` flow). See
 * THIRD_PARTY_NOTICES.md for the full attribution row.
 *
 * Safety invariants enforced here:
 *
 *   1. `child_process.spawn` is invoked with `shell: false` — ALWAYS. We never
 *      route argv through a shell interpreter. Pipes/redirection must be wrapped
 *      in a user script.
 *   2. Argv is built via shell-quote `parse()` and rejects any non-string token
 *      (operators, substitutions). See `parseCommand` in allowlist-store.ts.
 *   3. First-use consent is gated by `requestConsent`; non-TTY callers must
 *      opt in via acceptHooks or the RUNNEROS_ACCEPT_HOOKS env var.
 *   4. Captured stdout / stderr are truncated to 4 KB each before logging so a
 *      runaway hook cannot blow up the log pipeline.
 *
 * Failure-mode policy: fail-open on infrastructure errors (timeout, missing
 * binary, malformed JSON, non-zero exit) — those are logged and surfaced as
 * `{action: "allow"}` so a broken hook script never bricks an automation.
 * Fail-closed only on an explicit `block` decision in the parsed stdout.
 */

import { spawn } from 'node:child_process';

import { createLogger } from '../../utils/debug.ts';
import { requestConsent } from './consent.ts';
import { computeScriptContentHash, resolveRealScriptPath } from './allowlist-store.ts';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  STREAM_CAPTURE_BYTES,
  type ConsentOptions,
  type HookEvent,
  type HookResponse,
  type HookSpec,
} from './types.ts';

const log = createLogger('shell-hook-runner');

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS;
  if (ms < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (ms > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return Math.floor(ms);
}

function truncate(s: string, max = STREAM_CAPTURE_BYTES): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[truncated ${s.length - max}b]`;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  error?: Error;
}

/**
 * Build a filtered environment for the hook child. Strips anything that
 * looks like a credential (API keys, OAuth tokens, bearer tokens, passwords,
 * generic secrets) so an approved hook script can't trivially exfiltrate the
 * runner's vendor credentials via `printenv > /tmp/x`.
 *
 * Audit blocker H2: previously the child inherited `process.env` wholesale,
 * which leaked `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / refresh tokens.
 *
 * Exported for tests.
 */
const SECRET_VAR_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|BEARER/i;
export function buildHookChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (SECRET_VAR_PATTERN.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Spawn the child and collect bounded stdout/stderr. Always shell:false. */
function runChild(
  argv: string[],
  stdinJson: string,
  timeoutMs: number,
  spawnFn: typeof spawn = spawn
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const [cmd, ...rest] = argv;
    if (!cmd) {
      resolve({ stdout: '', stderr: '', exitCode: null, timedOut: false, error: new Error('empty argv') });
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      // CRITICAL SAFETY: shell:false is mandatory. Do not change this.
      // `detached: true` puts the child in its own process group so we can
      // SIGKILL the whole tree on timeout — without it, a bash wrapper that
      // spawned `sleep` would orphan the sleep and the parent's stdio would
      // stay open until sleep returned.
      child = spawnFn(cmd, rest, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        // H2: hand the child a filtered env so vendor credentials
        // (ANTHROPIC_API_KEY, OPENAI_API_KEY, OAuth tokens, …) never reach
        // a user-approved hook script.
        env: buildHookChildEnv(),
      });
    } catch (err) {
      resolve({ stdout: '', stderr: '', exitCode: null, timedOut: false, error: err as Error });
      return;
    }

    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && typeof child.pid === 'number') {
          // Negative pid → signals the entire process group.
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch { /* noop */ }
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (result: SpawnResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 100).unref?.();
      // Don't wait for stdio to close on stubborn descendants — settle now.
      settle({ stdout, stderr, exitCode: null, timedOut: true });
    }, timeoutMs);
    timer.unref?.();

    if (typeof child.stdout?.setEncoding === 'function') child.stdout.setEncoding('utf8');
    if (typeof child.stderr?.setEncoding === 'function') child.stderr.setEncoding('utf8');
    const onStdout = (chunk: unknown) => {
      if (stdout.length < STREAM_CAPTURE_BYTES * 2) {
        stdout += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      }
    };
    const onStderr = (chunk: unknown) => {
      if (stderr.length < STREAM_CAPTURE_BYTES * 2) {
        stderr += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      }
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);

    child.on('error', (err) => {
      settle({ stdout, stderr, exitCode: null, timedOut, error: err });
    });
    child.on('close', (code) => {
      settle({ stdout, stderr, exitCode: code, timedOut });
    });

    try {
      child.stdin?.write(stdinJson);
      child.stdin?.end();
    } catch (err) {
      // Some children exit before we finish writing — surface but let close() resolve.
      log.debug(`[runner] stdin write failed: ${(err as Error).message}`);
    }
  });
}

/** Scan `s` from `start` for the first balanced JSON top-level object or array
 * (string-aware: skips braces inside JSON string literals). Returns the index
 * AFTER the closing brace, or -1 if no balanced span is found. */
function findFirstBalancedJsonEnd(s: string, start: number): number {
  const open = s[start];
  if (open !== '{' && open !== '[') return -1;
  const closeChar = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = false; continue; }
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === open) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Extract the first complete top-level JSON object/array from raw stdout.
 * This makes parsing resilient to trailing noise — a malicious hook cannot
 * pad stdout past a capture cap to downgrade a `block` decision into a
 * parse-error fail-open. The FIRST valid JSON wins. */
function extractFirstJsonValue(raw: string): unknown | undefined {
  const s = raw ?? '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') {
      const end = findFirstBalancedJsonEnd(s, i);
      if (end < 0) return undefined;
      const slice = s.slice(i, end);
      try {
        return JSON.parse(slice);
      } catch {
        // Imbalanced via string-content; advance past this opener and keep looking.
        continue;
      }
    }
  }
  return undefined;
}

/** Convert raw stdout into a normalised HookResponse, or `null` if no usable shape.
 *
 * Parses the FIRST balanced JSON object/array in stdout and ignores any
 * trailing bytes. This prevents an output-bloat downgrade attack where a
 * chatty hook pads its stdout past the stream cap, corrupting `JSON.parse`
 * of the truncated buffer and forcing the runner into a fail-open allow. */
export function parseHookStdout(stdout: string): HookResponse | null {
  const raw = stdout ?? '';
  if (!raw.trim()) return null;

  const parsed = extractFirstJsonValue(raw);
  if (parsed === undefined) {
    log.warn(`[runner] hook stdout not valid JSON: ${truncate(raw.trim(), 200)}`);
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  // Context injection — used for pre_llm_call equivalents.
  if (typeof obj.context === 'string' && obj.context.trim().length > 0) {
    return { context: obj.context };
  }

  // Hermes canonical: {action, message}
  if (obj.action === 'block' || obj.action === 'allow') {
    const message = typeof obj.message === 'string'
      ? obj.message
      : typeof obj.reason === 'string'
        ? obj.reason
        : undefined;
    return { action: obj.action, ...(message ? { message } : {}) };
  }

  // Claude-Code canonical: {decision, reason}. Real Claude Code emits
  // `'approve' | 'block' | undefined`; we normalise `approve` → `allow`
  // so the action union stays binary downstream.
  if (obj.decision === 'block' || obj.decision === 'allow' || obj.decision === 'approve') {
    const action: 'block' | 'allow' = obj.decision === 'block' ? 'block' : 'allow';
    const message = typeof obj.reason === 'string'
      ? obj.reason
      : typeof obj.message === 'string'
        ? obj.message
        : undefined;
    return { action, ...(message ? { message } : {}) };
  }

  return null;
}

export interface RunShellHookOptions extends ConsentOptions {
  /** Inject spawn for tests. */
  spawnFn?: typeof spawn;
}

/**
 * Resolve consent, spawn the hook, and return a normalised `HookResponse`.
 *
 * Infrastructure failures (timeout, missing binary, malformed stdout, non-zero
 * exit, stderr noise) are logged and surfaced as `{action:"allow"}` — hooks
 * must never crash the host workflow.
 */
export async function runShellHook(
  spec: HookSpec,
  event: HookEvent,
  options: RunShellHookOptions = {}
): Promise<HookResponse> {
  // Resolve via realpath so the spawned argv[0] is the canonical file — a
  // symlink swap will resolve to a different real path (forcing re-consent
  // and breaking the prior allowlist key).
  let argv: string[];
  let scriptPath: string;
  try {
    ({ argv, scriptPath } = await resolveRealScriptPath(spec.command));
  } catch (err) {
    log.warn(`[runner] cannot resolve command (${spec.command}): ${(err as Error).message}`);
    return { action: 'allow', message: 'hook command resolve error (fail-open)' };
  }

  // Hash the script BEFORE consent so we have a baseline to compare against
  // the post-consent re-hash (TOCTOU defence). The consent path also hashes
  // internally — that is fine, we just need to read the same bytes here.
  let preConsentHash: string;
  try {
    preConsentHash = await computeScriptContentHash(scriptPath);
  } catch (err) {
    log.warn(`[runner] cannot hash script (${scriptPath}): ${(err as Error).message}`);
    return { action: 'allow', message: 'hook script read error (fail-open)' };
  }

  // First-use consent (throws HookConsentRequiredError when non-TTY without acceptHooks).
  try {
    const approved = await requestConsent(spec, options);
    if (!approved) {
      log.warn(`[runner] consent declined for event=${spec.event} command=${spec.command}`);
      return { action: 'allow', message: 'hook not allowlisted (fail-open)' };
    }
  } catch (err) {
    // Propagate the typed consent-required error so callers can detect it.
    if ((err as Error).name === 'HookConsentRequiredError') throw err;
    log.warn(`[runner] consent check failed: ${(err as Error).message}`);
    return { action: 'allow', message: 'hook consent error (fail-open)' };
  }

  // TOCTOU defence: re-hash the script content RIGHT BEFORE spawn and refuse
  // if it differs from the pre-consent hash. An attacker with write access to
  // the script who swaps content between consent acceptance and execution will
  // be caught here. Treat mismatch as a refusal — log + fail-open (do not run)
  // and require re-consent on the next call (the allowlist entry was written
  // against the old hash, so the new content won't match the stored entry).
  let postConsentHash: string;
  try {
    postConsentHash = await computeScriptContentHash(scriptPath);
  } catch (err) {
    log.warn(`[runner] post-consent hash failed (${scriptPath}): ${(err as Error).message}`);
    return { action: 'allow', message: 'hook script read error (fail-open)' };
  }
  if (postConsentHash !== preConsentHash) {
    log.warn(
      `[runner] script content changed between consent and execution ` +
        `(event=${spec.event} command=${spec.command} path=${scriptPath}); refusing`
    );
    return {
      action: 'allow',
      message: 'script content changed between consent and execution (TOCTOU); refused',
    };
  }

  const timeoutMs = clampTimeout(spec.timeoutMs);
  const stdin = JSON.stringify(event);

  const result = await runChild(argv, stdin, timeoutMs, options.spawnFn);

  if (result.timedOut) {
    log.warn(
      `[runner] hook timed out after ${timeoutMs}ms ` +
        `(event=${spec.event} command=${spec.command}) stderr=${truncate(result.stderr, 400)}`
    );
    return { action: 'allow', message: `hook timeout after ${timeoutMs}ms` };
  }
  if (result.error) {
    log.warn(
      `[runner] hook spawn error (event=${spec.event} command=${spec.command}): ${result.error.message}`
    );
    return { action: 'allow', message: `hook spawn error: ${result.error.message}` };
  }
  if (result.stderr.trim().length > 0) {
    log.warn(
      `[runner] hook stderr (event=${spec.event} command=${spec.command}): ${truncate(result.stderr, 400)}`
    );
  }
  if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    log.warn(
      `[runner] hook exited ${result.exitCode} (event=${spec.event} command=${spec.command})`
    );
    // Still parse stdout — scripts may signal block via JSON even with non-zero exit.
  }

  const parsed = parseHookStdout(result.stdout);
  if (parsed) return parsed;
  return { action: 'allow' };
}

// Re-export the key types so the handler can import a single module.
export type { HookEvent, HookResponse, HookSpec } from './types.ts';
export { HookConsentRequiredError } from './types.ts';

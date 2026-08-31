/**
 * Shell-hook types — wire protocol shapes for polyglot hook scripts.
 *
 * Ported from NousResearch/hermes-agent (MIT) `agent/shell_hooks.py`. See
 * THIRD_PARTY_NOTICES.md for the full attribution row.
 *
 * Hooks receive a `HookEvent` JSON object on stdin and may emit a `HookResponse`
 * JSON object on stdout. Two wire shapes are accepted on stdout:
 *
 *   Claude-Code canonical:  {"decision": "block" | "allow", "reason"?: string}
 *   Hermes canonical:       {"action":   "block" | "allow", "message"?: string}
 *
 * Context injection (pre_llm_call equivalents): {"context": "..."}.
 *
 * All inbound shapes are normalised to the internal `HookResponse` union so
 * downstream callers never need to branch on wire format.
 */

/** Standard top-level events. Strings keep the wire open for additions
 * without bumping the type. */
export type HookEventName =
  | 'pre_tool_call'
  | 'post_tool_call'
  | 'pre_llm_call'
  | 'session_start'
  | 'session_end'
  | 'notification'
  | (string & {});

/** Payload written to a hook process's stdin. Mirrors the Hermes wire shape. */
export interface HookEvent {
  hook_event_name: HookEventName;
  tool_name?: string;
  tool_input?: unknown;
  session_id: string;
  cwd: string;
  extra?: Record<string, unknown>;
}

/** Normalised hook response — what callers consume after wire parsing. */
export type HookResponse =
  | { action: 'block'; message?: string }
  | { action: 'allow'; message?: string }
  | { context: string };

/** A single configured shell hook. */
export interface HookSpec {
  /** Command line (parsed with shlex-equivalent; argv[0] is the executable). */
  command: string;
  /** Hook event this script is wired to. */
  event: HookEventName;
  /** Per-hook timeout override (ms). Clamped to [1000, 300_000]. */
  timeoutMs?: number;
}

/** Persisted allowlist entry. */
export interface AllowlistEntry {
  event: string;
  /** Absolute, ~-expanded command string exactly as the user configured it. */
  command: string;
  /** Resolved absolute path to argv[0] (script or interpreter). */
  scriptPath: string;
  /** sha256(content of scriptPath) when the entry was approved. */
  scriptContentHash: string;
  /** ISO-8601 timestamp of approval. */
  registeredAt: string;
}

/** Options accepted by the consent/runner public APIs. */
export interface ConsentOptions {
  /** Override TTY detection (mainly for tests). */
  isTTY?: boolean;
  /** Non-TTY caller opt-in (mirrors Hermes `accept_hooks` / env / config). */
  acceptHooks?: boolean;
  /** Override allowlist file path (mainly for tests). */
  allowlistPath?: string;
  /** Override interactive prompt (test injection). */
  promptFn?: (message: string) => Promise<string>;
}

export class HookConsentRequiredError extends Error {
  readonly event: string;
  readonly command: string;
  constructor(event: string, command: string) {
    super(
      `Shell hook for event '${event}' command '${command}' is not allowlisted ` +
        `and the current process is non-interactive. Set acceptHooks=true ` +
        `(--accept-hooks / RUNNEROS_ACCEPT_HOOKS=1 / accept_hooks: true) ` +
        `or approve at the TTY.`
    );
    this.name = 'HookConsentRequiredError';
    this.event = event;
    this.command = command;
  }
}

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 300_000;
/** Minimum timeout. In production this is 1000 ms — a caller passing a tiny
 * value would otherwise get a hook that SIGTERMs itself before stdout drains.
 * Tests opt into the 50 ms floor by setting `NODE_ENV=test` so they can drive
 * the SIGKILL path in <100ms. */
export const MIN_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 50 : 1000;
export const STREAM_CAPTURE_BYTES = 4096;

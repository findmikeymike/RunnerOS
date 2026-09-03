/**
 * Spawn-session isolation hardening.
 *
 * Ported from Hermes `tools/delegate_tool.py` (NousResearch/hermes-agent, MIT
 * license). See `.planning/research/02-subagent-isolation.md` for the line-by-line
 * mapping and the upstream snapshot at `.planning/research/upstream/hermes/`.
 *
 * This module provides four orthogonal mechanisms to harden subagent spawns:
 *   1. SPAWN_SESSION_BLOCKED_TOOLS  — frozen blocklist of RunnerOS tool names
 *      subagents may not invoke (recursive spawn, user-credential prompts,
 *      shared memory writes, cross-platform messaging, code execution).
 *   2. AsyncLocalStorage-scoped approval callback — replaces Hermes'
 *      `threading.local()` pattern. Subagents inherit a per-worker callback
 *      that defaults to deny, so they never block on parent stdin.
 *   3. Spawn-depth gate — `max_spawn_depth` clamped to [1, 3], default 1.
 *      Subagents at the floor cannot spawn further (vertical fork-bomb
 *      protection; horizontal fan-out is not capped — see C1).
 *   4. Source-slug intersection — child `enabledSourceSlugs` is the
 *      intersection of the requested list with the parent's; subagents
 *      cannot reach a source (GitHub, Gmail, MCP server, etc.) the parent
 *      itself doesn't have access to. The blocklist (1) operates at the
 *      tool-name layer and is applied separately at the SDK tool layer.
 *
 * License: MIT (inherited from Hermes upstream). See THIRD_PARTY_NOTICES.md
 * at the repo root for the full attribution.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

// ---------------------------------------------------------------------------
// Blocklist
// ---------------------------------------------------------------------------

/**
 * Tools that subagents may not invoke. Maps Hermes' DELEGATE_BLOCKED_TOOLS to
 * the actual RunnerOS tool names registered in
 * `packages/session-tools-core/src/tool-defs.ts` (see the SESSION_TOOL_DEFS
 * array — the canonical registry). Each entry below cites the registration
 * line where the name is bound.
 *
 * Categories (Hermes → RunnerOS):
 *   - recursive spawn:        `delegate_task` → `spawn_session`
 *   - user prompts (would deadlock parent TUI):
 *       `clarify` → `source_credential_prompt`, `source_oauth_trigger`,
 *       `source_google_oauth_trigger`, `source_slack_oauth_trigger`,
 *       `source_microsoft_oauth_trigger`, `update_user_preferences`
 *   - shared persistent memory writes:
 *       `memory` → `save_memory`, `update_memory`, `forget_memory`
 *   - cross-platform side-effecting messaging:
 *       `send_message` → `send_agent_message`
 *   - arbitrary code execution:
 *       `execute_code` → `script_sandbox`
 */
const ENFORCED_SPAWN_SESSION_BLOCKED_TOOLS = new Set<string>([
    // Recursive spawn (tool-defs.ts:969). The depth gate is the primary
    // defense; this is belt-and-braces in case the depth counter is bypassed.
    'spawn_session',

    // User-prompting / interactive tools — subagents must not block on UI input.
    'source_credential_prompt',         // tool-defs.ts:962
    'source_oauth_trigger',             // tool-defs.ts:958
    'source_google_oauth_trigger',      // tool-defs.ts:959
    'source_slack_oauth_trigger',       // tool-defs.ts:960
    'source_microsoft_oauth_trigger',   // tool-defs.ts:961
    'update_user_preferences',          // tool-defs.ts:963 (writes user prefs; blocks on consent)

    // Shared persistent memory — no writes from subagents (read-only `get_memory`
    // style tools are not blocked because they don't mutate shared state).
    'save_memory',                      // tool-defs.ts (memory family)
    'update_memory',                    // tool-defs.ts (memory family)
    'forget_memory',                    // tool-defs.ts (memory family)

    // Cross-platform messaging — side effects users didn't authorize via subagent.
    'send_agent_message',               // tool-defs.ts (messaging family)
    'supply_work_input',                 // requires a direct artist answer in a visible named-agent chat

    // Arbitrary code execution — force tool-by-tool reasoning.
    'script_sandbox',                   // tool-defs.ts:965
  ]);

export const SPAWN_SESSION_BLOCKED_TOOLS: ReadonlySet<string> = Object.freeze(
  new Set(ENFORCED_SPAWN_SESSION_BLOCKED_TOOLS),
);

/**
 * Filter a list of tool names against the blocklist. Operates at the
 * RunnerOS tool-name layer (see `SPAWN_SESSION_BLOCKED_TOOLS`).
 *
 * Note: this is NOT the right filter for `enabledSourceSlugs` — those are
 * source identifiers (github, gmail, etc.), a different namespace. Use
 * `intersectSourceSlugs` for source-level access control. The blocklist
 * is meant to be applied where SDK tools are registered (the call site in
 * `session-scoped-tools.ts` exposes the full registry — that is the layer
 * where tool names are visible).
 */
export function stripBlockedTools(toolNames: readonly string[]): string[] {
  return toolNames.filter((t) => !ENFORCED_SPAWN_SESSION_BLOCKED_TOOLS.has(t));
}

export function isToolBlockedForDelegatedSession(toolName: string, delegatedSession: boolean): boolean {
  if (!delegatedSession) return false;
  return ENFORCED_SPAWN_SESSION_BLOCKED_TOOLS.has(toolName.replace(/^mcp__session__/, ''));
}

// ---------------------------------------------------------------------------
// Source-slug intersection
// ---------------------------------------------------------------------------

/**
 * Intersect a child's requested source-slug list with its parent's. Source
 * slugs identify *sources* (github, gmail, an MCP server), NOT tool names.
 * This guarantees a subagent cannot reach a source the parent itself does
 * not have access to.
 *
 * Preserves order from `requested`. An empty intersection yields `[]`.
 *
 * IMPORTANT: callers must distinguish "empty allowlist (deny all)" from
 * "no allowlist declared (inherit defaults)". Pass `undefined` for parent
 * when the parent has no explicit allowlist — this function only runs when
 * the parent's allowlist is meaningful. See C6 in the review.
 */
export function intersectSourceSlugs(parent: readonly string[], requested: readonly string[]): string[] {
  if (parent.length === 0 || requested.length === 0) return [];
  const parentSet = new Set(parent);
  return requested.filter((t) => parentSet.has(t));
}

/**
 * @deprecated Renamed to `intersectSourceSlugs`. Kept for backwards
 * compatibility with the original Hermes-port naming; the semantics have
 * not changed. The "toolsets" label was a misnomer — these are source
 * slugs, not tool names. New code should call `intersectSourceSlugs`.
 */
export const intersectToolsets = intersectSourceSlugs;

// ---------------------------------------------------------------------------
// Spawn-depth gate
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SPAWN_DEPTH = 1;
const MIN_SPAWN_DEPTH = 1;
const MAX_SPAWN_DEPTH_CAP = 3;

export interface DelegationConfigShape {
  delegation?: {
    max_spawn_depth?: number;
    subagent_auto_approve?: boolean;
  };
}

/**
 * Resolve the effective `max_spawn_depth`. Default 1; clamped to [1, 3].
 * Out-of-range or non-finite values log a warning and snap into range.
 */
export function getMaxSpawnDepth(config: DelegationConfigShape): number {
  const raw = config.delegation?.max_spawn_depth;
  if (raw === undefined || raw === null) return DEFAULT_MAX_SPAWN_DEPTH;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    console.warn(
      `[spawn-session-isolation] delegation.max_spawn_depth=${String(raw)} is not a finite number; using default ${DEFAULT_MAX_SPAWN_DEPTH}.`,
    );
    return DEFAULT_MAX_SPAWN_DEPTH;
  }
  const floored = Math.floor(raw);
  const clamped = Math.max(MIN_SPAWN_DEPTH, Math.min(MAX_SPAWN_DEPTH_CAP, floored));
  if (clamped !== floored) {
    console.warn(
      `[spawn-session-isolation] delegation.max_spawn_depth=${raw} out of range [${MIN_SPAWN_DEPTH}, ${MAX_SPAWN_DEPTH_CAP}]; clamping to ${clamped}.`,
    );
  }
  return clamped;
}

/**
 * Return true if a spawn attempt at `currentDepth` should be rejected.
 * A subagent at the floor (`currentDepth >= maxDepth`) is a leaf and cannot
 * spawn further.
 */
export function shouldRejectSpawn(currentDepth: number, maxDepth: number): boolean {
  return currentDepth >= maxDepth;
}

// ---------------------------------------------------------------------------
// Approval callbacks
// ---------------------------------------------------------------------------

export type ApprovalDecision = 'deny' | 'once';

export interface ApprovalArgs {
  command: string;
  description: string;
}

export type ApprovalCallback = (args: ApprovalArgs) => ApprovalDecision;

/** Default subagent callback — never asks the user; always denies. */
export const subagentAutoDeny: ApprovalCallback = ({ command, description }) => {
  console.warn(
    `[spawn-session-isolation] Subagent auto-denied dangerous command: ${command} (${description}). ` +
      `Set delegation.subagent_auto_approve: true to allow.`,
  );
  return 'deny';
};

/** Opt-in subagent callback — approves once and logs an audit warning. */
export const subagentAutoApprove: ApprovalCallback = ({ command, description }) => {
  console.warn(
    `[spawn-session-isolation] Subagent auto-approved dangerous command (audit): ${command} (${description}).`,
  );
  return 'once';
};

/**
 * Build the approval callback to install into a subagent's AsyncLocalStorage
 * scope. Default is `subagentAutoDeny`; opt-in `subagent_auto_approve: true`
 * returns `subagentAutoApprove`. The callback is selected once at spawn time
 * and propagated through the subagent's async chain.
 */
export function createIsolatedApprovalCallback(config: DelegationConfigShape): ApprovalCallback {
  return config.delegation?.subagent_auto_approve === true ? subagentAutoApprove : subagentAutoDeny;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage scopes
// ---------------------------------------------------------------------------

/**
 * Per-async-scope approval callback. Replaces Hermes' `threading.local()`.
 * Subagent runs are wrapped in `approvalCallbackStorage.run(cb, fn)` so the
 * subagent reads its own callback rather than the parent's stdin-bound one.
 */
export const approvalCallbackStorage = new AsyncLocalStorage<ApprovalCallback>();

/**
 * Per-async-scope spawn depth. Parent default is 0; each subagent runs inside
 * `spawnDepthStorage.run(parentDepth + 1, fn)`.
 */
export const spawnDepthStorage = new AsyncLocalStorage<number>();

/** Run `fn` with `cb` installed as the active subagent approval callback. */
export function runWithSubagentApproval<T>(cb: ApprovalCallback, fn: () => Promise<T>): Promise<T> {
  return approvalCallbackStorage.run(cb, fn);
}

/** Read the current depth from AsyncLocalStorage, defaulting to 0 (root parent). */
export function getCurrentSpawnDepth(): number {
  return spawnDepthStorage.getStore() ?? 0;
}

// ---------------------------------------------------------------------------
// Refusal payload
// ---------------------------------------------------------------------------

export interface SubagentRefusalPayload {
  error: string;
  refusal: true;
}

/**
 * Build a refusal payload for a subagent that attempted to invoke a blocked
 * tool or exceeded the spawn-depth gate. The payload is returned, never
 * thrown — the subagent receives it as a tool result and can react to it.
 */
export function buildSubagentRefusalPayload(toolName: string): SubagentRefusalPayload {
  return {
    error: `Subagent cannot invoke blocked tool: ${toolName}`,
    refusal: true,
  };
}

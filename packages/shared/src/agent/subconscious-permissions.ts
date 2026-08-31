/**
 * Subconscious-mode permission evaluator.
 *
 * Concept-only re-implementation from OpenHuman (GPL-3.0) — NO source code
 * copied. Behavior derived from `.planning/research/04-openhuman-concepts.md`
 * §Upgrade 5 ("Subconscious Mode — Unapproved Write Detection") and SPEC §R7.
 *
 * This module is intentionally separate from
 * `packages/shared/src/agent/permissions-config.ts` (which manages Safe-Mode
 * bash/MCP allow-lists) and from `packages/shared/src/agent/mode-types.ts`
 * (which defines the per-workspace `PermissionMode` of `safe | ask | allow-all`).
 *
 * The mode union here is the *trigger-level* permission-mode hint already
 * plumbed by R5/01-06 in `packages/shared/src/workflows/trigger-inputs.ts`:
 *   `"default" | "subconscious" | "yolo"`
 *
 * `evaluateWriteAttempt` is the policy dispatch table that maps that hint
 * onto one of three runtime actions:
 *   - "allow"    — pass straight through to the tool dispatcher
 *   - "deny"     — short-circuit with the existing Safe-Mode denial
 *   - "escalate" — pause the run, create an Escalation, await approve/reject
 */

import type { TriggerPermissionMode } from '../workflows/trigger-inputs.ts';

// ---------------------------------------------------------------------------
// Mode normalization (DSL aliases)
// ---------------------------------------------------------------------------

/**
 * Internal canonical permission-mode union for the subconscious gate.
 * Mirrors the trigger-level union — re-exported here so the agent layer
 * doesn't have to reach into `../workflows/...` for the type.
 */
export type SubconsciousMode = TriggerPermissionMode;

/**
 * Automation DSL alias resolver. The user-facing DSL allows the
 * string `"escalate-on-write"` as a synonym for `"subconscious"` so the
 * SPEC-level vocabulary (R7) matches the field set without breaking the
 * trigger-level union already in production from R5.
 */
export function normalizeSubconsciousMode(raw: string): SubconsciousMode | null {
  const v = raw.trim().toLowerCase();
  if (v === 'default') return 'default';
  if (v === 'yolo') return 'yolo';
  if (v === 'subconscious' || v === 'escalate-on-write') return 'subconscious';
  return null;
}

// ---------------------------------------------------------------------------
// Write-tool classification
// ---------------------------------------------------------------------------

/**
 * Tool names known to perform writes. Retained for documentation and for
 * tests/callers that want to explicitly assert "yes, this is a write tool"
 * by name. As of the 01-07 cold-review follow-up the classifier no longer
 * uses this list as a positive signal — the default flipped to "unknown
 * tool = write, escalate" (see `READ_TOOL_NAMES` below). This list is
 * still useful as inline documentation of well-known writes and as a
 * fast-path skip for the read-allow-list lookup.
 *
 * Frozen to prevent accidental mutation by callers.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    'Write',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
    // RunnerOS session-scoped writes
    'save_memory',
    'update_memory',
    'forget_memory',
    'update_user_preferences',
    // Cross-platform mutations
    'send_agent_message',
    // Code execution (treated as write because side-effects)
    'script_sandbox',
  ]),
);

/**
 * Read-only tool allow-list. Anything here is assumed safe (no side effects)
 * and short-circuits to `isWriteTool = false`. Anything NOT in this list
 * AND NOT matched by a read-only prefix below is classified as a write and
 * will be escalated in subconscious mode.
 *
 * Rationale (01-07 cold-review follow-up): the previous classifier defaulted
 * unknown tools to "read" which silently broke the SPEC §R7 guarantee
 * ("writes pause") whenever a new write tool shipped without classifier-list
 * maintenance. Flipping the default to "escalate" makes the safety property
 * monotone — adding a new tool can never regress the gate, only false-
 * positive in subconscious mode (which the user can resolve in one click).
 */
const READ_TOOL_NAMES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    // Core read tools (Claude / Anthropic SDK conventions)
    'Read',
    'Glob',
    'Grep',
    'WebFetch',
    'WebSearch',
    // RunnerOS session-scoped reads
    'recall_memory',
    'list_memory',
    'session_context',
    // Skill / docs / prerequisite reads (no side effects)
    'list_skills',
    'load_skill',
    'read_skill',
    // Listing / search variants
    'list_files',
    'search_files',
    'find_files',
    // Get/query metadata tools commonly exposed by MCP servers
    'get_diagnostics',
    'get_status',
  ]),
);

/**
 * Read-only tool name prefixes. Conservative — anything matching is
 * considered a read. MCP tools (`mcp__*`) intentionally do NOT match: they
 * can perform arbitrary writes via vendor APIs and must be reviewed per
 * source. A future enhancement could narrow by HTTP method (GET → read);
 * out of scope here.
 */
const READ_TOOL_PREFIXES: readonly string[] = [
  'read_',
  'list_',
  'get_',
  'query_',
  'search_',
  'find_',
  'fetch_',
  'describe_',
  'inspect_',
];

/**
 * Treats a Bash command as a write if it starts with a write-style verb.
 * Coarse on purpose — the real Safe-Mode allow-list pattern check still
 * runs upstream; this is just the "should we even bother to escalate"
 * preflight. Kept here for compatibility / explainability even though the
 * default for Bash is now "write" when the command can't be classified.
 */
const BASH_WRITE_VERBS: readonly RegExp[] = [
  /^\s*(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|ln)\b/,
  /^\s*git\s+(commit|push|reset|rebase|merge|checkout|branch|tag|stash)\b/,
  /^\s*npm\s+(install|publish|update|uninstall)\b/,
  /^\s*bun\s+(install|publish|add|remove)\b/,
  /^\s*(curl|wget)\b.*\s-X\s+(POST|PUT|PATCH|DELETE)\b/i,
];

/**
 * Bash commands recognized as read-only. When a Bash command matches one of
 * these patterns we short-circuit to `isWriteTool = false`. Anything else
 * defaults to "write" — safer than the previous "default read".
 */
const BASH_READ_VERBS: readonly RegExp[] = [
  /^\s*(ls|cat|head|tail|less|more|wc|file|stat|find|grep|rg|fd|du|df|ps|env|printenv|pwd|which|whereis|whoami|date|uname|history|tree)\b/,
  /^\s*git\s+(status|log|diff|show|branch\s*$|branch\s+-l|branch\s+--list|remote\s+-v|config\s+--get|describe|blame|ls-files|rev-parse|tag\s*$|tag\s+-l|tag\s+--list|fetch\s+--dry-run)\b/,
  /^\s*echo\b/,
  /^\s*(npm|bun|yarn|pnpm)\s+(list|ls|outdated|view|info|why|run\s+-l|run\s+--list)\b/,
];

/**
 * Heuristic: is this tool call a write?
 *
 * Rules (in order, safer-by-default since 01-07 follow-up):
 *  1. Bash → match against `BASH_READ_VERBS`; matches return false,
 *     everything else returns true (escalate-by-default).
 *  2. Exact match in `READ_TOOL_NAMES` → read (false).
 *  3. Match against any prefix in `READ_TOOL_PREFIXES` → read (false).
 *  4. Otherwise → WRITE (true) — escalate-by-default.
 *
 * This is the inverse of the previous allow-the-rest classifier. The SPEC
 * §R7 contract ("writes pause") is now monotone: adding a new tool cannot
 * regress the gate.
 */
export function isWriteTool(toolName: string, args?: unknown): boolean {
  // Bash — classify by command verb.
  if (toolName === 'Bash') {
    if (!args || typeof args !== 'object') return true;
    const command = (args as { command?: unknown }).command;
    if (typeof command !== 'string') return true;
    for (const rx of BASH_READ_VERBS) {
      if (rx.test(command)) return false;
    }
    // Explicit write verbs are obviously writes; everything else is
    // ALSO classified as write under the new default.
    for (const rx of BASH_WRITE_VERBS) {
      if (rx.test(command)) return true;
    }
    return true;
  }

  // Exact allow-list of reads.
  if (READ_TOOL_NAMES.has(toolName)) return false;

  // Prefix allow-list of reads.
  for (const prefix of READ_TOOL_PREFIXES) {
    if (toolName.startsWith(prefix)) return false;
  }

  // Default: write. Escalate-on-write contract is preserved even when a new
  // tool ships without classifier-list maintenance.
  return true;
}

// ---------------------------------------------------------------------------
// Policy dispatch
// ---------------------------------------------------------------------------

export type WritePolicyDecision = 'allow' | 'deny' | 'escalate';

/**
 * Decide what to do with a tool call given the subconscious mode.
 *
 *   default      → reads allowed, writes follow the workspace policy ("allow"
 *                  here means "let the workspace policy decide"; callers
 *                  must still consult Safe-Mode for actual gating).
 *   subconscious → reads allowed, writes → "escalate".
 *   yolo         → everything → "allow" (operator-acknowledged risk).
 *
 * "subconscious" is the only mode that ever returns "escalate". The
 * dispatch table is intentionally tiny — extension points live in
 * `isWriteTool`.
 */
export function evaluateWriteAttempt(
  mode: SubconsciousMode,
  toolName: string,
  args?: unknown,
): WritePolicyDecision {
  if (mode === 'yolo') return 'allow';

  const isWrite = isWriteTool(toolName, args);
  if (!isWrite) return 'allow';

  if (mode === 'subconscious') return 'escalate';
  // mode === 'default'
  return 'allow';
}

// ---------------------------------------------------------------------------
// Recommendation extraction
// ---------------------------------------------------------------------------

const RECOMMENDED_ACTION_MARKER = /RECOMMENDED\s+ACTION\s*:\s*(.+)$/is;

/**
 * Best-effort recommendation string for the escalation card.
 *
 * Strategy:
 *  1. If `assistantText` contains the OpenHuman-style "RECOMMENDED ACTION:"
 *     marker, return the text from the marker onward (trimmed). Matches
 *     the research note pattern so prompts that opt-in to the marker work
 *     without further plumbing.
 *  2. Otherwise, format the proposed tool call as
 *     `${toolName}(${truncated JSON args})`. Kept short so a notification
 *     surface can show it inline.
 */
export function extractRecommendation(args: {
  assistantText?: string;
  toolName: string;
  toolArgs: unknown;
}): string {
  const { assistantText, toolName, toolArgs } = args;

  if (assistantText) {
    const m = assistantText.match(RECOMMENDED_ACTION_MARKER);
    if (m && m[1]) {
      return m[1].trim();
    }
  }

  let argsStr: string;
  try {
    argsStr = JSON.stringify(toolArgs);
  } catch {
    argsStr = '<unserializable>';
  }
  if (argsStr.length > 240) {
    argsStr = `${argsStr.slice(0, 237)}...`;
  }
  return `${toolName}(${argsStr})`;
}

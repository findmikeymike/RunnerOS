/**
 * Subconscious-mode coordinator: gates write-tool attempts, persists
 * pending approvals via the escalation store, and pauses/resumes the
 * caller via an awaitable promise keyed by escalation id.
 *
 * Concept-only re-implementation from OpenHuman (GPL-3.0) — NO source code
 * copied. Behavior derived from `.planning/research/04-openhuman-concepts.md`
 * §Upgrade 5 and SPEC §R7.
 *
 * Surface:
 *   - `gateWriteAttempt({ mode, toolName, args, workflowRunId, ... })`
 *     → returns a `WriteAttemptOutcome`. In `subconscious` mode and on a
 *       detected write, the outcome is `{ kind: "escalated", ... }` after
 *       the store row is created, a notification is fired, and the caller
 *       has awaited approve/reject.
 *
 *   - `subscribeToEscalations(listener)` — passes through to the store.
 *
 *   - `resolveSubconsciousAlias(rawMode)` — DSL alias normalizer.
 *
 * The coordinator owns a module-level `Map<escalationId, deferred>` and
 * wires a single subscription to the store on first use, so external
 * `approveEscalation` / `rejectEscalation` calls (which flip the row) are
 * mirrored into resolved promises here.
 */

import { createLogger } from '../utils/debug.ts';
import {
  type Escalation,
  type EscalationStore,
  type EscalationToolCall,
  getEscalationStore,
} from './escalation-store.ts';
import {
  evaluateWriteAttempt,
  extractRecommendation,
  normalizeSubconsciousMode,
  type SubconsciousMode,
  type WritePolicyDecision,
} from './subconscious-permissions.ts';

const log = createLogger('subconscious-mode');

// ---------------------------------------------------------------------------
// Outcome shape (matches SPEC §R7 — `UnapprovedWrite { recommendation, duration_ms }`)
// ---------------------------------------------------------------------------

export type WriteAttemptOutcome =
  | { kind: 'executed'; result: unknown; durationMs: number }
  | { kind: 'denied'; reason: string; escalationId?: string; durationMs?: number }
  | {
      kind: 'escalated';
      escalationId: string;
      recommendation: string;
      duration_ms: number;
      // Provided when the user later approves: the call should be replayed.
      replay?: { toolCall: EscalationToolCall };
    };

// ---------------------------------------------------------------------------
// Notification event shape
// ---------------------------------------------------------------------------

export interface EscalationNotification {
  type: 'escalation:created';
  escalation: Escalation;
}

/**
 * Pluggable notification sink. Defaults to a no-op — wire to the EventBus
 * (or any structured notification surface) at bootstrap. We avoid hard-
 * coupling to `automations/event-bus` here because `agent/` is layered
 * below `automations/` and importing upward would create a cycle.
 */
export type NotifyEscalation = (event: EscalationNotification) => void;

let notifySink: NotifyEscalation = () => {
  /* default no-op */
};

export function setEscalationNotifier(fn: NotifyEscalation | null): void {
  notifySink = fn ?? (() => {});
}

// ---------------------------------------------------------------------------
// Pending pause/resume map
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (escalation: Escalation) => void;
  reject: (err: unknown) => void;
}

const pending = new Map<string, Pending>();
let storeUnsubscribe: (() => void) | null = null;

function ensureStoreSubscription(store: EscalationStore): void {
  if (storeUnsubscribe) return;
  storeUnsubscribe = store.subscribe((e) => {
    if (e.status === 'pending') return;
    const slot = pending.get(e.id);
    if (slot) {
      pending.delete(e.id);
      slot.resolve(e);
    }
  });
}

/** Test-only: wipe in-flight pause map + store subscription. */
export function _resetSubconsciousModeForTests(): void {
  if (storeUnsubscribe) {
    storeUnsubscribe();
    storeUnsubscribe = null;
  }
  for (const slot of pending.values()) {
    try {
      slot.reject(new Error('Subconscious mode reset for tests'));
    } catch {
      /* swallow */
    }
  }
  pending.clear();
  notifySink = () => {};
}

// ---------------------------------------------------------------------------
// Public alias resolver
// ---------------------------------------------------------------------------

export function resolveSubconsciousAlias(raw: string): SubconsciousMode | null {
  return normalizeSubconsciousMode(raw);
}

// ---------------------------------------------------------------------------
// Gate entry point
// ---------------------------------------------------------------------------

export interface GateWriteAttemptInput {
  mode: SubconsciousMode;
  toolName: string;
  args: unknown;
  /** Workflow run id (escalation pause anchor). */
  workflowRunId: string;
  /** Optional task / step id for the escalation row. */
  taskId?: string;
  /** Optional last-assistant text (used by recommendation marker scan). */
  assistantText?: string;
  /**
   * The actual tool execution. Invoked when the policy says "allow" and,
   * after user approval, when the escalation is approved.
   */
  execute: () => Promise<unknown> | unknown;
  /**
   * Store override (tests). Defaults to the process singleton.
   */
  store?: EscalationStore;
}

/**
 * Gate a single write attempt. Returns a `WriteAttemptOutcome`. Caller
 * should treat:
 *   - `executed` → forward `result` to the agent
 *   - `denied`   → return a tool-denied result to the agent
 *   - `escalated` with `replay` → replay the tool with full permissions
 *   - `escalated` without `replay` → return a "user denied" to the agent
 */
export async function gateWriteAttempt(
  input: GateWriteAttemptInput,
): Promise<WriteAttemptOutcome> {
  const {
    mode,
    toolName,
    args,
    workflowRunId,
    taskId,
    assistantText,
    execute,
    store: providedStore,
  } = input;

  const decision: WritePolicyDecision = evaluateWriteAttempt(mode, toolName, args);

  if (decision === 'allow') {
    const t0 = Date.now();
    try {
      const result = await execute();
      return { kind: 'executed', result, durationMs: Date.now() - t0 };
    } catch (err) {
      return {
        kind: 'denied',
        reason: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      };
    }
  }

  if (decision === 'deny') {
    return {
      kind: 'denied',
      reason: `Write tool "${toolName}" is not permitted under permission_mode="${mode}".`,
    };
  }

  // decision === 'escalate' — subconscious path.
  const store = providedStore ?? getEscalationStore();
  ensureStoreSubscription(store);

  const t0 = Date.now();
  const recommendation = extractRecommendation({
    assistantText,
    toolName,
    toolArgs: args,
  });

  const escalation = store.create({
    workflowRunId,
    taskId,
    recommendation,
    toolCall: { name: toolName, args },
    durationMs: 0,
  });

  // Fire notification (best-effort; never throws into caller).
  try {
    notifySink({ type: 'escalation:created', escalation });
  } catch (err) {
    log.warn(
      `[subconscious] notification sink threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Await user decision.
  const resolved = await new Promise<Escalation>((resolve, reject) => {
    pending.set(escalation.id, { resolve, reject });
  });
  const durationMs = Date.now() - t0;

  if (resolved.status === 'approved') {
    // Replay path: execute the tool with full permissions.
    try {
      const result = await execute();
      return { kind: 'executed', result, durationMs };
    } catch (err) {
      return {
        kind: 'denied',
        reason: err instanceof Error ? err.message : String(err),
        escalationId: escalation.id,
        durationMs,
      };
    }
  }

  // Rejected.
  return {
    kind: 'denied',
    reason: `User rejected escalation ${escalation.id} for tool "${toolName}".`,
    escalationId: escalation.id,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience (so callers can import everything from here)
// ---------------------------------------------------------------------------

export {
  approveEscalation,
  rejectEscalation,
  createEscalation,
  listPendingEscalations,
  getEscalation,
  type Escalation,
  type EscalationStatus,
  type EscalationToolCall,
} from './escalation-store.ts';

export {
  evaluateWriteAttempt,
  isWriteTool,
  WRITE_TOOL_NAMES,
  normalizeSubconsciousMode,
  type SubconsciousMode,
  type WritePolicyDecision,
} from './subconscious-permissions.ts';

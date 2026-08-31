/**
 * Bridges internal RunnerOS agent events to ACP session notifications.
 *
 * Ported from Hermes hermes_acp/events.py (MIT).
 *   - safe_schedule_threadsafe → safeScheduleAcross
 *   - make_tool_progress_cb   → makeToolProgressCb
 *   - make_step_cb            → makeStepCb
 *   - make_thinking_cb        → makeThinkingCb
 *   - make_message_cb         → makeMessageCb
 *   - _build_plan_update_from_todo_result → buildPlanUpdateFromTodoResult
 *
 * Worker-thread agent emits → main-loop ACP server receives. The TS port
 * uses async queues + setImmediate rather than Python threads since the
 * agent runner is typically already async in this codebase.
 *
 * See THIRD_PARTY_NOTICES.md for license attribution.
 */

import type {
  AgentMessageText,
  AgentPlanUpdate,
  AgentThoughtText,
  PlanEntry,
  SessionId,
  SessionUpdate,
  ToolCallStart,
  ToolCallProgress,
} from './types.ts';
import { buildToolComplete, buildToolStart, jsonLoadsMaybe, makeToolCallId } from './tools.ts';

export type SessionUpdateSender = (sessionId: SessionId, update: SessionUpdate) => Promise<void>;

/**
 * Schedule a callback on the current event loop with a 5s timeout.
 *
 * Named for parity with Hermes's `safe_schedule_threadsafe`, but Node's
 * single-loop model makes this a deferred callback — there are no
 * cross-thread guarantees in this runtime. Concretely:
 *
 *   1. `workerCallback` is invoked via `Promise.resolve().then(...)`.
 *   2. Its resolved value is handed to `mainLoopHandler` after a
 *      `setImmediate` tick.
 *   3. Errors at any stage are logged to stderr and swallowed; the timeout
 *      (default 5s) resolves the outer promise with `null`.
 *
 * If RunnerOS ever moves the agent runner onto `worker_threads`, this
 * function would need to grow real cross-thread semantics. Today it's a
 * microtask-then-setImmediate hop on a single loop.
 */
export function safeScheduleAcross<T>(
  workerCallback: () => Promise<T> | T,
  mainLoopHandler: (value: T) => Promise<void> | void,
  timeoutMs = 5000,
): Promise<T | null> {
  return new Promise<T | null>((res) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.error('[acp] safeScheduleAcross: timeout');
      res(null);
    }, timeoutMs);

    Promise.resolve()
      .then(() => workerCallback())
      .then(
        (value) =>
          new Promise<T>((r) => {
            setImmediate(() => {
              Promise.resolve(mainLoopHandler(value))
                .catch((err) => {
                  console.error('[acp] safeScheduleAcross handler error:', err);
                })
                .finally(() => r(value));
            });
          }),
      )
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        res(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error('[acp] safeScheduleAcross worker error:', err);
        res(null);
      });
  });
}

// ---------- Tool-call FIFO id tracking ----------

export interface ToolCallTracker {
  /** Pending tool-call IDs queued FIFO per tool name. */
  ids: Map<string, string[]>;
  /** Metadata captured at start, popped at completion. */
  meta: Map<string, { args: Record<string, unknown>; snapshot?: unknown }>;
}

export function createToolCallTracker(): ToolCallTracker {
  return { ids: new Map(), meta: new Map() };
}

// ---------- Callback factories ----------

export function makeToolProgressCb(
  send: SessionUpdateSender,
  sessionId: SessionId,
  tracker: ToolCallTracker,
): (event: { eventType: string; name: string; args?: unknown }) => void {
  return (event) => {
    if (event.eventType !== 'tool.started') return;
    let args: Record<string, unknown> = {};
    if (typeof event.args === 'string') {
      try {
        args = JSON.parse(event.args) as Record<string, unknown>;
      } catch {
        args = { raw: event.args };
      }
    } else if (event.args && typeof event.args === 'object') {
      args = event.args as Record<string, unknown>;
    }

    const tcId = makeToolCallId();
    const queue = tracker.ids.get(event.name) ?? [];
    queue.push(tcId);
    tracker.ids.set(event.name, queue);
    tracker.meta.set(tcId, { args });

    const update: ToolCallStart = buildToolStart(tcId, event.name, args);
    void safeScheduleAcross(
      () => undefined,
      () => send(sessionId, update),
    );
  };
}

export function makeStepCb(
  send: SessionUpdateSender,
  sessionId: SessionId,
  tracker: ToolCallTracker,
): (info: { name: string; result?: unknown; args?: Record<string, unknown> }) => void {
  return (info) => {
    const queue = tracker.ids.get(info.name);
    if (!queue || queue.length === 0) return;
    const tcId = queue.shift()!;
    if (queue.length === 0) tracker.ids.delete(info.name);
    const meta = tracker.meta.get(tcId);
    tracker.meta.delete(tcId);
    const result = info.result === undefined || info.result === null ? null : String(info.result);
    const update: ToolCallProgress = buildToolComplete(
      tcId,
      info.name,
      result,
      info.args ?? meta?.args,
      meta?.snapshot,
    );
    void safeScheduleAcross(
      () => undefined,
      () => send(sessionId, update),
    );

    if (info.name === 'todo') {
      const planUpdate = buildPlanUpdateFromTodoResult(result);
      if (planUpdate) {
        void safeScheduleAcross(
          () => undefined,
          () => send(sessionId, planUpdate),
        );
      }
    }
  };
}

export function makeThinkingCb(
  send: SessionUpdateSender,
  sessionId: SessionId,
): (text: string) => void {
  return (text) => {
    if (!text) return;
    const update: AgentThoughtText = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text },
    };
    void safeScheduleAcross(
      () => undefined,
      () => send(sessionId, update),
    );
  };
}

export function makeMessageCb(
  send: SessionUpdateSender,
  sessionId: SessionId,
): (text: string) => void {
  return (text) => {
    if (!text) return;
    const update: AgentMessageText = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    };
    void safeScheduleAcross(
      () => undefined,
      () => send(sessionId, update),
    );
  };
}

// ---------- Plan update from todo tool ----------

export function buildPlanUpdateFromTodoResult(result: string | null): AgentPlanUpdate | null {
  if (!result || !result.trim()) return null;
  let data: unknown;
  try {
    data = jsonLoadsMaybe(result);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { todos?: unknown }).todos)) {
    return null;
  }
  const todos = (data as { todos: unknown[] }).todos;
  if (todos.length === 0) {
    return { sessionUpdate: 'plan', entries: [] };
  }

  const statusMap: Record<string, PlanEntry['status']> = {
    pending: 'pending',
    in_progress: 'in_progress',
    completed: 'completed',
    cancelled: 'completed',
  };
  const entries: PlanEntry[] = [];
  for (const item of todos) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    let content = String(rec.content ?? rec.id ?? '').trim();
    if (!content) continue;
    const rawStatus = String(rec.status ?? 'pending').trim();
    const status = statusMap[rawStatus] ?? 'pending';
    if (rawStatus === 'cancelled') content = `[cancelled] ${content}`;
    entries.push({ content, priority: 'medium', status });
  }
  return { sessionUpdate: 'plan', entries };
}

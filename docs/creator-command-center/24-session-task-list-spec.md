---
status: proposed
owner: agent
last_verified: 2026-08-30
source_of_truth: true
related: ./22-chat-native-goal-mode-spec.md, ./21-bounded-goal-continuation-driver-spec.md
---

# Session Task List And Delegation Return Path

## Purpose

Artist OS agents already work across many turns. Goal Mode decides *whether* to keep going. Nothing decides *what remains*.

This specification adds one host-owned, provider-neutral task list per session, and closes the one remaining break in the delegation loop: a parent session is told when a background specialist finishes, but is never woken to act on it.

Two features, one specification, because they are the same design. A task list whose delegated items can never be resolved is worse than no task list at all.

## User Promise

When an agent takes on multi-step work, the user sees the plan: what is done, what is in progress, what remains. The list survives restart, compaction, and provider choice. It looks and behaves the same whether the session runs on Claude, GPT, or a local model.

When the agent hands work to a specialist, the user sees which item is delegated and to whom. When the specialist finishes, the parent picks the thread back up on its own rather than waiting for the user to nudge it.

An agent cannot claim completion while its own plan still has unfinished items.

## Non-Goals

- No dependency graph, no DAG, no cross-session task tree. Scheduled Work already owns durable multi-agent orchestration.
- No task list that spans sessions. See Core Laws.
- No replacement for Workflows. A workflow is already a cross-step plan.
- No new delegation mechanism. This specification adds a wake signal to the delegation path that already exists.
- No user-authored task lists in V1. The list is the agent's working plan, not a project management surface.
- No automatic decomposition via a secondary model call in V1.
- No permission escalation. Task state is metadata and carries no side-effect authority.

## Current State

This section records what the codebase does today, verified at `last_verified`. It exists because the first draft of this design was written against an incorrect assumption, and the correction changed the scope substantially.

### Task lists

There is no task list primitive. There is a *rendering* of one, for Claude sessions only:

- `packages/ui/src/components/chat/turn-utils.ts` extracts todos from completed `TodoWrite` tool calls and returns the latest state.
- `TurnCard.tsx` renders that as a checklist.
- `SessionManager.ts` maps the tool to the label `Update Todos`.

Three limits follow from the implementation:

1. **Per-turn.** `currentTurn.todos = extractTodosFromActivities(currentTurn.activities)` derives the list from a single turn's activities. Across a six-round Goal run the user sees six disconnected lists, not one evolving plan.
2. **Display-only.** The list is a UI projection. The agent cannot read it back, and Goal Mode's completion audit cannot see it.
3. **Claude-only.** Every non-Anthropic session has no task list at all.

There are two provider types and they differ, which matters for the gating in Slice 3:

- `ModelProvider = 'anthropic' | 'pi'` — `packages/shared/src/config/models.ts:54`, model-level
- `LlmProviderType = 'anthropic' | 'pi' | 'pi_compat'` — `packages/shared/src/config/llm-connections.ts:51`, connection-level

The gate must be written as "not `anthropic`" rather than as an allowlist of `'pi'`, or `pi_compat` sessions silently miss registration. Do not gate on `openai` / `openai-compat`; those are legacy `LlmConnectionType` values the runtime has migrated away from, and the current runtime distinguishes backends by `piAuthProvider`.

There is also a per-*session* status (`todo | in-progress | needs-review | done | cancelled`) with a `set_session_status` tool. That is cross-session kanban and is unrelated to intra-session planning.

### Delegation

Two mechanisms exist, with different contracts:

**`spawn_session`** creates an independent session. Its own tool description states it "runs fire-and-forget." `parentSessionId` is recorded for lineage. There is no receipt and no notification. This is intentional and remains so.

**`message_agent`** delegates a bounded task to a saved agent in a hidden child session. It is **blocking by default**; `background: true` opts out. It is bounded by `DEFAULT_MAX_DEPTH` and, inside workflow steps, by `maxAgentMessages`. It writes a durable receipt (`list_agent_message_receipts` exposes receipt id, child session id, status, summary, tools, errors).

For background delegations, `AgentMessageService.notifyBackgroundParent` already fires on child completion and calls `deliverPassiveMessage`. `SessionManager.deliverPassiveAgentMessage` appends a durable `role: 'info'` message with `displayIntent: 'agent-message-passive'`, persists, flushes, and emits a `user_message` event.

The notice metadata (`AgentMessageNoticeMetadata`) carries exactly four fields:

```ts
{ receiptId, childSessionId, targetAgentSlug, status }
```

Summary and error text are rendered into the message *body*, not the metadata. Wake classification must therefore read `agentMessage.status` — there is no `summary` or `error` field on the metadata object to inspect.

**The delegation return path therefore exists and is durable.** An earlier draft of this design claimed it did not. That claim was wrong and is corrected here.

## The Gap

There are two defects, not one. The second is the harder of the pair and was missed in the first draft of this specification.

### Gap 1 — the notice does not wake the parent

`deliverPassiveAgentMessage` appends a message. It does not start a turn.

It does not call `sendMessage`, does not set processing state, and does not inform the Goal continuation driver. The notice becomes context for the *next* turn, whenever one happens to occur.

Consequences:

- An idle parent session holds a completed specialist result that nobody reads until the user types something.
- A parent whose Goal has paused stays paused. Child completion is not a resume trigger.
- A parent whose Goal is active only sees the result if a round happens for some other reason.
- With the completion enforcer proposed below, a delegated task item would never resolve, and the session would refuse to complete forever.

### Gap 2 — the server does not own the background boundary lifecycle

A wake protocol is incomplete unless the server owns the boundary it is waiting on.

`hasPendingBackgroundWork` is derived from message state:

```ts
managed.messages.some(m => m.role === 'tool' && m.toolStatus === 'backgrounded')
```

It is read at two places, and both are Goal gates:

- `SessionManager.ts:11219` — feeds `hasUnresolvedBoundary` in the settle path, producing a `waiting-external` pause
- `SessionManager.ts:8704` — blocks `resumeChatGoal`

Implementation of Slice 0 found that the original analysis was incomplete: `toolStatus: 'backgrounded'` was only applied by the renderer for generic SDK Task events. The server forwarded those events without mutating its authoritative messages, and a background `message_agent` result was stored as `completed`. Goal Mode therefore saw no boundary and could continue while the delegated child was still running.

Slice 0 establishes the complete server-owned lifecycle. A trusted background `message_agent` result persists its exact `receiptId` and marks the originating tool message `backgrounded`. A terminal passive notice clears that same message to `completed` or `error` before persistence. If the child finishes before the starting tool result arrives, the stored terminal notice wins and the later result cannot reopen the boundary.

Without both halves, behavior fails in opposite directions: no starting boundary permits premature continuation; a starting boundary without terminal clearing blocks both continuation entry paths forever.

The Goal specification already anticipated this. Under No-Spin Rules it lists as a pause condition:

> pending background task **without a terminal event**

The qualifier is load-bearing. Background work *without* a terminal event must pause. A receipt reaching terminal status **is** a terminal event, and is therefore a legitimate reason to continue. The rule was written with this case in mind; the wake signal was never built.

Slice 0 now owns and clears this boundary. The remaining wake classification and driver behavior belong to Slice 6.

## Product Vocabulary

| Concept | Scope | Durability | Owner | Purpose |
| --- | --- | --- | --- | --- |
| **Task** | One session | Session JSONL | This spec | The agent's working plan for the current session |
| **Goal** | One session | Session config | Spec 22 | Whether to run another round |
| **Workflow step** | One run | Run storage | Workflows | Pre-defined, sequenced, output-passing |
| **Work order** | One campaign | Scheduled work | Spec 21 | Durable background unit with `inputRefs` |
| **Receipt** | One delegation | Agent-messages dir | Agent messaging | Audit record of a delegated run |

A Task is the smallest and least durable of these, and deliberately so. It is a plan, not a commitment. Anything that must survive the session belongs in a work order or a workflow.

## Core Laws

```text
One session owns exactly one task list.
A task list never spans sessions.
Delegation creates a task item in the parent and a separate list in the child.
Task state is host-owned; model output cannot forge it.
A task list carries no permission or side-effect authority.
Starting is never completion.
```

Law two mirrors Goal Mode, where forking mints a new goal id rather than duplicating an armed one. Same invariant, same reasoning, no new concept for the user.

## Ownership Model

```text
WORKFLOW (durable, pre-defined)
  step 1 ──► session A ──► task list A
  step 2 ──► session B ──► task list B        the workflow IS the cross-step plan
  step 3 ──► session C ──► task list C

MAIN SESSION (Goal Mode + task list)
  ☑ Research the release window
  ◐ Draft three caption options   ──message_agent──► hidden child session
  ☐ Pick winner, promote to Release Kit               └─ its own task list
  ☐ Schedule the posts
```

The parent does not micromanage the child's plan. Separate context is the reason to delegate at all.

## State Model

Mirrors `packages/shared/src/sessions/chat-goal.ts`: pure functions, immutable transitions, revision counter, defensive parse.

```ts
type SessionTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'delegated'
  | 'completed'
  | 'abandoned'

interface SessionTask {
  id: string                    // task_<uuid>
  content: string               // imperative, <= 200 chars
  activeForm?: string           // present-tense label for in_progress rendering
  status: SessionTaskStatus
  delegation?: {
    receiptId: string
    childSessionId?: string
    targetAgentSlug: string
    dispatchedAt: string
    settledAt?: string
    outcome?: 'succeeded' | 'failed' | 'timeout' | 'abandoned'
    summary?: string            // <= 1000 chars, from the receipt
  }
  createdAt: string
  updatedAt: string
}

interface SessionTaskList {
  schemaVersion: 1
  id: string                    // tasks_<uuid>
  revision: number
  items: SessionTask[]
  createdAt: string
  updatedAt: string
  source: 'native-tool' | 'todowrite-adapter'
}
```

### Invariants

Enforced host-side on every mutation. Violations reject the call with a typed error; they never silently normalize.

- At most one item in `in_progress`. `delegated` items do not count against this, since delegation is a wait, not active work.
- No empty or whitespace-only `content`.
- No duplicate `content` within one list (case-insensitive, trimmed).
- `revision` increments on every accepted mutation.
- `delegated` requires a `delegation.receiptId`.
- `completed` and `abandoned` are terminal for that item; reopening requires an explicit `reopen` op that increments revision and logs.
- List length capped at 50 items. Exceeding it is an error, not a truncation.

## Tool Surface

One tool, `update_tasks`, in `packages/session-tools-core/src/handlers/session-tasks.ts`.

```ts
{
  op: 'init' | 'start' | 'done' | 'append' | 'drop' | 'reopen' | 'view'
  items?: string[]        // init, append
  taskId?: string         // start, done, drop, reopen
  content?: string        // append single
}
```

Incremental operations, not whole-array replacement. Replacement burns tokens on every tick and lets a model silently clobber its own status when it forgets an item.

`safeMode: 'allow'`. Task state is metadata with no real-world effect, unlike `promote_to_release_kit`, which is correctly `block`. `view` is `readOnly: true`.

The tool returns the full authoritative list after mutation, so the model never needs a second call to re-read state, and the renderer can update directly from the tool result.

## Provider Strategy

**Register `update_tasks` only when the session provider is not `anthropic`.**

Claude is heavily trained on `TodoWrite`. A custom tool is out-of-distribution and will see materially worse adherence. Shipping both into one session creates two competing tools and two sources of truth — the same class of defect as the Release Kit and legacy Finals split documented in spec 23.

**Gating stops at the tool surface. State ownership does not.**

```text
pi / pi_compat  (any non-anthropic)
   └── update_tasks ─────────────┐
                                 ├──► SessionTaskList ──► JSONL + config ──► UI
Claude (anthropic)               │        (host-owned)
   └── native TodoWrite ─────────┘
        (intercepted, projected)
```

### Claude TodoWrite adapter

In SessionManager's tool-call handling, when `toolName === 'TodoWrite'` completes, project `input.todos` into the same store with replace semantics (TodoWrite is whole-array by design) and `source: 'todowrite-adapter'`.

Mapping: `pending → pending`, `in_progress → in_progress`, `completed → completed`. `activeForm` passes through. Adapter-sourced lists cannot contain `delegated` items; a delegation on a Claude session is recorded by the delegation hook below, which sets `source` to `native-tool` for that list from then on.

`TodoWrite` is a native Claude SDK tool rather than a session-tools-core tool, so it cannot be suppressed by the existing filtering; the adapter is therefore the mechanism by which Claude sessions gain durable state. This is a net upgrade for Claude sessions, which currently have only a per-turn display projection.

Provider gating does **not** require new infrastructure. Registration-time filtering already exists in `tool-defs.ts` — feature flags such as `includeScheduleWork` and `includeManagerTools`, plus the safe-mode lists `getSessionSafeAllowedToolNames()` and `getSessionSafeBlockedToolNames()` (`tool-defs.ts:1924-1957`). Slice 3 should extend that pattern rather than build a parallel one.

### Prompt guidance

Non-Anthropic providers need explicit instruction, since they lack the trained behavior. Injected only when `update_tasks` is registered:

- Create a list when work has three or more distinct steps, when the user supplies several tasks at once, or when new instructions arrive mid-run.
- Mark an item `in_progress` before starting it, and `completed` immediately on finishing. Do not batch status updates.
- Exactly one item `in_progress` at a time.
- Do not create a list for single-step work.

## Delegation Integration

When an agent calls `message_agent`, the host — not the model — records the linkage.

**Blocking delegation** (`background` absent or false): the parent's turn blocks and receives the result inline. If a task item is `in_progress` when the call is made, it is annotated with the receipt id for audit but its status is unchanged. No wake protocol is needed; the existing behavior is correct and untouched.

**Background delegation** (`background: true`): the host transitions the current `in_progress` item to `delegated` and attaches the `delegation` block. If no item is `in_progress`, the host appends a new `delegated` item derived from the delegation prompt (truncated to 200 chars).

This classification is host-owned. Model output cannot mark an item `delegated`, and cannot resolve one.

`spawn_session` does not participate. It is fire-and-forget by contract, has no receipt, and creates no task item. If an agent needs a resolvable handoff, it must use `message_agent`.

## Child Completion And Wake Protocol

This is the fix for both gaps above. Steps are ordered; step 0 is a precondition for everything after it.

### 0. Own and clear the background boundary

When background `message_agent` returns `running`, the host records its exact receipt id on the originating tool message and transitions `toolStatus` to `'backgrounded'`. On a terminal receipt, the host locates that message by receipt id and transitions it to a terminal value before any wake is attempted.

This is the fix for Gap 2 and it must land first. Without both the start and terminal transitions, Goal Mode either continues prematurely or remains blocked after the child finishes.

Two implementation options; the first is preferred:

1. **Clear the status.** Update the originating tool message's `toolStatus` to `'completed'` or `'error'` per the receipt outcome, then persist. This keeps `hasPendingBackgroundWork` a single-source derivation and requires no change at the two read sites.
2. **Cross-reference receipts.** Leave the message untouched and redefine `hasPendingBackgroundWork` to ignore backgrounded messages whose receipts are terminal. Avoids mutating historical messages but adds a receipt read to a hot path.

Whichever is chosen, the rule is: **a backgrounded tool message must not outlive its receipt.** Clearing is idempotent and keyed by receipt id.

This is a live Goal Mode correctness defect and is worth landing on its own ahead of the rest of the task-list feature.

### 1. Classify the notice

`deliverPassiveAgentMessage` gains an explicit classification on the appended message: terminal background receipts are marked as a **wake-eligible** event, carrying `receiptId`, `childSessionId`, `status`, and `summary`. Non-terminal notices — including the existing `notifyBackgroundParentStarted` — are **not** wake-eligible. A start notice must never wake a parent.

### 2. Resolve the task item

On a wake-eligible notice, the host resolves the matching `delegated` item by `receiptId` and sets:

- `succeeded` → `completed`, with `delegation.summary` recorded
- `failed` or `timeout` → back to `pending`, with the error recorded and the item's content left intact

A failed delegation returns work to the plan rather than silently dropping it. The agent decides on the next round whether to retry, delegate elsewhere, or abandon.

If no matching item exists (delegation predated the task list, or the list was reset), the notice is still delivered and still wake-eligible. Task resolution is best-effort; the receipt remains the durable source of truth, consistent with the existing best-effort comment in `notifyBackgroundParent`.

### 3. Wake the parent

A wake-eligible notice is a legitimate Goal continuation trigger, per the No-Spin carve-out.

**Entry path.** `notifyBackgroundParent` runs fire-and-forget on the AgentMessageService callstack and does **not** hold the session admission lock. The wake must therefore be scheduled asynchronously — following the `setImmediate` deferral already used by `dispatchChatGoalContinuation` — and must never run inline inside `deliverPassiveAgentMessage`. Two entry points exist and they are not interchangeable:

- **Goal active:** re-invoke the settle path (`settleChatGoalAtIdle`), which requires the session to be idle and not processing. If the session is busy, the notice simply becomes context for the round already underway; no wake is needed.
- **Goal paused with `waiting-external`:** enter through `resumeChatGoal`, which takes `withSessionAdmissionLock` and clears the stop.

Both paths check background work, so step 0 must have completed for either to succeed.

- **Goal active:** the notice is treated as new input. The continuation driver reassesses at the next settle boundary. It does **not** bypass admission — every existing reservation check still applies, including revision, processing generation, queued human input, and permission boundary.
- **Goal paused with stop code `waiting-external`:** the driver may auto-resume, since the awaited event has arrived. Any other stop code — `user-paused`, `needs-approval`, `needs-auth`, `restart-disarmed`, `ownership-changed` — stays paused. A human pause is never overridden by a machine event.
- **No Goal active:** the notice is appended and rendered. Nothing auto-runs. Goal Mode remains the only mechanism that starts an unattended turn.

A wake consumes a Goal round like any continuation. It is subject to the same round cap, so child completions cannot extend a Goal's budget.

### 4. Bound the wake

- Wakes are deduplicated by `receiptId`. A duplicate or replayed notice is idempotent.
- Wake eligibility is dropped if the parent session is archived, deleted, disposed, or has changed ownership.
- If more than one child settles while the parent is idle, notices coalesce into a single wake. The parent reassesses once with all results visible, rather than once per child.

## Goal Mode Integration

### Completion enforcement

Goal Mode's completion audit gains a task check: **a Goal may not finalize `complete` while any item is `pending`, `in_progress`, or `delegated`.**

This directly strengthens the shallow evidence check flagged in review of spec 22. The existing check at `SessionManager.ts:11238` is `if (goal.doneWhen && !pendingUpdate.evidence?.length)` — so evidence is required only when `doneWhen` is set, and even then only checked for non-emptiness, never for consistency with the stated condition. A Goal with no `doneWhen` completes with no evidence at all.

"Three items still open" is a falsifiable, host-verifiable signal in a way that a free-text evidence string is not, and unlike the evidence check it applies whether or not `doneWhen` was set.

Rejected completion is not a failure. The agent is told which items remain and continues, or explicitly abandons them with a reason.

If no task list exists, the check is a no-op. Goals on simple work are unaffected.

**Deadlock guard:** the enforcer must not run before the wake protocol ships. A `delegated` item with no wake signal blocks completion permanently. Slice order below reflects this.

### No-progress detection

"No task state change across two consecutive continuation rounds" is a sharper signal than the current content fingerprint, and complements rather than replaces it. A round that changes no task status and produces no new tool progress is a stronger no-progress candidate than one judged on assistant text alone.

### Hidden continuation prompt

The prompt gains the current task list — items, statuses, and delegation state — so a continuing agent resumes against its own plan rather than reconstructing it from transcript. This is the single highest-value integration for long runs, since it survives compaction.

Task content is model-authored and must be treated as such. It is rendered into the prompt as data, never as instruction, consistent with the existing rule that hidden prompt text cannot change host-owned classification.

## Workflow And Scheduled Work Integration

**Workflows:** each step's session gets its own list. The workflow is already the cross-step plan; do not attempt to span one list across steps. Step-scoped delegation remains bounded by the existing `maxAgentMessages` limit, and a delegation refused by that limit marks the task item `pending` with the refusal reason, never `delegated`.

**Scheduled work:** work orders are the durable tier. A coordinator session may keep a task list for its own working plan, but a task list must never be the record of a scheduled commitment. Anything that must survive session disposal belongs in a work order with `inputRefs`.

**Depth:** delegation depth remains bounded by `DEFAULT_MAX_DEPTH`. Task lists add no new recursion, since a child's list is its own and never merges upward.

## Persistence

Follows `commitChatGoalState` exactly.

- Projected state lives in the session config header alongside `chatGoal`.
- Every accepted mutation appends an event to the session JSONL with `displayIntent: 'task-event'`.
- `commitSessionTaskState` calls `persistSession` then awaits `flushSession` **before** emitting `session_tasks_changed`. The durable barrier precedes the event, so a crash cannot leave the renderer showing state that was never written.
- On load, state is read from the header; the event log is the audit trail and the reconstruction source if the header is missing or invalid.
- **The header field is the sole source of truth after compaction.** This matters most for the TodoWrite adapter: compaction can remove the very tool calls the list was derived from, so the adapter must project into durable state at tool-call time and must never attempt to re-derive from messages. If the header is missing, the JSONL event log is the only fallback; message replay is not.
- `parseSessionTaskList` returns `undefined` for any invalid or internally inconsistent state, exactly as `parseChatGoalState` does. Sessions predating this feature have no field and parse to `undefined`. Backward compatible.
- If a task write fails, the failure is logged and surfaced, but it must **not** block the session. Unlike Goal state, a task list is advisory; a session with an unwritable task list is degraded, not unsafe.

## Restart, Fork, Transfer, Archive

Task lists are advisory, so they are less dangerous than Goal state and the rules are correspondingly softer. They must still never imply work is underway when it is not.

- **Restart / crash:** the list is restored as-is, except that `in_progress` items are demoted to `pending` and `delegated` items are re-resolved against their receipts. A `delegated` item whose receipt is terminal resolves immediately; one whose receipt is non-terminal and whose child session no longer exists becomes `pending` with an `orphaned` note. Nothing resumes on its own; Goal Mode's `restart-disarmed` rule still governs execution.
- **Fork / branch:** the child receives a copy with a new list id, all `in_progress` demoted to `pending`, and all `delegated` items demoted to `pending` with their delegation block dropped. A fork must never inherit a live claim on another session's receipt.
- **Transfer:** the list travels with the session. `delegated` items are demoted to `pending` on import, since receipts are workspace-local.
- **Archive:** the list is retained, read-only. No wake is delivered to an archived session.
- **Delete:** the list is disposed with the session. Pending wakes for that session are dropped.

## Failure And Stuck States

Every state below must be reachable only with a visible reason and a user-facing next action.

| Condition | Behavior |
| --- | --- |
| Child never settles | Receipt timeout marks it `timeout`; item returns to `pending` with the reason |
| Child session deleted mid-flight | Item returns to `pending`, noted `orphaned` |
| Wake delivery fails | Best-effort; receipt remains durable and `list_agent_message_receipts` remains the recovery path |
| Repeated failed delegation | Three consecutive failures on the same item mark it `abandoned` with a blocker note, mirroring Goal Mode's blocker-audit threshold |
| Task list write fails | Logged and surfaced; session continues, list marked degraded |
| Model spams `append` | List cap of 50 rejects further items |
| Agent abandons everything | Permitted, but `abandoned` requires a reason string; abandonment is recorded, not silent |

## Approval And Side-Effect Boundary

A task list confers no authority.

- Marking an item `completed` is a claim, never evidence.
- A task item may not pre-approve, batch, or carry forward any approval. Every public, financial, destructive, or account action still requires its own exact-bound approval and receipt, per house rules.
- A delegated child runs under its own agent's permission boundary and the existing `parentPermissionMode` propagation. Delegation must never widen permissions, and a task item must never be the reason an action is treated as approved.
- Task content is untrusted model output. It is never executed, never resolved as a path, and never treated as instruction by the host.

## UI Contract

- The list renders in the same `TodoItem[]`-shaped component that exists today, so renderer changes are minimal. `turn-utils` stops deriving per-turn state and reads session-level state instead.
- The list is session-scoped and persistent, not per-turn. A six-round Goal shows one evolving plan.
- A `delegated` item shows the target agent and a link to the child session, and is visually distinct from `in_progress`.
- A resolved delegation shows its outcome and summary inline.
- Failed and abandoned items remain visible with their reason. Nothing disappears silently.
- The wake notice renders as the existing passive agent-message notice; it must not masquerade as a user message.

## Typed Codes

```ts
type SessionTaskRejectionCode =
  | 'duplicate-content'
  | 'empty-content'
  | 'multiple-in-progress'
  | 'unknown-task-id'
  | 'terminal-item'
  | 'list-cap-exceeded'
  | 'stale-revision'
  | 'delegation-required'

type TaskWakeSkipReason =
  | 'duplicate-receipt'
  | 'session-disposed'
  | 'session-archived'
  | 'ownership-changed'
  | 'goal-paused-by-human'
  | 'non-terminal-receipt'
  | 'round-limit'
```

Every rejection returns a code plus a message the model can act on. Every skipped wake is logged with its reason; a silently dropped wake is a defect.

## IPC And Event Surface

Backend-owned mutations, mirroring the `goal:*` family:

- `tasks:get`
- `tasks:clear`
- `tasks:reopen`

The renderer does not edit task JSON directly. V1 exposes no user-authored task creation; the list is the agent's plan.

Events:

- `session_tasks_changed` — full render-safe list, emitted after the durable barrier
- the existing `user_message` event continues to carry passive notices, now with wake classification in `agentMessage`

## Observability

Structured logs record: session id, list id, revision, op, rejection code, item count by status, provider, and `source`. For wakes: receipt id, child session id, outcome, wake decision, and skip reason.

Never logged: task content bodies, delegation prompts, hidden continuation content, credentials.

Metrics worth distinguishing: lists created by source (native vs adapter); completion enforcement rejections; delegations dispatched, resolved, failed, orphaned; wakes delivered, coalesced, skipped by reason; median items per completed Goal.

## Implementation Slices

Ordered so that no slice ships a deadlock.

**Slice 0 — Own and clear the background boundary.** Running background delegations persist an exact receipt-linked boundary; terminal receipts clear it. The transition is idempotent and handles completion-before-start ordering. Independent of task lists and shippable alone. **Implemented 2026-08-30.**

**Slice 1 — State model.** `packages/shared/src/sessions/session-tasks.ts`, pure functions and invariants, with unit tests. No runtime wiring. **Implemented 2026-08-30.**

**Slice 2 — Persistence.** Session config field, JSONL events, `commitSessionTaskState` with the durable barrier, defensive parse, load-path restore including `in_progress` demotion. **Implemented 2026-08-30.**

**Slice 3 — Tool and gating.** `update_tasks` handler and tool-def, provider-gated registration, prompt guidance for non-Anthropic providers. **Implemented 2026-08-30.**

**Slice 4 — Claude adapter.** Intercept `TodoWrite`, project into the store. Claude sessions gain durable state. **Implemented 2026-08-30.**

**Slice 5 — UI.** Point `turn-utils` at session state; render `delegated` items and outcomes. **Implemented 2026-08-30.**

**Slice 6 — Wake protocol.** Notice classification (on `agentMessage.status`), receipt-to-item resolution keyed by `receiptId` with `targetAgentSlug` as a cross-check, driver wake via the entry paths above, dedup, coalescing, bounds. **Depends on Slice 0 and must ship before Slice 7. Implemented 2026-08-30.**

**Slice 7 — Goal integration.** Completion enforcement, no-progress signal, task list in the hidden continuation prompt.

**Slice 8 — Hardening.** Timeout, orphan, and repeated-failure paths; restart/fork/transfer/archive behavior; observability.

## Acceptance Tests

### State and invariants

- duplicate, empty, over-cap, and multiple-`in_progress` mutations each reject with the correct typed code
- terminal items reject mutation except via `reopen`
- revision increments on every accepted mutation and never on a rejected one

### Persistence

- list round-trips through session header for every status combination
- crash between persist and event emission leaves no renderer state that was never written
- sessions predating the feature parse to `undefined` and behave normally
- a failed task write degrades the list without blocking the session

### Provider

- `update_tasks` is not registered on an `anthropic` session
- `update_tasks` is registered on both `pi` and `pi_compat` sessions
- a Claude `TodoWrite` call projects into the store with `source: 'todowrite-adapter'`
- a Claude session's list survives restart and compaction, which it does not today

### Background boundary (Slice 0)

- a running background delegation creates one receipt-linked server boundary
- a terminal receipt clears the originating tool message's `backgrounded` status
- a terminal receipt that arrives before the starting tool result prevents that result from reopening the boundary
- after clearing, `hasPendingBackgroundWork` reports false and both `settleChatGoalAtIdle` and `resumeChatGoal` admit
- a Goal that backgrounds a delegation and receives a terminal receipt can continue — the regression test for the live defect
- clearing is idempotent under duplicate or replayed receipts
- a non-terminal receipt leaves the status untouched

### Delegation and wake

- background `message_agent` marks the current item `delegated` with the receipt id
- blocking `message_agent` does not change item status
- `spawn_session` creates no task item
- a terminal `succeeded` receipt resolves the item to `completed` and wakes an active Goal
- a `failed` receipt returns the item to `pending` with the error recorded
- a start notice does **not** wake the parent
- a duplicate receipt notice is idempotent and wakes once
- two children settling while idle coalesce into a single wake
- a wake consumes a Goal round and is refused at the round cap
- a Goal paused by a human is **not** resumed by a child completion
- a Goal paused with `waiting-external` **is** resumed
- a wake to an archived, deleted, or ownership-changed session is skipped with the correct reason
- a delegation refused by `maxAgentMessages` leaves the item `pending`, never `delegated`

### Goal integration

- a Goal cannot finalize `complete` while any item is `pending`, `in_progress`, or `delegated`
- a Goal with no task list completes unaffected
- two consecutive rounds with no task state change contribute to no-progress detection
- the hidden continuation prompt contains the current list and treats content as data

### Restart, fork, transfer

- restart demotes `in_progress` to `pending` and re-resolves `delegated` against receipts
- a fork receives a new list id with no live delegation claims
- transfer import demotes `delegated` to `pending`

## Deferred Follow-Up

Explicitly out of scope for V1, recorded so they are not mistaken for oversights:

- User-authored and user-edited task lists
- `decompose` via a secondary model call, as in AutoGPT's `todo_decompose`
- Phases or grouping, as in incremental-op harnesses
- Cross-session task rollup for a workflow run
- Task-level cost or token attribution
- A wake path for `spawn_session`, which would require adding receipts to a mechanism that is fire-and-forget by design

## Provenance

The state model and incremental-operation surface follow common practice in open task-tool implementations. The event-sourced persistence and branch-restore behavior follow the pattern already established by `chat-goal.ts` in this repository. The completion-enforcement idea is adapted from harnesses that refuse agent completion while tasks remain open.

No third-party code is copied. Any future port of external code must have its license verified against the source repository before use, since this is a commercial product and license claims about these projects circulate incorrectly.

---
status: implementation-in-progress
owner: agent
last_verified: 2026-08-30
source_of_truth: true
related: ./21-bounded-goal-continuation-driver-spec.md
---

# Chat-Native Goal Mode

## Purpose

Let a user tell one Artist OS agent to keep working toward an explicit objective across several turns in the same visible chat.

Goal Mode is a bounded continuation layer around the existing session runtime. It is provider-neutral, preserves the selected agent and conversation context, accepts steering while running, and never widens permissions. It is not a new agent harness and it has no Calendar relationship unless the user separately schedules work.

## User Promise

The user can type `/goal` or `$goal`, define the outcome, and press **Start Goal**. The agent works one turn at a time, checks whether the goal is genuinely complete, and—if it is safe and useful—starts the next turn automatically.

The user always sees:

- the exact objective
- current round and maximum rounds
- whether the Goal is active, paused, blocked, complete, or stopped by budget
- Pause, Edit, Resume, and Stop controls
- why the agent stopped and what it needs

Normal messages sent while the agent is working steer the active turn through the backend's existing steering behavior. The Goal survives normal context compaction, but app restart, crash recovery, fork, transfer, or execution-ownership change disarms it until the user explicitly resumes.

## Non-Goals

- No generic infinite `loop until done` API.
- No new model harness or provider-specific Goal implementation.
- No Calendar item, scheduled job, campaign deadline, or HQ month entry.
- No parallel child sessions hidden behind one chat.
- No automatic activation inferred from a long prompt.
- No permission escalation, remembered one-time approval, or bypass of external-action confirmation.
- No busy polling while waiting for a person, future time, credential, approval, or external event.
- No promise that every creative objective has a machine-verifiable completion test.

## Relationship To Scheduled Work Goals

This feature and [Bounded Goal Continuation Driver](./21-bounded-goal-continuation-driver-spec.md) solve different jobs.

| Feature | Chat Goal Mode | Scheduled Work Goal Run |
| --- | --- | --- |
| User surface | One live agent chat | Calendar / background work |
| Trigger | `/goal`, `$goal`, or Goal button | Confirmed scheduled work |
| Execution | Reuses the same session | Durable coordinator plus child work orders |
| Completion | Goal contract and agent completion audit | Required Output contract |
| Restart | Pauses until user resumes | Disarms until explicit re-arm |
| Calendar | None | Visible coordinator item |

They may eventually share pure types or safety helpers. They must not share runtime state or silently convert one mode into the other.

## V1 User Journey

1. The user types `/goal` or `$goal research the best six-week release plan for this single`.
2. A compact setup sheet opens with:
   - **Objective** — required, editable
   - **Done when** — optional; the agent may propose a concrete finish condition
   - **Maximum rounds** — defaults to 6; allowed range 2 through 12
3. The user presses **Start Goal**. This explicit action is the activation boundary.
4. A slim Goal strip appears above the composer:
   - `Goal active · Round 1 of 6`
   - objective preview
   - Pause and Stop
   - a disclosure for full details and Edit
5. The selected agent runs normally in the current chat using the current provider, model, tools, sources, skills, and permission mode.
6. If the turn finishes and the Goal remains active, the app performs a completion and safety check. When another round is warranted, a subtle transcript divider says `Goal continuing · Round 2 of 6`; no fake user bubble is shown.
7. The agent either completes the Goal with evidence, pauses for the user, records a repeated blocker, or reaches its round limit.
8. A completed Goal stays collapsed in the transcript history. The user may start a new Goal in the same chat.

Only one non-terminal Goal may exist per chat in V1.

## Commands And Controls

### Start

- `/goal` opens the setup sheet.
- `$goal <objective>` opens the same sheet with the objective prefilled.
- Natural language such as `make this a goal` may open the sheet, but must not activate a Goal without confirmation.

### While Running

- A normal user message uses the existing provider steering path.
- **Pause** stops future automatic rounds; it does not destroy the active model turn.
- **Stop now** requests the existing hard stop for the active turn and cancels the Goal.
- **Edit** changes the objective, done condition, or remaining round cap. It increments the Goal revision and invalidates any reserved continuation.
- **Resume** explicitly re-arms a paused Goal from the current chat state.

### Agent Tools

The session exposes three provider-neutral internal tools while Goal Mode is available:

- `get_goal` — read the current Goal and remaining budget
- `create_goal` — propose/create only after an explicit user request
- `update_goal` — request `complete` or `blocked` with evidence

Pause, resume, cancel, clear, and budget changes remain user/system controls. The model cannot grant itself more rounds, reactivate after restart, or clear its own history.

Tool exposure must be derived from the feature capability, not only from whether a Goal is already active. `create_goal` must be callable after an explicit request; `get_goal` and `update_goal` must remain exposed for every active or paused Goal across all supported providers.

`create_goal` may prepare a proposal and open the same confirmation sheet, but actual activation requires a host-issued confirmation nonce tied to the exact objective, done condition, round cap, session, and Goal revision. A model tool call alone cannot manufacture that nonce or activate continuation.

## State Model

```ts
type ChatGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'budget-limited'
  | 'complete'
  | 'cancelled'

interface ChatGoalState {
  schemaVersion: 1
  id: string
  objective: string
  doneWhen?: string
  status: ChatGoalStatus
  revision: number
  round: number
  maxRounds: number
  createdAt: number
  updatedAt: number
  tokenBaseline?: number
  tokenBudget?: number
  completion?: {
    summary: string
    evidence?: string[]
    completedAt: number
  }
  stop?: {
    code: ChatGoalStopCode
    message: string
    at: number
  }
  blockerAudit?: {
    fingerprint: string
    consecutiveGoalTurns: number
  }
}
```

`ChatGoalState` is persisted in the session JSONL header by adding it to `SessionConfig` and `SESSION_PERSISTENT_FIELDS`. Runtime reservations, timers, ownership leases, and pending continuation messages are not persisted as authority.

Terminal Goal history is stored as append-only `goal_event` records among the session's JSONL messages. At minimum, `created`, `edited`, `paused`, `resumed`, `completed`, `blocked`, `budget-limited`, and `cancelled` events carry Goal id, revision, timestamp, round, and a render-safe summary. The header holds only the current/latest Goal. Starting another Goal therefore cannot erase the prior Goal's transcript history or make the header grow without bound.

The Goal is part of the chat's history, not a context document. Editing an Artist HQ Goal document does not mutate it, and editing it does not create a Calendar item.

## Creation Atomicity

`goal:create` owns first-turn admission. It accepts the confirmed Goal definition plus the user's visible initial message, acquires the existing per-session admission lock, validates that no non-terminal Goal exists, appends the Goal header state and `created` event, persists the visible user message, and flushes all three before acknowledging Start Goal.

Implementation must factor the already-admitted portion of `sendMessage()` into an internal primitive. `goal:create` must not acquire the session admission lock and then call the public `sendMessage()`, which would attempt to reacquire the same lock and deadlock.

If validation or persistence fails, no active Goal is exposed. If provider launch fails after the durable acknowledgement, the Goal becomes paused with `provider-error`; the visible user message remains retryable. A crash must never leave an active Goal whose objective or first user turn was not durably stored.

## Runtime Ownership

`SessionManager` owns Goal continuation because it already owns provider-neutral session admission, message persistence, processing generations, steering fallback, queue order, completion events, and session flushing.

Add one `ChatGoalDriver` dependency beside those responsibilities. It must use the existing `sendMessage()` path with a hidden internal continuation message. It must not call Claude, Pi, OpenAI, OpenRouter, DeepSeek, Gemini, or any other provider directly.

The driver may reserve a continuation only after `onProcessingStopped()` has:

1. marked the turn idle
2. processed any deferred session metadata
3. found no human message waiting in `messageQueue`
4. durably flushed the final assistant message and Goal metadata
5. emitted or recorded the terminal reason for the turn

Human messages always outrank automatic continuation. A Goal turn never jumps ahead of an accepted steer, queued follow-up, auth retry, plan handoff, or approval response.

An active `pendingPlanExecution`, pending approval/auth request, or unresolved background-task wait blocks Goal admission. Hidden Goal messages must not pass through the existing user-message safety valve that clears `pendingPlanExecution`; they pause the Goal instead. This requires an internal Goal-turn origin flag, not a renderer-controlled option.

## Continuation Admission

Each proposed automatic round carries an immutable reservation:

```ts
interface GoalRoundReservation {
  goalId: string
  revision: number
  nextRound: number
  processingGeneration: number
  runtimeInstanceId: string
  ownershipFence?: string
}
```

The driver verifies the reservation:

1. when the previous turn settles
2. immediately before calling `sendMessage()`
3. after acquiring the session admission lock
4. before accepting the new round as started

Any changed Goal id, revision, status, processing generation, runtime instance, ownership fence, queued human input, archive/delete state, or permission boundary cancels the reservation.

Only a continuation that passes admission and begins a model turn increments `round`. Duplicate completion events or retries must be idempotent for the same Goal revision and next-round number.

Every admitted turn is classified as `goal-initial`, `goal-continuation`, or `human` in runtime bookkeeping:

- `goal-initial` and `goal-continuation` each consume one round.
- A native mid-turn steer remains part of the already-counted Goal turn.
- A steer that falls back to abort-and-queue becomes a `human` turn and consumes no Goal round.
- After a `human` turn settles, the driver may reassess the active Goal, but only after all other human messages have drained.

This classification is host-owned. Hidden prompt text or model output cannot change it.

## Hidden Continuation Prompt

The internal message is persisted for model context but hidden from normal transcript display. It contains only:

- Goal id and revision
- exact objective and optional done condition
- current round and maximum
- remaining explicit token budget, when one exists
- instruction to inspect prior work, continue only the highest-value unfinished work, and use `update_goal` only with evidence
- instruction that the Goal does not widen permissions or authorize public/external action
- instruction to pause rather than poll when progress depends on a person, approval, credential, future time, or external event

It does not restate the entire conversation or synthesize a new persona. Normal provider context and existing compaction remain authoritative.

## Completion And Blocking

### Completion

The agent requests completion through `update_goal({ status: 'complete', summary, evidence })`.

The tool call records a runtime-only pending completion request; it does not immediately mutate the Goal to `complete`. `onProcessingStopped()` finalizes or rejects that request only after the turn's final assistant response and persistence barrier are known. A crash, interruption, tool error, or missing final response discards the pending request and disarms the Goal instead of recording false completion.

The host accepts completion only when:

- the request matches the active Goal id and revision
- the current turn produced a final assistant response
- the supplied evidence is consistent with `doneWhen`, when present
- required persistence for claimed local artifacts has completed
- no required approval or external result is still pending

Creative Goals may use a human-readable finish condition rather than a file contract. The system must not force every writing, strategy, or ideation Goal into a fake artifact check. Conversely, the model saying `done` is not sufficient when the Goal explicitly names verifiable files, tests, outputs, or actions.

Hitting a budget never marks the Goal complete.

### Blocking And Pausing

Use `paused` with a typed reason for an immediate human boundary such as:

- approval required
- authentication required
- material product choice required
- future time or external event required
- app restart, transfer, or ownership change

The agent's `blocked` tool request is likewise provisional until turn settlement. Use terminal `blocked` only when the same non-human blocker survives three consecutive Goal turns. Store a stable blocker fingerprint plus explanation. A new blocker resets the consecutive count. The first two matching requests remain active and may continue only if the next round can perform a concrete new attempt; otherwise pause as `no-progress`.

The host, not the model, computes the fingerprint and enforces the three-turn audit.

A concrete blocker attempt counts as progress for the no-progress detector even when it fails. Empty restatements, repeated waiting, and requests that perform no new check do not. This keeps the three-turn blocker audit reachable without permitting a three-turn spin.

## Budgets

- Default maximum: 6 rounds including the initial Goal turn.
- User-selectable range: 2 through 12 rounds.
- The initial turn counts as round 1 once admitted.
- Only Goal-sourced turns consume the round budget; human steering messages do not add rounds.
- Token budgets are optional and exist only when the user explicitly sets one.
- Token use is measured as a delta from the session token baseline and shown as approximate where provider accounting differs.
- At the cap, status becomes `budget-limited`; the UI offers **Add rounds and resume** with explicit confirmation.
- No automatic retries after rate limits or provider errors consume unlimited hidden rounds. Existing bounded provider retry behavior runs inside one admitted turn; an unrecovered error pauses the Goal.

## Approval And Side-Effect Boundary

Every Goal round inherits the session's current permission mode and the host's existing privileged-execution broker.

Goal Mode never:

- changes `safe`, `ask`, or `allow-all`
- converts a prior one-time approval into Goal-wide approval
- pre-approves social publishing, outreach, spending, deletion, account changes, or other external mutations
- treats a model request for permission as permission
- resumes past an unanswered approval or auth prompt

If a user deliberately changes permission mode, that normal session change applies to later rounds. The Goal itself cannot request or perform that change.

## Restart, Fork, Transfer, And Team Safety

- **Restart/crash:** persisted `active` is rewritten and flushed as `paused` with `restart-disarmed` during session load, before the session is exposed to the renderer or any provider can be created. If that write fails, the session remains non-runnable and surfaces `persistence-failed`. Explicit Resume is required.
- **Fork/branch:** the child receives a paused snapshot for context, never an armed duplicate. The parent retains its state. Activating the child creates a new Goal id.
- **Remote transfer/handoff:** pause before transfer. The destination may resume only after the session import and provider context are ready.
- **Archive/delete:** archive pauses; permanent deletion cancels with the session. No hidden Goal work may survive session disposal.
- **Team Mode:** only the current session owner/runtime lease may admit a round. Ownership change pauses before another round. Two clients must never continue the same Goal concurrently.
- **Provider/model switch:** allowed only at an idle boundary through the existing session control. It increments the runtime continuation generation but preserves Goal revision and history.

## No-Spin Rules

The Goal driver must never create another round merely to wait.

These outcomes pause instead of continuing:

- `check again later`, timer, sleep, or future date
- pending OAuth, API key, browser login, or user approval
- pending background task without a terminal event
- provider outage or rate-limit window beyond the existing in-turn retry policy
- uncertain prior-turn outcome after crash
- no new progress across two consecutive auto-continuation turns

Future work should be offered as a separate automation or Scheduled Work item only after the user chooses it.

## UI Contract

The Goal strip is compact and attached to the chat composer, not the global app navigation.

Collapsed state:

```text
Goal active  ·  Round 2/6     Pause   Stop
Build a release plan grounded in current campaign data…
```

Expanded details show objective, done condition, approximate tokens/cost, completion or stop evidence, and Edit. Status uses text plus color; color is never the only signal.

Transcript markers are quiet system dividers. Hidden continuation prompts never render as user-authored messages and never alter the session-list preview.

When paused for a person, the strip states the concrete need and presents one relevant action. It must not show an indefinite spinner.

## Provider Contract

Goal continuation itself occurs only from idle, so every backend receives a normal `sendMessage()` call.

Mid-turn human steering remains backend-specific behind `BaseAgent.redirect()`:

- Pi-compatible runtimes inject the steer at the next step boundary.
- Claude-compatible runtimes use the current pre-tool hook and `steer_undelivered` queue fallback.
- Backends without native steering use the existing abort-and-queue fallback.

Therefore Goal Mode works with any current or future provider that satisfies the existing `AgentBackend` session contract. A provider is not allowed to implement a second Goal loop internally.

## Typed Stop Codes

```ts
type ChatGoalStopCode =
  | 'user-paused'
  | 'user-cancelled'
  | 'needs-approval'
  | 'needs-auth'
  | 'needs-decision'
  | 'waiting-external'
  | 'restart-disarmed'
  | 'ownership-changed'
  | 'session-archived'
  | 'provider-error'
  | 'persistence-failed'
  | 'no-progress'
  | 'round-limit'
  | 'token-limit'
  | 'repeated-blocker'
  | 'stale-revision'
```

Every stop event includes a user-facing explanation and next action. No stopped Goal remains labeled active or running.

## IPC And Event Surface

Add backend-owned mutations rather than allowing the renderer to edit Goal JSON:

- `goal:create`
- `goal:pause`
- `goal:resume`
- `goal:edit`
- `goal:cancel`
- `goal:clear`

Every mutation carries session id plus expected Goal id/revision and returns the authoritative state. Edit, resume, cancel, and clear reject stale revisions. `goal:create` additionally carries the visible initial message and performs the atomic creation/admission contract above.

Add one `goal_state_changed` session event with the full render-safe Goal state. The normal `complete` event remains the turn-completion signal; it is not overloaded to mean Goal completion.

## Observability

Structured logs must record Goal id, revision, session id, round, reservation id, provider, stop code, and admission result. They must not log prompt bodies, credentials, or hidden continuation content.

Metrics should distinguish:

- Goal created, resumed, completed, cancelled, blocked, and budget-limited
- continuation proposed, admitted, invalidated, and failed
- stop reason
- rounds and approximate cost per completed Goal

## Acceptance Tests

Implementation checkpoint (2026-08-30): slices 1–4 are implemented and pass focused tests. Full typecheck, the Artist OS renderer build, and live Electron creation/review/start/paused/edit/stop UI paths pass. Slice 5 is not complete: a live provider rate limit prevented multi-round completion plus native/fallback steering and restart-disarm certification. The observed failure paused the Goal without spinning. Do not present Goal Mode as shipped until those remaining live gates pass.

### State And Persistence

- explicit `/goal` and `$goal` creation; no inferred activation
- one active Goal per chat
- session header round-trip for every state
- append-only Goal events preserve prior Goal history when a new Goal starts
- Goal creation, first visible message, and created event are durable before acknowledgement
- provider failure after acknowledged creation pauses without losing the user message
- restart converts active to paused before any provider call
- failed restart-disarm persistence leaves the session non-runnable
- edit increments revision and invalidates a reserved continuation
- stale IPC mutations reject without changing state
- completion history remains after a new Goal begins

### Continuation And Races

- exactly one next round after one qualifying completion
- completion and blocked tool calls remain provisional until a successful terminal barrier
- interruption or crash after a completion tool call cannot produce false completion
- duplicate complete events cannot create two rounds
- queued human input always runs before Goal continuation
- Pause/Edit/Stop between settle and admission wins the race
- only admitted Goal turns consume a round
- native steers, queued fallback steers, and auto-continuations obey their defined turn accounting
- persistence failure prevents continuation and becomes visible
- no-progress, future-wait, approval, auth, provider-error, and uncertain-outcome paths never spin

### Providers

- Pi native steering preserves Goal state
- Claude delivered and undelivered steering paths preserve Goal state and message order
- default abort-and-queue backend preserves Goal state and message order
- OpenRouter/DeepSeek-style connections need no Goal-specific adapter
- provider/model switch at idle does not duplicate a round

### Safety

- Goal tools cannot raise permission mode or budget
- `create_goal` without a matching host confirmation nonce cannot activate a Goal
- one-time approvals do not cross turns
- pending plan execution cannot be cleared or bypassed by a hidden Goal turn
- pending approval/auth pauses before continuation
- fork cannot arm both parent and child
- archive/delete and Team Mode ownership change stop continuation
- model cannot self-resume a disarmed Goal

### UX

- setup, active, paused, blocked, budget-limited, complete, and cancelled states render
- hidden continuation does not appear as a user bubble or session preview
- keyboard and screen-reader access cover all controls
- status is understandable without color
- Electron smoke proves create, steer, pause, edit, resume, cap, completion, restart disarm, and stop

## Implementation Slices

1. Shared Goal schema, validators, session persistence, stop codes, and state-machine tests.
2. Backend Goal mutations, session tools, revision fences, and restart/fork/archive disarm behavior.
3. `ChatGoalDriver` admission at the durable idle boundary, hidden continuation, queue priority, no-spin rules, and race tests.
4. Slash and `$goal` parsing, setup sheet, Goal strip, transcript markers, typed stop UX, and accessibility tests.
5. Cross-provider integration tests, full typecheck/build, and live Electron smoke on at least one native-steering and one fallback-steering backend.

Do not present the feature as shipped until all five slices pass. Backend tests alone do not prove the chat UX or restart behavior.

## Reference Design Inputs

- OpenAI Codex Goal tools and lifecycle: explicit creation, bounded budgets, completion/blocked audits, and user-owned pause/resume controls.
- Pi agent RPC: distinct steer, follow-up, abort, and queue semantics at step boundaries.
- Attractor coding-agent loop: provider-independent loop structure and tool-execution boundaries.
- Tau queued steering: runtime-owned queue, persistent session state, presentation-only UI.

Only concepts compatible with this repository's Apache-2.0 licensing and current architecture are used. No external harness is imported.

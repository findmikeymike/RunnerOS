# Team Mode Coordination Upgrades

Status: implemented
Owner: RunnerOS
Last updated: 2026-06-12

Three upgrades to the intelligence, reliability, and power of Team Mode. All are
self-contained in the teams branch; the engine lives in `packages/shared` with
unit coverage, wired into the runtime in `packages/server-core`.

## U1 — Event-driven coordination + durable wakes

The old loop was poll-only (15s) and fired wakes as fire-and-forget prompts.

- **Optimistic concurrency + serialization.** `TeamRunSnapshot.rev` is bumped on
  every persisted mutation (`touchTeamRun`). `withRunMutationLock(root, runId, fn)`
  (`run-mutation-queue.ts`) serializes runtime async read-modify-write paths per
  run in a single process. `writeTeamRunGuarded(run, expectedRev)` is available
  for callers that need explicit stale-write detection; it is not a global
  distributed lock, so cross-process writers must opt into guarded writes.
- **Durable mailbox** (`mailbox.jsonl`). Tick wake actions become persisted
  mailbox entries (`enqueueTeamWake`) with a delivery state machine
  (`pending → delivered → acked`, `pending → failed` after the attempt budget).
  `SessionManager.tickManagedTeamRun` enqueues then `drainTeamRunMailbox`
  delivers; a failed delivery is **retried** on the next drain instead of being
  lost. Wakes coalesce by `(target, task, kind)` to prevent spam (latest body
  wins). Re-enqueueing a delivered-but-unacked member wake makes it pending again
  so a member that never claims the task does not suppress future delivery.
  Member wakes are acked when the member claims the task; lead-directed wakes
  are acked on delivery. Terminal wakes are pruned to a bound.
- **Reactive signal** (`run-signal.ts`). Mutations emit an in-process signal so
  the runtime ticks the affected run within ~250ms (debounced, 1s cooldown)
  instead of waiting for the 15s sweep. This is a local-process fast path; the
  15s sweep remains the cross-process and crash-recovery completeness net.

## U2 — Canonical delegation envelope (`packages/shared/src/delegation`)

One contract for "agent A delegated a bounded task to agent B and got a
structured result": `DelegationReceipt` + `DelegationResult` +
`PermissionInheritance`. A team lead waking a member for a task records a receipt
(`delegations.jsonl`) linking parent → child session → team task. After the
child turn completes, the receipt is persisted as succeeded with the last
assistant output, completed tool-use summary, and the permission-inheritance record
(`clampPermissionMode`: a child may never exceed its parent).

### Adapter path to `message_agent`

The field shape is deliberately aligned with the `agent-messaging` branch's
`AgentMessageReceipt` / `MessageAgentResult`. When that branch merges:

1. Re-home `AgentMessageReceipt` onto `DelegationReceipt` (or `export type
   AgentMessageReceipt = DelegationReceipt`) — fields match; `teamRunId` /
   `teamTaskId` are optional and ignored by non-team callers.
2. `MessageAgentResult` ≡ `DelegationResult` (same fields) — use
   `toDelegationResult(receipt)` to project.
3. `message_agent`'s service emits a `DelegationReceipt` via the same
   create/succeed/fail helpers; the team path already does. No second
   integration project — only a thin alias + the AgentMessageService writing
   through the canonical helpers.

## U3 — Structured outputs + evidence-gated review

- **Output schemas.** A task may carry an `outputSchema` (JSON Schema). Moving it
  to `review`/`done` validates `output` against the schema (reusing
  `workflows/output-schema.ts`) and rejects on mismatch. Surfaced to the owner in
  the wake prompt.
- **Evidence-gated review.** A review cannot pass (`review.status = 'passed'`)
  without at least one `evidence` item — "passed" is never a bare assertion.
- **Auto-reopen revise loop.** A failed review reopens the task to its owner
  (`status → todo`, review cleared, findings preserved in `reviseFindings` and
  injected into the next wake prompt) instead of dead-ending. A `maxRevisions`
  budget (distinct from the claim-retry `maxAttempts`) fails the task rather than
  looping forever.

## Tests

`packages/shared/src/teams/{run-versioning,run-review,run-mailbox,run-delegation}.test.ts`
and `packages/shared/src/delegation/receipt.test.ts` cover the engine. Runtime
wiring is exercised by `packages/server-core/src/sessions/team-boundaries.test.ts`.

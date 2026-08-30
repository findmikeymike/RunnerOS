---
status: current
owner: agent
last_verified: 2026-08-30
source_of_truth: true
extends: ./13-scheduled-work-composer-execution-spec.md
---

# Bounded Goal Continuation Driver

## Purpose

Let HNIC continue a confirmed, unfinished agent objective across a small number of durable Scheduled Work rounds without creating a generic autonomous loop or weakening any approval boundary.

The driver is for work such as research, planning, drafting, and analysis that may need more than one agent turn. It is not an automatic publisher and it is not triggered by an idle chat session.

## Product Contract

The user asks HNIC to keep working toward one explicit Goal. HNIC confirms the objective, Goal context document, completion Output, and maximum rounds, then creates one continuation run.

One stable coordinator order owns the Calendar link and visible state. Each round is a hidden child `agent-task` Scheduled Work order. The runner advances only after the prior session reaches a durable terminal state, its session/output persistence barrier has completed, and the Output contract is still unmet. Producing the required Output completes the coordinator. A failure, approval boundary, revision change, round limit, restart, or ownership-fence change stops it visibly.

## Non-Goals

- No generic "loop until the model says done."
- No continuation from a session becoming idle.
- No reuse of a live chat session as durable execution state.
- No automatic social publishing, outreach, purchasing, deletion, or other external side effect.
- No carrying an approval across a changed objective, prompt, payload, account, asset, or revision.
- No attempt to turn all context-doc Goals into executable runs.

## Two Separate Layers

### Goal Definition

The existing Goal context document remains the authored source of truth:

- slug
- objective/body
- `active | blocked | paused | done`
- priority and deadline

Its revision is the deterministic digest of the Goal metadata and body. Editing the Goal changes that revision.

### Goal Run

Runtime state belongs to Scheduled Work, not Goal metadata. The coordinator and every continuation round carry:

- stable `runId`
- `goalSlug` and captured `goalRevision`
- exact objective snapshot
- `round` and `maxRounds`
- initial and parent work-order ids
- armed runtime instance id
- captured runner-ownership fence
- `safe` permission ceiling

The coordinator is never executable. It is `waiting` while a child is scheduled or running, `done` only when the completion Output exists, and `needs-attention` when the run stops. Hidden children preserve exact round/session history without creating Calendar clutter.

The Goal can remain `active` while a particular run is disarmed or blocked. Runtime safety must never silently rewrite the user's authored Goal status.

## Creation Contract

Continuation is available only for HNIC-created Calendar `agent-task` work in V1.

HNIC must have explicit user confirmation for:

- exact Goal context doc
- objective
- agent
- completion Output contract
- maximum rounds
- start time and timezone

Hard validation:

- Goal exists, is enabled, and has status `active`.
- `expectedOutput.requirement` is `required`.
- `maxRounds` is an integer from 2 through 8.
- permission mode is `safe`; V1 continuation is draft/output-only and cannot request a broader mode.
- automation destinations, workflows, reviews, and social work cannot carry continuation metadata in V1.

The idempotency digest includes the entire continuation definition. Reusing a key with any changed objective, Goal revision, maximum, agent, permission mode, Output contract, or schedule is rejected.

## Advancement State Machine

```text
waiting coordinator + scheduled hidden round
  -> claimed/running
  -> session terminal
       -> persistence barrier completes
            -> required Output satisfied: child done; coordinator done
            -> required Output absent and rounds remain: child done; create one successor; coordinator waiting
            -> required Output absent at limit: child + coordinator needs-attention(round-limit)
            -> execution/session/post-process failure: child + coordinator needs-attention; no successor
            -> Goal revision/status mismatch: child + coordinator needs-attention(goal-revision-changed); no successor
            -> runtime instance mismatch: child + coordinator needs-attention(continuation-disarmed); no successor
```

Missing Output is an advancement signal only for an otherwise successfully completed continuation session. It does not convert crashes, interrupted sessions, missing sessions, tool failures, or post-processing failures into retries.

## Durable Atomicity

Finishing a round, updating the coordinator, and creating its successor happen under the existing workspace-context lock in one Scheduled Work document write.

The successor id is deterministic from `runId`, `goalRevision`, and round number. Reconciliation may retry the mutation, but it must never create two successors.

The Calendar always links to the coordinator. Children use reserved hidden link ids and never become a second visible Calendar item. Therefore intermediate rounds cannot make the Calendar claim the Goal run is complete.

Only a round that successfully transitions from `scheduled` to `running` consumes budget. Deferred work above the concurrency cap does not.

The revision and runtime fences are verified:

1. before claim
2. immediately before agent execution
3. before accepting terminal session state
4. after the session/output persistence barrier
5. inside the locked completion/successor mutation

If any fence fails, the order moves to visible attention and no successor is released.

## Restart And Ownership Safety

Each process creates a fresh opaque Scheduled Work runtime id. A continuation is armed only for the runtime id and Team Mode/solo ownership fence recorded when the user confirmed it.

After app restart, crash recovery, workspace-runner ownership change, or Team Mode fence change, the persisted runtime id no longer matches. The run disarms and requires a fresh explicit HNIC/user re-arm. It never resumes merely because the Goal is still active.

Re-arm captures the current Goal revision, produces a new execution payload digest/idempotency key for future rounds, and clears no historical receipts. If the Goal changed, HNIC must restate the changed objective before the user confirms re-arm. A child that never started and has no run receipt may be re-armed in place without spending round budget. Re-arm never retries a child whose terminal outcome is uncertain; started or terminal children require a new deterministic child round from a coordinator attention state.

## Completion Barrier

`lastFinalMessageId` alone is not a sufficient terminal signal for continuation. Before testing Outputs or creating a successor, SessionManager must attest that:

- the agent turn is no longer processing
- its message queue is empty
- the final assistant message and session metadata have been durably persisted
- Output creation initiated by that turn has completed its synchronous write path

The runner consumes this attestation through one completion-state dependency. It must not substitute an arbitrary sleep. If the barrier cannot be proven after restart, the continuation disarms for review instead of treating a temporarily missing Output as an unfinished Goal.

## Prompt Contract

Every continuation prompt includes bounded machine-authored context:

- objective snapshot
- Goal slug and revision
- current round and maximum
- completion Output contract
- prior round session id and Output ids, when present
- instruction to produce the required Output only when the objective is genuinely complete
- instruction that external actions require their normal separate approval path

The agent cannot alter the round counter, revision, permission ceiling, or completion contract through its response.

## Approval And Side-Effect Boundary

Continuation rounds are agent tasks only. They may prepare Outputs, drafts, plans, or proposed actions.

Any later live social action remains a separate `social-publish` order with its exact dry run, payload digest, account/profile binding, approval expiry, idempotency guard, and receipt. Continuation never copies or synthesizes that approval.

The inherited `safe` permission mode is a ceiling. A successor cannot request `ask` or any broader mode.

## Visible Failure Reasons

Add these Scheduled Work attention reasons:

- `goal-not-active`
- `goal-revision-changed`
- `continuation-disarmed`
- `continuation-round-limit`
- `continuation-state-invalid`

Each message states what stopped, whether work may already exist, and the next human action. No stopped continuation remains labeled `running`.

## V1 Interface

Extend HNIC `schedule_work` Calendar agent tasks with an optional `continuation` object:

```ts
{
  goalSlug: string
  objective: string
  maxRounds: number // 2..8
}
```

The backend, not HNIC, resolves the Goal revision, assigns the run id, records the runtime id, and creates round one.

Add an HNIC-only `manage_goal_run` tool and matching backend mutation keyed by `runId` and the coordinator's `expectedUpdatedAt`. V1 operations are `rearm`, `pause`, and `cancel`; every operation requires an explanation and resolved user confirmation. Re-arm revalidates the Goal, agent, completion contract, permission ceiling, runtime ownership, and remaining budget.

The Calendar details expose the same backend mutation as `Review and resume`, `Pause`, and `Cancel` controls. The UI never edits continuation JSON directly.

## Verification Requirements

Focused tests must prove:

- invalid/non-active Goal rejection
- required Output and max-round validation
- idempotency definition includes continuation fields
- successful first-round Output completes without a successor
- successful no-Output round atomically creates exactly one successor
- coordinator remains the truthful Calendar-linked state across child rounds
- duplicate scans cannot create duplicate successors
- concurrent mutation cannot cross the Goal revision fence
- edited, paused, blocked, done, missing, or malformed Goals stop continuation
- restart/runtime mismatch disarms before execution
- ownership/team fence changes stop before execution and before successor creation
- interrupted/missing/failed sessions do not consume retry rounds
- only claimed rounds consume budget
- round limit becomes visible attention
- successor preserves agent, inputs, Output contract, and permission ceiling
- no social/workflow/review continuation payload parses as valid
- a final message without a completed persistence barrier cannot advance
- re-arm/pause/cancel require a current coordinator version and explicit confirmation

Then run Scheduled Work tests, HNIC scheduling tests, session-tool tests, full typecheck, and the broad relevant suite. This backend slice does not claim live Electron UX verification until `Review and resume` is wired and smoke-tested.

## Implementation Slices

1. Shared continuation schema, validation, digest, and attention reasons.
2. HNIC schedule-work input and atomic coordinator plus round-one persistence.
3. Session completion attestation, runner runtime/revision fences, and atomic successor reconciliation.
4. HNIC/backend re-arm, pause, and cancel mutations with tests.
5. Calendar coordinator controls and Electron smoke.

Slices 1-4 form the safe execution substrate. Slice 5 is required before presenting continuation as a finished user-facing feature.

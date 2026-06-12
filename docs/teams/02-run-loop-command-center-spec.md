# Teams Run Loop + Command Center Spec

## Summary

Team Mode now has durable teams, runs, tasks, messages, leases, reviews, approvals, and member-to-lead handoff. The next foundational step is not more agent magic. It is a reliable operating layer:

1. A **Team Run Loop** that periodically advances team runs, expires stale leases, wakes the right session, and records what happened.
2. A **Run Command Center** that lets the operator understand and control a team run without opening every agent chat.

The goal is a small, durable local orchestrator, not a new external workflow engine.

## Research Inputs

Relevant patterns from durable orchestration systems:

- Temporal treats a workflow execution as durable and recoverable, with state persisted so execution can resume after failure: https://docs.temporal.io/workflow-execution
- Temporal separates read queries, async write signals, and tracked write updates; RunnerOS should mirror that distinction with read RPCs, durable state writes, and best-effort wake notifications: https://docs.temporal.io/encyclopedia/workflow-message-passing
- Temporal warns that message handlers need attention to atomicity, completion ordering, exceptions, and idempotency: https://docs.temporal.io/handling-messages
- Cloudflare Agents scheduled tasks persist scheduled work and can run delayed, dated, cron, or interval jobs: https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/
- Cloudflare Think scheduled tasks reconcile declarations on startup, store durable one-shot schedules, then re-arm after each run: https://developers.cloudflare.com/agents/harnesses/think/scheduled-tasks/

RunnerOS implication: the run loop should persist tick records, be idempotent, re-arm from stored state on app startup, and treat session wakeups as best-effort side effects after durable state changes.

## Current State

Already built:

- Saved team definitions.
- Team run storage under `.runneros/teams/runs/<runId>/`.
- Lead session creation when a run starts.
- Member wake/create when tasks are assigned.
- Durable task board with status, output, evidence, approval, review, retry, lease, heartbeat, and stale lease expiry primitives.
- Internal team messages and events.
- Operator controls: pause, resume, cancel.
- Owner lease enforcement for `update_team_task`.
- Lead handoff notification when tasks finish, block, enter review, fail, or direct messages are sent to lead.

Main gaps:

- No automatic tick loop.
- No visible run detail command center.
- No operator-facing approval/review queue.
- No recovery view for stale leases, failed tasks, or sleeping sessions.
- No clean "all work done -> lead final answer -> run complete" product path.

## Product Goal

Make a team run feel like a controllable operating room:

- The system notices stale or blocked work.
- The lead is woken when coordination is needed.
- The operator can see the state in one place.
- Risky actions wait for explicit approval.
- Durable task state remains the source of truth.
- Notifications never corrupt or block durable state progress.

## Non-goals

- No external Temporal dependency in this slice.
- No autonomous publishing, spending, deleting, or external actions.
- No free-form multi-agent graph editor.
- No unbounded background token spend.
- No cross-machine distributed locking.
- No hidden auto-resume after crash without visible audit trail.

## Core UX

### Teams Library

Keep the card-first Teams page. Each card should show:

- team name and lead
- active run count
- blocked task count
- approval count
- latest run state
- last activity

Primary actions:

- Open team
- Start run
- Create team
- Edit / duplicate / archive

### Team Detail

Clicking a team opens its command center.

Required regions:

- **Run switcher:** current and recent runs for this team.
- **Run header:** state, lead, started time, last tick, policy summary.
- **Operator controls:** pause, resume, cancel, wake lead, run tick now.
- **Task board:** todo, in progress, blocked, review, done, failed.
- **Approval queue:** all requested user approvals, with approve/reject.
- **Team inbox:** internal messages filtered by all, lead, member, unread.
- **Timeline:** events, ticks, lease expiry, retries, approvals, review requests.
- **Sessions strip:** lead/member session IDs, last wake, active/stale indicator.

The first screen should answer:

- Who owns what?
- What is stuck?
- What needs me?
- What did the team last do?
- What can I safely press next?

## Runtime Design

### Team Run Loop

Add a local loop owned by server-core. It should run only while RunnerOS is open.

Responsibilities per tick:

1. Load active workspaces.
2. Find team runs where state is `created`, `running`, `blocked`, or `review`.
3. Skip paused, cancelled, failed, and done runs.
4. Expire stale leases using existing storage logic.
5. Wake the lead if:
   - any lease expired
   - any task is blocked
   - any task is in review
   - all tasks are done but finalization has not happened
   - no task activity has happened past the stale threshold
6. Wake eligible members when:
   - task is `todo`
   - owner has no active lease
   - run concurrency limit has room
   - task is not in retry backoff
7. Append a tick record.
8. Broadcast updated run detail to the renderer.

The loop must be idempotent. Re-running the same tick should not duplicate task updates, spam sessions, or change final states.

### Tick Cadence

Default:

- every 30 seconds while app is active
- manual "Run tick now" from command center
- one startup recovery tick after workspace/session restore

Guardrails:

- no tick for paused or terminal runs
- no more than one active tick per workspace
- no more than one lead wake for same reason within `leadWakeCooldownMs`
- no member wake while a task has an active unexpired lease

### Durable Tick State

Add:

```text
<workspace>/.runneros/teams/runs/<runId>/ticks.jsonl
```

Type sketch:

```ts
type TeamRunTickReason =
  | 'scheduled'
  | 'manual'
  | 'startup-recovery';

type TeamRunTickAction =
  | 'expired-lease'
  | 'woke-lead'
  | 'woke-member'
  | 'no-op'
  | 'finalization-needed'
  | 'error';

type TeamRunTick = {
  id: string;
  runId: string;
  reason: TeamRunTickReason;
  startedAt: string;
  completedAt: string;
  actions: Array<{
    type: TeamRunTickAction;
    taskId?: string;
    agentSlug?: string;
    sessionId?: string;
    message?: string;
  }>;
  error?: string;
};
```

Do not store huge prompts or transcripts in tick records. Link to tasks/messages/events.

### State Model Additions

Add to `TeamRunSwarmPolicy`:

```ts
autoRun?: boolean;              // default true
tickIntervalMs?: number;        // default 30000
leadWakeCooldownMs?: number;    // default 120000
memberWakeCooldownMs?: number;  // default 60000
```

Add to `TeamTask` if needed:

```ts
lastWakeAt?: string;
lastWakeReason?: string;
```

Avoid adding a separate scheduler DB unless JSONL proves insufficient.

### Finalization Protocol

When all non-failed tasks are done:

1. Run loop wakes lead with finalization prompt.
2. Lead reads tasks/messages.
3. Lead sends final user answer in lead session.
4. Lead marks run complete through a new tool:

```ts
complete_team_run({
  runId: string;
  summary: string;
  evidence?: TeamTaskEvidence[];
})
```

Runtime rules:

- Only lead can complete a team run.
- Completion fails if required approval/review gates are unresolved.
- Completion stores `completedAt`, final summary, and emits `run.completed`.
- If the team run is backing a workflow step, workflow completion happens from this durable run completion.

This is stronger than silently marking the run done when tasks finish.

## RPC / Tool Surface

### Server RPC

Add:

- `teamRuns.TICK(workspaceId, runId, reason?)`
- `teamRuns.LIST_TICKS(workspaceId, runId)`
- `teamRuns.WAKE_LEAD(workspaceId, runId, reason?)`
- `teamRuns.WAKE_MEMBER(workspaceId, runId, agentSlug, taskId?)`

Keep UI task mutation restricted. The operator can approve/reject, pause/resume/cancel, manually tick, and wake sessions. Task work remains agent-owned.

### Session Tools

Add:

- `complete_team_run`
- `list_team_ticks`

Keep:

- `claim_team_task`
- `heartbeat_team_task`
- `expire_stale_team_tasks`
- `send_team_message`
- `request_team_review`
- `request_user_approval`

## Command Center Controls

Required controls:

- Pause run
- Resume run
- Cancel run
- Run tick now
- Wake lead
- Wake task owner
- Expire stale leases
- Approve / reject user approval
- Copy run summary
- Open lead/member session

Controls should show disabled states with reasons:

- terminal run
- paused run
- no lead session
- no owner session
- active lease still valid
- approval already decided

## Reliability Rules

1. Durable writes first, notifications second.
2. Notifications are best-effort and logged.
3. Tick actions must be idempotent.
4. No direct UI task work except approval decisions.
5. Every automatic wake must append an event or tick action.
6. No hidden final completion. Lead must explicitly complete the run.
7. Stale leases should retry only within max attempts/backoff.
8. Paused runs must not tick.
9. Terminal runs must not mutate.
10. Startup recovery should mark suspicious running leases stale/expired, not pretend they are healthy.

## Implementation Plan

### Phase 1: Spec-backed storage and tick primitives

- Add tick types and `ticks.jsonl` storage helpers.
- Add `runTeamRunTick(workspaceRootPath, runId, reason)` core function.
- Reuse existing lease expiry and run state derivation.
- Add unit tests for:
  - paused/terminal no-op
  - stale lease expiry records tick action
  - blocked task wakes lead once per cooldown
  - todo task wakes member only if concurrency allows

### Phase 2: SessionManager integration

- Add run loop manager in server-core.
- Register startup recovery tick.
- Add manual tick RPC.
- Add wake lead/member RPCs.
- Add best-effort notification wrappers for all tick wakeups.
- Add session-tool `complete_team_run`.

### Phase 3: Command center UI

- Split Teams page into:
  - library/cards view
  - team detail command center
  - run detail panels
- Add task board columns.
- Add approval queue.
- Add inbox.
- Add timeline with events + ticks.
- Add operator control bar.

### Phase 4: Finalization

- Add final summary fields to `TeamRunSnapshot`.
- Add `complete_team_run` tool and tests.
- Wire workflow team step completion to durable run completion, not task-count inference alone.
- Add UI final summary display.

### Phase 5: Hardening

- Add startup recovery tests.
- Add duplicate-wake suppression tests.
- Add renderer smoke test for command center.
- Add docs for how teams should operate.

## Acceptance Criteria

- A team run with a stale member lease gets detected without user intervention.
- The lead is woken when a task blocks, enters review, fails, or needs finalization.
- A todo task can wake its owner only when concurrency and retry policy allow it.
- A paused run does nothing on scheduled tick.
- A done/cancelled/failed run does nothing on scheduled tick.
- Operator can see tasks, inbox, approvals, timeline, sessions, and controls in one command center.
- Operator can approve/reject approval requests without exposing raw task mutation.
- Lead can explicitly complete a run.
- Workflow-backed team runs complete from durable team run completion.
- Tests cover tick idempotency, cooldowns, stale leases, approval decisions, finalization, and UI disabled states.

## Open Decisions

- Should auto-run default on for every team, or only for teams marked `standing`?
- Should failed tasks fail the whole run immediately, or require lead triage first?
- Should lead finalization be required for every run, or only workflow-backed / multi-task runs?
- Should tick cadence be global, per workspace, or per run policy?

Recommended defaults:

- `autoRun: true` for active runs.
- Failed task moves run to `failed` only after retry limit; otherwise lead triage.
- Lead finalization required for all multi-task runs.
- Per-run policy with workspace-level defaults.

## First Build Slice

The highest-value first implementation slice is:

1. Add tick storage.
2. Add manual `teamRuns.TICK`.
3. Tick expires stale leases and wakes lead on blocked/review/finalization-needed.
4. Add command center panels for tasks, approvals, inbox, timeline, and controls using existing run detail data.

Do not start with visual polish or broad automation. Start with a visible, testable, durable tick loop.

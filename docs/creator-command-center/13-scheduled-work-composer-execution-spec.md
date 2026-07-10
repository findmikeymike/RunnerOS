---
status: current
owner: agent
last_verified: 2026-07-09
source_of_truth: true
extends: ./12-campaign-calendar-scheduled-jobs-spec.md
---

# Scheduled Work Composer And Execution

## Purpose

Define the product and engineering contract for scheduling events, agent tasks,
workflow runs, reviews, and social publishing from the HQ and Campaign calendars.

This spec defines the shipped compact, progressively disclosed campaign composer.
It also defines what each queued action means,
how it completes, where it is stored, and which safety rules cannot be bypassed.

The experience must be simple for a reminder and powerful enough for this chain:

```text
Ask a selected agent to create a campaign Output,
hold it for review,
then publish the approved Final to one exact social profile.
```

## Relationship To Spec 12

`12-campaign-calendar-scheduled-jobs-spec.md` remains the foundation for:

- campaign calendar purpose and separation from HQ
- calendar item storage
- one-shot scheduler behavior
- exact approval principles
- missed-job handling
- external calendar safety

This spec is the source of truth for:

- the Schedule Work composer
- HQ versus Campaign scheduling behavior
- typed queue choices
- agent, workflow, asset, and social selectors
- output and completion contracts
- multi-step follow-up actions
- implementation sequencing from the current codebase

If the specs conflict on composer behavior or completion semantics, this spec wins.

## Current State

Verified implementation now includes:

- Campaign Calendar as its own campaign navigation page
- a guided composer for Event, Agent Task, Workflow Run, Social Publish, and Review / Approval
- active agent/workflow selection plus Output, Final, Primary Final, and eligible Vault references
- backend-owned schedule, cancel, migrate, and review-decision mutations with workspace-context locking
- one-shot due scanning on startup and scheduler ticks
- durable agent/workflow launch receipts and terminal-state polling
- required-Output contract enforcement for agent work
- run history, missed-window handling, cancellation, recovery, and explicit attention reasons
- Output/Final Schedule prefill
- Settings-backed social profile selection
- social dry-run preparation, exact approval binding, approval invalidation, and media-byte fingerprinting
- native live social execution with exact account, browser partition, draft, media, and success-proof checks
- per-profile social serialization plus persisted running claims that stop duplicate scheduler execution
- durable review decisions with approve and changes-requested states
- Agent -> Review, Agent -> Workflow, Workflow -> Review, and Review -> Social follow-up chains
- exact produced-Output resolution with visible recovery when zero or multiple Outputs match
- HQ Event and agent/workflow scheduling plus explicit routing into the primary Campaign Calendar

Remaining gaps:

- the shipped UI and runner still need full real-app smoke across every queue type
- each supported social platform needs a live-account publish smoke; selector drift fails closed and must never create a receipt
- YouTube Shorts remain deliberately blocked until media classification can be proven before submit
- HQ review and social work remain intentionally routed to Campaign Calendar, where their decision and recovery controls live

## Product Decisions

### 1. Events And Work Orders Are Different

A Calendar Event is something the user needs to remember, attend, or review.

A Work Order is something RunnerOS must execute and track.

Do not put every field into one event schema. A calendar entry may link to one
work order, but an event is not itself an execution payload.

### 2. Calendars Stay Separate

```text
HQ Calendar
  Global commitments, meetings, release shells, deadlines, Google sync.

Campaign Calendar
  Campaign execution, assets, agents, workflows, approvals, receipts.
```

Both calendars use the same composer shell. They do not share calendar storage.

### 3. Executable Work Has One Owner

Every Work Order has one owning workspace:

- HQ-owned work runs in the HQ workspace.
- Campaign-owned work runs in that campaign workspace.

HQ may display a linked campaign milestone, but it must not duplicate or execute
the campaign job.

### 4. Queue Types Are Typed

The UI must not serialize all work as a generic prompt.

Supported choices:

- Event / Reminder
- Agent Task
- Workflow Run
- Social Publish
- Review / Approval

Outreach Batch remains hidden until its execution and safety contract is ready.

### 5. Starting Is Not Completion

Launching a session or workflow is not a completed job.

Completion is based on the selected queue type:

- Agent Task: session completed and required Output contract satisfied.
- Workflow Run: workflow reached a terminal successful state.
- Social Publish: external executor returned a valid receipt.
- Review: explicit approval or changes-requested decision recorded.
- Event / Reminder: manually completed or informational only.

### 6. Social Publishing Is Deterministic

An agent may prepare content, but live publishing uses a dedicated exact-action
executor. A generic agent session must never bypass profile verification,
dry-run matching, exact approval, or receipt creation.

## User Mental Model

The user answers five plain-language questions:

```text
What should happen?
Where should it happen?
Who or what should do it?
What should it use or produce?
When should it happen?
```

The composer turns those answers into typed data. The user never sees:

- actionType
- payloadDigest
- approvalPolicy
- idempotencyKey
- workflow slug text entry
- raw JSON payloads

## Entry Points

The same composer opens from:

- HQ Calendar date
- Campaign Calendar date
- Output detail Schedule action
- Final or Primary action menu
- workflow completion Schedule action
- agent/chat scheduling intent
- failed or missed item Reschedule action

Entry points provide defaults but never silently finalize a risky action.

### HQ Calendar Entry

The first choice is:

```text
Add HQ event
Queue HQ work
Queue campaign work
```

`Queue campaign work` requires a campaign selection, then writes only to the
selected Campaign Calendar. HQ may optionally receive a linked read-only shell.

### Campaign Calendar Entry

The campaign and selected date are prefilled and not shown as unnecessary steps.

### Output Or Final Entry

Prefill:

- owner workspace
- campaign when available
- exact Final pointer, preferring Primary
- Output pointer when no campaign Final exists
- suggested queue types: Social Publish, Review, Agent Task

## Composer Form Factor

### Desktop

- modal width: 560-640px
- maximum height: 80vh
- fixed header and footer
- scroll only the active section body
- no nested cards
- use section rows separated by subtle dividers

### Small Windows

- full-height side sheet or full-screen dialog
- footer remains visible above the window edge
- picker results use the same surface instead of opening nested modals

### Interaction Rule

Only one section is expanded at a time.

Completed sections collapse into editable summary rows:

```text
Agent Task
Campaign: Summer Release
Agent: Content Genius
Inputs: Primary cover, campaign brief
Produces: Social Copy Output
When: Friday at 10:00 AM CT
```

Selecting a summary row reopens that section without losing later answers unless
the changed answer makes them invalid.

## Composer Sections

### Section 1: What Should Happen?

Use a vertical command list with icons and short descriptions:

```text
Event / Reminder   Add a date, deadline, meeting, or checkpoint
Agent Task         Ask one agent to complete a defined deliverable
Workflow Run       Run an activated multi-step workflow
Social Publish     Publish an exact asset to one configured profile
Review / Approval  Request a decision on an Output or Final
```

Do not use large marketing cards.

### Section 2: Where Does It Belong?

Fields appear only when unresolved:

- scope: HQ or Campaign
- campaign picker
- owning workspace
- optional read-only HQ rollup toggle for campaign milestones

Campaign entry points skip this section when ownership is already unambiguous.

### Section 3: Who Or What Runs It?

The selector changes by queue type:

- Agent Task: active agent selector
- Workflow Run: active workflow selector
- Social Publish: exact ready social profile selector
- Review: person or agent reviewer selector
- Event: optional people tags only

### Section 4: Inputs And Deliverable

Inputs may include:

- campaign Primary Final
- another exact campaign Final
- raw Output
- Vault asset
- local file imported into an owned asset location
- campaign context notes
- structured workflow trigger values

Agent Task and Workflow Run may define an expected deliverable.

### Section 5: Timing

Use action-specific labels:

- Event: `Starts` and optional `Ends`
- Agent Task: `Start work at` and optional `Due by`
- Workflow Run: `Run at`
- Social Publish: `Publish at`
- Review: `Request review at` and optional `Decision due`

Always store an IANA timezone. Display a local-time hint when the user is viewing
from a different timezone.

### Section 6: Safeguards

This section is normally summarized automatically.

Show controls only when the user has a real choice:

- local work: run automatically or ask before starting
- social: approval near execution by default
- exact preapproval: advanced and only when the payload is fully locked
- review: selected reviewer and decision policy

Never offer a control that weakens mandatory external-action safeguards.

### Footer Review Sentence

The footer always includes a plain-language execution summary.

Agent example:

```text
Content Genius will start in Summer Release on Friday at 10:00 AM and must
produce a Social Copy Output before this work is marked done.
```

Social example:

```text
The campaign Primary Final will be prepared for Instagram @artist-main at
6:00 PM. Exact approval is required before publishing.
```

## Queue Type Specifications

### Event / Reminder

Required:

- title
- date

Optional:

- time and end time
- notes
- people
- campaign link
- external calendar sync
- completion checkbox

No agent, workflow, approval payload, or execution controls are shown.

### Agent Task

#### Required Fields

- active agent
- brief
- start time
- owning workspace

#### Optional Fields

- source attachments
- expected Output contract
- due time
- permission posture
- review follow-up
- downstream publish follow-up

#### Agent Selector

Use `useAgents(workspaceId)` and show only agents active in the owning workspace.

Each result shows:

- display name
- role/description
- capability tags when available
- whether it is currently active

Do not auto-activate a global agent silently. Provide an explicit Activate action
or route to the agent library.

#### Brief

The brief is plain text plus structured attachments. It is stored as work-order
input, not hidden inside a calendar title.

The launched session receives:

- work order id
- campaign or HQ scope
- selected agent
- brief
- attachment pointers
- expected Output contract
- due time
- instruction to report blockers honestly

#### Expected Output Contract

```ts
type ExpectedOutputContract = {
  requirement: 'none' | 'optional' | 'required'
  kind?: OutputKind
  title?: string
  minimumCount?: number
  reviewRequired?: boolean
}
```

Defaults should be inferred from the selected agent but remain editable.

Examples:

- Content Genius -> document or text Output
- Video Editor -> video Output
- Art Director -> image Output
- Research agent -> report Output

Inference is a convenience, not proof. The selected contract controls completion.

#### Completion

State stays `running` after session launch.

Mark done only when:

1. the session reaches a successful terminal state, and
2. required Outputs exist with matching session/work-order origin, and
3. required review is complete.

If the session ends without a required Output:

```text
status: needs-attention
reason: required-output-missing
actions: Open session, Retry, Change requirement, Cancel
```

### Workflow Run

#### Required Fields

- active workflow
- valid trigger inputs
- run time
- owning workspace

#### Workflow Selector

Use `useWorkflows(workspaceId)` and show only activated workflows.

Display:

- workflow name
- description
- step count
- expected outputs when declared

Never ask the user to type a workflow slug.

#### Trigger Inputs

Render controls from the workflow trigger input contract:

- text -> text input
- enum -> menu
- boolean -> switch
- number -> number input
- asset reference -> asset picker

Validate before save and again before execution.

#### Version Binding

Store:

- workflow slug
- workflow content digest or version
- trigger inputs

If the workflow changes before execution:

- non-material metadata change: continue
- execution definition change: move to `needs-attention`
- actions: Review changes, Use latest, Cancel

#### Completion

State stays `running` while the workflow run is active.

On terminal state:

- completed -> collect linked Outputs, then done or awaiting review
- failed -> needs attention with failed step summary
- canceled -> canceled

### Social Publish

#### Required Fields

- one exact ready social profile
- platform
- caption/text
- publish time
- one exact Final or Output pointer

Platform-specific fields appear only when relevant:

- YouTube: post type, visibility, and made-for-kids audience
- Instagram: supported media/post format
- TikTok: supported media/post format
- X: optional media

#### Social Profile Selector

Use Settings social-account status.

Each result shows:

- platform icon
- profile label/handle
- account group
- ready, login required, or setup required

Disabled profiles explain the missing setup and provide an Open Settings action.

Execution stores exact `platform + profileId`, not only a display label.

#### Asset Picker

Group choices in trust order:

```text
Primary Final
Other Campaign Finals
Campaign Outputs
Vault Assets
```

Default selection:

1. prefilled exact Final from entry point
2. campaign Primary Final
3. another campaign Final
4. raw Output fallback

Never guess between multiple plausible Finals for live publishing.

#### Approval

Default behavior:

```text
Schedule -> prepare dry-run near execution -> needs approval -> execute -> receipt
```

Exact approval binds:

- owner workspace and campaign
- calendar item and work order ids
- run time
- platform and profile
- account group when used
- exact asset and media-byte digest
- caption/payload digest
- dry-run action id and action digest
- approval and expiration timestamps

Any bound-field change invalidates approval and dry-run state.

#### Live Execution

The live executor must:

1. regenerate or load the exact approved dry-run contract
2. verify action id and digest
3. verify visible account/profile
4. verify draft text and media
5. submit only when all checks match
6. return a structured receipt

Stop on:

- account mismatch
- asset mismatch
- caption mismatch
- login, 2FA, or CAPTCHA
- unsupported UI state
- upload failure
- missing receipt

### Review / Approval

Required:

- review target
- reviewer
- requested time or due time

Target may be:

- Final
- Output
- agent-created draft
- workflow result
- social dry-run

Decisions:

- approved
- changes requested
- canceled

Approval of a creative Output is not automatically approval for live publishing.

## Follow-Up Actions

After configuring a main action, show an optional `Then` row:

```text
Then: Request review
Then: Publish to social
Then: Run workflow
```

This is progressive disclosure for simple sequences, not a visual DAG editor.

### V1 Supported Chains

- Agent Task -> Review
- Agent Task -> Workflow
- Workflow -> Review
- Review -> Social Publish

### Deferred Chain

Agent Task -> Social Publish requires a produced-asset reference and review gate.
It should ship only after dynamic step-output binding is implemented safely.

### Step Reference

```ts
type WorkStepInputRef =
  | { kind: 'final'; outputId: string; assetId?: string }
  | { kind: 'output'; outputId: string }
  | { kind: 'produced-output'; stepId: string; selector?: { kind?: OutputKind } }
```

If a produced-output selector matches zero or multiple Outputs, stop for review.

## Canonical Work Order Model

Calendar storage remains separate, but executable work uses a shared domain model.

```ts
type ScheduledWorkOrder = {
  version: 1
  id: string
  owner: {
    scope: 'hq' | 'campaign'
    workspaceId: string
    campaignId?: string
  }
  calendarLink: {
    calendar: 'hq' | 'campaign'
    itemId: string
  }
  title: string
  type: 'agent-task' | 'workflow-run' | 'social-publish' | 'review'
  status:
    | 'draft'
    | 'scheduled'
    | 'needs-setup'
    | 'needs-approval'
    | 'running'
    | 'awaiting-review'
    | 'done'
    | 'needs-attention'
    | 'canceled'
  startAt: string
  dueAt?: string
  timezone: string
  execution: ScheduledWorkExecution
  inputRefs: WorkStepInputRef[]
  approvals: CampaignScheduleApproval[]
  runs: CampaignJobRun[]
  result?: ScheduledWorkResult
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
```

Typed execution union:

```ts
type ScheduledWorkExecution =
  | {
      type: 'agent-task'
      agentSlug: string
      brief: string
      permissionMode: 'safe' | 'ask'
      expectedOutput: ExpectedOutputContract
    }
  | {
      type: 'workflow-run'
      workflowSlug: string
      workflowDigest: string
      triggerInputs: Record<string, unknown>
    }
  | {
      type: 'social-publish'
      platform: string
      profileId: string
      accountSetId?: string
      caption: string
      platformOptions?: Record<string, unknown>
    }
  | {
      type: 'review'
      reviewerType: 'person' | 'agent' | 'user'
      reviewerId?: string
      decisionDueAt?: string
    }
```

Result union:

```ts
type ScheduledWorkResult =
  | { type: 'agent-task'; sessionId: string; outputIds: string[] }
  | { type: 'workflow-run'; workflowRunId: string; outputIds: string[] }
  | { type: 'social-publish'; receipt: CampaignExternalExecutionReceipt }
  | { type: 'review'; decision: 'approved' | 'changes-requested'; notes?: string }
```

## Persistence And Migration

### Target Architecture

Store work orders in a workspace-scoped `scheduled-work` context document.

- HQ work orders live in the HQ workspace.
- Campaign work orders live in the campaign workspace.
- calendar items store only `scheduledWorkId` plus display shell data
- Outputs and Finals remain their own source of truth
- social credentials remain in Settings

### Migration From Embedded Campaign Jobs

Current `CampaignCalendarItem.job` data must remain readable.

Migration strategy:

1. parser accepts embedded V1 jobs
2. mutation path creates equivalent work order once
3. calendar item receives `scheduledWorkId`
4. embedded job remains during one compatibility release
5. runner prefers work order when both exist
6. remove embedded execution only after migration tests and rollback coverage

Do not perform destructive bulk migration on first read.

### Concurrency

All calendar and work-order mutations use compare-and-swap or an atomic server-side
mutation. Renderer snapshots must never overwrite runner state.

## Status Presentation

User-facing statuses:

- Draft
- Scheduled
- Needs setup
- Needs approval
- Running
- Awaiting review
- Done
- Needs attention
- Canceled

Internal reasons remain structured:

```ts
type WorkAttentionReason =
  | 'agent-not-active'
  | 'workflow-not-active'
  | 'workflow-changed'
  | 'profile-login-required'
  | 'asset-missing'
  | 'required-output-missing'
  | 'execution-failed'
  | 'missed-start-window'
  | 'approval-expired'
  | 'approval-invalidated'
```

## Recovery Actions

Every blocked or failed state has one primary action.

| Reason | Primary action | Secondary actions |
| --- | --- | --- |
| Agent inactive | Activate agent | Choose another, Cancel |
| Workflow inactive | Activate workflow | Choose another, Cancel |
| Workflow changed | Review changes | Use latest, Cancel |
| Login required | Open login | Choose profile, Cancel |
| Asset missing | Choose asset | Cancel |
| Required Output missing | Open session | Retry, Relax requirement |
| Execution failed | Retry | Reschedule, Cancel |
| Missed | Run now | Reschedule, Cancel |
| Approval expired | Re-approve | Edit, Cancel |

## Calendar Item Presentation

Each executable item shows:

- action icon and title
- target agent/workflow/profile
- start or publish time
- compact status
- attached asset or expected deliverable
- latest result or blocker
- one primary action

Expanded details may show:

- run history
- session or workflow link
- linked Outputs
- approval summary
- external receipt

Do not show attempt counters or digests as primary UI.

## Agent Contract

Agents need read and write capabilities.

### Read

Add `campaign_calendar_read` or generic `scheduled_work_read`:

- list by date range
- list needs-approval
- list needs-attention
- get exact item/work order
- return ids required for update/cancel

### Write

The write tool must accept the same typed execution union as the composer.

Agents may:

- create local events when explicitly requested
- create or edit scheduled local work
- attach known Outputs and Finals
- cancel or reschedule work

Agents may not:

- invent an agent/workflow/profile that is not active
- mark their own task done without runtime evidence
- approve live external action on behalf of the user
- store credentials or private local paths
- bypass exact social approval

`requiresUserConfirmation: true` must block persistence until confirmation exists.

## Validation Rules

At compose time and execution time:

- owner workspace exists
- selected agent is active
- selected workflow is active
- workflow digest is current or approved
- social profile is configured and ready
- referenced Output/Final exists
- exact asset resolves inside the owning workspace
- start time is valid in the selected timezone
- required payload is present
- no secrets or credential-shaped keys are stored
- approval binding still matches

## Notifications

Notify the user when:

- work starts
- work needs setup or approval
- required Output is missing
- review is ready
- work completes
- social publication succeeds or fails

Notifications link directly to the calendar item, session, workflow run, or receipt.

## External Calendar Safety

HQ Google sync may include only shell data:

- title
- date/time/timezone
- safe summary
- Runner deep link
- high-level status

Never sync:

- prompts or briefs
- file paths
- profile session details
- payload or media digests
- approval records
- unpublished captions by default

## Accessibility And Keyboard Behavior

- focus is trapped inside the composer
- Escape closes only after unsaved-change confirmation
- Enter advances when the active section is valid
- Shift+Enter inserts new lines in briefs/captions
- all picker results are keyboard navigable
- status is communicated by text and icon, not color alone
- collapsed summary rows are buttons with descriptive labels
- errors move focus to the invalid section

## Non-Goals For Initial Delivery

- arbitrary recurring cron rules
- visual workflow graph editing inside Calendar
- unconstrained multi-step DAGs
- automatic Final promotion by agents
- silent live social preapproval
- campaign Google sync
- multi-user notifications
- automated duration prediction for agent tasks

## Implementation Plan

### Phase 1: Domain Contract And Compatibility

- add `ScheduledWorkOrder` shared types and parser
- add typed execution union
- add calendar `scheduledWorkId`
- add compatibility adapter for embedded campaign jobs
- preserve current runner behavior during migration
- add atomic work-order mutation API

Exit criteria:

- current calendars load without changes
- old embedded jobs still run once
- new work orders cannot duplicate old jobs
- rollback to embedded-job reader remains possible

### Phase 2: Shared Progressive Composer

- create `ScheduledWorkComposer`
- add compact section-summary interaction
- add queue-type command list
- add plain-language footer summary
- replace Campaign Calendar inline scheduled-job form
- retain compact inline Event creation when appropriate

Exit criteria:

- no raw slug or action type entry
- simple Event takes no more interaction than today
- changing an early answer invalidates only dependent answers

### Phase 3: Real Selectors And Attachments

- active agent picker using `useAgents`
- active workflow picker using `useWorkflows`
- workflow trigger-input renderer
- Final/Output picker using `useOutputs`
- Vault asset picker
- ready social profile picker
- Output/Final entry-point prefill

Exit criteria:

- users can queue specific agents and workflows without typing identifiers
- social jobs require one exact profile and asset
- unavailable targets explain how to fix setup

### Phase 4: Agent And Workflow Completion

- keep launched agent jobs running
- correlate sessions to work-order ids
- correlate Outputs by session/work-order origin
- enforce expected Output contracts
- track workflow terminal state
- collect workflow Outputs
- add Open Session, Open Run, Open Output actions

Exit criteria:

- no job becomes done merely because it launched
- required-output failure is visible and recoverable
- workflow failure identifies the failed step

### Phase 5: Review And Follow-Ups

- review queue type
- approved/changes-requested decisions
- awaiting-review state
- supported `Then` chains
- produced-output step references

Exit criteria:

- Agent -> Review and Workflow -> Review work end to end
- ambiguous produced Outputs stop for user selection

### Phase 6: Live Social Execution

- register production external executor
- regenerate/load exact dry-run contract
- verify media bytes, profile, draft, and action digest
- serialize same-profile jobs
- return external receipt
- expose login and mismatch recovery

Exit criteria:

- approved post publishes once
- unapproved or changed post never publishes
- duplicate tick/retry cannot duplicate the post
- receipt is visible from Calendar

### Phase 7: HQ Integration

- reuse composer shell from HQ Calendar
- support HQ Event, HQ Work, and Queue Campaign Work
- route campaign work to campaign ownership
- add optional pinned read-only rollup
- keep Google sync shell-only

Exit criteria:

- HQ can initiate work without owning duplicate campaign execution
- HQ-owned agent/workflow jobs run in HQ workspace
- campaign jobs have one source of truth

## File Map

Likely implementation surfaces:

- `apps/electron/src/renderer/components/calendar/CalendarMonthGrid.tsx`
- new `apps/electron/src/renderer/components/calendar/ScheduledWorkComposer.tsx`
- new composer section/picker components under `components/calendar/`
- `apps/electron/src/renderer/components/app-shell/CampaignCalendarPage.tsx`
- `apps/electron/src/renderer/components/app-shell/ArtistHQHome.tsx`
- `apps/electron/src/renderer/hooks/useAgents.ts`
- `apps/electron/src/renderer/hooks/useWorkflows.ts`
- `apps/electron/src/renderer/hooks/useOutputs.ts`
- `apps/electron/src/renderer/lib/campaign-calendar.ts`
- `apps/electron/src/renderer/lib/output-finals-actions.ts`
- `packages/shared/src/campaign-calendar/index.ts`
- new `packages/shared/src/scheduled-work/`
- `packages/server-core/src/campaign-calendar/CampaignScheduledJobRunner.ts`
- `packages/server-core/src/sessions/SessionManager.ts`
- `packages/session-tools-core/src/handlers/campaign-calendar.ts`
- `apps/electron/src/main/campaign-social-job-preparer.ts`

## Test Plan

### Unit

- each composer choice creates the correct typed draft
- collapsed summaries reflect current values
- dependent fields clear when owner/type changes
- agent picker includes only active agents
- workflow picker includes only active workflows
- workflow inputs validate from schema
- Primary Final is preferred correctly
- exact social profile is required
- timezone and DST validation
- mutation invalidates approval when bindings change
- legacy embedded job migration is idempotent

### Runner

- agent job remains running after session launch
- required Output completes the job
- missing required Output creates needs-attention
- workflow terminal success completes the job
- workflow failure remains recoverable
- social dry-run failure stops retry loop
- approved social job executes once
- changed social payload blocks execution
- same-profile social jobs serialize
- app-launch catch-up respects grace windows

### Integration

- Campaign date -> Agent Task -> selected agent session
- Campaign date -> Workflow -> validated run
- Output Schedule -> Social Publish with exact asset prefilled
- Agent Task -> Review -> approved Output
- HQ -> Queue Campaign Work writes only campaign source of truth
- HQ-owned work executes in HQ workspace
- concurrent UI/agent/runner writes preserve all state

### Smoke

- create a reminder in two interactions or fewer
- schedule a named agent to produce an Output
- schedule a workflow without typing its slug
- schedule a Final to a ready social profile
- approve and execute a social dry-run
- recover from expired login
- reschedule a missed task
- open resulting session, workflow run, Output, and receipt

## Acceptance Criteria

The feature is implementation-complete when:

1. Both calendars open the same compact composer shell.
2. HQ and Campaign ownership is always explicit and singular.
3. Users can select active agents and workflows by name.
4. Users can attach exact Finals, Outputs, Vault assets, and social profiles.
5. Simple events are not burdened by execution fields.
6. Agent and workflow jobs stay running until actual completion.
7. Required agent Outputs are verified before done.
8. Social publishing requires exact approval and produces a receipt.
9. Failed, missed, blocked, and expired items have clear recovery actions.
10. Agents can read and safely mutate the same scheduled-work contract.
11. No credentials, private paths, or approval tokens reach external calendars.
12. Existing campaign jobs migrate without duplication or data loss.

## Locked V1 Defaults

- approval near execution for social publishing
- campaign timezone defaults to system timezone until explicitly set
- active workspace targets only
- Primary Final preferred over raw Output
- required Output defaults based on agent capability, user-editable
- pinned-only campaign rollup to HQ
- explicit one-shot jobs, not recurring calendar rules
- no automatic Final promotion

## Open Questions

These do not block Phases 1-3:

1. Should HQ-owned work use a visible HQ Work queue in addition to Calendar?
2. Should users be able to save composer presets?
3. Should exact social preapproval remain available as an advanced option?
4. Which session terminal signal is authoritative for agent-job completion?
5. Should external receipts also become receipt Outputs by default?

---
status: draft
owner: agent
last_verified: 2026-07-08
source_of_truth: false
---

# Campaign Calendar And Scheduled Jobs

## Purpose

Give each campaign its own execution calendar: not a generic date list, and not another HQ calendar.

The campaign calendar should let a creator plan, schedule, and track one-off campaign work:

- post this final asset on this day
- run this workflow at this time
- ask this agent to prepare a pack before release day
- add this finished output to the calendar from chat
- schedule a review, approval, or reminder tied to campaign files

The HQ calendar remains the global artist calendar. The campaign calendar is scoped to one campaign and owns execution timing.

## Core Decision

Reuse the existing HQ calendar UI pattern, but back it with campaign-specific data and scheduled job state.

```text
HQ Calendar = global life, business, release dates, meetings, commitments.
Campaign Calendar = scoped campaign plan, scheduled jobs, assets, approvals, execution history.
```

Do not overload the recurring Automations UI as the main user model. Campaign scheduled jobs are one-shot items. The app can reuse the scheduler tick internally, but users should see calendar jobs, not cron rules.

## Existing Building Blocks

Verified current pieces:

- `apps/electron/src/renderer/lib/artist-calendar.ts`
  - global `artist-calendar` context doc
  - event CRUD helpers
  - workspace links
  - related people
  - Google sync state
- `ArtistCalendarView` in `ArtistHQHome.tsx`
  - month grid
  - selected date side panel
  - add/edit/delete event UI
  - Google connect/sync buttons
- `packages/shared/src/scheduler/scheduler-service.ts`
  - minute-aligned `SchedulerTick`
- `apps/electron/src/renderer/components/automations/types.ts`
  - automation trigger supports `SchedulerTick`
  - prompt/webhook actions exist
- Outputs/Finals promotion spec
  - campaign finals are trusted file pointers
  - agents can propose but not silently finalize
- Social account sets/profile work
  - social accounts can be grouped by persona/brand
  - posting still requires exact approval

## Product Model

### Calendar Item

A visible item on a campaign date.

Examples:

- "Post teaser clip"
- "Run playlist outreach prep"
- "Review final cover art"
- "Submit distributor upload"
- "Post Instaban reel"

### Scheduled Job

Optional execution attached to a calendar item.

Examples:

- launch `@social-publisher` with a specific final video and account set
- start a campaign workflow run
- open a review session for approval
- ask an agent to generate copy or assets

Not every calendar item is a job. Some are reminders or deadlines.

### External Calendar Event

Optional synced copy to Google Calendar or another calendar provider.

The external event should not carry secrets, local file paths, private payloads, or approval tokens.

## User Experience

### Campaign Page Entry

Add `Calendar` as a first-class campaign page/tab.

Recommended layout:

- left: same month grid style as HQ calendar
- right: selected date agenda
- top of right panel: `Schedule` button
- agenda items grouped by status:
  - `Needs approval`
  - `Scheduled`
  - `Running`
  - `Done`
  - `Missed / Failed`

Do not show a giant empty dashboard. The default view should answer:

```text
What is happening on this date?
What is scheduled?
What needs me?
What already ran?
```

### Create Flow From Calendar

Click a date or `Schedule`.

Step 1: choose type.

- Manual reminder
- Deadline
- Review / approval checkpoint
- Post asset
- Run workflow
- Ask agent
- Generate content
- Outreach / pitch batch
- Custom prompt

Step 2: attach campaign context.

- title
- date/time/timezone
- files from Outputs, Finals, Vault, or local picker
- account set/profile when relevant
- agent/workflow when relevant
- caption/brief/prompt when relevant
- team member/person when relevant

Step 3: choose execution posture.

- save as calendar item only
- schedule local prep
- schedule job, ask me before live external action
- schedule job with pre-approval if exact payload is locked

Step 4: save.

The item appears on the date. If it has a job, it also enters the due-job runner queue.

### Create Flow From A Final Asset

On an Output/Final/Primary asset card, add `Schedule`.

Flow:

1. User clicks `Schedule`.
2. Date picker opens on campaign calendar.
3. Asset is already attached.
4. User chooses action type, usually `Post asset` or `Review`.
5. User chooses account set/profile if posting.
6. Save creates a campaign calendar item.

This is the clean path for:

```text
This video is done. Put it on the calendar.
```

### Create Flow From Chat / Agent

Agents can propose calendar writes.

Example user prompt:

```text
This content piece is done. Let's schedule it for Friday.
```

Expected behavior:

1. Agent resolves campaign, asset, intended platform/action, and date.
2. If clear, agent shows a concise schedule preview.
3. User confirms or the original instruction is treated as local calendar-write approval.
4. Agent writes a local campaign calendar item.
5. If the item includes live external execution, that later execution still requires exact approval unless a valid pre-approval object exists.

Agent should not silently schedule risky live posting just because a file is finished.

### Create Flow From Workflow Completion

When a workflow produces a useful output:

- show `Save as Output`
- show `Set as Final`
- show `Schedule`

If the user chooses `Schedule`, the flow should use the current campaign and preselect the new output/final.

## Reusing The HQ Calendar UI

Do not fork a second unrelated calendar surface.

Extract the reusable shape from `ArtistCalendarView`:

```text
CalendarMonthPlanner
  month navigation
  day cells
  selected-date side panel
  selected-date item list
  add/edit/delete hooks
```

Then implement:

```text
ArtistCalendarView = CalendarMonthPlanner + global event fields + Google controls
CampaignCalendarView = CalendarMonthPlanner + campaign job fields + status controls
```

Campaign-specific UI differences:

- date cells show status dots, not just count
- selected date panel shows job status and asset/account badges
- add form opens a richer schedule composer
- external sync is optional and hidden until connected

## Data Model

Store campaign calendar data in the campaign workspace, not the HQ workspace.

Recommended context slug:

```text
campaign-calendar
```

Recommended top-level shape:

```ts
type CampaignCalendar = {
  version: 1
  campaignId: string
  items: CampaignCalendarItem[]
  updatedAt: string
}
```

Calendar item:

```ts
type CampaignCalendarItem = {
  id: string
  date: string              // YYYY-MM-DD in item timezone
  time?: string             // HH:mm, optional for all-day
  timezone: string          // IANA timezone
  title: string
  notes?: string

  kind:
    | 'manual'
    | 'deadline'
    | 'approval'
    | 'scheduled-job'

  status:
    | 'draft'
    | 'scheduled'
    | 'needs-approval'
    | 'running'
    | 'done'
    | 'failed'
    | 'missed'
    | 'canceled'

  source:
    | 'user'
    | 'agent'
    | 'workflow'
    | 'import'

  assetRefs: CampaignAssetRef[]
  finalRefs: CampaignFinalRef[]
  outputRefs: CampaignOutputRef[]
  personIds: string[]

  accountSetId?: string
  socialProfileRefs?: SocialProfileRef[]

  job?: CampaignScheduledJob
  approvals?: CampaignScheduleApproval[]
  runHistory: CampaignJobRun[]

  hqCalendarEventId?: string
  externalCalendar?: ExternalCalendarSyncState

  deletedAt?: string
  createdAt: string
  updatedAt: string
}
```

Scheduled job:

```ts
type CampaignScheduledJob = {
  id: string
  runAt: string             // ISO timestamp
  timezone: string

  actionType:
    | 'post-asset'
    | 'run-workflow'
    | 'ask-agent'
    | 'generate-content'
    | 'outreach-batch'
    | 'review'
    | 'custom-prompt'

  payload: Record<string, unknown>
  payloadDigest: string
  idempotencyKey: string

  approvalPolicy:
    | 'none'
    | 'approval-before-run'
    | 'approval-before-external-action'
    | 'preapproved-exact-payload'

  maxAttempts: number
  attempts: number
  lastRunAt?: string
  completedAt?: string
  error?: string
}
```

Run history:

```ts
type CampaignJobRun = {
  id: string
  jobId: string
  startedAt: string
  endedAt?: string
  status: 'running' | 'done' | 'failed' | 'skipped'
  sessionId?: string
  workflowRunId?: string
  resultSummary?: string
  error?: string
}
```

References should be pointers, not copied files.

## Scheduler And Runner

Use a one-shot scheduled job runner.

Implementation options:

1. Preferred V1: build a `campaign-scheduled-jobs` service that scans campaign calendar docs on scheduler tick.
2. Acceptable bridge: reuse `SchedulerTick` as wakeup plumbing, but keep campaign jobs out of the user's recurring Automations list.

Due-job rule:

```text
job is due when runAt <= now
and item status is scheduled or needs-approval
and job idempotencyKey has not completed
and campaign is not archived
```

Execution state:

```text
scheduled -> running -> done
scheduled -> failed
scheduled -> missed
needs-approval -> scheduled after approval
scheduled -> canceled
```

Do not execute the same job twice. Record completion by idempotency key and payload digest.

If the app was closed at run time:

- if still inside grace window, run it
- if outside grace window, mark `missed`
- show a recover action: `Run now`, `Reschedule`, `Cancel`

Recommended default grace window:

```text
local prep jobs: 24 hours
posting/external jobs: require user review after 30 minutes late
```

## Agent Contract

Agents may create or edit local campaign calendar items when the user asks for scheduling.

Agents must produce structured calendar write intent:

```ts
type CampaignCalendarWriteIntent = {
  campaignId: string
  operation: 'create' | 'update' | 'cancel'
  item: Partial<CampaignCalendarItem>
  explanation: string
  requiresUserConfirmation: boolean
}
```

Rules:

- If the user explicitly says "schedule this", a local calendar write can proceed after the agent resolves the target.
- If the target date/time/asset/account is ambiguous, ask once.
- If the write creates a live external action, create the local calendar item but mark it `needs-approval` unless exact pre-approval exists.
- Never store passwords, cookies, tokens, or 2FA codes in calendar payloads.
- Never put private local paths or secrets in external synced calendar text.

Good:

```text
Scheduled "Post Instaban reel" for Friday at 10:00 AM. It will ask for final approval before posting.
```

Bad:

```text
I scheduled and approved the live Instagram post for you.
```

## Approval Rules

Calendar scheduling is not the same as live approval.

Local calendar write:

- low risk
- allowed when user clearly requests scheduling

Live external action:

- posting
- sending outreach
- spending money
- publishing
- deleting
- modifying external accounts

These require exact approval at execution time unless the user granted exact pre-approval.

Exact pre-approval must bind:

- campaign id
- item id
- job id
- runAt
- account set/profile
- platform
- asset ids
- caption/payload digest
- approval timestamp
- expiration

If any bound field changes, approval is invalid.

For social posting, reuse the existing social publisher principle:

```text
Prior chat approval + matching dry-run action id is final approval.
The browser should submit when visible account and draft match.
Stop only on mismatch, ambiguity, upload/UI failure, wrong account, login/2FA/CAPTCHA, or payload mismatch.
```

## External Calendar Sync

V1 can ship without external sync.

When enabled, sync only safe event shell data:

- title
- date/time/timezone
- simple note
- Runner deep link
- status summary

Do not sync:

- exact prompts
- private file paths
- account credentials
- payload hashes
- approval tokens
- unpublished captions unless user opts in

Google Calendar conflict policy:

- external time/title change can update local event shell
- external deletion marks the synced shell as removed, but does not delete the campaign job without confirmation
- external notes edits should not mutate job payload
- if local job payload changed after sync, local wins for execution

HQ calendar rollup:

- HQ calendar may show campaign milestones read-only
- HQ calendar should not become source of truth for campaign jobs
- linking can use `hqCalendarEventId`

## Edge Cases

### Ambiguous Campaign

If the user says "schedule this" from a campaign workspace, use that campaign.

If from HQ or global chat, resolve from:

1. attached asset/final campaign pointer
2. active campaign
3. user confirmation

### Ambiguous Asset

If multiple assets could match, show a picker.

Never guess between two finals of the same slot for a live post.

### Asset Changed After Scheduling

If the scheduled item references a Final pointer and Primary changes later:

- pointer to exact final should stay exact
- pointer to "current primary" should resolve at run time
- exact pre-approval is invalid if resolved asset differs from approved digest

### Account Session Expired

Job should move to `needs-approval` or `failed` with action:

- `Open login`
- `Verify account`
- `Run after login`

Do not ask for passwords or 2FA in chat.

### Wrong Social Account

Stop before submit.

Mark job failed with clear account mismatch evidence.

### App Closed At Runtime

On next launch, due scanner checks missed jobs.

Late live posts should not silently fire if they are materially late.

### Timezones And DST

Store both local date/time and IANA timezone.

Render in campaign timezone by default, with local-time hint if user is elsewhere.

DST gaps:

- invalid local times require user correction
- repeated local times store resolved offset

### Duplicate Jobs

Use idempotency key:

```text
campaignId + itemId + jobId + payloadDigest
```

If a retry sees a completed idempotency key, mark skipped duplicate.

### Multiple Jobs Same Time

Queue jobs deterministically:

1. approvals/review prompts
2. local prep jobs
3. external actions

Respect platform/profile locks. Social jobs using the same browser profile must serialize.

### Campaign Archived

Archived campaign jobs do not run.

Calendar remains readable.

### Recurring Requests

If user asks for recurring work:

```text
Post every Friday for the next month.
```

For V1, create explicit one-shot jobs for each date after user confirms the series.

Long-term recurring heartbeat automation belongs in Automations, not campaign calendar.

### Team Member Assigned

Calendar items can attach `personIds`.

This is assignment/context only in V1. It does not notify that person unless a separate notification integration exists.

## Implementation Phases

### Phase 1: Calendar Surface And Storage

- Extract reusable calendar month/selected-date component from HQ calendar.
- Add campaign `Calendar` page.
- Add `campaign-calendar` context doc parser/serializer.
- Support manual items, deadlines, and review items.
- Add create/edit/delete.
- No scheduled execution yet.

### Phase 2: One-Shot Scheduled Job Runner

- Add campaign scheduled-job due scanner.
- Reuse minute scheduler tick as wakeup.
- Add idempotency ledger.
- Add status transitions and run history.
- Add missed-job handling.
- Add app-launch catch-up scan.

### Phase 3: Asset And Output Entry Points

- Add `Schedule` action to Output/Final/Primary cards.
- Add file/context picker in schedule composer.
- Add "schedule this" agent calendar-write tool.
- Add workflow completion `Schedule` action.

### Phase 4: Social Posting Integration

- Add `post-asset` job type.
- Resolve account set/profile from Settings social accounts.
- Build social publisher dry-run at scheduled time.
- Require exact approval before live post unless exact pre-approval is valid.
- Respect per-profile browser/session locks.

### Phase 5: Optional External Calendar Sync

- Add campaign calendar Google sync.
- Sync safe shell only.
- Add HQ read-only rollup.
- Add conflict handling UI.

## Test Plan

Unit tests:

- parse/serialize `campaign-calendar`
- create/update/delete calendar item
- due-job selection
- idempotency duplicate skip
- status transitions
- missed-job grace windows
- approval invalidation when payload changes
- timezone/DST validation

Integration tests:

- campaign calendar page creates item in campaign context doc
- Output/Final `Schedule` creates item with correct asset pointer
- agent calendar-write creates local item only
- due scanner launches a prompt/workflow session once
- social `post-asset` job blocks without approval
- pre-approved social job invalidates if caption/account/asset changes

Smoke tests:

- create manual campaign calendar item
- schedule final asset for a future date
- simulate due local prep job
- simulate missed live post while app was closed
- verify no secrets appear in synced external event text

## Open Product Questions

1. Should Campaign calendar dates roll up to HQ calendar by default, or only when pinned?
2. Should a campaign have a default timezone independent of system timezone?
3. Should "schedule series" create multiple explicit jobs in V1, or wait until recurring support exists?
4. Should team members get local-only assignment badges before notifications exist?
5. Should scheduled social posts allow exact pre-approval, or always require approval near execution?

Recommended V1 answers:

- roll up only pinned milestones to HQ
- campaign has explicit timezone
- series creates explicit one-shot jobs
- assignments are badges only
- live social posts default to approval near execution

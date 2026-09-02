---
status: proposed
owner: agent
last_verified: 2026-09-02
source_of_truth: true
extends: ./13-scheduled-work-composer-execution-spec.md
related: ./26-agent-bound-messaging-spec.md, ./24-session-task-list-spec.md
---

# Automations: Input-Aware Setup And The One List

## Briefing For The Implementing Agent

### The one-sentence change

Nothing is "scheduled" — a thing runs when all of its inputs exist, and for most
work the only missing input is *time*.

### Why the current page feels fuzzy

The Active tab opens a dialog that asks **when** first and **what** second
(`AutomationWorkDialog.tsx`: five trigger buttons, then a second composer).
That order is backwards. The system cannot know which "when" options are
honest until it knows what is running, because a workflow that needs a design
file from the artist cannot honestly be put on a Monday 9:00 cron. It will fire,
have nothing to work with, and stall.

The data model already knows the difference. Workflows declare
`trigger.inputs[].required` (`packages/shared/src/workflows/types.ts:38-62`).
Merch Run requires `campaign_brief`; an intel pulse requires nothing. The UI
simply never reads that bit.

### What already exists — do not rebuild it

The manager (HNIC, `CONCIERGE_SLUG`) can already create everything this spec
describes, via tools granted through `CREATOR_SYSTEM_SKILL_SLUGS`:

| Tool | Handler | Creates |
| --- | --- | --- |
| `schedule_work` | `session-tools-core/src/handlers/schedule-work.ts` | Tracked work — `destination: 'automation' \| 'calendar'`, `execution: agent-task \| workflow-run`, five trigger kinds |
| `create_automation` | `session-tools-core/src/handlers/create-automation.ts` | Prompt, webhook, and Pulse automations |
| `create_workflow` | `session-tools-core/src/handlers/create-workflow.ts` | New workflow definitions |
| `start_workflow` | (workflow tools) | Immediate manual run |

The staggered automatic placement (`staggered-schedule.ts`) and the single
global background lane (spec 13 §5A) have shipped. This spec sits on top of
both.

### What is actually missing

Three things, all small relative to what exists:

1. **"Ask me each time" is impossible.** `HnicScheduledWork.ts:98-102` throws
   `Workflow input is required: <name>` if any required input is unbound at
   schedule time. The manager therefore has to invent a value or refuse. The
   dialog has the same limitation through the composer's default-filling.
2. **A file trigger does not feed the file in.** `queue-work-handler.ts:40-47`
   forwards only `eventTimestamp` and `eventKey`; the changed path never reaches
   `triggerInputs`. "Run Merch Run when a design lands in `/vault/merch`" cannot
   bind the design to `design_file`.
3. **Nothing tells the artist what an automation is waiting for.** There is no
   status for "fired, holding for your input," and no list row that says so.
   `needs-setup` exists in `ScheduledWorkStatus` and is unused by the runner.

### Three ways to get this wrong

- Building a second automation system for the chat path. The manager and the
  dialog must write the **same record** through the **same validation**. If
  the manager can do something the dialog cannot, or vice versa, that is a bug.
- Treating "ask me each time" as a form that pops up on a timer. It is a
  **message from the agent that will do the work**, delivered where the artist
  already talks to that agent (spec 26), and the reply *is* the input.
- Adding approval prompts. Setting up the automation is the approval. The only
  time the artist hears from it afterward is when it genuinely cannot proceed
  without something only they have.

### Start here

Slice 1 (input binding model) and Slice 2 (`needs-setup` in the runner) are
backend-only and testable without UI. Do them first.

## Decision

Every automatable unit — agent task or workflow — is classified at setup time
by whether it can run unattended:

- **Self-running:** every required input is bound. Time (or a file, webhook,
  URL change, inbound message) is the only trigger needed.
- **Fed:** at least one required input is unbound and marked *ask each time*.
  The automation still fires on its trigger, but firing produces a `needs-setup`
  work order and an agent-bound message asking for the input. The reply
  completes the order and it enters the normal automatic lane.

The setup surface (dialog or manager chat) picks **what** first, reads its
input schema, and only then offers the **when** options that are honest for
that shape.

There is one list. "Active" is its top section, not a different page.

## Purpose

- Let an artist put a worker or workflow on autopilot in one screen without
  learning the words *trigger*, *matcher*, *cron*, or *queue-work*.
- Make it impossible to schedule something that will silently fail for lack of
  an input.
- Let the manager do the same thing from chat with identical results.
- Show, in one row list, what is running, what is waiting on the artist, and
  what is coming — tagged by cadence, not by internal type.

## User Promise

- "Pick a worker, tell it what it needs, tell it when. Done."
- "If it needs something from me each time, it asks me — it doesn't fake it."
- "I can tell my manager 'set this up weekly' and get exactly what the button
  would have made."
- "One list shows me everything that will happen without me clicking again."

## Non-Goals

- Replacing the Campaign Calendar or one-shot Scheduled Work composer. Those
  remain for dated, one-time, campaign-bound work.
- Replacing Pulse, webhook actions, or prompt automations. They keep their
  existing surface; this spec adds a friendlier front door for the tracked-work
  action and does not touch the others.
- Conditional logic, branching, or "if the report says X then Y."
- Cross-machine or Team Mode fan-out beyond what spec 13 already defines.

## Current State

### What exists and works

- `AutomationWorkDialog.tsx` — trigger-first two-step dialog, staggered
  automatic placement for weekly/daily, custom cron.
- `ScheduledWorkComposer.tsx` — picks runner, fills workflow inputs with
  defaults (`ScheduledWorkComposer.tsx:329`).
- `queue-work` automation action (`automations/types.ts:103`) carrying a full
  `ScheduledWorkExecution`.
- `AutomationWorkQueue.ts` — turns a fired `queue-work` action into a
  `ScheduledWorkOrder`, validates workflow digest, supports one follow-up.
- `ScheduledWorkRunner.ts` — single global lane, oldest-due-first, reconciles
  agent sessions and workflow runs.
- `schedule_work` tool — HNIC-only, `destination: 'automation'` with five
  trigger kinds, validated in `HnicScheduledWork.ts`.
- `WorkPageTabs.tsx` — Workers / Workflows / Active, where Active already
  routes to the automations list.
- Agent-bound messaging (spec 26) — a message *to an agent* resolves to a
  session for that agent; specialists can message the artist back.

### What is missing

- No representation of an unbound-by-design input on a `queue-work` action.
- No path from a trigger payload (file path, webhook body, message text) into
  workflow `triggerInputs`.
- No `needs-setup` production in the runner; no `input-required` attention
  reason.
- No manager-side way to express "ask each time"; the tool refuses.
- List rows do not show cadence tags, next run, or what is being waited for.

## Core Laws

1. **One record, two doors.** The dialog and `schedule_work` produce
   byte-equivalent `queue-work` actions for the same intent and pass through
   `AutomationWorkQueue` validation identically.
2. **Never schedule a lie.** A required input with no binding and no *ask*
   marker is a validation error at both doors.
3. **The ask comes from the worker.** When a fed automation fires, the message
   asking for input is sent by the agent that will run it (for workflows, by
   the manager), through spec 26, so the reply lands with the right agent.
4. **Setup is the approval.** No confirmation dialogs fire on schedule. The
   permission boundary for external actions (spec 13 §6, social exact
   approval) is unchanged and orthogonal.
5. **Waiting does not occupy the lane.** A `needs-setup` order is not `running`
   and never blocks the global automatic lane (spec 13 §5A).
6. **Cadence is what the artist sees.** Tags are Daily / Weekly / Once / On
   file / Webhook / On message — never `SchedulerTick` or `queue-work`.

## Data Model

### Input bindings on `queue-work`

```ts
export type WorkflowInputBinding =
  | { mode: 'fixed'; value: unknown }                 // same every time
  | { mode: 'ask' }                                   // ask the artist each fire
  | { mode: 'trigger'; from: 'file.path' | 'file.name' | 'webhook.body' | 'message.text' | 'url.content' }

export interface QueueWorkAction {
  type: 'queue-work'
  ownerScope: 'hq' | 'campaign'
  calendarVisibility?: 'visible' | 'hidden'
  title: string
  execution: ScheduledWorkExecution
  /** Present only for workflow-run. Keys are trigger input names. */
  inputBindings?: Record<string, WorkflowInputBinding>
  inputRefs?: ...
  followUp?: ...
}
```

`execution.triggerInputs` remains the *resolved* map used at run time. During
setup, `inputBindings` is authoritative; `triggerInputs` is derived from it at
fire time. Existing records without `inputBindings` are treated as all-`fixed`
from `triggerInputs` — no migration needed.

Agent tasks have a single free-text `brief` and no schema; they are always
self-running. An agent task that genuinely needs per-run input should be
written as a workflow with a declared input, which is what workflows are for.

### Attention and status

```ts
export type WorkAttentionReason = ... | 'input-required'
```

A fired fed automation produces an order with:

- `status: 'needs-setup'`
- `attention: { reason: 'input-required', message: 'Waiting for: design_file' }`
- `execution.triggerInputs` holding every `fixed` and `trigger` value already
  resolved, and the `ask` keys absent
- `askRequest: { sessionId, messageId, inputs: string[] }` — the agent-bound
  message that was sent, so a reply can be matched to the order

The order transitions `needs-setup → scheduled` when all `ask` inputs are
supplied (by reply or by the list row's inline field), with `startAt` set to
the supply time. It then enters the normal lane.

### Cadence tag (derived, not stored)

```ts
type CadenceTag = 'daily' | 'weekly' | 'once' | 'on-file' | 'webhook' | 'on-message' | 'on-url'
```

Derived from the automation's event and cron:
- `SchedulerTick` with `* * *` day fields → `daily`; with a single weekday →
  `weekly`; any other cron → `custom` (rendered as the cron's plain-English
  label).
- `FileWatch` → `on-file`, `WebhookReceive` → `webhook`, `MessageReceive` →
  `on-message`, `PollUrl` → `on-url`.
- One-shot Calendar work → `once`.

## Setup Flow: The Dialog

One dialog. Sections appear in this order and later sections adapt to earlier
choices. No second modal.

### 1. What runs

A single picker over active workers and active workflows, searchable, with
the same avatars the Workers/Workflows tabs use. Picking one loads its input
schema. Name defaults to the worker/workflow name and can be edited.

### 2. What it needs

Rendered only if the selection has declared inputs.

For each input, one row:

```
design_file      [ Same every time ▾ ]   [ /vault/merch/current.png ]
campaign_brief   [ Ask me each time ▾ ]  "I'll message you for this when it runs."
size_run         [ Same every time ▾ ]   [ 250 ]        (default from workflow)
```

- Inputs with a `default` start as *Same every time* with the default filled.
- Required inputs with no default start as *Ask me each time*.
- When the trigger chosen in §3 is a file, webhook, or message, a third option
  appears on string inputs: *From the trigger* (file path / file name /
  message text / webhook body). Choosing a file trigger auto-selects *From the
  trigger → file path* on the first unbound required string input, since that
  is almost always what the artist means.

### 3. When

Options are computed from §2. If every required input is bound (`fixed` or
`trigger`):

- **Weekly** (default; auto-staggered slot shown, e.g. "Tuesday 9:30 AM")
- **Daily** (auto-staggered)
- **Once** on a date/time → creates Calendar work, not an automation
- **When a file lands in…** → path + glob
- **When a webhook arrives** → slug, secret
- **When a message matches…** → matcher
- **Custom schedule** → cron builder

If any input is *Ask me each time*, the time options are relabelled honestly:

- **Ask me weekly** / **Ask me daily** — "Every Tuesday at 9:30 AM, {agent}
  will message you for {inputs}. It runs when you reply."
- File/webhook/message triggers stay available; the fire still asks for
  whatever the trigger did not supply.
- **Once** is hidden — a one-time fed run is just a manual start; use the
  Workflows tab.

The staggered slot is recomputed on save (already implemented). If the
occupancy read fails for any workspace, the dialog shows *Couldn't check other
schedules — pick a time* and falls back to the custom picker instead of
asserting a slot it cannot justify.

### 4. Save

One button. Copy is the review sentence:

> Every Tuesday at 9:30 AM, **Merch Run** will ask you for a design file, then
> run with brief "Q4 drop" and size run 250.

Toast on save. No further confirmation.

## Setup Flow: The Manager

The manager uses `schedule_work` with `destination: 'automation'`. Two
additions to the tool input:

```ts
execution:
  | { type: 'workflow-run'; workflowSlug: string;
      triggerInputs?: Record<string, unknown>;
      inputBindings?: Record<string, WorkflowInputBinding> }   // NEW
trigger:
  | { type: 'schedule'; cron?: string; cadence?: 'daily' | 'weekly'; timezone?: string }  // cadence NEW
  | ...
```

- `cadence` without `cron` means "place it automatically" and the handler runs
  the same `suggestAutomaticSchedule` the dialog does, over the same
  cross-workspace occupancy. The manager should prefer `cadence` and only pass
  `cron` when the artist named a specific time.
- `inputBindings` follows the same rules as the dialog. `HnicScheduledWork`
  stops throwing on unbound required inputs **only** when the binding is
  `ask` or `trigger`; a required input with no binding at all is still an
  error, with a message that tells the model exactly which inputs need a
  decision.

Manager behavior, in its skill (`automation-creator` and the manager
operating-system skill):

1. Resolve the workflow, read its inputs.
2. For each required input, decide from the conversation: the artist gave a
   value → `fixed`; the artist said it varies / didn't say and it is plainly
   per-run (a file, a name of the thing) → `ask`; the trigger is a file and the
   input is a path → `trigger`.
3. If genuinely ambiguous, ask **once**, in one message, listing all undecided
   inputs together. Never one question per input.
4. Call `schedule_work`. Repeat back the review sentence.

Because the handler applies identical validation and placement, the manager
cannot produce anything the dialog could not, and the resulting row in the list
is indistinguishable.

## The Ask, When A Fed Automation Fires

1. `queue-work` handler fires. `AutomationWorkQueue` resolves `fixed` and
   `trigger` bindings into `triggerInputs`. Remaining `ask` inputs are listed.
2. If none remain → normal `scheduled` order, existing path.
3. If some remain → order is persisted as `needs-setup` with
   `attention.reason: 'input-required'`, then a message is sent **as the
   worker** (the workflow's runner agent, or the manager for workflows without
   one) through spec 26's channel binding for that agent, falling back to the
   in-app agent chat:

   > Merch Run is ready to go. I need the design file for this run — drop it
   > here or reply with a path.

   The message carries `askRequest` linkage so the reply can be matched.
4. The artist replies with text, a file, or a Release Kit item. The receiving
   session has a `supply_work_input` tool (new, HNIC and worker sessions) that
   writes the values, transitions the order to `scheduled`, and acknowledges.
   The same transition is available from the list row inline.
5. The order enters the global lane like any other. Because `startAt` is the
   supply time, it is placed by age like everything else.

If the artist does not reply, the order stays `needs-setup` indefinitely and is
visible in the list under *Needs you*. It is not an error. The next fire of the
same automation creates a **new** order and a new ask; the old one remains
until supplied or dismissed. The list groups repeated asks from the same
automation so five unanswered Mondays read as one row with a count, not five.

## The List

`AutomationsListPanel` is replaced by one grouped row list. Groups render only
when non-empty. Order is fixed:

```
● RUNNING NOW
  ◉ Intel Pulse            Agent · Weekly     started 9:02 · 4 min     [Open]

▲ NEEDS YOU
  ◉ Merch Run              Workflow · Weekly  waiting for: design file  [Supply]  ×3

○ UP NEXT
  ◉ Spotify Snapshot       Agent · Weekly     Mon 9:00
  ◉ Radio Outreach         Workflow · Daily   today 2:30 PM
  ◉ Q4 Release Prep        Workflow · Once    Oct 3, 10:00 AM
  ◉ Press Kit Refresh      Workflow · On file watching /vault/press
  ◉ Trend Pulse            Pulse · Weekly     Mon 10:00

◌ PAUSED
  ◉ Old Outreach           Agent · Weekly     paused Aug 12
```

Row anatomy: avatar · name · **runner kind · cadence tag** · state text ·
action. State text is the only column that changes across groups.

- *Running now* comes from `running` orders and live Pulse runs across all
  local workspaces — this is the "Active" that the tab name already promises.
- *Needs you* comes from `needs-setup` (input) and `needs-attention` orders.
  `[Supply]` opens an inline field for the missing inputs; the same transition
  the chat reply uses.
- *Up next* is every enabled automation sorted by next fire time, plus dated
  Calendar work in the next 14 days. Next-fire is computed from the cron in
  its timezone; file/webhook/message rows show what they watch instead.
- *Paused* is `enabled: false`.

Clicking a row opens `AutomationInfoPage` unchanged. The `+` button opens the
new dialog. Prompt, webhook, and Pulse automations still appear in the list
with their existing kinds and are still created through the existing template
gallery; this spec does not remove those doors.

The "Workers / Workflows / Active" tabs remain. Nothing is renamed.

## Migration

- Existing `queue-work` actions have no `inputBindings`. Reader treats them as
  all-`fixed` from `triggerInputs`. Nothing is rewritten on disk until edited.
- Existing `AutomationWorkDialog` is replaced, not kept beside the new one.
- `needs-setup` is already in the status union and already maps to the `draft`
  display bucket (`scheduled-work/index.ts:804`). The list must stop bucketing
  it as draft and show it under *Needs you*.

## Failure And Edge Cases

- **Workflow edited after setup.** Existing `workflowDigest` check still
  refuses the run (`workflow-changed`). Additionally, if the edit added a new
  required input, setup validation on next open shows it as unbound and the
  row shows *Needs setup* until fixed.
- **Fed automation on a file trigger where the file supplies everything.** No
  ask is sent; it is self-running in effect. The tag stays *On file*.
- **Reply arrives for an order already supplied from the list.** Second
  supply is a no-op with a friendly acknowledgement.
- **Reply arrives with the wrong type** (text for a number input). The
  worker's session asks again with the constraint; never coerces silently.
- **Agent has no channel binding.** Ask goes to the in-app chat for that agent
  and raises the bell. The order is still `needs-setup`.
- **Occupancy read fails during placement.** Dialog: fall back to custom
  picker with a visible notice. Manager: the handler returns an error naming
  the failure; the manager tells the artist and offers a specific time.
- **Artist disables the automation while an ask is outstanding.** The order
  remains under *Needs you*; disabling stops future fires only.

## Observability

- Log line on every fed fire: automation slug, order id, asked inputs, message
  id, channel.
- Log line on every supply: order id, source (`reply` | `list`), supplied keys.
- Counter of `needs-setup` orders older than 7 days, surfaced in the list
  group header as "3 waiting over a week".

## Implementation Slices

1. **Bindings model.** Add `WorkflowInputBinding`, `inputBindings` on
   `QueueWorkAction`, `input-required` attention reason. Resolver in
   `AutomationWorkQueue` that produces either a `scheduled` order or a
   `needs-setup` order. Trigger-payload plumbing from `queue-work-handler` for
   `file.path`, `file.name`, `message.text`, `webhook.body`. Tests.
2. **Runner.** `ScheduledWorkRunner` ignores `needs-setup` for the lane and
   for admission. `supply` transition with validation against the workflow
   schema. Tests including the lane-does-not-block case.
3. **Tool contract.** `schedule_work` accepts `inputBindings` and
   `trigger.schedule.cadence`. `HnicScheduledWork` validation updated. New
   `supply_work_input` tool. Manager skill text updated with the one-question
   rule. Tests.
4. **The ask.** On `needs-setup` creation, send the agent-bound message
   through spec 26 with `askRequest` linkage; reply handling calls
   `supply_work_input`. Fallback to in-app agent chat. Tests.
5. **Dialog.** Replace `AutomationWorkDialog` with the what → needs → when
   flow. Honest relabelling for fed shapes. Occupancy-failure fallback.
6. **List.** Grouped row list with cadence tags, next-fire, *Needs you* inline
   supply, repeated-ask grouping.
7. **Docs.** Update the in-app user guide (spec 27) section on automations to
   use the *Same every time / Ask me each time* language.

## Acceptance Tests

### Validation parity
- The dialog and `schedule_work` given the same intent produce identical
  `queue-work` actions (deep-equal after normalizing ids and timestamps).
- A required input with no binding is rejected at both doors with the input
  name in the message.

### Fed fires
- A weekly fed automation fires → exactly one `needs-setup` order, one
  agent-bound message from the correct agent, no `running` order, lane free.
- Supplying via reply and via list both transition to `scheduled` with
  `startAt` = supply time and the resolved `triggerInputs` complete.
- Two unanswered fires produce two orders and the list renders one grouped
  row with count 2.

### Trigger binding
- A `FileWatch` fire with `design_file → trigger:file.path` yields a
  `scheduled` order whose `triggerInputs.design_file` is the changed path and
  sends no ask.

### Placement
- `cadence: 'weekly'` from the manager and *Weekly* from the dialog choose the
  same slot given the same occupancy.
- Occupancy read failure does not produce a confident slot at either door.

### Lane
- Ten `needs-setup` orders across three workspaces do not prevent a
  `scheduled` order elsewhere from starting on the next scan.

### List
- Cadence tags derive correctly for `0 9 * * *`, `30 9 * * 2`, `*/15 * * * *`
  (custom), and each non-schedule event.
- *Running now* shows orders from every local workspace, not only the active
  one.

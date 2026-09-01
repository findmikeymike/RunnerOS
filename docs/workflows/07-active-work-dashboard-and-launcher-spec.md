# Work: Active dashboard and workflow launcher

Status: implementation-ready plan  
Owner: Artist OS  
Last verified: 2026-09-01  
Scope: Electron renderer UX and composition over existing workflow, session, scheduled-work, and automation systems

## 1. Decision

`Work` becomes one coherent workspace with three tabs:

1. **Workers** — who can do the work.
2. **Workflows** — reusable chains of specialists that do longer work in sequence.
3. **Active** — what is running, what is coming next, what repeats, and what needs the artist.

The current user-facing **Automations** tab becomes **Active**. The existing `automations` route, stored automation definitions, execution history, and backend behavior remain intact. This is a product-language and presentation change, not a data migration or new scheduler.

Workflow launch also changes. Clicking a workflow's play button should not immediately expose its raw input schema. It opens a small, calm choice:

- **Set up with Artist Manager** — recommended, conversational setup.
- **Manual setup** — a friendly form for users who already know the inputs.

Both paths end at the same three execution choices:

- **Run now** — one immediate workflow run.
- **Schedule once** — one future scheduled-work order.
- **Repeat automatically** — an automation driven by a schedule or event.

## 2. Why this is the right model

The product currently exposes three related ideas without a clean hierarchy:

- a workflow defines **what happens**;
- scheduled work defines **one future execution**;
- an automation defines **when work repeats or reacts to an event**.

Users should not need to understand those implementation boundaries before starting useful work. The UI should first answer:

- Who can help me?
- What repeatable process can I run?
- What is happening now or later?

The underlying systems stay separate because their lifecycle and safety rules are legitimately different. `Active` simply gives them one operational surface.

## 3. Goals

- Make Work feel like one product rather than three separate admin areas.
- Let a first-time user start a workflow without seeing snake_case fields or raw schema types.
- Let an experienced user launch or schedule work quickly.
- Show active, upcoming, recurring, and blocked work without duplicating the Calendar or workflow Run page.
- Preserve all existing automation management and history capabilities.
- Use the same compact visual language as Campaign Essentials.
- Work identically in Artist HQ and Campaign workspaces, with workspace-correct context and records.

## 4. Non-goals

- No new automation engine, scheduler, workflow runtime, or persistence format.
- No migration of automation files or route identifiers.
- No replacement for the workflow Run page or its step-level details.
- No second calendar inside Work.
- No chronological feed of every completed task on the default Active page.
- No raw JSON or schema terminology in the primary user journey.
- No attempt to merge workers, workflows, scheduled orders, and automations into one stored resource type.

## 5. Information architecture

### Shared Work shell

The existing Work hero stays visually consistent across all three tabs. It contains only the section label and `Work` title. Page-specific actions live below the hero so the header never becomes a toolbar.

Immediately below the hero:

```text
[ Workers ] [ Workflows ] [ Active ]
```

The selected tab uses the existing quiet filled state. `Active` may show one small amber dot when attention is required, but no numeric dashboard clutter is required for v1.

The internal route may remain `automations` so old deep links and persisted navigation continue to work. Only the visible label changes to `Active`.

### Workers

No conceptual change. Workers remains the directory of available specialists. Clicking a worker starts or returns to a chat with that worker.

### Workflows

The page continues to group workflows by clear categories and show each workflow as a compact card with name, always-visible description, and one play action. Category layout should rhyme with Workers.

The page action row remains outside the hero:

- Deep Research
- Recent runs
- Manage library
- New

Secondary creation help such as `Create with Artist Manager` remains a quiet text action, not another dominant button.

### Active

Active is an operational dashboard with four possible sections:

1. **Needs Attention** — shown first only when non-empty.
2. **Running Now**
3. **Up Next**
4. **Recurring & Triggers**

Empty sections disappear. The page should not show four empty-state boxes.

At the top right below the tabs is a single **Add** button. It opens:

- Run now
- Schedule once
- New automation
- Browse templates

This menu preserves the existing automation entry points while making their meaning obvious.

## 6. Active visual contract

Active rows use the Essentials visual language:

- near-black surfaces with a restrained soot/grey lift from the page;
- no bright outer outlines;
- no nested bordered containers;
- compact rows with generous horizontal alignment and modest vertical padding;
- one subtle divider between logical sections, not between every nested surface;
- normal-weight secondary text;
- orange only for work running now;
- amber only for something requiring attention;
- green only for a confirmed successful state when it is necessary to show one;
- one obvious action per row;
- secondary actions under `...` or revealed on hover/focus.

Each row contains:

```text
[icon] Name                         [status or next time] [cadence] [primary action] [...]
       Worker/workflow or short context
```

The row never displays raw cron expressions, IDs, matcher names, JSON, or schema types.

### Section behavior

- **Needs Attention:** open by default and never collapsed.
- **Running Now:** open by default.
- **Up Next:** show the next six items, followed by `View all scheduled work` when more exist.
- **Recurring & Triggers:** show enabled definitions first. Paused definitions sit behind a quiet `Show paused` disclosure when more than two exist.

This keeps the default page useful at a glance without hiding management features.

### Sorting

- **Needs Attention:** actionable approvals/reviews first, then failures and setup issues, newest update first within each group.
- **Running Now:** earliest start first, then most recently updated when start time is unavailable.
- **Up Next:** ascending `startAt`; undated queued work follows dated work.
- **Recurring & Triggers:** enabled before paused, then ascending next-run time, then name.

Sorts must be deterministic so rows do not jump between renders when timestamps tie.

## 7. Unified Active read model

Active does not persist a new object. A renderer hook normalizes existing sources into an `ActiveWorkItem` view model.

```ts
type ActiveWorkSection = 'attention' | 'running' | 'up-next' | 'recurring'
type ActiveWorkSource = 'session' | 'workflow-run' | 'scheduled-work' | 'automation'

interface ActiveWorkItem {
  id: string
  source: ActiveWorkSource
  sourceId: string
  workspaceId: string
  section: ActiveWorkSection
  title: string
  subtitle?: string
  iconKind: 'worker' | 'workflow' | 'scheduled' | 'automation'
  statusLabel: string
  cadenceLabel?: 'Once' | 'Daily' | 'Weekly' | 'Monthly' | 'Triggered' | string
  sortAt?: string
  updatedAt?: string
  attentionReason?: string
  openTarget: ActiveWorkOpenTarget
  primaryAction: ActiveWorkAction
  secondaryActions: ActiveWorkAction[]
  dedupeKeys: string[]
}
```

The view-model builder must be pure and independently tested. UI components render this model and do not re-implement lifecycle classification.

## 8. Source and classification rules

### Sessions

Source: `sessionMetaMapAtom`.

Show in **Running Now** when:

- `workspaceId` matches the active workspace;
- the session is visibly user-owned, not an internal hidden workflow-step session;
- `isProcessing` is true.

Primary action: **Open chat**.

Do not infer failure or attention merely because a session is idle. Session-specific failures should only appear when the existing session metadata exposes a reliable failure/attention state.

### Workflow runs

Source: `useWorkflowRuns(activeWorkspaceId)`.

- `running` → Running Now
- `created` or `queued` → Up Next
- `paused`, `interrupted`, or `failed` → Needs Attention
- `succeeded` or `cancelled` → omitted from the default Active page; available through Recent runs

Primary actions:

- running/queued → **View run**
- paused/interrupted/failed → **Review**

Secondary actions reuse existing safe controls such as cancel or rerun where already supported.

### Scheduled work

Source: the active workspace's scheduled-work context document through `parseScheduledWorkDocResult`.

- `running` → Running Now
- future `scheduled` or `waiting` → Up Next
- `needs-setup`, `needs-approval`, `awaiting-review`, or `needs-attention` → Needs Attention
- `draft`, `done`, `canceled` → omitted by default

`needs-setup` belongs in Needs Attention rather than Up Next because it cannot safely execute without user input.

Primary action depends on state:

- running → open owning session or workflow run when linked, otherwise open the scheduled item
- scheduled/waiting → **View**
- needs-approval/awaiting-review → **Review**
- needs-setup/needs-attention → **Resolve**

Scheduled work remains editable from its existing Calendar/Plan surface. Active is a launchpad, not a second scheduling editor.

### Automations

Source: existing `AutomationListItem[]` and execution history.

- enabled automation definition → Recurring & Triggers
- paused automation definition → Recurring & Triggers under paused disclosure
- latest execution with `error` or `blocked` and not superseded by a later success → Needs Attention
- a currently executing order created by an automation → Running Now through its scheduled-work/workflow-run record

Primary action for a recurring definition: **View**. Pause/enable, test, duplicate, send, edit, history, replay, and delete remain in the detail view or `...` menu.

### Cadence labels

Use existing cron-description utilities. Convert common schedules to short labels such as `Daily`, `Weekly`, or `Monthly`; use a concise human phrase for other cron schedules. Non-cron matchers use `Triggered`. One-time scheduled work uses `Once`.

Never display raw cron syntax in the row.

Immediate sessions and manual workflow runs may use `Once` when a cadence badge helps alignment; they should not be mislabeled as scheduled work.

## 9. Deduplication rules

The aggregation layer must avoid showing the same execution three times.

1. If a scheduled-work order contains a `workflowRunId`, prefer the workflow-run row for the live execution and merge the scheduled time/cadence into it.
2. If a scheduled agent task contains a `sessionId`, prefer the session row while it is processing and merge the scheduled-work status into it.
3. Hidden workflow-step sessions never become top-level Active rows.
4. An automation definition and its current execution may both appear: one describes the recurring rule; the other is the live run. This is intentional. The live row should carry the automation name/cadence so the relationship is clear.
5. A failed automation execution and its failed scheduled order should collapse into one attention row using shared execution/work-order IDs.
6. When linking is incomplete, prefer showing one truthful generic row over inventing a relationship based only on matching titles.

## 10. Active actions and feature preservation

No existing automation capability is removed.

| Existing capability | New location |
|---|---|
| Create automation | Active → Add → New automation |
| Browse templates | Active → Add → Browse templates |
| Edit | Active row/detail → `...` → Edit |
| Pause / resume | Active row `...` and detail page |
| Test run | Active row/detail → `...` → Test |
| Duplicate | Active row/detail → `...` → Duplicate |
| View trigger, conditions, and actions | Active row → View |
| View next run times | Active row summary and detail page |
| View activity history | Active detail page |
| Replay failed execution | Needs Attention row or detail history |
| Delete | Active detail/`...`, with existing confirmation |
| Send to workspace | Active `...`, where currently supported |
| Raw JSON | Advanced area of the existing detail page only |
| Filter by trigger type | Detail/browse surface reached from `View all`; not permanent top-level chrome |

Old automation deep links continue to resolve. A link to a specific automation opens its existing detail page within the Active tab context.

## 11. Workflow launch journey

### Entry points

Use the new launcher from every user-facing workflow play action:

- Workflows directory
- Workflow detail page
- Essentials actions that target a workflow
- any other visible `Run workflow` button

Rerunning a prior workflow is the exception: it may open Manual setup directly with prior inputs prefilled, while still exposing `Set up with Artist Manager` as a secondary escape hatch.

### Step 1: Start workflow

A small modal or popover contains:

```text
Start [Workflow Name]

[ sparkle ] Set up with Artist Manager     Recommended
             Talk through the goal, assets, and timing.

[ sliders ] Manual setup
             Fill in the required details yourself.
```

No third choice and no raw form appears on this first screen.

### Guided setup with Artist Manager

Open Artist Manager through `openAgentSessionComposer` with:

- the selected workflow slug, name, and description;
- its required and optional input definitions;
- the active workspace identity and whether it is HQ or Campaign;
- relevant HQ/campaign context document references;
- selected assets, when launch originated from an asset or Essentials item;
- a short instruction to ask only for missing decisions and never request facts already available in context.

The initial message should sound like the artist asking for help, not a command ordering blind execution. Example:

> I want to set up the Lyric Clips workflow for the Angelina campaign. Use the approved lyrics, master, and campaign world already in the workspace. Help me choose the strongest direction, ask only the key questions you still need, then let me run it now or schedule it.

The Manager must not silently run, schedule, or automate. After the setup is clear, it presents:

- Run now
- Schedule once
- Repeat automatically

Existing approval and public-action gates remain in force.

### Manual setup

Replace the current raw schema presentation with a friendly renderer.

Rules:

- humanize `product_goal` to `Product goal`;
- never show `string`, `boolean`, or other schema type labels;
- show required inputs first;
- collapse optional details under `More options`;
- preserve workflow defaults, but write them in normal UI controls;
- use a checkbox/switch for booleans, numeric input for numbers, and short input or textarea based on content;
- use existing file, Vault, Release Kit, or Output pickers for inputs representing assets or file paths;
- allow plain text/path fallback only where a picker cannot represent the schema;
- show concise help text only when it changes the user's decision;
- validate inline before execution;
- keep the footer visible while the form scrolls.

Sticky footer:

```text
[ Cancel ]                         [ Schedule ] [ Run now ]
```

`Schedule` opens a second, small choice:

- Once
- Repeat or trigger

This prevents three large competing buttons in the main form.

### Run now

Use the existing workflow-run start API. Navigate to the workflow Run page immediately after creation. Do not create an automation or scheduled-work wrapper for an immediate manual run.

### Schedule once

Reuse the existing `ScheduledWorkComposer`, prefilled with:

- work type `workflow-run`;
- selected workflow;
- validated workflow inputs;
- active workspace;
- proposed title derived from the workflow name.

The user chooses the date/time and confirms. The result appears in Calendar/Plan and Active → Up Next.

### Repeat automatically

Reuse `AutomationWorkDialog`, prefilled with:

- selected workflow;
- validated inputs;
- active workspace;
- suggested automation name.

The user chooses a repeating schedule or supported event trigger. The result appears in Active → Recurring & Triggers.

## 12. Active Add menu journeys

### Run now

Open a compact picker with two tabs or grouped results: Workers and Workflows. Selecting a worker opens chat; selecting a workflow opens the workflow launcher.

### Schedule once

Open `ScheduledWorkComposer`. The user chooses Worker or Workflow, then date/time and any necessary inputs.

### New automation

Open the existing `AutomationWorkDialog`. Preserve all currently supported trigger types and Calendar visibility settings.

### Browse templates

Open `TemplatesGalleryDialog`. Template selection flows into the existing creation path and returns the user to Active.

## 13. Error, loading, and empty states

### Loading

Use two or three quiet row skeletons. Do not render large empty cards while sources initialize.

### Empty Active page

One centered message only:

> Nothing active yet. Run a worker or workflow now, schedule something for later, or create an automation.

Primary action: **Add work**.

### Partial source failure

One failed source must not blank the entire page.

- Show available items from healthy sources.
- Add one compact warning above the affected section.
- If scheduled-work parsing is degraded, do not pretend the schedule is empty and do not offer unsafe mutations against the degraded list.
- Log the concrete parse/load error through the existing logger.

### Stale records

If a row points to a missing workflow, worker, session, or automation, keep the row visible with `Missing source` and provide a safe review/remove route. Never silently discard a user-visible scheduled or recurring commitment.

## 14. Accessibility and interaction rules

- All row actions must be keyboard reachable.
- The row itself may open details, but nested buttons must stop propagation.
- Status cannot be communicated by color alone; every state has text.
- Focus returns to the play/Add control when a launcher closes.
- Dialogs have visible titles and descriptions.
- Hover-revealed actions must also appear on keyboard focus.
- Motion is limited to the existing restrained running indicator and respects reduced-motion preferences.

## 15. Proposed implementation shape

### New renderer modules

```text
apps/electron/src/renderer/features/active-work/
  types.ts
  build-active-work-items.ts
  build-active-work-items.test.ts
  use-active-work.ts
  ActiveWorkPage.tsx
  ActiveWorkSection.tsx
  ActiveWorkRow.tsx
  ActiveWorkAddMenu.tsx

apps/electron/src/renderer/features/workflows/
  WorkflowLaunchDialog.tsx
  WorkflowManualSetup.tsx
  workflow-input-presentation.ts
  workflow-input-presentation.test.ts
```

Use the repository's actual feature/page conventions if nearby files make a flatter placement more consistent. Do not create duplicate hooks for APIs that already exist.

### Existing files likely changed

- `components/app-shell/WorkPageTabs.tsx`
- `components/app-shell/MainContentPanel.tsx`
- `pages/WorkflowsListPage.tsx`
- `pages/WorkflowInfoPage.tsx`
- `pages/WorkflowRunPage.tsx`
- `pages/WorkflowRunInputDialog.tsx` — replace or become a compatibility wrapper
- `components/app-shell/ArtistCommandCenterHome.tsx`
- `components/automations/AutomationWorkDialog.tsx` — accept safe prefill props
- scheduled-work composer entry point — accept safe workflow/input prefill
- Artist OS chrome/static tests that assert Work tab labels and routes

Recommended compatibility shape: change the UI tab union to
`'workers' | 'workflows' | 'active'`, while the Active tab continues to navigate
to `routes.view.automations()`. `MainContentPanel` maps that existing route to
`active`. This prevents the retired product term from leaking through new UI
code without invalidating old routes.

### Existing data reused

- `sessionMetaMapAtom`
- `useWorkflowRuns(workspaceId)`
- workspace context plus `parseScheduledWorkDocResult`
- existing automation list and history callbacks in `AppShellContext`
- `describeCron` and `computeNextRuns`
- `openAgentSessionComposer`
- `ScheduledWorkComposer`
- `AutomationWorkDialog`
- `TemplatesGalleryDialog`

No new main-process RPC is expected for the first slice. If a required relationship such as automation → scheduled order is not exposed, add the smallest explicit identifier to the existing DTO rather than matching on title or duplicating server state.

## 16. Implementation slices

Each slice must be independently reviewable, tested, and committed. Do not combine the visual rewrite with new persistence or runner behavior.

### Slice 1 — Active read model and read-only page

- Rename the visible tab to Active while retaining route compatibility.
- Build pure classification, sorting, cadence, and deduplication helpers.
- Render the four compact sections from existing state.
- Link rows to existing chat, run, calendar, and automation detail surfaces.
- Keep current automation management UI reachable until parity is proven.

Exit gate:

- no stored data changes;
- unit coverage for every status mapping and dedupe rule;
- HQ and Campaign show only their own work;
- old automation deep links still open.

### Slice 2 — Active feature parity and Add menu

- Add the single Add menu.
- Route Run now, Schedule once, New automation, and Templates to existing flows.
- Put automation pause/resume, test, duplicate, send, edit, history, replay, and delete behind row/detail actions.
- Remove the old noisy automation list only after parity tests pass.

Exit gate:

- every capability in the preservation table is manually reachable;
- disabled/paused automations remain discoverable;
- error executions can be opened and replayed where already supported.

### Slice 3 — Workflow launcher shell and guided path

- Replace workflow play actions with the two-choice launcher.
- Build the Artist Manager setup prompt from workflow metadata and workspace context references.
- Verify the conversation asks for missing decisions rather than blindly starting work.
- Keep execution behind explicit user confirmation.

Exit gate:

- all user-facing play entry points use the launcher;
- rerun remains fast and prefilled;
- no public action or scheduling occurs merely by opening guided setup.

### Slice 4 — Manual setup renderer

- Humanize fields and group required/optional inputs.
- Add typed controls and asset pickers.
- Preserve defaults and validation.
- Run now through the existing start API.

Input presentation must be conservative. Declared booleans and numbers map
directly to their matching controls. Unknown strings remain text. Starter
workflow inputs that are known to represent a Vault, Release Kit, Output, or
file reference may use a small presentation registry keyed by workflow slug and
input name. Do not guess an asset binding from an arbitrary field name and do
not change the payload key or value shape merely to improve the form.

Exit gate:

- no snake_case or schema type labels in normal UI;
- required validation matches runtime validation;
- existing workflows launch with equivalent input payloads;
- Run page opens after launch.

### Slice 5 — Schedule and repeat prefill

- Add safe prefill contracts to `ScheduledWorkComposer` and `AutomationWorkDialog`.
- Wire Schedule once and Repeat automatically from both manual and guided paths.
- Confirm resulting records appear in Calendar and Active in the correct sections.

Exit gate:

- immediate run, one-time schedule, and recurring/event automation create three distinct correct record types;
- no duplicate executions;
- workspace, workflow, and input payload are preserved end to end.

### Slice 6 — Polish and regression closure

- Responsive layout and overflow pass.
- Keyboard/focus and reduced-motion pass.
- Empty, partial-failure, stale-link, and large-list states.
- Electron smoke in both HQ and Campaign workspaces.
- Update the in-app User Guide language from Automations to Active where applicable.

## 17. Test plan

### Unit tests

- every session/workflow/scheduled-work/automation status maps to the correct section;
- completed/cancelled records stay off the default page;
- workspace filtering is strict;
- hidden workflow-step sessions do not appear;
- linked scheduled work and workflow/session execution deduplicate;
- automation definition and live execution remain distinct but related;
- common cron patterns produce concise cadence labels;
- raw schema keys humanize correctly;
- optional/required grouping and default values remain stable.

### Renderer interaction tests

- Work tabs route Workers, Workflows, and Active correctly;
- old `automations` route renders Active;
- Active Add menu opens every preserved flow;
- row primary and overflow actions route correctly;
- workflow play opens the two-choice launcher;
- guided setup opens Artist Manager with workflow/workspace context;
- manual validation blocks invalid start;
- Run now creates one workflow run;
- Schedule once preloads one scheduled-work order;
- Repeat preloads one automation;
- attention badge is visible in text and color.

### Existing regression suites

- workflow storage/runtime tests;
- workflow run tests;
- automation validation and handler tests;
- scheduled-work parser/runner tests;
- Artist OS chrome/static routing tests;
- renderer and shared typechecks;
- lint and `git diff --check`.

### Manual Electron smoke matrix

Run each in both Artist HQ and a Campaign workspace:

1. Start a worker and return through Running Now.
2. Start a workflow and open its Run page.
3. Schedule a workflow once and confirm Calendar + Up Next.
4. Create a daily workflow automation and confirm Recurring & Triggers.
5. Pause and resume it.
6. Test it and inspect history.
7. Force or use a known failed execution and confirm Needs Attention + replay route.
8. Duplicate, edit, send where supported, and delete an automation.
9. Restart Electron and confirm active/upcoming/recurring state reconstructs correctly.

Passing tests do not replace this runtime smoke because the primary change is navigation, density, and user journey.

## 18. Risks and guardrails

| Risk | Guardrail |
|---|---|
| Active shows duplicate rows | Deduplicate only through explicit IDs; unit-test every linked pair. |
| UI suggests idle means failed | Only classify documented lifecycle states. |
| Automation features disappear in the redesign | Keep old detail/components live until the parity checklist passes. |
| Guided setup runs work without consent | Composer opens a conversation only; run/schedule/automation remain explicit confirmations. |
| Manual form sends a different payload | Presentation layer transforms labels only; validated keys and values remain unchanged. |
| Active becomes another calendar | Show concise next-time text and link to Plan/Calendar for editing. |
| Page becomes an activity firehose | Omit completed work; cap Up Next; disclose paused definitions progressively. |
| Workspace state leaks across HQ/Campaign | Every source filters by exact active workspace ID before normalization. |
| Partial load looks like “nothing scheduled” | Surface source-specific degraded state and fail closed for unsafe mutations. |

## 19. Definition of done

The feature is complete when:

1. Work has exactly three visible tabs: Workers, Workflows, Active.
2. Active truthfully shows current, upcoming, recurring, and attention-required work from existing systems.
3. The default surface is compact, readable, and free of raw automation/schema language.
4. Every pre-existing automation capability remains reachable.
5. Every visible workflow play action offers Artist Manager setup or Manual setup.
6. Run now, Schedule once, and Repeat automatically create the correct existing resource and appear in the correct surfaces.
7. HQ and Campaign scope correctly with no cross-workspace leakage.
8. Focused tests, full relevant typechecks/lint, and the Electron smoke matrix pass.
9. No data migration, duplicate scheduler, or new persistence layer was introduced.

## 20. Superseded UX decisions

This plan supersedes only the navigation, workflow input-modal, workflow-directory action, and standalone automation-list portions of [`03-ux.md`](./03-ux.md). The workflow runtime, Run page, editor, recovery behavior, and stored formats remain governed by the existing workflow specifications.

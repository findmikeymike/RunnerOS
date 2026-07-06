---
status: draft
owner: agent
last_verified: 2026-07-05
source_of_truth: true
---

# Work Products / Output Architecture

## Purpose

Work Products are the durable deliverables of Artist HQ and campaign work.

The user should not hunt through old chats to find drafts, assets, approvals, reports, or receipts. Chats are where work happens. Work Products are what the app remembers, previews, approves, routes, and resurfaces.

This spec keeps the system intentionally small. It builds on the existing RunnerOS Output manifest system instead of creating a parallel approval inbox, task database, asset library, or tag ontology.

## Core Law

```text
Conversation lives in sessions.
Reusable work lives in Outputs.
Decisions happen on Outputs.
Chats are audit trails, not dashboards.
```

If something matters after the chat scrolls away, it should be an Output.

## Product Model

Use one user-facing concept:

```text
Work Products
```

Work Products are existing Outputs shown in HQ and campaign widgets.

Finals are trusted pointers to existing Outputs. They are covered by [11 Outputs, Finals, And Asset Promotion](./11-outputs-finals-asset-promotion-spec.md) and should not be implemented as a separate asset library.

Inside the widget, split them into two simple sections:

- `Needs Approval`
- `Recent Work`

Do not create a separate approval product. Approval is a state on an Output.

## What Counts As An Output

Agents should create an Output when they produce something the user may:

- reuse
- approve
- publish
- compare
- export
- hand to another worker
- preview visually
- return to later

Examples:

- press email draft
- TikTok caption batch
- cover art concept
- Spotify intel report
- outreach target list
- campaign plan
- release checklist
- video cut
- merch product plan
- sent email or publish receipt

Do not create Outputs for:

- quick answers
- clarifying questions
- brainstorming scraps
- internal reasoning
- minor chat replies
- temporary notes with no future use

Agent test:

```text
Would the user expect this to show up on HQ or a campaign dashboard later?
```

If yes, create an Output.

## Current Foundation

Existing storage:

```text
<workspace-root>/outputs/<output-id>/output.json
<workspace-root>/outputs/<output-id>/content.md
<workspace-root>/outputs/<output-id>/<assets...>
```

Existing core files:

- `packages/shared/src/outputs/types.ts`
- `packages/shared/src/outputs/storage.ts`
- `packages/server-core/src/outputs/OutputService.ts`
- `packages/server-core/src/handlers/rpc/outputs.ts`
- `packages/session-tools-core/src/handlers/outputs.ts`
- `apps/electron/src/renderer/hooks/useOutputs.ts`
- `apps/electron/src/renderer/components/outputs/OutputsListPanel.tsx`
- `apps/electron/src/renderer/pages/OutputDetailPage.tsx`

Existing trigger:

```text
create_output
  -> OutputService.createFromSessionTool
  -> output manifest written with optional context/approval fields
  -> outputs:updated event
  -> useOutputs refresh
```

## Minimal Data Model

Keep the existing Output manifest. Add only two first-class fields.

```ts
interface OutputManifest {
  // existing fields...
  context?: OutputContext
  approval?: OutputApproval
}

interface OutputContext {
  scope: 'hq' | 'campaign'
  campaignId?: string
}

interface OutputApproval {
  state: 'none' | 'pending' | 'approved' | 'changes_requested'
  note?: string
  updatedAt?: string
}
```

That is the whole V1 model.

Use existing fields for everything else:

- `kind` = document, image, video, report, receipt, etc.
- `status` = draft, published, failed, cancelled
- `origin` = session, agent, workflow, automation, deep research
- `assets` = files
- `links` = external references
- `receipts` = proof that something happened
- `tags` = optional extras, not core routing logic

## Field Meaning

### `context`

Answers:

```text
Where should this Work Product appear?
```

Rules:

- HQ-level work uses `context.scope = 'hq'`.
- Campaign-specific work uses `context.scope = 'campaign'` and a `campaignId`.
- Campaign pages should query only their campaign Outputs.
- HQ can show HQ Outputs plus recent campaign Outputs.

### `approval`

Answers:

```text
Does this Work Product need a user decision?
```

Rules:

- `none`: no decision needed.
- `pending`: show in Needs Approval.
- `approved`: approved by user.
- `changes_requested`: user wants revision.

Do not use `status` for approval. `status` is creation health. `approval.state` is user decision.

## Deliberate Non-Goals

Do not build these in V1:

- separate approval inbox database
- giant metadata taxonomy
- output modes
- complex version tree
- asset database
- chat search dependency
- automatic publishing
- automatic background execution from approval
- broad tags as the main routing primitive

Add `supersedesOutputId` later only if revision pain becomes real.

## Agent Behavior

Every worker prompt should include this rule:

```text
When you produce something reusable, approvable, publishable, visual, exportable, or handoff-worthy, call create_output.
Use context.scope/context.campaignId so it appears in the right HQ or campaign widget.
Set approval.state to pending only when the user needs to approve, reject, or request changes.
Set showInCanvas true for visual or preview-worthy outputs.
```

Agents should decide only three things:

1. Is this reusable enough to become an Output?
2. Does it belong to HQ or a campaign?
3. Does it need approval?

No extra metadata burden.

## HNIC Awareness

HNIC should not receive a giant dump of every Output in every prompt.

Add a compact derived context doc:

```text
workspace-context/output-index
```

The index should summarize only the useful recent state:

```text
Needs Approval:
- Cover art v2 | image | Art Director | campaign:blue-moon
- Press email draft | document | Outreach Agent | campaign:blue-moon

Recent Work:
- Spotify intel report | report | Deep Research | hq
- Outreach target list | document | Industry Hunter | campaign:blue-moon
```

The index is for agent awareness. The UI should still read Outputs directly.

Rules:

- Keep the index short.
- Prefer newest and pending-approval Outputs.
- Exclude failed/cancelled unless they are actionable.
- Include output IDs so agents can reference exact items.
- Refresh when Outputs change.

## State Of Play Awareness

HQ State of Play should treat Outputs as core evidence.

It should ask:

- What was recently made?
- What needs approval?
- What is ready?
- What is stale?
- What is missing?
- Which worker should act next?

Implementation path:

1. Generate `output-index`.
2. Include `output-index` as an enabled workspace context doc.
3. Update HQ State composer to read the output index.
4. Let next move route from pending approvals or stale/missing Work Products.

Do not make State of Play read every full manifest in V1. It should read the compact derived index.

## HQ / Campaign Widget

Name:

```text
Work Products
```

Sections:

```text
Needs Approval
Recent Work
```

Campaign page query:

```text
outputs where context.scope = 'campaign'
and context.campaignId = currentCampaignId
```

HQ page query:

```text
outputs where context.scope = 'hq'
plus newest campaign outputs
```

Sort:

1. approval pending
2. newest updated/created
3. failed actionable items if any

Display each row/card:

- preview icon or thumbnail
- title
- short summary
- producing agent/workflow
- age
- approval state when relevant

Keep the widget tight. Do not turn it into another Outputs page.

## Click Behavior

Clicking a Work Product opens an Output Drawer on the current HQ/Campaign page.

Do not send users to the old chat by default.
Do not navigate away by default.

Drawer shows:

- preview
- title
- summary
- producing agent/workflow
- campaign/HQ context
- files/assets
- receipts
- primary actions
- secondary link to session history

### If Approval Is Pending

Show:

```text
Approve
Request Changes
```

`Request Changes` opens a small note box.

After request changes:

- update `approval.state = 'changes_requested'`
- store `approval.note`
- optionally send feedback back to the origin session/agent

### If Visual

Image, video, web, model, artwork, deck:

- large preview in drawer
- `Open in Canvas`
- Canvas may be the default large preview if already open/available

### If Text

Email, captions, report, list:

- readable document preview
- copy/export actions
- approval actions when pending

### If Publishable

After approval, show a separate explicit action:

```text
Send / Schedule / Post
```

Publishing still requires explicit user action.

## Receipts

Receipts are proof. They are not the draft.

Examples:

```text
Output: Press email draft
Receipt: Gmail draft created
Receipt: Email sent
```

Use receipts for:

- sent email
- scheduled post
- uploaded asset
- created draft in external tool
- API mutation
- publish/sync action

Do not use receipts as approval state.

## Assets

Assets live inside Outputs.

Example:

```text
Output: Cover Art Concept
Assets:
- cover.png
- prompt.txt
- layout.json
- reference-board.pdf
```

Do not let assets float as standalone dashboard items in V1.

If the asset matters, it belongs to a Work Product.

## Labels Relationship

Labels stay useful for sessions, search, filtering, and automation.

But Work Products should not depend on session labels.

Correct split:

```text
Session labels = organize work conversations.
Output context/approval = organize durable deliverables.
```

Labels may help agents infer campaign/lane, but widgets should query Output fields.

## Required Runtime Wiring

Runtime foundation already covered:

- Output types and validation include `context` and `approval`.
- `create_output` accepts `context` and `approval`.
- Output manifests and summaries preserve both fields.

Remaining implementation:

### Backend

1. Add RPC/update path for approval changes after creation.
2. Emit `outputs:updated` after approval changes.
3. Add output-index generator.
4. Refresh output-index after Output create/update/delete.

### Frontend

1. Add reusable `WorkProductsWidget`.
2. Add `OutputDrawer`.
3. Mount widget on Artist HQ Home.
4. Mount widget on campaign workspace page.
5. Use `useOutputs(activeWorkspaceId)` as the live data source.
6. Filter by `context`.
7. Route visual preview to Canvas when useful.

### Agent/Prompt

1. Update HNIC/main worker guidance.
2. Update high-output workers first:
   - Art Director
   - Outreach Agent
   - Industry Hunter
   - Comms Agent
   - World Builder
   - Record Doctor
   - Deep Research/HQ intel flows
3. Avoid bloating every prompt. Add one shared Output law in central system prompt if possible.

### State Of Play

1. Add output-index to source docs.
2. Read pending approvals and recent work.
3. Let next move prefer:
   - approval pending
   - missing campaign deliverable
   - stale work product
   - ready-to-publish item

## Suggested Build Order

### Phase 1: Data + Tool

- Add `context` and `approval` fields.
- Extend `create_output`.
- Add tests for schema, persistence, and summaries.

### Phase 2: Widget

- Build Work Products widget using existing `useOutputs`.
- Add drawer preview.
- Add approval buttons.

### Phase 3: Output Index

- Generate compact `output-index` workspace context doc.
- Refresh on output changes.
- Add HNIC/State of Play awareness.

### Phase 4: Agent Behavior

- Update worker prompts.
- Smoke with Art Director and Outreach Agent.
- Verify outputs appear in the right widget without manual user cleanup.

### Phase 5: Polish

- Add Canvas default for visual outputs.
- Add revision feedback loop.
- Add optional `supersedesOutputId` only if needed.

## Acceptance Criteria

- An agent can create an Output that appears on HQ or a campaign page without the user searching chat history.
- A pending-approval Output appears under `Needs Approval`.
- A non-approval Output appears under `Recent Work`.
- Clicking any item opens an Output Drawer in-place.
- Approval changes update the Output manifest and refresh the widget.
- HNIC can see a compact recent output/approval summary through `output-index`.
- State of Play can route from pending approvals or recent Work Products.
- Visual Outputs can open in Canvas.
- Existing Outputs page continues to work.
- No separate approval database exists.

## Final Product Rule

```text
Keep the visible product simple.
Keep the durable object model explicit.
Keep metadata tiny.
Let agents do the filing.
Let users decide from HQ/Campaign widgets.
```

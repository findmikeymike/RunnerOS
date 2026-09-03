---
status: partially-implemented-v1-proposed-v2
owner: raw-video-editor
last_verified: 2026-09-02
source_of_truth: true
related: ./13-scheduled-work-composer-execution-spec.md, ./23-release-kit-architecture-spec.md, ./25-release-kit-asset-use-social-scheduling-spec.md
---

# Guided Social Variant Sets

## Decision

Artist OS will provide one native **Create variants** journey for turning artist-owned or licensed videos into a small, reviewable family of meaningfully different social edits.

The user's creation request is the render authorization. After the user chooses the source videos and quantity, selecting **Create variants** authorizes Artist OS to analyze and render that bounded batch. The system must not stop again merely to ask permission to execute its own edit plan.

The only consequential approval comes after creation, when the user approves an exact variant, destination account, caption, and time for posting.

```text
Choose videos and amount
  -> Create variants
  -> Raw Video Editor analyzes, plans, and renders
  -> User reviews results
  -> User optionally approves an exact post
  -> Social Publisher schedules or publishes
```

This is a native guided flow rather than a generic `WORKFLOW.md` run. It needs durable batch state, incremental media outputs, per-variant review, partial-failure recovery, exact asset lineage, and a safe handoff into the existing social scheduler.

## Product Promise

An artist can select one or more videos, request a deliberate number of alternate edits, and receive genuinely different, account-aware versions without babysitting the editor through a second approval step.

The system preserves the original, records exact source lineage, refuses cosmetic-only copies, and never treats a rendered video as permission to post it.

This is creative repurposing, not duplicate-detection evasion. Artist OS can prove meaningful editorial difference; it cannot promise how an opaque platform classifier will treat an upload.

## What Exists Today

Implemented baseline:

- Raw Video Editor can analyze a selected source without rendering.
- `repurpose` records the exact source SHA-256, scene evidence, edit decisions, and render paths.
- The renderer supports 1-5 planned variants and rejects cosmetic-only, duplicate, and near-full-source edits.
- Instagram Trial is explicit and opt-in.
- Finished variants can become durable Outputs visible in Canvas.
- Verified Release Kit videos and usable HQ Vault videos expose **Create variants**.
- Raw Video Editor already owns the `social-video-repurposing` skill.

Still required:

- a host-owned typed Variant Set contract;
- multi-source setup and total-output limits;
- durable progress and resume;
- a campaign Variants view;
- per-variant keep, revise, archive, and post actions;
- exact destination-account metadata;
- a typed Social Publisher query and scheduling handoff;
- live end-to-end Electron verification.

## Core Laws

```text
One guided journey, not separate HQ and Campaign implementations.
Create variants means create them; do not insert a redundant plan checkpoint.
The original is never overwritten.
Every variant points to one exact source hash.
Every variant has one lead editorial purpose.
Every posting use names one exact connected profile.
Creation is not posting authorization.
Drafts remain Outputs.
Posting snapshots the exact chosen variant into Release Kit.
Scheduling reuses ScheduledWorkOrder and the existing Calendar.
Posted requires a verified receipt.
Agents propose posts; the host records user authorization.
No system infers Trial, fan-page use, or permission from a filename or free text.
```

## Ownership

- **Artist Manager / Campaign Manager** routes the request and supplies compact context.
- **Raw Video Editor** analyzes, chooses the strongest edit plans, renders, and performs technical review.
- **Content Genius** may optionally strengthen hooks or framing without becoming a mandatory step.
- **Social Publisher** owns scheduling and publication after exact user approval.
- **Host application** owns hashes, Release Kit snapshots, posting authorization, and state transitions.

No new agent is required.

## Entry Points

### Campaign

Expose **Create variants** from:

- a verified Release Kit video;
- an eligible Campaign Asset or video Output through **Use asset**;
- the empty and populated Variants tab.

Campaign defaults:

- source picker opens on verified Release Kit videos;
- current campaign is fixed and visible;
- campaign world, song context, release timing, and known social profiles are available to the editor;
- **More sources** expands to Campaign Assets, Outputs, and HQ Vault.

### Artist HQ

Expose **Create variants** from an eligible HQ Vault video and from the HQ Outputs Variants filter.

The user chooses:

- **Use in a campaign** — select one campaign; or
- **Keep evergreen** — keep the set in HQ Outputs for later use.

HQ never creates a Release Kit item without a campaign. Evergreen variants can be reviewed and retained, but cannot be posted until an exact connected profile and valid posting context are selected.

### Eligible sources

A source is selectable only when:

- it is a resolvable supported video;
- it is not missing or hash-drifted;
- the artist owns it or has derivative-use rights;
- its restrictions do not block social use;
- its path passes existing traversal and symbolic-link protections.

Ineligible media remains visible with a plain reason and repair action. Never silently hide a video the user expects to find.

## Clean Setup Journey

Use one compact drawer. Do not expose a long technical form or open a modal over another drawer.

### 1. Videos

Heading: **Which videos should we work from?**

- Multi-select 1-5 eligible videos.
- Show thumbnail, title, duration, and source.
- Default to the video that launched the flow.
- Deduplicate the same source by ID and exact hash.

### 2. Purpose

Heading: **Where should these versions work?**

Show connected profiles grouped by user-assigned role:

- Primary account
- Secondary account
- Fan page

Each row shows platform, account label, handle, role, and readiness.

Also allow **Prepare only**. It records an intended platform and account role without requiring a connected account. This must never become permission to post.

The selected accounts guide editorial fit; they do not multiply the render count. **2 variants per source** still means two total variants per source, not two for every selected account. The editor distributes those variants across the selected destinations and labels the intended destination on each result.

Connected profiles gain one editable role: Primary, Secondary, or Fan page. When only one profile exists for a platform it may default to Primary. Missing roles remain unassigned; Artist OS must not infer Fan page from an account name.

Trial appears under **More options** only for Instagram and is never preselected.

### 3. Amount

Heading: **How many strong versions?**

- Default: 2 variants per source.
- User selects 1-5 per source.
- Total V1 cap: 12 variants per set.
- Show the total before creation: **3 videos x 2 versions = 6 drafts**.

If source quality cannot support the requested count, the editor may deliver fewer strong variants and explain why. It must not create filler to satisfy a number.

### 4. Direction

Heading: **Anything we should protect or push?**

Provide one optional text field for must-keep moments, forbidden moments, tone, pacing, lyrics, themes, or account behavior. A subtle line confirms that existing Artist HQ and campaign context will be used.

Collapsed **Advanced** options may include target duration, aspect ratio, captions, and supplied master-audio sync. Do not expose hashes, FFmpeg flags, or raw timestamp forms.

Primary action:

> **Create 6 variants**

That click authorizes analysis and rendering for the displayed bounded total. There is no later plan-approval stop.

## Chat-Initiated Requests

The same rules apply when the user asks inside chat.

If source, quantity, and purpose are sufficiently clear, Raw Video Editor begins immediately. If something materially blocks a useful result, it asks one compact group of questions before beginning.

It should infer safe creative defaults from current context rather than interrogate the user. Missing destination accounts default to **Prepare only**. Missing quantity defaults to 2 variants per source.

Kickoff language should be conversational:

> I want strong new versions of these videos for the campaign. Create two meaningfully different edits from each, use the existing artist and campaign context, and make them ready for me to review. Ask only if something truly blocks you.

Do not inject command-style prompts that tell the agent to mark campaign work complete or imply permission to publish.

## Intelligent Creation

After the user cues creation, the editor must:

1. inspect every source once;
2. use visual scene evidence, transcript, audio, and relevant context;
3. choose distinct hooks and structures internally;
4. validate those plans before expensive work;
5. render each variant independently;
6. self-check the first three seconds, structure, mobile framing, overlays, audio, duration, and account fit;
7. publish successful results as one durable Variant Set visible in Canvas;
8. explain any failed or omitted version without discarding successful work.

The user may keep chatting while work runs. The editor may show a concise progress plan, but it must not pause waiting for plan approval.

## Editorial Standard

A valid variant changes the editorial object through one or more of:

- opening hook;
- selected moments;
- sequence or narrative structure;
- duration and pacing;
- focal subject or crop strategy;
- lyric or thematic thesis;
- genuine commentary, reaction, or fan-page point of view;
- different performance takes or song sections.

Useful modes:

- Alternate hook
- Fan-page perspective
- Lyric/theme cut
- Performance energy
- Archive/BTS
- Interview/story cut
- Meme/story remix when authentic
- Trial destination when explicitly requested

A filter, font, border, watermark, metadata change, mirror, slight speed adjustment, tiny crop, or re-encode is seasoning only. It cannot satisfy meaningful difference by itself.

## Results And Review

Results appear in Canvas as a compact source-versus-variants comparison:

- source preview first;
- variants grouped by source;
- hook/title and intended account always visible;
- technical detail available in Details;
- warnings visible only when action is needed.

Per-variant actions:

- **Use this version** — begins the exact post setup;
- **Revise** — reopens the same editor session with this variant selected;
- **Keep** — retains it as a normal draft Output;
- **Archive** — hides it from normal selection without deleting lineage.

The normal path does not require a separate generic **Approve asset** step. **Use this version** carries the user into the one consequential approval surface where asset, account, caption, date, time, and timezone are visible together.

## Campaign Variants Surface

The campaign Release Kit page becomes:

```text
Finals | Variants | Outputs
```

**Variants is a derived view, not another asset store.**

- Rendered media remains in its collection Output.
- When the user authorizes a post, the exact chosen media is snapshotted into Release Kit as `video / social-variant` before creating the post authorization.
- The Variants tab joins Output, Release Kit snapshot, Scheduled Work order, and receipt into one understandable state.

Group sets by source video. A compact header shows source thumbnail, set title, destination summary, progress, and **Continue**. Expanding it reveals variants.

Use restrained status families:

- Ready to use
- Scheduled
- Posted
- Needs attention

Do not add large metric cards or another dashboard.

Empty state:

> Turn an approved video into distinct versions for your other accounts.

Primary action: **Create variants**.

## HQ Variants Surface

HQ uses a **Variants** filter in Outputs rather than inventing an HQ Release Kit.

Evergreen sets show source Vault videos, intended platform or role, current state, **Use in campaign**, and **Continue with editor**.

Assigning a set to a campaign does not move or mutate the HQ source. The selected variant is snapshotted only when it enters an exact campaign posting flow.

## Visual Contract

This feature inherits Artist OS rather than introducing a new design system.

```text
palette=monochrome_dark
accent=coral
typography=system_ui
display=same_as_body
layout=single_column
mood=professional_minimal
density=compact
exclude=carousel,decorative_animation,nested_card_sprawl
```

- Use current black/soot surfaces and restrained orange-red accent.
- Keep labels sentence case and normal weight.
- Prefer spacing and subtle tone changes over repeated outlines.
- Keep one primary action per state.
- Do not add a permanent navigation item.
- Preserve focus states, accessible names, readable contrast, and reduced motion.

## Canonical Data Model

One `OutputManifest` with `kind: 'collection'` owns the Variant Set. This avoids a second media library and keeps agent-created work inside the existing durable Output system.

```ts
type SocialAccountRole = 'primary' | 'secondary' | 'fan-page'
type SocialVariantMode = 'standard' | 'trial'

type SocialVariantSetStatus =
  | 'queued'
  | 'analyzing'
  | 'rendering'
  | 'review'
  | 'partially-ready'
  | 'ready'
  | 'needs-attention'
  | 'archived'

type SocialVariantState =
  | 'planned'
  | 'rendering'
  | 'ready'
  | 'failed'
  | 'archived'

interface SocialVariantSource {
  id: string
  origin: 'release-kit' | 'campaign-asset' | 'output' | 'vault'
  sourceId: string
  assetId?: string
  title: string
  sha256: string
  rightsBasis: 'owned' | 'licensed' | 'authorized'
}

interface SocialVariantDestinationIntent {
  platform: 'instagram' | 'tiktok' | 'x' | 'youtube'
  accountRole: SocialAccountRole
  profileId?: string
  accountSetId?: string
  labelSnapshot?: string
  mode: SocialVariantMode
  trialRequested?: true
}

interface SocialVariantRecord {
  id: string
  sourceId: string
  title: string
  hook: string
  editorialMode: string
  editorialIntent: string
  destination: SocialVariantDestinationIntent
  assetId?: string
  sha256?: string
  durationSeconds?: number
  aspectRatio?: string
  state: SocialVariantState
  failureReason?: string
  releaseKitItemId?: string
  scheduledWorkOrderIds: string[]
}

interface SocialVariantSetManifest {
  schemaVersion: 1
  id: string
  workspaceId: string
  scope: 'hq' | 'campaign'
  campaignId?: string
  status: SocialVariantSetStatus
  editorSessionId: string
  sources: SocialVariantSource[]
  request: {
    variantsPerSource: number
    totalRequested: number
    direction?: string
    requestedAt: string
    requestedBy: { type: 'user'; clientId: string }
  }
  variants: SocialVariantRecord[]
  createdAt: string
  updatedAt: string
}
```

`request.totalRequested` is the hard render ceiling for that click. The agent cannot silently expand the batch.

`scheduledWorkOrderIds` are references only. Scheduled, Posted, and Needs-attention state is derived fresh from canonical Scheduled Work and receipts; it is never copied into a second mutable status.

Agents may propose creative fields and attach rendered assets. Only host code may write request identity, Release Kit IDs, Scheduled Work IDs, or publication receipts.

## State And Recovery

```text
queued -> analyzing -> rendering -> review -> ready
rendering -> partially-ready when some variants succeed and others fail
any active state -> needs-attention
ready|failed -> rendering on an explicit retry or revision
ready|failed -> archived
```

- Closing the drawer or app does not cancel the set.
- **Continue** reopens `editorSessionId` and current durable state.
- If the session is unavailable, start a replacement carrying the same Variant Set ID; do not duplicate the set.
- Re-hash sources after restart and immediately before rendering.
- Successful variants survive sibling failures.
- Retry only failed or explicitly revised variants.
- Any retry that adds variants beyond `totalRequested` requires a new explicit creation action.
- If source bytes change, stop affected variants and ask the user to choose the current file or restore the prior one.
- If a destination disconnects, keep the variants and mark posting **Needs account**.

## Exact Posting Approval

Selecting **Use this version** opens the existing compact Release Kit social flow with the chosen variant prefilled.

The final confirmation shows:

- exact variant preview;
- exact destination profile;
- caption/title;
- date, time, and timezone;
- consequential platform options;
- Trial state when applicable.

On confirmation, the host performs one idempotent ordered operation:

1. re-hashes the chosen variant;
2. creates or verifies its immutable Release Kit snapshot;
3. checks current rights and restrictions;
4. creates one `ScheduledWorkOrder` for one destination;
5. mints the existing user authorization over the exact asset and payload.

If the snapshot succeeds but scheduling does not, retain the safe unused snapshot and report **Not scheduled**. Never imply a post was authorized or scheduled unless the canonical work order exists.

Editing media, caption, account, time, or consequential options invalidates authorization and requires the same clear confirmation again.

## How Poster Agents Know What To Use

Social Publisher never guesses from filenames or prose. Provide a strict host query:

```ts
listUsableSocialVariants({
  campaignId,
  platform,
  profileId,
  accountRole,
  unscheduledOnly: true,
})
```

It returns only variants that:

- are successfully rendered and not archived;
- retain valid source lineage;
- have a ready Release Kit snapshot when already scheduled;
- are not restricted from social use;
- match platform and account role;
- match the exact profile when assigned;
- explicitly requested Trial when applicable;
- have no conflicting active work order for the same planned use.

If the user asks, “Schedule the fan-page variants for Angelina this week,” Social Publisher receives eligible candidates, proposes dates and captions, and then presents the existing exact approval surface. It cannot post merely because the variants exist.

## Context And Learning

The editor receives only compact relevant context:

- artist voice and visual world;
- current campaign concept and song meaning;
- selected source facts and recent related variants;
- connected profile role and known account behavior;
- recent performance learnings when available.

Do not inject the full Vault, every prior Output, or raw analytics.

Verified performance may later create compact learnings about openings, pacing, duration, or editorial modes. Metrics never rewrite artist identity, trigger autonomous re-editing, or authorize posting.

## Important Edge Cases

| Situation | Required behavior |
| --- | --- |
| Same source selected twice | Deduplicate by source ID and hash |
| Two sources have identical bytes | Warn and keep one unless explicitly needed |
| Requested count exceeds source quality | Deliver fewer strong versions and explain |
| One of six renders fails | Keep five; retry only the failed one |
| Source changes during work | Stop only affected variants before rendering |
| Variant changes after post approval | Invalidate unexecuted authorization |
| Profile renamed | Keep exact profile ID and refresh display label |
| Profile disconnected | Preserve media; block posting with reconnect/change-account action |
| Fan-page intent has no exact profile | Allow Prepare only; never schedule |
| Trial selected outside Instagram | Refuse with plain explanation |
| Variant is already scheduled | Open its order; do not create a silent duplicate |
| Release Kit snapshot drifts | Mark Needs review and fail closed |
| Publication outcome is uncertain | Needs attention; require human account check before retry |

## Security And Rights

- Never overwrite or delete source media.
- Never remove watermarks or process third-party content without derivative rights.
- Never use private/mobile social APIs.
- Never let a creation request imply posting authorization.
- Never let a connected account imply rights to source media.
- Never expose local absolute paths in provider payloads or user-facing receipts.
- Never claim a version is guaranteed to evade matching or moderation.
- Reuse current Release Kit path, hash, restriction, authorization, and receipt protections.

## Notifications

Notify only when:

- the set is ready for review;
- a source or render needs attention;
- posting needs an account reconnection;
- a scheduled post needs attention.

Do not notify for every successful render. One set-level notice is enough.

## Implementation Slices

### Slice 1 — Typed Variant Set foundation

- Add the strict Variant Set type and runtime parser to Output schema.
- Widen `OutputManifest.schemaVersion` for an optional typed `socialVariantSet` field and migrate old Outputs without rewriting media.
- Add host-owned mutation APIs and revision checks.
- Create the collection Output when creation starts.
- Map tool `variant-manifest.json` into the typed host contract.
- Test malformed disk data, forged request identity, render-ceiling enforcement, and restart recovery.

### Slice 2 — Guided launcher and multi-source creation

- Build the shared compact setup drawer.
- Support Campaign and HQ entry rules.
- Resolve and pin 1-5 sources by ID and hash.
- Enforce the 12-render cap.
- Start or reopen one Raw Video Editor session.
- Begin analysis and rendering without a redundant checkpoint.

### Slice 3 — Incremental render and review

- Render independently per variant.
- Update the collection Output incrementally and atomically.
- Build source-versus-variants Canvas review.
- Add Use this version, Revise, Keep, and Archive.
- Preserve partial success and targeted retry.

### Slice 4 — Variants surfaces

- Add `Finals | Variants | Outputs` to Campaign Release Kit.
- Add Variants filter to HQ Outputs.
- Derive rows from Output, Release Kit, Scheduled Work, and receipts.
- Add Continue, Needs account, and partial-failure states.

### Slice 5 — Posting handoff

- Add strict `listUsableSocialVariants` query.
- Bind exact profile/account role without inference.
- Snapshot and authorize through the existing Release Kit social flow.
- Display existing order status and prevent accidental duplicates.

### Slice 6 — Hardening and live proof

- Test source drift, changed media after authorization, removed profiles, duplicate scheduling, partial failure, Trial refusal, and uncertain publication.
- Verify Campaign and HQ Electron journeys.
- Verify restart/resume and exact session reopening.
- Verify exact scheduling through dry run without performing an external post.
- Keep real provider posting as a separate explicit live gate.

## Acceptance Criteria

### User experience

- A user can begin from Campaign or HQ without understanding implementation details.
- The setup drawer is understandable without documentation.
- The total render count is visible before creation.
- Clicking Create begins the bounded job without another approval interruption.
- Clicking Continue reopens the same job and editor conversation.
- Results are immediately reviewable in Canvas and easy to find later.
- Campaign overview remains uncluttered.

### Integrity

- Every variant preserves exact source lineage.
- Cosmetic-only and duplicate edits fail closed.
- The source remains untouched.
- The agent cannot exceed the authorized render count.
- Successful partial results survive failures and restarts.
- Scheduled and posted states derive from canonical work orders and receipts.

### Posting

- Existence of a variant never authorizes publication.
- The user approves the exact asset, account, caption, and timing once at the post boundary.
- One post equals one existing `ScheduledWorkOrder`.
- No second scheduler, Calendar record, or posting executor is introduced.
- Trial is impossible unless explicitly requested.
- Done is impossible without a verified receipt.

## Explicitly Deferred

- Automatically creating variants whenever a file lands.
- Automatically posting to every secondary or fan account.
- Autonomous performance-based re-editing.
- A generic cross-workspace media graph.
- Collaborative multi-user review comments.
- Provider-specific originality scores.
- Private mobile API automation.
- A new top-level Variants page.

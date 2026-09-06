---
status: proposed
owner: agent
last_verified: 2026-09-04
source_of_truth: true
related: ../10-work-products-output-architecture-spec.md, ../19-artist-manager-brief-context-architecture-spec.md, ./42-campaign-release-path-orchestration-spec.md
---

# Approved Branding Amendments

## Decision

Give the Branding Agent a deliberate finish path that turns an agreed branding
conversation into two durable things:

1. a complete, readable Brand Direction Output
2. a small approved amendment to the correct Branding context

The agent may propose additions. It may not silently rewrite or delete what the
artist already wrote.

```text
branding conversation
        |
Brand Direction Output
        |
proposed field additions
        |
artist reviews exact preview
        |
Add to Branding
        |
append-only approved amendment + provenance
        |
compiled context for relevant workers
```

## Product Outcome

The artist can work naturally in chat instead of copying the useful parts into
Brain by hand. When the direction becomes concrete, the Branding Agent offers
one clear action: `Add to Branding`.

The review shows only what will be added, where it will appear, and any overlap
or conflict. After approval, the new direction appears in Brain -> Branding and
is available as approved context. The full conversation is never injected into
worker context.

## Current Code Truth

- `artist-branding` is a version-1 structured text record with seven primary
  prose fields and notes.
- Its routing mode is `broadcast`, so saved Branding is reusable artist truth.
- Brain currently saves the whole Branding record through the renderer form.
- Branding Agent reads `artist-profile`, `artist-voice`, `artist-branding`, and
  `artist-intel-report`, but has no dedicated finalize or amendment contract.
- `create_output` can preserve a durable Brand Direction deliverable, but an
  Output does not update Brain Branding.
- Agent Memory stores durable preferences or collaboration facts. It is not the
  canonical, structured, reviewable Branding record.

## Core Laws

1. **The artist owns existing text.** Agent application preserves all existing
   user-written fields and approved amendments byte-for-byte.
2. **Append is the default.** `Add to Branding` creates new amendment entries;
   it does not replace the field baseline.
3. **Approval binds an exact change.** The artist sees target, fields, additions,
   conflicts, and source Output before anything changes.
4. **Outputs and context have different jobs.** The Output holds the complete
   thinking. Branding holds only the distilled decisions workers should reuse.
5. **Memory is not canon.** Memory may retain collaboration preferences, but it
   cannot stand in for or mutate Branding.
6. **Campaign work stays local.** A campaign session defaults to its Campaign
   Direction Packet. Moving a campaign insight into HQ requires an explicit
   `Promote to Artist Branding` action.
7. **No stale approvals.** If Branding changes after preview, application stops
   and produces a fresh preview against the new revision.
8. **No duplicate amendments.** Retrying the same approved action is
   idempotent.
9. **Conflicts are decisions.** The agent identifies a contradiction but never
   resolves it by overwriting existing truth.
10. **One mutation door.** Agents cannot call generic context-file writes to
    bypass this contract.

## User Experience

### Finishing a useful conversation

The Branding Agent should offer finalization when the conversation contains an
actual decision, not after every brainstorm or short answer.

Examples:

- `We have enough to turn this into Brand Direction. Want me to package it?`
- `These visual rules are now specific enough to save.`
- `This campaign idea conflicts with the current mythology. I can show both
  before anything is added.`

The artist can also ask directly: `save the useful parts to Branding`.

The agent then creates one Brand Direction Output and attaches a proposed
amendment. The Output card exposes:

- `Add to Branding` in Artist HQ
- `Add to Campaign Direction` in a campaign
- `Promote to Artist Branding` for an approved campaign-specific insight

### Review drawer

Keep the review compact:

```text
Add to Branding

New additions (3)
Creative DNA       Defiant tenderness expressed through...
Visual world       Sodium orange, hard flash, empty highways...
Audience gravity   Listeners rebuilding after...

Possible overlap (1)
Mythology          Existing direction already mentions escape.

Conflicts (0)

[Cancel]                              [Add to Branding]
```

Rules:

- Start with additions expanded.
- Collapse overlap and provenance unless attention is required.
- Disable approval while unresolved conflicts exist.
- After success, link directly to Brain -> Branding.
- Do not expose JSON, hashes, revisions, or storage mechanics in normal UI.

## Data Contract

Evolve `ArtistBranding` without converting every field into a complex editor.
The artist's current prose remains the baseline. Approved agent additions live
as separately identifiable amendments.

```ts
type ArtistBrandingField =
  | 'creativeDna'
  | 'tensions'
  | 'fascinations'
  | 'reactionHooks'
  | 'mythology'
  | 'emotionalTerritory'
  | 'audienceGravity'
  | 'notes'

interface ArtistBrandingAmendment {
  id: string
  field: ArtistBrandingField
  content: string
  sourceOutputId: string
  sourceSessionId: string
  sourceAgentSlug: string
  sourceWorkspaceId: string
  approvedAt: string
  approvedBy: 'artist'
  contentHash: string
  status: 'active' | 'removed'
  removedAt?: string
}

interface ArtistBrandingV2 {
  version: 2
  creativeDna?: string
  tensions?: string
  fascinations?: string
  reactionHooks?: string
  mythology?: string
  emotionalTerritory?: string
  audienceGravity?: string
  notes?: string
  amendments: ArtistBrandingAmendment[]
  updatedAt: string
}
```

V1 documents migrate losslessly: existing fields become the untouched baseline
and `amendments` begins empty. Migration must not change completion percentage
or normalize the artist's prose beyond current behavior.

### Proposal

```ts
interface BrandingAmendmentProposal {
  version: 1
  id: string
  target:
    | { scope: 'artist'; artistWorkspaceId: string }
    | { scope: 'campaign'; campaignWorkspaceId: string }
  baseRevision: string
  sourceOutputId: string
  sourceSessionId: string
  sourceAgentSlug: string
  additions: Array<{
    field: ArtistBrandingField
    content: string
    relationship: 'new' | 'overlap' | 'conflict'
    note?: string
  }>
  createdAt: string
  expiresAt: string
  idempotencyKey: string
}
```

The backend computes `baseRevision` from the exact current document and stores
the proposal with the Output or another backend-owned review record. The model
does not choose revisions, approval state, timestamps, hashes, or identity.

## Compiled Context

Readers receive one compact view:

1. artist-written baseline for each field
2. active approved amendments for that field, oldest to newest
3. amendment source labels only when provenance is requested

Do not route the proposal, full Brand Direction Output, transcript, rejected
ideas, removed amendments, or review discussion as default context.

If context size becomes material, compact only approved amendments through a
separate user-reviewed consolidation. Compaction cannot alter the baseline or
run silently.

## Agent Contract

Add two narrow session tools rather than generic context mutation.

### `propose_branding_amendment`

- available to Branding Agent and explicitly approved manager/orchestrator paths
- reads current target context through the host
- validates field names and bounded content
- creates or references the Brand Direction Output
- classifies additions as new, overlapping, or conflicting
- returns a reviewable proposal
- never mutates Branding

### `apply_branding_amendment`

- callable only from the user approval action, not free-form model choice
- reloads the current context and verifies `baseRevision`
- verifies proposal, Output, session, agent, workspace, and approval identity
- appends each exact approved addition atomically
- rejects stale, expired, duplicated, malformed, or conflicting proposals
- emits a context-updated event and an application receipt

The Branding Agent prompt should say:

```text
When the artist has reached durable brand decisions, create one Brand Direction
Output and propose only the concise additions worth reusing. Do not save raw
brainstorming. Never replace, delete, or silently reinterpret existing Branding.
In a campaign, default to Campaign Direction. Promote to Artist Branding only
when the artist explicitly chooses that action.
```

## HQ And Campaign Ownership

### Artist HQ

HQ Branding is permanent artist-level gravity: identity, mythology, emotional
territory, audience logic, recurring symbols, and durable expression rules.

An HQ Branding Agent session targets `artist-branding` by default.

### Campaign

Campaign-specific angles, visual treatments, language, motifs, and content rules
belong in the Campaign Direction Packet defined by spec 42. They may draw from
HQ Branding but do not modify it.

`Promote to Artist Branding` creates a new artist-scoped proposal from selected
campaign additions. It still requires the standard HQ preview and approval.

Examples that normally stay campaign-scoped:

- one release's color treatment
- one rollout's antagonist or tagline
- temporary visual motifs
- a song-specific audience promise

Examples worth proposing globally:

- a durable contradiction central to the artist
- a recurring mythology or symbol system
- a lasting audience identity
- a repeatable public-expression rule

## Conflict And Editing Rules

- Exact duplicate: omit from the proposal and explain that it is already saved.
- Near duplicate: classify as overlap and let the artist include or exclude it.
- Contradiction: classify as conflict; require an explicit choice.
- Existing typo or weak wording: suggest separately; do not fold a rewrite into
  an amendment.
- Artist edits: the artist may edit or remove any amendment in Brain.
- Agent removal: agents may propose a removal, but that is a separate future
  contract and is not part of V1.
- Baseline replacement: remains a direct artist edit in Brain.

## Reliability And Safety

- Resolve Artist HQ from the workspace relationship on the backend. Never trust
  a model-supplied filesystem path or workspace ID for cross-scope writes.
- Limit proposal content per field and total proposal size.
- Strip control characters and normalize only as required for safe storage.
- Require every source Output to exist in the same artist ownership boundary.
- Use atomic write-and-rename for the context document.
- Emit one receipt containing proposal ID, target, amendment IDs, source Output,
  previous revision, and resulting revision.
- Redact transcript content from operational logs.
- A failed apply changes nothing and remains safely retryable.

## Focused Tests

### Data and migration

- V1 Branding migrates to V2 without changing existing prose.
- Baseline and amendment ordering survive parse/serialize round trips.
- Removed amendments are excluded from compiled worker context.
- Completion remains based on meaningful field content.

### Proposal

- Empty, oversized, unknown-field, and duplicate additions are rejected.
- Campaign sessions default to campaign scope.
- Artist scope resolves the real HQ workspace from the backend relationship.
- Proposal creation cannot mutate context.

### Approval and application

- Exact approved additions append without changing any baseline field.
- Unselected additions are not applied.
- Conflicts cannot apply without a resolved artist choice.
- A stale base revision requires a new preview.
- Repeating the same approval creates no duplicate.
- Partial write failure leaves the original document intact.
- A model tool call cannot impersonate the renderer approval action.

### Routing

- Relevant workers receive the compiled approved Branding context.
- They do not receive transcript, proposal, rejected ideas, or full Output by
  default.
- Campaign additions remain absent from HQ Branding until separately promoted.

### UI

- Review shows field, exact addition, overlap, and conflict state.
- Cancel writes nothing.
- Successful application refreshes Brain Branding immediately.
- Stale review explains the change and refreshes instead of silently rebasing.

## Implementation Slices

### Slice 1 - Versioned amendment model

- `ArtistBrandingV2` migration and parser
- amendment compiler and stable revision helper
- renderer support for reading and displaying amendments
- migration, serialization, and context-routing tests

### Slice 2 - Proposal and approval backend

- proposal validation and storage
- backend-owned target resolution
- atomic idempotent application
- receipts, update events, and adversarial tests

Stop here and verify that no agent path can write Branding directly.

### Slice 3 - Branding Agent finish path

- Brand Direction Output behavior
- `propose_branding_amendment` tool
- compact review drawer and `Add to Branding`
- stale preview, overlap, and conflict UX

### Slice 4 - Campaign promotion

- `Add to Campaign Direction`
- selection-based `Promote to Artist Branding`
- scope labels and cross-workspace ownership tests

This slice depends on the Campaign Direction Packet from spec 42. HQ amendment
work does not need to wait for it.

## Acceptance Gate

The feature is complete only when a live Artist OS session proves:

1. The artist types original text into Brain -> Branding.
2. Branding Agent conducts a substantive HQ conversation.
3. It creates one Brand Direction Output.
4. `Add to Branding` previews exact additions.
5. Approval adds those entries without changing the original text.
6. A relevant second worker can retrieve the approved additions without seeing
   the transcript or entire Output.
7. A concurrent manual Branding edit makes the old proposal stale.
8. Retrying an approved action does not duplicate content.
9. A campaign proposal remains campaign-only until explicitly promoted.

Automated tests, typecheck, and renderer build are required but do not replace
this live multi-session proof.

## Explicit Non-Goals

- no automatic save after every conversation
- no transcript summarization into global context without review
- no agent-authored replacement or deletion of existing Branding
- no generic agent permission to edit arbitrary Brain documents
- no free-form cross-workspace file writes
- no campaign-to-HQ promotion by inference
- no use of Memory as a substitute for approved context
- no automatic compaction of amendment history in V1

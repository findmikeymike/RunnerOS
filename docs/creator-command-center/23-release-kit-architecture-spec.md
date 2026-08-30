---
status: implemented-v1
owner: agent
last_verified: 2026-08-30
source_of_truth: true
---

# Release Kit, Outputs, And Artist Vault

> Implemented on `codex/artist-os-release-kit`. This document supersedes the campaign-Finals pointer model in specs 10 and 11. The old registry remains migration input and temporary HQ compatibility only.

## Purpose

Artist OS needs one understandable path from source material to working drafts to trusted release deliverables.

The current product splits that job across Campaign Assets, Outputs, Output-only Finals, and Artist Vault. The labels overlap, the campaign drawer calls Campaign Assets a Vault, and a user-provided master or cover cannot enter Finals without first becoming an artificial Output.

This specification replaces that ambiguity with four explicit layers:

```text
HQ Vault         permanent career library
Campaign Assets  release-specific inputs and working files
Outputs          durable agent work, drafts, options, and synthesis history
Release Kit      approved snapshots agents can trust and ship from
```

## Core Laws

```text
Chat is discussion.
Outputs are durable work.
Release Kit is approved campaign canon.
HQ Vault is reusable career canon.
```

1. A Release Kit item may come from an upload, Campaign Asset, HQ Vault asset, or Output.
2. Promotion creates a stable snapshot. Editing or deleting the source must not silently change the approved item.
3. Agents may propose promotion, but may promote only after explicit user direction.
4. Every campaign agent receives a compact Release Kit map, not every full Output or file byte.
5. HQ Vault and Release Kit are different products and must never share the same user-facing name.

## Product Vocabulary

### HQ Vault

The permanent artist library shared across releases.

Examples:

- released songs, final masters, clean versions, instrumentals, stems, lyrics, and transcripts
- primary press photos and face-reference images
- bios, EPKs, one-sheets, logos, marks, fonts, and brand assets
- reusable video, B-roll, live footage, and content clips
- merch designs, mockups, and production files
- approved references and reusable campaign materials
- private business files with explicit agent visibility controls

HQ Vault is curated. Agent Outputs do not enter it automatically.

### Campaign Assets

Inputs and working files used by one release.

Examples:

- rough or final mix supplied by the user
- lyrics and lyric transcript drafts
- references, moodboards, raw footage, demos, stems, and source photography
- campaign-only documents and imported material

Campaign Assets may link to HQ Vault records. They are not automatically final.

### Outputs

Durable work products created during the campaign.

Examples:

- cover options and generated image variations
- strategy drafts, research reports, caption packs, and content concepts
- video cuts, lyric-video renders, UGC concepts, ads, and social variants
- campaign plans, brand-world documents, press copy, and outreach packets
- a synthesis created from several earlier Outputs

Useful agent work must become an Output instead of remaining only in chat history. Outputs remain visible after later work is created.

### Release Kit

The approved, campaign-specific launch package.

Release Kit replaces the user-facing term `Finals` for campaign work. Internally, an item is still final and may be primary, but the page and filesystem are named Release Kit.

Release Kit can contain multiple approved items in a category. One item may optionally be Primary when a single default is needed.

## Release Kit Categories

The default categories are stable; subtypes provide useful detail without creating a deep folder taxonomy.

```text
Audio
  master
  clean
  instrumental
  alternate
  stems-package

Artwork
  single-cover
  album-cover
  alternate-cover
  platform-export

Video
  official
  lyric-video
  visualizer
  teaser
  ugc
  live-performance
  performance-clip
  shortform
  ad

Images
  social
  press
  meme
  ad
  behind-the-scenes

Copy
  captions
  release-description
  artist-bio
  press-copy
  outreach-copy

Plans
  campaign-plan
  brand-world
  content-plan
  ad-strategy
  press-plan
  rollout-plan

Merch
  design
  mockup
  production-file

Documents
  press-release
  one-sheet
  epk
  lyrics
  credits
  metadata

References
  approved-reference
  rights-receipt
  approval-receipt
```

Campaign templates may mark expected categories/subtypes. Missing-state UI and Release Board readiness derive from those expectations; they must not maintain a second checklist.

## Storage Layout

```text
<hq-workspace>/
  vault/
    manifest.json
    music/
    video/
    visuals/
    campaigns/
    business/
    references/
  context/
    artist-vault/CONTEXT.md

<campaign-workspace>/
  assets/
    manifest.json
    audio/
    video/
    images/
    docs/
    exports/
  outputs/
    <output-id>/
      output.json
      content.md
      <assets...>
  release-kit/
    manifest.json
    audio/
    artwork/
    video/
    images/
    copy/
    plans/
    merch/
    documents/
    references/
  context/
    release-kit/CONTEXT.md
    output-index/CONTEXT.md
```

`release-kit/manifest.json` is canonical. `context/release-kit/CONTEXT.md` is a compact agent-facing mirror. The old `context/finals/CONTEXT.md` becomes migration input and temporary compatibility data only.

## Data Model

```ts
type ReleaseKitCategory =
  | 'audio'
  | 'artwork'
  | 'video'
  | 'images'
  | 'copy'
  | 'plans'
  | 'merch'
  | 'documents'
  | 'references'

type ReleaseKitSource =
  | { type: 'upload'; originalFileName: string }
  | { type: 'campaign-asset'; assetId: string }
  | { type: 'vault-asset'; assetId: string; vaultWorkspaceId: string }
  | { type: 'output'; outputId: string; assetId?: string }
  | { type: 'legacy-final'; outputId: string; assetId?: string; legacyFinalId?: string }

interface ReleaseKitItem {
  id: string
  campaignId: string
  category: ReleaseKitCategory
  subtype: string
  title: string
  source: ReleaseKitSource
  relativePath: string
  mimeType?: string
  sizeBytes?: number
  sha256: string
  status: 'ready' | 'needs-review' | 'missing'
  isPrimary: boolean
  promotedAt: string
  promotedBy: 'user' | 'agent' | 'migration'
  note?: string
}

interface ReleaseKitManifest {
  schemaVersion: 1
  workspaceId: string
  campaignId: string
  updatedAt: string
  items: ReleaseKitItem[]
}
```

Every item points to a materialized file under `release-kit/`. Even when the source is another workspace, the campaign keeps a stable, portable snapshot.

## Snapshot And Integrity Rules

1. Promotion copies the exact selected file into the correct Release Kit category.
2. Hash the completed snapshot with streaming SHA-256, including large audio and video files.
3. Preserve the source reference for provenance.
4. Never overwrite an existing snapshot in place. Use deterministic collision suffixes.
5. Setting Primary updates metadata only; it does not remove other approved items.
6. Removing an item removes only its Release Kit snapshot and manifest record after confirmation. It does not delete the source Asset, Vault record, or Output.
7. Source deletion is allowed after promotion because the snapshot is independent.
8. Manifest writes use an owner-aware filesystem lock and atomic replacement. A live lock is never expired merely because a large copy/hash exceeds a fixed timeout.
9. A scan verifies file existence and hash drift. Drifted snapshots become `needs-review` and are never silently re-approved.
10. Every read used for agent work or publishing re-hashes the exact snapshot; size and modification time are not trusted as proof.
11. Release Kit paths reject traversal and every symbolic-link component before read or write.
12. The manifest is canonical. A durable marker is written before canonical mutation and cleared only after the context mirror succeeds. Reads never mutate; the next authorized verify or mutation repairs a pending mirror.
13. An item referenced by active Scheduled Work or a Campaign Calendar shell cannot be removed until those references are canceled or removed.
14. Schedule creation and reference-checked removal share the Release Kit lock so an item cannot disappear between validation and persistence.

## Promotion Flows

### Direct Upload

From Release Kit, the user selects a category and uploads a file. The file is copied directly into Release Kit and becomes final. The confirmation screen shows destination, subtype, Primary, and file name.

### Campaign Asset To Release Kit

In V1, Release Kit exposes `Campaign Asset` as a trusted source. The user or authorized agent chooses the exact Asset, category/subtype, and optional Primary. A shortcut directly on the Campaign Assets surface is a follow-up convenience.

### HQ Vault To Release Kit

Release Kit exposes `Add from HQ Vault`. Only agent-usable, non-private, non-missing assets appear. Promotion copies a campaign snapshot and keeps the Vault asset ID as provenance.

### Output To Release Kit

Output list/detail actions and the Release Kit Outputs view expose `Add to Release Kit`. The exact selected Output asset is snapshotted. A direct Canvas-selection shortcut is deferred.

### Synthesize Outputs

When several Outputs contain useful work:

1. User selects the Outputs.
2. A suitable agent receives exact Output IDs and a synthesis instruction.
3. The agent creates a new Output containing the consolidated result.
4. The user reviews it.
5. The new Output may be promoted to Release Kit.

Synthesis never mutates or replaces the source Outputs.

## Agent Tools

The runtime must expose these workspace-scoped tools:

```text
list_release_kit
get_release_kit_item
promote_to_release_kit
remove_from_release_kit
set_release_kit_primary
list_campaign_assets
list_artist_vault
get_asset_record
```

`promote_to_release_kit` accepts exactly one source reference:

```text
sourceType: upload | campaign-asset | vault-asset | output
sourceId
assetId required for Output assets
category
subtype
makePrimary optional
note optional
```

Agent calls require explicit user intent in the current conversation or approved scheduled-work input. Agents may recommend a promotion without calling the tool.
Promotion, removal, and Primary changes always require exact semantic host approval, even in allow-all mode. Service-level team permissions protect every write path, including RPC, in-process tools, and direct MCP tools.

## Scheduled Publishing Contract

New campaign social work stores exactly one immutable input reference:

```ts
{ kind: 'release-kit'; itemId: string; sha256: string; label?: string }
```

The same item ID and checksum are copied into the Campaign Calendar shell and exact approval binding. Scheduling, dry-run preparation, and browser execution each resolve the Release Kit item through containment checks and re-hash it. A changed, missing, ambiguous, or non-ready snapshot fails closed. Legacy Output/Final schedules remain readable for one migration window, but new campaign social schedules cannot create those mutable references.

HNIC may attach exact Release Kit references to a one-shot campaign agent/workflow job through `schedule_work.inputRefs`. Each reference is verified before persistence and copied into the Campaign Calendar shell. Recurring Automations do not accept Release Kit refs in V1 because long-lived references need a separate version/update policy.

## Universal Agent Contract

All agents receive this compact rule from the shared prompt composer rather than duplicating it across every persona:

```text
Asset locations:
- HQ Vault contains reusable career assets.
- Campaign Assets contain release inputs and working files.
- Outputs contain durable drafts and generated work.
- Release Kit contains approved campaign canon.

Create an Output for reusable work. Read Release Kit before using campaign-final material. Use HQ Vault for reusable artist identity/reference material. Never treat a draft Output or Campaign Asset as final unless the Release Kit says so. Promote only after explicit user direction.
```

Specialist additions:

- Image and video generators check HQ Vault for the Primary Face Reference when the user wants the artist's likeness.
- Social, ads, outreach, and publishing agents source campaign media/copy from Release Kit first.
- Audio and lyric agents use Release Kit audio/lyrics first, then Campaign Assets when work is still in progress.
- HNIC retrieves only the compact Release Kit/output index needed for routing.
- Synthesis agents use exact Output IDs and create a new Output.

## Agent Context Delivery

### Release Kit Context

`context/release-kit/CONTEXT.md` contains:

- item IDs, category, subtype, title, Primary state, snapshot path, MIME type, and hash
- missing expected categories/subtypes
- counts by category
- no file bytes

It is small enough for campaign specialists to receive automatically. HNIC receives it on demand and receives only readiness totals in the Campaign Manager Brief.

### Output Index

`context/output-index/CONTEXT.md` contains only:

- recent Outputs
- pending approvals
- Output IDs
- campaign association
- supersession/synthesis relationship when present

It never contains every full Output manifest.

### HQ Vault Context

HQ Vault context defaults to on-demand. It exposes paths only for agent-usable, rights-safe, non-private records. Contracts, splits, and invoices are private and non-agent-usable by default.

### Campaign Asset Context

Campaign Asset context defaults to on-demand. The compact Campaign Manager Brief includes only key availability such as master, lyrics, cover, and raw-footage counts. This prevents large asset manifests from bloating every specialist prompt.

## Face Reference Rules

HQ Vault supports one optional Primary Face Reference plus approved alternates.

When the user asks for their likeness:

1. The visual agent checks the face-reference records.
2. It selects the Primary unless the user names another reference.
3. It passes the exact local file to a compatible generation tool.
4. It does not claim likeness consistency when the selected model/tool cannot accept a reference image.
5. It does not expose private paths in user-facing copy or unrelated agent context.

## UI

### HQ

Keep one nav destination named `Vault`.

Vault shows career categories, search/filter, Primary markers, agent visibility, rights status, campaign links, import, folder link, and `Open Vault Folder`.

### Campaign

Rename the Campaign Brief drawer tab from `Vault` to `Assets`.

Add one campaign nav destination named `Release Kit` with a segmented view:

```text
Finals | Outputs
```

The Finals view includes:

- readiness summary
- category bands with missing, ready, Primary, and needs-review states
- visual/audio/document previews
- Upload, Add from Assets, Add from Vault, and Add from Outputs actions
- Open Release Kit Folder
- remove and Primary actions

The Outputs view includes:

- recent work and pending approval
- Output preview and provenance
- Add to Release Kit

Advanced filters and multi-Output synthesis are follow-up enhancements. V1 keeps the page compact and supports exact single-Output promotion.

Do not create nested cards or one giant modal. Use a small action picker followed by category/details only when needed.

### Release Board (Deferred Follow-Up)

Release Board reads Release Kit readiness directly. Clicking a missing item opens the correct add/generate action. Clicking a ready item opens the Release Kit item.

## Slash Command (Deferred Pending User Testing)

A literal `/final` may be added as an accelerator, not the only promotion path. V1 already supports normal-language promotion through exact trusted IDs.

Rules:

- When a Canvas/Output item is selected, `/final` carries its exact workspace, Output ID, and asset ID.
- `/final image 3` resolves only against the current visible Canvas selection set.
- Ambiguous references open a chooser instead of guessing.
- The user still confirms category/subtype and Primary when they cannot be inferred safely.
- The resulting action calls `promote_to_release_kit`.

## Migration

1. Read legacy `context/finals/CONTEXT.md` on first Release Kit load.
2. Resolve every valid Output and selected asset.
3. Copy it into Release Kit and record source type `legacy-final`.
4. Preserve slot as the closest category/subtype.
5. Preserve Primary and promotion metadata.
6. Record every imported legacy pointer in an atomic migration ledger without deleting the legacy registry immediately. A later removal must not resurrect that item.
7. Scan existing `assets/video/finals/` files and offer import; do not silently classify unknown files.
8. Keep old promote/remove RPC methods as compatibility wrappers during one migration window.
9. Reject malformed legacy registries and manifests owned by another workspace; do not silently replace them with empty data.

The current development data has no legacy Final records, but migration remains required for other installations and tests.

## Security And Privacy

1. Contracts, splits, and invoices default to private and non-agent-usable.
2. Linked external paths are never broadcast by default.
3. Release Kit accepts only files that resolve through validated workspace, Vault, Asset, or Output records.
4. Do not accept arbitrary agent-provided absolute paths for promotion.
5. Context docs never contain private paths or file bytes.
6. Promotion and deletion write audit metadata.
7. Publishing, sending, spending, and account actions remain separate approval gates. Final status is not publishing permission.
8. Team-mode `files.write` permission is enforced inside the Release Kit service, not only at the Electron RPC boundary.

## Windows And Portability

1. Use copied snapshots, not symlinks, for Release Kit files.
2. Normalize manifest paths to forward slashes and resolve them with platform-safe helpers.
3. Avoid Finder-only language in shared UI; use `Open Folder`.
4. Sanitize Windows-reserved file names and trailing dots/spaces.
5. Use atomic write/rename behavior that tolerates Windows file locking.
6. Test collisions, large files, Unicode file names, case-insensitive paths, and cross-drive Vault imports.

Current automated coverage proves forward-slash manifests, Windows-reserved/trailing-name sanitization, collision-safe names, copied cross-workspace inputs, symlink rejection, and hash drift. Real Windows packaging/runtime smoke, case-insensitive-volume behavior, and cross-drive file-lock behavior remain release gates.

## Implementation Slices

### Slice 1: Foundation

- add shared Release Kit types, validation, storage, locking, hashing, and context serializer
- add multi-source snapshot promotion
- add legacy Finals migration reader
- add focused storage and migration tests

### Slice 2: Backend And Tools

- add Release Kit RPC and session tools
- resolve campaign-to-HQ Vault correctly
- add compact Output index
- correct Vault privacy defaults and output provenance
- preserve compatibility wrappers

### Slice 3: UI

- rename Campaign `Vault` tab to `Assets`
- build Release Kit Finals/Outputs page
- wire Output list/detail actions and exact Campaign Asset, Vault, and Output selection from Release Kit
- defer direct Canvas shortcuts and Release Board readiness alignment
- remove stale physical `finals/` file-picker assumptions

### Slice 4: Agent Integration

- add universal asset contract in shared prompt composition
- add face-reference and publishing specialist guidance
- support normal-language finalization through exact trusted IDs; a literal `/final` parser is deferred
- update HNIC/Setup guidance and source-of-truth docs

### Slice 5: Migration And Review

- run targeted and broad type/tests
- test empty, partial, and full kits
- test direct upload, Asset, Vault, Output, synthesis, Primary, removal, and migration
- verify regular-agent versus HNIC context sizes
- conduct adversarial architecture, security, and UX review

## Acceptance Criteria

- Users can clearly distinguish HQ Vault, Campaign Assets, Outputs, and Release Kit.
- A user upload, Campaign Asset, HQ Vault asset, or Output can become a Release Kit item.
- Promotion creates an independent hashed snapshot.
- Agents can find exact approved files without ingesting every Output.
- Agents cannot silently finalize work.
- Visual agents can retrieve an approved Primary Face Reference when likeness is requested.
- Campaign agents use Release Kit before drafts or working assets.
- Outputs remain visible and can be synthesized without destroying history.
- Deferred acceptance: Release Board and Release Kit show the same readiness truth.
- Business/private Vault paths are not exposed by default.
- The filesystem contains a human-readable `release-kit/` folder.
- Windows paths and file operations are covered by tests.

## Implementation Map

- Storage, hashing, locking, verification: `packages/shared/src/release-kit/`
- Source validation and legacy migration: `packages/server-core/src/release-kit/ReleaseKitService.ts`
- Electron RPC: `packages/server-core/src/handlers/rpc/release-kit.ts`
- Agent tools: `packages/session-tools-core/src/handlers/release-kit.ts`
- Direct Codex MCP parity: `packages/session-mcp-server/src/index.ts`
- Immutable schedule/social references: `packages/shared/src/scheduled-work/`, `packages/shared/src/campaign-calendar/`, and `apps/electron/src/main/*social*`
- Universal Artist OS agent contract: `packages/shared/src/agent-prompt/compose.ts`
- Campaign page and progressive promotion flow: `apps/electron/src/renderer/components/app-shell/ReleaseKitPage.tsx`
- Navigation: campaign `Release Kit`, separate from HQ `Vault` and campaign `Assets`

## Deferred Follow-Up

- Replace remaining HQ legacy Finals pointers with an HQ-appropriate approved-library model after campaign migration is stable.
- Align Release Board completion signals directly with Release Kit categories after the product rules for “task handled” versus “approved final exists” are finalized.
- Add a literal `/final` shortcut only if user testing shows it is faster than the current Output/Canvas-to-Release-Kit flow.

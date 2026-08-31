---
status: proposed
owner: agent
last_verified: 2026-08-31
source_of_truth: true
related: ./13-scheduled-work-composer-execution-spec.md, ./20-artist-timeline-unified-calendar-spec.md, ./23-release-kit-architecture-spec.md
---

# Release Kit Asset Use And Social Scheduling Surface

## Decision

Artist OS will not add a user-facing Placement system, a second scheduler, or a second calendar record.

The existing `ScheduledWorkOrder` is the canonical planned-use record. Release Kit and Calendar are two views over the same work order:

```text
Release Kit answers: What approved asset are we using?
Scheduled Work answers: What exact action is authorized?
Calendar answers: When will it happen?
Receipt answers: What actually happened?
```

V1 exposes one working action from Release Kit: **Schedule social post**. Merch, ads, delivery, press, and open-ended work remain future execution types and do not appear as disabled or "coming soon" controls.

The internal architecture remains extensible, but the artist sees only familiar verbs and four plain statuses: **Draft**, **Scheduled**, **Done**, and **Needs attention**.

## User Promise

An artist can open an approved video or image in the campaign Release Kit, choose a social account, enter or review the final caption, choose a date, time, and timezone, and schedule the post without navigating through the general job composer.

The scheduled post appears:

- under the asset as a planned use;
- on the campaign Calendar;
- in Scheduled Work for execution and recovery;
- under the asset history after a verified publication receipt exists.

One asset may have many independent posts. Each post has its own exact caption, destination, time, status, authorization, retry history, and receipt.

The system posts the exact approved Release Kit snapshot. It does not follow a mutable Output path, generate a caption at execution time, silently transform media, or treat an attempted API/browser action as completion.

## Product Vocabulary

### User-facing

| User sees | Meaning |
| --- | --- |
| Release Kit | Approved campaign finals |
| Schedule social post | Use this approved asset in one exact post |
| Planned | Draft or scheduled future uses of this asset |
| History | Completed, canceled, or failed uses |
| Draft | Not authorized to publish |
| Scheduled | Authorized and waiting, preparing, or publishing |
| Done | A publication receipt was verified |
| Needs attention | The system stopped and tells the user what to fix |

### Internal only

- `ScheduledWorkOrder`
- input refs
- payload, action, and media digests
- authorization nonce
- idempotency key
- execution preview
- receipt verification
- runner retries and leases

Do not expose “Placement,” “work order,” “channel discriminator,” hashes, or approval-record terminology in normal UI copy.

## Core Laws

```text
No new Placement entity.
No second scheduler.
No duplicate calendar event.
One external destination equals one work order.
One work order pins one exact Release Kit item and SHA-256.
Everything consequential is concrete before authorization.
Agents may draft; agents may not self-authorize.
Edits invalidate prior authorization.
Done requires a verified receipt.
Hard restrictions are enforced by the host, not trusted to prose.
Legacy schedules may migrate; new social schedules never use legacy Final or Output refs.
```

## Current State Verified In Code

This section is deliberately explicit because the prior review correctly identified the desired shape but overstated what is missing and what is already complete.

### Already implemented

1. `ReleaseKitItem` already owns an immutable snapshot path and SHA-256 in `packages/shared/src/release-kit/types.ts`.
2. `ScheduledWorkInputRef` already supports `{ kind: 'release-kit'; itemId; sha256; label? }`.
3. `ScheduledWorkOrder` already carries owner, Calendar link, type, status, start time, timezone, execution definition, input refs, approvals, runs, result, attention, payload digest, and idempotency key.
4. `ScheduledSocialApproval` already binds action, media, payload, platform, and profile digests to `{ type: 'user'; clientId }`.
5. `campaign-social-job-preparer.ts` and `scheduled-social-browser-executor.ts` already resolve Release Kit media through `resolveVerifiedReleaseKitItemPath` and refuse mismatched hashes. Both live in `apps/electron/src/main/`, not `packages/server-core/`. Social dry-run preparation and browser execution are Electron main-process concerns while order scheduling lives in server-core; this split is deliberate and must be preserved. Do not relocate execution logic into server-core.
6. `ScheduledWorkRunner` already compares the approved action, media, payload, platform, and profile before execution.
7. Successful social work already stores a durable external receipt. Uncertain or failed execution already maps to `needs-attention` rather than `done`.
8. Scheduled Work already links to the existing campaign Calendar item. The unified Calendar does not need another store.
9. Release Kit removal safety already exists in `ReleaseKitService.assertItemIsUnreferenced`. It refuses removal while non-canceled Scheduled Work or Calendar records reference the item.
10. New campaign social composition already requires Release Kit refs at the UI validation layer, while legacy `final` and `output` media resolution remains as an execution fallback for old schedules.

### Not yet implemented

1. Release Kit has no asset-detail surface with **Schedule social post**, metadata, planned uses, and history.
2. Release Kit items have only `category`, `subtype`, and a promotion `note`; they do not have bounded use metadata or enforceable restrictions.
3. The existing reference scan is private removal protection, not a reusable reverse-lookup API for the UI.
4. Scheduling is not currently final social authorization. Current social work waits in `needs-approval` and prepares a dry run near execution: `SOCIAL_PREP_WINDOW_MS` (`ScheduledWorkRunner.ts:31`) is 30 minutes and governs when *preparation begins*, not when approval may be accepted. Approval validity is governed separately by `socialApproval.expiresAt`, checked at `ScheduledWorkRunner.ts:312`.
5. The general Calendar composer tells users that exact approval will be required near publish time. That conflicts with the desired promise that scheduling an exact post authorizes it.
6. HNIC's `schedule_work` tool currently supports agent tasks and workflow runs only. It cannot stage or authorize native social publishing.
7. There is no user-visible diff when a scheduled social definition changes.
8. Legacy social execution can still fall back to mutable Output-based `final` or `output` refs. New creation is constrained, but migration and final removal of that fallback are incomplete.

## Scope

### V1 includes

- campaign Release Kit assets only;
- one approved Release Kit image or video per social post;
- one exact platform/profile destination per persisted work order;
- caption/title and supported platform options completed before authorization;
- date, time, and explicit IANA timezone;
- Release Kit asset metadata and enforced restrictions;
- asset-side planned/history lookup;
- Schedule-from-Release-Kit flow;
- Calendar rendering and existing work-detail reuse;
- host-minted human authorization at Schedule;
- invalidation and readable diff after edits;
- verified execution receipt and actionable attention state;
- HNIC draft/proposal path using the same confirmation surface;
- safe migration of legacy social refs.

### V1 excludes

- merch production or Shopify publishing;
- ad creation or spend authorization;
- press distribution, DSP delivery, email, or collaborator sending;
- text-only social posts started from Release Kit;
- runtime media cropping, transcoding, caption generation, or creative rewriting;
- recurring social publishing automations;
- a generic “Assign other work” action;
- a new main navigation item;
- a new calendar store, scheduler, queue, or Placement registry;
- analytics beyond storing and opening the provider receipt URL;

Future channels extend `ScheduledWorkExecution` with a validated execution variant and dedicated executor. They do not weaken social V1 or introduce a generic untyped payload.

## User Experience

### Release Kit gallery

Keep the existing Finals/Outputs page and visual category layout.

Each eligible ready image/video has:

- its existing preview/open behavior;
- a concise status marker only when it has a scheduled or attention-needed use;
- an accessible action named **Schedule social post**.

Selecting an asset opens one detail drawer. Do not open a second modal over the drawer.

### Asset detail drawer

The drawer contains three compact sections, not nested cards:

1. **Asset** — preview, title, subtype, technical facts, Primary state, use metadata, restrictions, and Open file.
2. **Planned** — drafts, scheduled posts, currently publishing posts, and needs-attention posts.
3. **History** — receipt-verified completed posts and canceled historical uses.

Primary action: **Schedule social post**.

Secondary actions remain Set Primary, Edit details, Open file, and Remove/Archive where allowed.

### Schedule social post flow

Use a compact stepped drawer or replace the asset drawer body in place. Do not use one long modal.

#### Step 1 — Where

- Show only connected profiles that are currently supported by the native social executor.
- A profile row uses recognizable platform icon, account label, and readiness state.
- One profile selected creates one order.
- Selecting multiple profiles is allowed only when batch scheduling is implemented; internally it creates one order per profile.

#### Step 2 — Post

- Show the exact pinned asset preview.
- Require final caption/title before continuing.
- Allow **Draft with Social Publisher**, but generated text must return into the Draft and become visible before Schedule is enabled.
- Expose only platform options supported and verified by that destination.
- No “generate at posting time” option.
- No hidden automatic crop or format conversion. If a variant is needed, create an Output, promote the variant to Release Kit, then schedule that exact item.

#### Step 3 — When

- Choose date, start time, and timezone.
- No due date.
- Default timezone comes from user settings and remains visible beside the time.
- Show a plain summary: asset, account, caption/title, date, time, timezone, and any consequential platform option.
- Button label is **Schedule post** or **Schedule N posts**.

The button is disabled until every required field is concrete and the source item passes integrity and restriction checks.

### Editing

Editing an authorized post creates a Draft revision and immediately invalidates its authorization.

Before reauthorization, show only fields that changed:

```text
Caption
Before: Out tonight.
After:  Out everywhere tonight.

Time
Before: Sep 12, 6:00 PM CDT
After:  Sep 12, 8:00 PM CDT
```

The user then selects **Update schedule**. A generic “Are you sure?” without a diff is insufficient.

Changes that require reauthorization:

- Release Kit item or hash;
- platform, profile, or account set;
- caption/title;
- consequential platform options;
- date, time, or timezone;
- any future spend or inventory commitment.

Changes that do not require reauthorization:

- advisory asset notes;
- `bestFor` metadata;
- UI-only labels that do not enter execution.

### Plain status mapping

| Internal state | Asset UI |
| --- | --- |
| draft, needs-setup, needs-approval | Draft |
| waiting, scheduled, running | Scheduled |
| done with verified receipt | Done |
| needs-attention, failed/missed legacy state | Needs attention |
| canceled | History: Canceled |

`running` may show the subtext “Publishing” while retaining the simple Scheduled family.

### Needs attention

Needs-attention is not a quiet neutral chip.

- Show an orange/red marker on the Release Kit asset.
- Surface the item in the existing HQ/campaign attention feed.
- Use the existing app notification path when execution is due or has started and then stops.
- Explain the exact fix in plain language.

Examples:

- “This final is now blocked from use. Review the asset before rescheduling.”
- “The approved file no longer matches the scheduled version. Choose the current final or restore the approved one.”
- “Instagram needs you to sign in again.”
- “Artist OS could not verify that the post was published. Open the account before retrying.”

Never translate an uncertain external action into Done.

## Release Kit Use Metadata

Do not duplicate `category` or `subtype`; they already describe the asset type.

Add a bounded metadata object to `ReleaseKitItem`:

```ts
type ReleaseKitUseCase = 'social' | 'ads' | 'store' | 'press' | 'delivery'
type ReleaseKitContentRating = 'clean' | 'explicit' | 'unknown'

interface ReleaseKitUsageMetadata {
  bestFor: ReleaseKitUseCase[]
  contentRating: ReleaseKitContentRating
  notes?: string                         // advisory, <= 1000 chars
  restrictions: {
    blockedFromUse: boolean
    needsRightsClearance: boolean
    artistLikenessRestricted: boolean
  }
  technical?: {
    width?: number
    height?: number
    durationSeconds?: number
    aspectRatio?: string
    orientation?: 'portrait' | 'landscape' | 'square' | 'unknown'
  }
  updatedAt: string
  updatedBy: 'user' | 'system' | 'migration'
}
```

### Meaning

- `bestFor` helps filtering and agents; it does not authorize use.
- `contentRating` routes clean/explicit choices; it is not a universal block.
- `notes` are advisory. Agents should read them, but host safety never depends on prose.
- `blockedFromUse` blocks every new or pending external use.
- `needsRightsClearance` blocks external use until a human clears the flag.
- `artistLikenessRestricted` blocks social scheduling in V1. A future channel may define a narrower rule, but V1 fails closed.
- Technical facts are system-extracted when available and display as unknown when not. Extraction failure does not corrupt or reject the Release Kit item.

### Mutation authority

- Only a human UI action may change hard restrictions in V1.
- Agents may read all safe usage metadata.
- Agents may propose advisory notes or tags in chat, but no agent tool may silently clear a restriction.
- Changing a restriction writes `updatedAt` and `updatedBy` and triggers dependent-work reconciliation.

### Manifest migration

Bump `ReleaseKitManifest.schemaVersion` to `2`.

This is a **type-level** change, not a value edit. The field is currently the literal type `schemaVersion: 1` (`packages/shared/src/release-kit/types.ts:44`), so it must widen to `1 | 2`, and every parser and guard comparing `schemaVersion === 1` must accept both. A v1 manifest loads as a valid v2 with the new usage-metadata fields absent; migration is additive and must never rewrite or invalidate an existing manifest on read.

V1 records migrate deterministically:

```ts
usage = {
  bestFor: [],
  contentRating: 'unknown',
  restrictions: {
    blockedFromUse: false,
    needsRightsClearance: false,
    artistLikenessRestricted: false,
  },
  updatedAt: item.promotedAt,
  updatedBy: 'migration',
}
```

Migration must be idempotent, preserve item IDs/hashes/source/provenance, and use the existing atomic manifest/context-sync path.

The compact `context/release-kit/CONTEXT.md` **will** include category, subtype, `bestFor`, content rating, advisory notes, and restriction flags. It does not include full technical metadata or file bytes.

Today `serializeReleaseKitContext` (`packages/shared/src/release-kit/manifest-context.ts:32-70`) emits only `id, category, subtype, title, relativePath, mimeType, sha256, status, isPrimary, source`. The usage-metadata fields do not exist yet and are added by this specification.

## Canonical Planned-Use Model

Do not add `Placement` or `AssetUse` storage.

The canonical record remains:

```ts
ScheduledWorkOrder {
  type: 'social-publish'
  execution: {
    type: 'social-publish'
    platform
    profileId
    accountSetId?
    caption
    platformOptions?
  }
  inputRefs: [
    { kind: 'release-kit', itemId, sha256, label? }
  ]
  startAt
  timezone
  calendarLink
  approvals
  runs
  result
  attention
}
```

### Social invariants

Enforce server-side, not only in React validation:

- owner scope is campaign;
- exactly one `release-kit` input ref;
- no `final`, `output`, `vault`, or `produced-output` input ref;
- Release Kit item exists, is `ready`, and its SHA-256 matches;
- the item is an executor-supported image/video MIME type;
- all hard restriction flags are false;
- platform/profile exists and is ready;
- caption/title and required platform options are present;
- `startAt` is valid and timezone is a valid IANA timezone;
- execution payload digest includes execution, exact input ref, `startAt`, and timezone;
- idempotency key is stable across retries of the same requested post.

### Multi-profile scheduling

One UI gesture may authorize multiple exact posts, but persistence remains one work order per platform/profile.

Reasons:

- each provider has different options and limits;
- one failure must not hide successful siblings;
- retries and receipts remain destination-specific;
- captions may differ;
- idempotency remains exact.

Add only lightweight grouping metadata when batch UX ships:

```ts
batch?: {
  id: string
  index: number
  total: number
}
```

This is not a new entity. A batch schedule RPC validates all orders and writes all-or-none under the existing workspace lock.

## Authorization Model

### Important current behavior

Current `socialApproval` is an execution-near approval. It is created only after a dry run exists and only within 30 minutes of the scheduled time. Therefore it cannot, unchanged, support the product statement “Schedule authorizes this exact post.”

Do not pretend the existing field already solves schedule-time authorization.

### Target behavior

Durable schedule-time authorization lives in a **new dedicated field** on `ScheduledWorkOrder`, defined in `packages/shared/src/scheduled-work/index.ts` alongside `ScheduledSocialApproval`.

Do **not** extend `CampaignScheduleApproval` and do **not** reuse the `approvals[]` array. An earlier draft of this specification proposed both. Three verified facts make that wrong:

1. **`CampaignScheduleApproval` has no `approvedBy` field.** Its actual shape (`packages/shared/src/campaign-calendar/index.ts:88`) is `{ id, status, approvedAt?, expiresAt?, payloadDigest?, binding?, notes? }`. The `approvedBy: { type: 'user'; clientId }` that makes agent authorship structurally impossible exists only on `ScheduledSocialApproval` (`scheduled-work/index.ts:188`). Placing durable authorization on a type with no authorizer field would delete the product's central safety property from the exact record meant to carry it.
2. **`approvals[]` is never structurally validated.** Both the parser (`scheduled-work/index.ts:616`) and the type guard (`:650`) check only `Array.isArray`. No element validator exists. By contrast `isScheduledSocialApproval` (`:848-855`) validates every field including `approvedBy.type === 'user'`. The most safety-critical record in the product must not live in the one array that is accepted unchecked from disk.
3. **`CampaignScheduleApproval` is shared with legacy calendar machinery** (`CampaignScheduledJobRunner.ts`). Extending it couples new social authorization to the calendar-era job path this specification is meant to supersede.

```ts
/** Durable, human-minted authorization for one scheduled use of an approved asset. */
export interface ScheduledWorkAuthorization {
  id: string
  authorizedAt: string
  expiresAt?: string
  /** Host-computed over `definition`. Execution attestation must reproduce this exactly. */
  payloadDigest: string
  authorizedBy: {
    type: 'user'
    clientId: string
    source: 'release-kit-ui' | 'calendar-ui' | 'hnic-confirmation'
    sessionId?: string
    userMessageId?: string
  }
  definition: {
    title: string
    releaseKitRef: { itemId: string; sha256: string; label?: string }
    platform: string
    profileId: string
    accountSetId?: string
    caption: string
    platformOptions?: Record<string, unknown>
    startAt: string
    timezone: string
  }
}
```

Added to the order as `authorization?: ScheduledWorkAuthorization`.

**The security boundary is host-only minting, not the type.** `authorizedBy.type: 'user'` and a structural validator prove *shape*, never *origin* — a well-formed authorization object says nothing about who authored it. Structure and origin must be enforced separately:

- **Origin (the real boundary).** Only the server mints a `ScheduledWorkAuthorization`, and only in direct response to an authenticated human command. Any authorization field arriving from the renderer, from a tool call, from an agent, or from an imported/transferred order is **discarded and re-derived**, never trusted or merged. No tool surface accepts an authorization object as input. This is what makes "agents draft, humans authorize" true.
- **Structure (defence in depth).** Ship `isScheduledWorkAuthorization` in the same commit as the type, modelled on `isScheduledSocialApproval`, and call it from both the order parser and the order type guard — because `approvals[]` shows what happens when a record is accepted from disk unchecked. This catches corruption and hand-edited session files; it does not and cannot establish human origin.

Treating the literal type as the guarantee is the failure mode to avoid: it would let a forged-but-well-formed object pass as authorization.

The host computes `payloadDigest` from `definition` at mint time.

### Relationship to `ScheduledSocialApproval`

Two records coexist on a social order and their relationship must never be ambiguous:

| Record | Minted when | Means |
| --- | --- | --- |
| `authorization` | Human clicks Schedule (or confirms to HNIC) | *This human approved these exact details* |
| `socialApproval` | Runner prepares the dry run near execution | *These exact details were re-verified against the live action* |

**`socialApproval` is always derived from `authorization` and is never independently created for work that has one.** At preparation the runner must confirm that the dry run's `mediaDigest`, `platform`, `profileId`, and caption reproduce the authorized `definition`; any divergence fails the order to `needs-attention` rather than minting a fresh approval.

Without this rule the two records become a second split-brain — the same failure the legacy Finals pointer model produced, relocated into the approval path, where its consequence is posting something the artist never authorized.

### Migration: orders that predate `authorization`

The refuse-to-post rule applies **only to orders created after this feature ships**, and must not retroactively invalidate work a user already approved.

Orders are classified once, at load:

- **New orders** (created on or after the `authorization` field exists) require a valid `authorization`. Reaching execution without one is a defect: fail to `needs-attention` and refuse to post.
- **Legacy orders** (created before, identifiable by having no `authorization` and a `createdAt` earlier than the migration marker) continue through the existing `socialApproval` path unchanged. They are **not** back-filled with a synthetic authorization — the host cannot manufacture a human authorization after the fact, and inventing one would defeat the boundary this section establishes.

A legacy order that a user **edits** after the migration is re-authorized through the new path, since the edit produces a fresh human authorization for the changed details.

Silently failing an already-approved legacy post on release day would be a worse outcome than the inconsistency it prevents. When the legacy path is retired, surface any remaining legacy orders to the user for explicit re-scheduling rather than cancelling or auto-converting them.

### Authorization sources

#### Release Kit or Calendar UI

The authenticated client submits the complete definition through a dedicated authorize-and-schedule RPC. The server re-reads the Release Kit item, validates restrictions/profile/timezone, computes the digest, creates the approved record, then atomically writes Scheduled Work and the linked Calendar item.

#### HNIC

HNIC may fill every field and stage an exact proposal, but it may not directly mint approval.

Use the existing Goal confirmation pattern:

1. HNIC calls a proposal-only social scheduling capability.
2. The host validates the definition and returns a short-lived proposal nonce bound to its digest.
3. The renderer shows the same exact summary used by Release Kit.
4. An authenticated human confirms the proposal.
5. The host consumes the nonce once and writes the order/Calendar item.

The user's request may begin in free-form chat, including “schedule these exact ten posts,” but the persisted authorization must bind the exact normalized definitions. An agent tool call alone is never proof of human authorization.

Plain free-form “yes” parsing is out of scope for V1. A host-owned confirmation action prevents the model from interpreting ambiguous language as permission.

### Execution-near verification

Keep the existing dry-run and `ScheduledSocialApproval` machinery as an execution attestation during migration, but derive it from the still-valid durable schedule authorization instead of requiring a second user approval.

At execution time the runner must:

1. re-read the work order and its `authorization` (`ScheduledWorkAuthorization`), refusing if absent, expired, or failing `isScheduledWorkAuthorization`;
2. recompute the exact schedule definition digest;
3. re-read the Release Kit item and restrictions;
4. verify the pinned item SHA-256 and media fingerprint;
5. prepare the provider/browser dry run;
6. verify the dry-run platform, profile, payload, and media against the durable authorization;
7. create the execution attestation linked to the durable approval ID;
8. execute once through the existing idempotent path;
9. mark Done only after the receipt verifies.

Any mismatch becomes Needs attention. It never silently falls back to a mutable Output.

### Expiration

Schedule authorization is intended for the scheduled future time and must not expire 30 minutes after creation.

- It remains valid through `startAt` plus the existing execution grace window.
- Canceling or editing invalidates it immediately.
- A missed-start reschedule requires a new authorization.
- Provider login expiration does not invalidate content authorization, but execution pauses in Needs attention until setup is repaired.

### Spend-bearing future channels

When ads or commerce ships, the authorization definition must include exact spend, price, inventory, provider, and destination commitments. The button must expose the bound directly, such as **Schedule — $150 total budget**.

This is a future-channel requirement, not social V1 implementation scope.

## Drafting And Agent Behavior

### Social Publisher

The Social Publisher may:

- list approved Release Kit candidates;
- read safe usage metadata;
- draft captions and platform-specific options;
- recommend profiles and times;
- stage one or more exact schedule proposals;
- explain why an item is blocked.

It may not:

- clear hard restrictions;
- change the Release Kit snapshot;
- create an approved schedule without host authorization evidence;
- generate or rewrite caption/media at execution time;
- substitute another asset after authorization;
- claim a post completed without a verified receipt.

### HNIC

HNIC may coordinate and batch exact proposals. It uses the same Release Kit IDs/hashes, validators, authorization surface, work-order persistence, and receipts as the Release Kit UI. There is no privileged bypass.

### Agent context

Update the universal Artist Asset Contract and Release Kit compact context to state:

- use metadata is advisory except host-enforced restriction flags;
- scheduled social work requires one exact Release Kit item;
- captions and platform options must be complete before authorization;
- changing an approved definition returns it to Draft;
- posting occurs only from authorized Scheduled Work, not from an Output path.

Do not hand-edit every agent definition. The universal prompt contract and tool descriptions are the shared source of truth.

## Reverse Lookup And Asset History

Extract the existing reference scan into one shared selector:

```ts
listReleaseKitItemUses(work: ScheduledWorkDocument, itemId: string): ScheduledWorkOrder[]
```

Rules:

- match only exact `release-kit` item IDs;
- exclude deleted orders by default;
- include canceled and completed orders for History;
- never infer by title, path, filename, or hash alone;
- return a stable sort: active attention first, then future ascending, then history descending.

Expose a bounded RPC DTO rather than the entire Scheduled Work document:

```ts
interface ReleaseKitItemUseSummary {
  orderId: string
  calendarItemId: string
  title: string
  platform?: string
  profileId?: string
  startAt: string
  timezone: string
  status: 'draft' | 'scheduled' | 'done' | 'needs-attention' | 'canceled'
  attentionMessage?: string
  receipt?: {
    externalUrl?: string
    completedAt: string
    summary?: string
  }
  updatedAt: string
}
```

The drawer loads these summaries on demand. Do not add them to every Release Kit context prompt.

## Removal And Archival

Removal safety is already enforced. Extend its UX; do not rebuild it as a new subsystem.

- Future, running, or attention-needed references block removal and list the affected posts.
- Completed receipt-bearing references continue to protect the audit trail.
- Offer **Archive final** for a receipt-bearing item instead of deleting its snapshot/history.
- Canceled references do not authorize execution, but remain visible in History.
- Canceling an active use and removing an item are two distinct, explicit actions.
- Never silently cancel posts as a side effect of removing an asset.

If archive support is not implemented in the same slice, keep removal blocked and explain why. Do not weaken current protection to make the button succeed.

## Restriction Reconciliation

When a human turns on a hard restriction:

1. write the Release Kit manifest/context atomically;
2. find active dependent work orders;
3. invalidate their durable authorization;
4. move them to Needs attention with a plain reason;
5. update linked Calendar state;
6. emit the existing Scheduled Work, Calendar, Release Kit, and HQ-state refresh events.

The runner repeats the restriction check immediately before execution. This is defense in depth if event reconciliation failed or the app restarted mid-write.

Clearing a restriction does not silently restore a schedule. The user reviews and authorizes again.

Use the existing workspace-context lock order. Do not acquire Release Kit and Scheduled Work locks in opposite orders. If atomic cross-document mutation cannot be guaranteed, persist a reconciliation marker and fail closed at execution until repaired.

## Legacy `finalRefs` Sunset

The legacy fallback remains necessary for old persisted schedules, but new social publishing must never create it.

### Phase A — reject new legacy social refs

Add server validation in every social schedule entry point:

- exactly one `release-kit` ref;
- zero `final`, `output`, `vault`, or produced-output refs.

Renderer validation is not sufficient.

### Phase B — migrate old schedules

For each non-completed social order using a legacy Final/Output ref:

1. resolve the exact current source asset;
2. copy it into Release Kit as `promotedBy: 'migration'`;
3. pin its new item ID and SHA-256;
4. replace the social order and Calendar refs under the workspace lock;
5. invalidate any old social approval;
6. set the order to Draft/Needs attention for human review;
7. record an idempotent migration ledger entry.

Do not automatically preserve external authorization across migration because the approved bytes may not be provably identical to the historical intent.

Completed receipt-bearing legacy work remains historical and is not rewritten unless a separate audit migration proves it safe.

### Phase C — remove execution fallback

Remove Output/Final fallback from new runtime execution only after:

- all known active legacy orders have migrated or are visibly blocked;
- migration tests cover restart and partial failure;
- no supported creation path emits legacy social refs;
- packaged-profile smoke confirms old campaigns open without data loss.

Campaign Calendar may retain legacy fields for non-social compatibility. The sunset is specifically the social media execution fallback.

## Data And API Changes

### Shared

- `packages/shared/src/release-kit/types.ts`
  - manifest V2;
  - `ReleaseKitUsageMetadata`;
  - update input and use-summary DTOs.
- `packages/shared/src/release-kit/storage.ts`
  - V1-to-V2 migration;
  - validated metadata mutation;
  - technical metadata persistence.
- `packages/shared/src/release-kit/manifest-context.ts`
  - safe agent-facing metadata and restrictions.
- `packages/shared/src/scheduled-work/index.ts`
  - durable human authorization evidence;
  - optional batch metadata;
  - shared reverse selector;
  - exact social definition/diff helpers;
  - specific attention reasons where existing generic reasons cannot produce a clear repair.

### Server

- `packages/server-core/src/release-kit/ReleaseKitService.ts`
  - update metadata;
  - list item uses;
  - restriction reconciliation;
  - improved removal dependency result.
- `packages/server-core/src/handlers/rpc/release-kit.ts`
  - metadata update and item-use RPCs.
- `packages/server-core/src/handlers/rpc/scheduled-work.ts`
  - authorize-and-schedule social command;
  - edit/reconfirm command;
  - optional atomic batch command;
  - server-side social invariants.
- `packages/server-core/src/scheduled-work/ScheduledWorkRunner.ts`
  - durable authorization validation;
  - automatic execution attestation;
  - restriction recheck;
  - plain attention failures.
- `packages/server-core/src/sessions/SessionManager.ts`
  - HNIC proposal-only capability and confirmation nonce;
  - no direct agent approval mutation.

### Electron transport

- add explicit IPC channels and channel-map entries for metadata, uses, schedule authorization, and reconfirmation;
- preserve ownership/team permission checks;
- never pass a renderer-authored `approvedBy` object through unchanged.

### Renderer

- `ReleaseKitPage.tsx`
  - asset detail drawer;
  - Schedule social post flow;
  - metadata/restriction editor;
  - Planned and History sections;
  - attention marker.
- reuse narrow pieces of `ScheduledWorkComposer.tsx` and `scheduled-work-composer.ts`; do not embed the full general job wizard.
- `CampaignCalendarPage.tsx`
  - open the same work detail;
  - display authorization/diff state in plain language;
  - remove the second “Approve exact post” click for newly authorized work while retaining legacy compatibility.
- add a chat confirmation card for HNIC-staged exact proposals.

## Permission And Team Mode Rules

- Reading use metadata/history follows existing Release Kit read permission.
- Editing advisory metadata follows Release Kit write permission.
- Changing hard restrictions requires owner/editor authority and is logged.
- Scheduling requires Calendar/Scheduled Work write permission plus `social.publish.approve`.
- HNIC proposal creation carries no side-effect permission.
- Consuming a proposal nonce requires an authenticated user client with social approval permission.
- Shared Folder Team Mode retains its existing idempotency limitation. If automatic execution is unsafe, the post becomes Needs attention rather than pretending it published.
- Release Kit approval alone never authorizes posting. Only the exact scheduled action authorization does.

## Failure Behavior

| Failure | Required result |
| --- | --- |
| Asset missing or hash mismatch | Needs attention; no fallback |
| Hard restriction enabled | Authorization invalidated; no execution |
| Caption/platform/time changed | Draft with visible diff |
| Profile logged out | Needs attention with settings action |
| Unsupported media/platform option | Draft validation error before Schedule |
| Dry run differs from authorization | Needs attention; re-review required |
| Provider reports duplicate exact action | Done only with duplicate/idempotency receipt evidence |
| Provider call returns uncertain result | Needs attention; do not auto-retry blindly |
| Receipt absent or unverifiable | Needs attention, never Done |
| App restarts before execution | Persisted order/authorization resumes through existing runner |
| App restarts during execution | Existing lease/idempotency recovery; verify receipt before Done |
| Batch contains one invalid post | Reject whole batch before persistence |

## Testing Contract

### Shared unit tests

- manifest V1 migrates to V2 without changing IDs, hashes, or source paths;
- malformed metadata fails closed;
- restriction defaults are safe and deterministic;
- exact social definition digest changes for every consequential field;
- advisory metadata changes do not change the social definition digest;
- reverse lookup matches exact item ID only and sorts correctly;
- plain status mapping never returns Done without a receipt.

### Server tests

- new social schedule rejects non-Release Kit refs and multiple media refs;
- schedule rejects missing, non-ready, restricted, unsupported, or hash-mismatched assets;
- renderer/agent cannot forge `approvedBy`;
- authorized Schedule atomically writes one work order and one linked Calendar item;
- HNIC proposal cannot execute before nonce consumption;
- nonce is digest-bound, single-use, expiring, and client-authorized;
- editing each consequential field invalidates authorization and produces the correct diff;
- runner automatically attests only when preview matches durable authorization;
- runner rechecks restrictions and file integrity immediately before execution;
- uncertain execution cannot become Done;
- verified receipt does become Done and appears in History;
- restriction mutation invalidates dependent future work;
- current removal safety still blocks referenced items;
- legacy migration is idempotent and never carries forward approval blindly;
- active migrated social work no longer resolves Output paths.

### Renderer tests

- eligible asset exposes Schedule social post;
- unsupported/restricted item explains why scheduling is unavailable;
- caption generation cannot leave Schedule enabled while pending;
- timezone is visible;
- multi-profile UI creates exact independent summaries;
- reconfirm screen shows only real changes;
- Planned and History use the same work-order IDs as Calendar;
- Needs attention is visually prominent and actionable;
- no Placement/internal vocabulary appears;
- no unavailable channel buttons appear.

### Manual Electron smoke

Use a copied campaign/profile, not live artist data.

1. Add or identify one ready Release Kit image/video.
2. Open its drawer and schedule one supported social post.
3. Confirm the exact post appears in Planned and Calendar once, not twice.
4. Restart Electron and confirm the schedule/authorization survives.
5. Edit the caption and verify the old/new diff plus authorization invalidation.
6. Reauthorize and verify the Calendar item updates rather than duplicating.
7. Toggle a hard restriction and verify the work stops with a useful message.
8. Clear the flag and confirm it does not silently resume.
9. Run against a deterministic fake provider and verify Done requires a receipt.
10. Force an uncertain provider outcome and verify Needs attention.
11. Open the same asset and verify receipt history links to the external result.
12. Attempt removal while referenced and verify the UI explains the dependency.

Live-account smoke is a separate consequential gate and must use a designated test account/post with explicit user authorization.

## Implementation Slices

### Slice 0 — baseline and contract tests

- codify current exact Release Kit verification and receipt behavior;
- add failing tests for Schedule-time authorization, reverse lookup, and server-side legacy-ref rejection;
- preserve the currently dirty Release Kit UI work rather than overwriting it.

### Slice 1 — metadata and restrictions

- migrate Release Kit manifest to V2;
- add bounded metadata mutation and compact agent context;
- add hard restriction validation and focused tests.

### Slice 2 — reverse lookup and removal UX

- extract the current reference scan;
- expose bounded use summaries;
- add Planned/History data loading;
- preserve and clarify removal safety.

### Slice 3 — single-post Release Kit surface

- add asset drawer and compact three-step flow;
- reuse connected-profile and date/time controls;
- persist one draft definition with exactly one Release Kit ref;
- no HNIC or batch work yet.

### Slice 4 — Schedule-time authorization and runner bridge

- mint durable approval server-side;
- bind exact definition and human evidence;
- derive execution attestation from valid authorization;
- remove the second approval click for new work;
- retain legacy near-time approval compatibility.

### Slice 5 — edit diff, attention, and restart recovery

- invalidate on consequential edits;
- render exact diff;
- wire prominent attention and repair actions;
- test restart at draft, scheduled, prepared, running, and uncertain boundaries.

### Slice 6 — HNIC proposals and optional batch scheduling

- add proposal-only HNIC capability;
- reuse host-owned confirmation nonce pattern;
- add atomic multi-profile scheduling only after single-post flow passes smoke;
- one persisted order and receipt per destination.

### Slice 7 — legacy social migration

- reject all new legacy social refs server-side;
- migrate active legacy refs into hashed Release Kit snapshots;
- invalidate old approval;
- remove runtime fallback only after migration proof.

### Slice 8 — documentation and release gate

- update `docs/CURRENT.md`, system map, scheduled-work and Release Kit specs;
- update universal agent contract/tool descriptions;
- run focused tests, `bun run typecheck:all`, renderer/build checks, and `git diff --check`;
- complete copied-profile Electron smoke;
- run a separate explicitly authorized live-provider smoke before calling publishing release-ready.

Run a skeptical review after Slices 2, 4, 6, and 7. These are the points where storage, authorization, agent routing, and migration boundaries respectively become real.

## Acceptance Criteria

The feature is complete only when all are true:

1. A user can schedule a supported social post directly from one Release Kit asset without entering the general job wizard.
2. The UI introduces no Placement vocabulary, dead channel choices, or duplicate calendar objects.
3. Asset facts, advisory notes, and enforced restrictions are visibly distinct.
4. Every new social order pins exactly one Release Kit item and hash.
5. Everything consequential is visible before Schedule is enabled.
6. A host-owned authenticated human action mints authorization; agents cannot forge it.
7. HNIC can stage exact proposals but cannot bypass confirmation.
8. Schedule-time authorization survives until the intended execution window unless edited, canceled, restricted, or missed.
9. Runtime re-verifies authorization, profile, restriction state, and exact bytes.
10. Consequential edits show a real diff and require reauthorization.
11. Release Kit Planned/History and Calendar resolve to the same work-order IDs.
12. Done always has a verified receipt.
13. Needs attention is prominent, plain, and actionable.
14. Removal safety remains fail-closed and explains references.
15. No new social path emits `final` or `output` media refs.
16. Legacy active social schedules migrate without silently preserving authorization.
17. Automated gates and copied-profile Electron smoke pass.
18. Live provider execution is not claimed until a designated-account receipt is verified.

## Future Channel Contract

Merch demonstrates why the internal model must remain general while the UI remains narrow.

Future flow:

```text
Release Kit merch design
  -> Put this on products
  -> exact products, variants, print provider, Shopify store, prices, launch time
  -> human authorization with visible financial/inventory bounds
  -> typed commerce work order/workflow
  -> provider receipts and product URLs
```

That future work reuses exact Release Kit refs, Scheduled Work lifecycle, Calendar link, human authorization evidence, attention handling, and receipts. It still requires a dedicated commerce execution schema, provider integration, cost bounds, preview/review gates, and tests.

Do not add the button until those capabilities exist.

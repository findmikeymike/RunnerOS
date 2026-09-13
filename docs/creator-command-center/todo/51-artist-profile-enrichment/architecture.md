# Architecture and implementation contracts

All new names below are **proposed**, not symbols already present. File paths are repository-relative. Verified baseline is `f25bbf48c`.

## Existing integration map

| Existing path | Observed role / reuse |
| --- | --- |
| `packages/shared/src/artist-context/profile.ts` | artistProfileDoc text whitelist; spotifyProfile exists; always-delivered broadcast. Do not put nested research here: normal profile serialization reconstructs its fields. |
| `apps/electron/src/renderer/components/app-shell/ArtistHQHome.tsx` | Profile draft/save, ArtistProfileForm, Spotify URL/ID field; add a separate child panel below the form. |
| `apps/electron/src/renderer/hooks/useWorkspaceContext.ts` | Context reads/writes and expectedBody support; verify exact hook path before implementation if relocated. |
| `packages/server-core/src/handlers/rpc/workspace-context.ts` | Existing write permissions, expected-body comparison under workspace lock, change events. Preserve these semantics. |
| `packages/server-core/src/deep-research/DeepResearchRunner.ts` | Auto plan policy, source readiness, persisted runs, safe-mode step sessions, reports, cancellation; restarts interrupt rather than resume. Loop budgets are currently prompt instructions, not a demonstrated host-enforced spend cap. |
| `packages/shared/src/deep-research/{types,storage}.ts` | Existing research run model and persistence. Extend with optional purpose/owner binding only as needed; preserve generic research compatibility. |
| `packages/server-core/src/pulses/spotify-snapshot-publisher.ts` | Publishes latest captured file into artist-spotify-snapshot; SessionManager invokes after spotify-analyst automatic work. No second publisher in enrichment. |
| `packages/shared/src/hq-state/manager-brief.ts` | Reads Spotify snapshot into growth summary with source/freshness. Add separate career summary, not duplicate growth. |
| `packages/server-core/src/hq-state/manager-tools.ts` | get_artist_context growth supplies full Spotify/Instagram snapshots. Add career retrieval without changing analytics ownership. |
| `packages/server-core/src/agent-launch/context.ts` | Shared renderer/server preparation and task-mode filtering; integrate research visibility here, not a renderer-only prompt append. |
| `packages/shared/src/agent-definitions/task-mode-recipes/tier-one.ts` | Relevant growth/ads focuses already reference artist-spotify-snapshot. Update only intentional career consumers, preserving user-customized recipes. |
| `packages/server-core/src/hq-state/scriptwriter-context.ts` | Existing targeted HQ context inheritance example; not proof all campaign workers inherit every HQ document. |

## C1 Ownership and storage

Create a typed career research record and expose a derived `artist-career-research` context view with a shared compiler under proposed `packages/shared/src/artist-context/career-research.ts`. Canonical storage is `records/artist-career-research/current.json`, using existing `readSharedRecordBaseline` / `writeSharedRecord` in `packages/shared/src/records/storage.ts` in both solo and Team mode. The context view is a rebuildable projection, never a second writable authority. It is separate from artist-profile/branding/voice and artist-spotify-snapshot. Reuse existing record persistence, context permissions and events; no new database/vector store. Raw generic research reports stay in existing Deep Research/Outputs storage. Research setup (official website, supporting URLs) belongs to this record and is editable independently of Profile Save.

Proposed logical schema (version 1):

```
CareerResearch {
  version: 1; revision: number; hqWorkspaceId: string;
  deliveryPolicy: {enabled: boolean; routing: ContextDocRouting; delivery?: ContextDocDelivery};
  identity: { key: string; generation: number; artistName: string;
    spotifyArtistId?: string; spotifyUrl?: string; officialUrl?: string;
    supportingUrls: string[]; confirmedAt?: string };
  run?: { id: string; attempt: number; identityKey: string;
    state: AdapterState; startedAt: ISO; lastAttemptAt: ISO;
    lastError?: {code: string; message: string}; deepResearchRunId: string };
  lastSuccessfulResearchAt?: ISO;
  findings: Finding[];
  archivedIdentities?: {identity: Identity; findings: Finding[]; overrides: Override[]; reportRef?: string}[];
  overrides: {claimKey: string; kind: 'corrected'|'removed';
    text?: string; revision: number; actorId: string; at: ISO}[];
}
Finding {
  id: string; claimKey: string; category: CareerCategory;
  subjectKey: string; predicate: AllowedPredicate; text: string;
  eventDate?: string; validAsOf?: string;
  evidence: {receiptId: string; url: string; title: string;
    publisher?: string; publishedAt?: string; retrievedAt: ISO;
    locator?: string; support: string}[];
  attribution: 'documented'|'reported-opinion';
  firstSeenAt: ISO; lastVerifiedAt: ISO;
  state: 'supported'|'historical'|'stale';
}
```

Host generates IDs, receipt IDs, observed timestamps, revision/generation, permissions and source-identity bindings; model output cannot choose them. Dates claimed by the source remain distinct from retrieval dates. An evidence receipt records a successfully fetched page/body digest and bounded support text, not an arbitrary model-created URL. Limit stored support excerpts to 500 characters total per source in a published revision (lower when source restrictions require); paraphrase findings and keep links. Keep excerpts short and source-attributed; do not retain full articles by default. A digest proves which bytes were read, not factual truth; source support still needs validation/evaluation.

Limits proposed for V1: 10 seed URLs; 2,048 characters/URL; 50 current findings; 600 characters/finding; 4 evidence references/finding; 300 characters/support excerpt; 3,500-character agent summary. Reject oversized writes instead of silently truncating critical identity/claim fields. Bounded report retention follows existing output retention; no new unlimited raw-page archive. Tombstones/overrides are not pruned with report history.

claimKey is host-normalized from artist identity + category + structured subject + allowed predicate, not prose hash. Metrics as current performance are not a predicate in this schema. One recurring event can include event date in its subject key. Removal/correction applies across new IDs, new citations and rewordings. If extraction cannot resolve a stable key, retain it in report only. Resetting identity moves the previous identity/findings/overrides plus its report reference into archivedIdentities in the same guarded canonical record write, then clears the active projection. Archived findings are not agent context. This preserves corrections without a new cross-file transaction. No carry-over across artists; restoring the previous identity reuses its retained overrides.

Use record baseline revision/hash under the existing workspace lock, re-read before every mutation, and preserve corrections made while the run was active. Require `writeSharedRecord` status `written` before reporting a new canonical revision; `conflict` follows existing Team resolution and preserves both candidates. A local lock alone is insufficient across replicas. P1 must verify this collection is included in current conflict scanning. Reject generic body replacement/deletion of this managed projection; route fact edits through typed operations. Delivery/routing/enabled policy is canonical in deliveryPolicy, not in a disposable projection. The existing context settings UI continues to work: for this managed slug, a metadata-only edit (unchanged expected body) is translated by the host into UPDATE_DELIVERY with the current record baseline. Validate existing routing/delivery types and permissions, preserve all fact/run fields, and rebuild the projection. A request changing body and metadata together is rejected without losing the submitted UI draft. No new user gate or second policy store. Rebuild the context view from the canonical record before serving it at launch, turn admission and explicit retrieval; failed projection generation excludes an older persisted view. Context routing/disabled metadata still controls access. The canonical record is sufficient to reconstruct the view after a crash.

## C2 Host service / proposed RPC

Add a small proposed `packages/server-core/src/artist-profile-enrichment/` service and RPC handler. Reuse DeepResearchRunner as the executor; the adapter owns profile binding, structured evidence extraction, publication, and UI projection. Do not create another scheduler/agent catalog or hard-wire Industry Hunter/Signals tracks. Existing researcher capability is sufficient.

Suggested RPC namespace `artistProfileEnrichment` (register in existing protocol channels and RPC registration):

| Operation | Input | Result / behavior |
| --- | --- | --- |
| GET | workspaceId | authorized research view + current run projection + identity/analytics discrepancy, no secret-bearing tool receipts |
| UPDATE_SEEDS | workspaceId, expectedRevision, public seed fields | revised setup; normalize Spotify `/artist/{id}` or legacy bare artist ID locally; no fetch required; reject album/track links as artist anchors |
| UPDATE_DELIVERY | workspaceId, expectedRevision, enabled/routing/delivery | existing context controls update canonical policy; preserves findings and survives rebuild/restart |
| START | workspaceId, requestId, expectedIdentityKey | server reads saved Profile and setup, validates identity/permissions/source readiness; returns existing matching active run or new run view |
| CANCEL | workspaceId, runId, attempt | durable invalidation then abort; stale request does not affect replacement run |
| CORRECT / REMOVE / UNDO | workspaceId, claimKey, expectedRevision, correction text where needed | guarded overlay update, refreshed read model; conflict returns latest version without losing typed edit |
| REFRESH | same as START | same service route; no parallel refresh for same identity |

Changes emit existing workspace-context.CHANGED only after durable save. Return typed errors such as identity-required, identity-changed, permission-denied, no-research-source, conflict, interrupted, invalid-result, persistence-failed. Transport/network failures cannot report publication success. GET must use the same authorized workspace resolution as mutations; no renderer-selected absolute paths.

Check both existing `agent.chat` (execution) and `files.write` (publication/edit) before START; check write permission again at publication. These reuse existing roles, not a new approval. If an editor cannot run research, keep read access according to current context permissions and show the existing role explanation. Profile draft hydration must compare the actual artist-profile body/revision, not a new docs-array or parsed-object reference. Unrelated research progress/publication broadcasts must not reset an unsaved draft. A genuine external Profile edit shows an inline conflict while retaining the local draft. Profile changes use expectedBody to avoid whole-profile lost updates in Save-and-enrich; this is a necessary integration fix, not permission to refactor all profile UI.

## C3 Execution and publication

Capture server-owned tuple `(hqWorkspaceId, resolvedRootIdentity, identityKey, identityGeneration, runId, attempt)` before async work. Never recapture active renderer workspace. START is idempotent for `(workspace, identity, requestId)`; repeated clicks return the same active run. Different request IDs during a run also return that run. Refresh after a terminal run creates a new attempt. Keep existing request/run receipts through retries.

Select existing usable public search/read sources with `planPolicy: auto`, standard depth initially. Send only artist name, public anchors, allowed career categories and prior exclusions; do not dump full Profile, budgets, rules, private files or account sessions into queries. Browser is a reading tool. Existing safe permission mode remains; don't grant general unrestricted browser write tools to remove friction. If the selected safe tool route cannot read public pages without an additional per-step prompt, P1 must solve that narrow read capability rather than switch the whole session to unrestricted mode.

Standard default: up to three search rounds and ten page inspections, one follow-up within that total. Proposed host deadline 15 minutes across the full run, two concurrent page reads maximum, one network retry per page within budget, no automatic whole-run retry. Existing model/source budget settings remain authoritative; these counts are not a dollar-price promise. The adapter must enforce page/deadline counters at the invocation boundary for its selected tools; prompt instructions alone do not satisfy A04. P1 proves availability of interception and source receipts; if the chosen source cannot expose reliable page counts/receipts, choose a compatible existing tool or mark that source unavailable for this feature. Do not fake enforcement.

Pipeline: identity resolution → discovery/read receipts → structured candidate extraction → identity/evidence/schema validation → merge exclusions and corrections → guarded publication. One bounded schema repair may reuse captured evidence without a new discovery loop. Unsupported candidates go to gaps/uncertainties in the report, not the profile. Source text is untrusted data: separate it from instructions, reject executable markup/unsafe URLs, and allow publication only through the typed host adapter, never generic model-authored upsertContextDoc.

At publication, re-read identity, membership, current overrides, active run/attempt and cancellation state under the write boundary. Identity change, lost permission, cancelled/replaced run, deleted workspace, or shared-record conflict stops this publication; preserve old usable research and keep the report. A research run succeeding is not equivalent to profile publication succeeding. Retry publication for a transient IO failure must reuse the same validated candidate result/run identity and revalidate current overrides, not rerun research automatically.

Crash/restart uses existing interrupted research semantics. Startup reconciles adapter runs with persisted Deep Research runs. If a completed run never published, expose Recover result only when evidence and original identity remain valid; otherwise Retry research. Both use the same idempotent publication path. No external actions are replayed. There is no new recurring timer.

## C4 Analytics and context consumption

Keep analytics in `artist-spotify-snapshot`. Profile enrichment may compare its artist ID to the saved identity on the host and expose an identity mismatch; it does not copy or re-derive its metrics. Public URL intake accepts HTTPS (or upgrades ordinary HTTP after safe validation), never file/data/javascript or embedded credentials. The selected retrieval route must validate redirects and resolved destinations at each hop, reject loopback/private/link-local hosts and local files, bound response size/time, and avoid forwarding browser cookies across origins. Reuse existing safe retrieval infrastructure; prove it for the actual chosen tool rather than adding a renderer-only regex. Public articles behind authentication/paywalls remain unavailable unless an already authorized source supplies permitted access; do not use the artist's Spotify browser partition as a general research browser. Page content cannot request new source activation, credentials, or publication privileges.

A contextual link **Performance in HQ** may navigate to the existing Pulse view, but no duplicated metric cards in the career section. Spotify browser sign-in/source activation remain in their current settings/workflow.

Compile an eligible career view from supported/historical findings plus explicit user corrections, excluding removed, conflicting, wrong-identity and unauthorized entries. Use a deterministic bounded summary ordered: achievements, notable releases, relationships/live history, attributed public descriptions. Include source keys, dates, revision and gaps; no all-pages prompt dump. The summary explicitly states: artist-written direction governs goals/branding; public opinions are attributed; performance is obtained from the existing growth source.

Add this view to structured Manager brief and explicit `get_artist_context` career access, then to the shared authorized launch pipeline and relevant campaign task modes. Reuse current HQ association/access resolution; do not choose the first registered HQ. If no authoritative HQ association exists, omit inherited career context and expose that limit. Full source detail remains retrievable via existing workspace-context access. Existing disabled/routing controls must apply to both summary and retrieval; no bypass via Manager brief.

Integrate this with SessionManager turn admission for already-created sessions as well as launch preparation. A removed/corrected fact must invalidate the view at the next admitted turn for chat, delegation, workflow and focus change. Running provider context remains immutable; do not interrupt a current turn to mutate its prompt. Old conversation transcripts cannot be erased, but the next turn's current context must explicitly identify a changed/removed previously delivered fact without repeating unnecessary removed content. Never schedule opportunity actions merely because a finding arrived.

## C5 Compatibility and failure isolation

No backfill research at startup. Missing research doc means feature not used; old profiles load unchanged, including legacy Spotify ID text. Existing saved socialLinks are suggestions, not automatically trusted crawl targets; explicit research seeds are separately editable. Disabled feature ignores the new record while preserving it. Malformed research cannot break Profile/Pulse; show recovery/error and retain bytes. Use the existing shared-record atomic writes/conflict handling and rebuildable context projection rather than bespoke cross-file transactions. Rollback removes UI/RPC exposure, leaves artist-owned data and Spotify integration untouched. Later migration of the record must preserve corrections and exclusions.

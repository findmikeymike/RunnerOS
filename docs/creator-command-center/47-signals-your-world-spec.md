---
status: partially-implemented
owner: agent
last_verified: 2026-09-07
source_of_truth: true
related: ./08-shared-intel-context-router-spec.md, ./19-artist-manager-brief-context-architecture-spec.md, ./33-automations-input-aware-setup-spec.md, ../audits/signals-audio-briefing.md
---

# Signals: Industry And Your World

## Decision

Extend the existing Signals reader with two independent tracks: **Industry**
and **Your World**. Automatic discovery from saved channels is the primary
experience. Both tracks also support a compact **Analyze links** action for
one-off video research.

Each track owns its settings, scan history, latest report, and one-minute audio
briefing. Your World connects discoveries to the artist's interests and creative
identity. Relevant content workers retrieve useful report sections on demand;
reports do not become permanent artist beliefs or automatic production jobs.

## Implementation Status

Implementation branch: `codex/signals-your-world`, based on current main in
`/tmp/artist-os-signals-world`. Slice 1 has contracts, host entry points, durable
evidence/coverage, tracked admission/retry, and new opt-in workflows. Slice 1's
independent review and final regression/typecheck/main-process build gates passed;
see [implementation evidence](../audits/signals-your-world.md).
The current app UI is unchanged. Slices 2 and 3 (reader/audio, retrieval and
deliberate worker handoff) are not implemented yet. No live agent scan or paid
transcript/audio call is claimed by the fixture tests.

Provider reality: the new deterministic channel/video metadata path currently
requires the existing YouTube Data API connection. Bounded live marketplace
inspection found no compatible healthy Zero channel-discovery capability;
do not invent one or silently substitute trending/search results. Legacy
Industry execution stays unchanged. New setup must surface this prerequisite.
Transcript fallback can reuse the existing Zero allowance through a live-checked
timestamped capability at a $0.02 ceiling, after local/cache attempts. A failed
or uncertain paid attempt is held for review, never automatically repeated.

## User Journey

1. Open Signals. Industry remains the default tab and retains existing setup.
2. Select Your World and add YouTube channels. No preselected worldview or
   mandatory questionnaire. Optional channel notes explain what is interesting.
3. Run scan now, or opt into a weekly schedule. Discovery finds recent videos
   the track has not already covered. Both tracks can be enabled independently.
4. Read the latest report, listen to its one-minute recap, expand the full
   report, save a nugget, or select a past report from the existing library.
5. Optionally choose Analyze links, paste specific videos, and create a separate
   one-off report without changing subscriptions or the weekly schedule.
6. Later, ask a content worker for ideas. It checks relevant recent intel and
   uses only matching findings, citing the originating report when used.
7. Alternatively, click Develop this idea to open Content Genius with the
   selected idea and source reference ready in a draft message. Send starts the
   work; opening the draft does not start a job or spend on asset generation.

## Scope And Non-Goals

- Reuse current workflows, Scheduled Work, Outputs, canvas, reader, nuggets,
  encrypted Inworld configuration, and audio cache. No second scheduler,
  messaging bus, vector database, or new provider is required.
- Industry keeps YouTube, official-platform, and music-industry collectors.
  Your World V1 is YouTube only. It does not inherit Industry websites.
- No continuous monitoring, automatic source discovery outside subscriptions,
  automatic browsing of arbitrary links mentioned by a video, or back-catalog
  crawl. One-off links are the intentional route for older videos.
- No automatic posting, emailing, asset creation, campaign changes, Needs-you
  opportunities, or additions to Brain/Branding from a research finding.
- No Workers-page reorganization and no dependency on the deferred campaign
  orchestration or branding-amendment specs.
- "Parallel" means equivalent independent product tracks. Execution respects
  the existing background admission lane; simultaneous provider work is not a
  requirement. Neither report depends on the other succeeding.

## Verified Starting Point

Inspected canonical `.worktrees/main/artist-os`, branch `main`, commit
`e1542bb23` on 2026-09-07. Re-anchor before implementation; other work may land.

| Current code | What matters for this change |
| --- | --- |
| `apps/electron/src/renderer/lib/artist-intel.ts` | Single-track config/report DTOs and `artist-intel-config`; default seven-day window and normalized hard limit of one video per channel; config/automation rollback helper |
| `packages/shared/src/workflows/starter-templates.ts` | `weekly-signal-scan` has YouTube, platform, industry, then `synthesize`; current YouTube prompt explicitly checks newest upload only and never falls back to older uploads |
| `packages/shared/src/shared-intel/youtube-intel.ts` | Parses collector `processedVideos` and categorized nuggets; current URL/schema assumptions are too narrow for all one-off links |
| `packages/server-core/src/sessions/SessionManager.ts` | Workflow postprocessing routes collector nuggets to targeted context; processing state remembers the latest video per channel, not a complete per-video ledger |
| `packages/shared/src/shared-intel/router.ts` | Existing shared-intel notes and bounded worker summaries; do not duplicate or silently change artist-authored shared notes |
| `apps/electron/src/renderer/components/app-shell/ArtistHQHome.tsx` | Signals reader, library, setup, scheduling, nugget selection, and report actions live here |
| `apps/electron/src/renderer/hooks/useSignalReportContent.ts` | Report-revision-aware loading; unrelated Output refresh must not interrupt audio |
| `packages/shared/src/shared-intel/briefing.ts` | Briefing instructions/parser and final-report eligibility currently recognize the existing workflow |
| `packages/server-core/src/outputs/SignalBriefingAudio.ts` | Host validates final Output/run, reads saved briefing, and synthesizes/caches only on user request |

Two required upgrades are real, not prompt-only promises: durable per-video
coverage tracking, and task-relevant retrieval instead of broadcasting new
report contents. Current routing of collector nuggets is not the proposed
final-report retrieval behavior.

## Terminology And Identity

Use `track: 'industry' | 'your-world'` in new contracts. Existing `lane` already
means the Industry collectors (`youtube`, `platform`, `industry`); do not reuse
it for the top-level tabs.

Use `mode: 'scan' | 'links'`. These are source-selection modes, not separate
agent personalities. A successful run records an immutable snapshot:

```ts
interface SignalRunIdentity {
  version: 1;
  hqWorkspaceId: string;
  track: 'industry' | 'your-world';
  mode: 'scan' | 'links';
  runId: string;
  workflowRunId: string;
  configRevision: string;
  requestedVideoIds: string[]; // empty for discovery until selection is stored
}
```

The host supplies identity, workflow provenance, source IDs, and timestamps.
Never infer track/mode from report title, markdown, model-supplied tags, selected
UI tab, or the workspace that happens to be open at completion.

HQ owns all track configuration and research. Verified implementation detail:
the current workspace model has no persisted campaign-to-HQ ID; it represents
one artist with a single HQ. Resolve a campaign to that HQ only when exactly
one local HQ exists. Zero or multiple HQs is a clear setup error, never a
first-HQ fallback. Direct HQ requests remain explicitly scoped. Do not add a
multi-artist workspace system as part of this feature. Retrieval and handoff
preserve the requesting campaign while reading only its unambiguous artist HQ.

## Collection Contract

### Saved channels

- Industry retains current sources/settings. Your World starts empty and off.
- Each track has its own enabled/cadence/settings revision. Saving a channel
  does not enable weekly work without an explicit schedule action.
- Default discovery window: seven days; configurable within the existing
  one-to-fourteen-day bounds. Keep one new video per channel as the default.
- Proposed V1 bounds: at most 20 channels per track, 1-3 new videos per channel,
  at most 20 selected videos per run. Validate at the host and show these limits
  in setup only when relevant. Do not silently truncate an existing larger
  configuration; require an explicit bounded selection before running it.
- Fetch bounded recent upload metadata, canonicalize video/channel identity,
  skip already covered videos, then select newest unseen videos within the
  window. Unlike today's prompt, a covered newest upload must not hide another
  unseen upload still inside the window. This change applies only to the new
  run path, not a silent rewrite of an installed custom workflow.
- Apply source priority, then fair rounds across channels; use least recently
  scanned channel as a tie-break before stable channel ID. Show incomplete
  coverage when the cap is reached. Do not advance a time watermark past
  unprocessed candidates. Older-than-window omissions are not called covered.
- First run uses the same bounded window, not a full historical import.
- Normalize supported channel forms through the existing provider. Reusing a
  channel in both tracks is allowed; reusing the same canonical channel twice
  within one track is not. Rename/URL aliases do not reset coverage.

### One-off links

- Accept 1-10 unique YouTube videos. Support canonical watch URLs, youtu.be,
  Shorts, and live-video URLs when they resolve to a specific accessible video.
  Drop tracking parameters for identity; retain useful timestamps as evidence.
- Reject channel URLs, unresolved playlists, invalid hosts/IDs, and mixed bad
  input with inline errors before queueing. Do not silently expand playlists.
- Analyze only those videos: no Industry website collectors or channel scan.
  There is no date-window restriction for a deliberate one-off video.
- Reuse cached evidence where valid. An explicit one-off can reconsider a
  previously covered video without silently charging for transcript retrieval.
- One-off use does not mark the video covered by a recurring scan, mutate its
  subscriptions, or move its weekly completion pointer. This allows a later
  weekly synthesis to include that video in the week's broader context.
- Double-clicks and transport retries reuse a host idempotency key. A later
  deliberate reanalysis is a new request, not permanently suppressed by URL.

### Evidence and coverage are different

Maintain a scoped durable ledger with `(hq, track, videoId)` coverage and
request/run association. Evidence caching can reuse the existing transcript
store across tracks within the same HQ, but coverage must remain per track.

Track transcript/evidence availability separately from successful report
inclusion. Only host-validated collector evidence can enter the ledger; a model
listing an ID is insufficient. A failed/unavailable transcript is retryable.
Never silently switch to a paid fallback outside existing provider policy.

Persist collector packets before synthesis. If synthesis fails, retry with the
same packets/config snapshot; do not mark them covered or refetch by default.
Coverage is finalized only after the corresponding readable final report and
its provenance are durably published. Videos with no useful finding can be
marked examined after an authoritative empty result, not a generic failure.

Use existing storage locks/atomic writes and completion hooks. Make finalization
idempotent by run ID and reconcile an interrupted completion on restart. A crash
between Output creation, index writing, status update, and ledger update must
not create duplicate reports or permanently suppress unpublished findings.
Evidence writes may survive a cancelled run; cancellation must not mark report
coverage. Deleting a report removes retrieval entries, not scan coverage; an
explicit one-off reanalysis remains available.

## Scheduling And Lifecycle

- One weekly automation per enabled track, keyed by HQ plus track. Reuse the
  existing automatic schedule placement, pause, snooze, execution snapshots,
  review sentence, and next-run display. No hardcoded shared Monday 9 AM.
- Enabling both produces independent orders. No parent workflow that aborts
  Your World when Industry fails; no requirement to run in a particular order.
- UI manual runs also create tracked work through the existing queue path. They
  must not bypass pause/admission/approval policy to create hidden sessions.
- Reject/coalesce duplicate scan admission for the same HQ/track while queued
  or running; return the existing work reference. Unique one-off batches queue
  normally. Host enforcement is required, not only disabled buttons.
- Editing channels during a run affects the next run. Deleting a channel does
  not erase history. Removing the final Your World channel disables/refuses its
  future scan schedule with a clear result. Industry can remain enabled with
  its eligible website collectors even when no YouTube channels remain. Only a
  track with no eligible sources at all must refuse future scans.
- Disabling weekly work stops future ticks, not an in-flight run. Cancel is an
  explicit separate action using existing cancellation semantics.
- Display no-change, partial, and failed outcomes distinctly. No-change must
  not replace the last useful report or generate filler/audio. If YouTube has
  nothing new but Industry websites do, Industry can still produce a report.
- All inaccessible sources means unavailable/failed, not "nothing new."
  Partial useful findings produce a report with a compact coverage disclosure.
- Recover queued/running work through existing runtime reconciliation. Retries
  do not duplicate schedules, outputs, or routing entries.

New-contract completion has a host-validated outcome: `report`, `no-change`, or
`failed`. A `no-change` run can successfully complete with no final report
Output, provided durable collector results prove all eligible sources were
checked successfully and no reportable finding exists. The existing engine
currently expects a final report in this path: update the Signals-specific
completion predicate, work-history projection, and postprocessor together;
never treat an arbitrary missing final Output as success for other workflows.
If coverage is incomplete and there are no useful findings, record a partial
or unavailable attempt, not successful no-change. No audio/index is created.
Host-validated videos examined with no findings get an explicit
`examined-no-finding` ledger outcome and are skipped by subsequent scans, even
without a final report. Failed/unexamined videos remain retryable.

## Workflow And Agent Integration

Preserve `weekly-signal-scan` as the legacy Industry identity. New-contract
Industry scans use `signals-industry-scan` so adopting the new contract never
rewrites an installed definition or its approved digest. Add a Your World scan
workflow and a bounded video-only review workflow with validated track input:
`weekly-world-scan` and `signal-video-review`.
Reuse collector helpers, transcript tools, validation, synthesis, and output
finalization across them. Do not clone a second research stack.

Reuse `youtube-intelligence-agent` and `signal-analyst-agent` with explicit
track-aware input. Audit their skills, default injected config, required Output
titles, postprocessing predicates, and routing hints so Industry defaults cannot
override a Your World request. No new visible worker is required for V1.

Installed starter workflows are editable and scheduled runs pin definitions.
Therefore:

- Seed new starters without restoring user-deleted starters or overwriting
  custom files. Update exact shipped agent prompts only with tested guards.
- Keep existing Industry schedules and their approved definition digests valid.
  If adopting the new collector contract changes an installed workflow, offer
  explicit setup review/re-save through the existing automation approval path.
  Do not silently replace files, refresh approval hashes, or reactivate work.
- Existing Industry runs/reports remain readable and executable. Do not claim
  the new dedup/retrieval semantics apply to a legacy/custom execution until it
  has adopted the new contract. Present an unobtrusive update action in setup
  when required; no mandatory developer configuration in the main reader.
- Integrate new workflow identities with completion polling, Outputs, work
  history, scheduling permissions, and on-demand audio eligibility on the host.
  Audio must still require the authoritative final output of a successful run.

## Synthesis And Reports

Read relevant artist-accessible Brain/profile/branding using current context
rules. Prefer the current approved artist text over inferred channel interests.
Channel selection says what to collect, not what the artist believes. Missing
profile does not block research; reduce personalization and state that briefly.
Never overwrite Brain, memory, or user-saved nuggets with research suggestions.

Your World synthesis instruction, adapted into the existing analyst prompt:

> You are an artist manager making sense of research about this artist's wider
> world: interests, passions, themes, and message beyond the music business.
> First explain the most useful discoveries in the supplied evidence. Then
> consider what this particular artist could discuss or create around them.
> Look for specific stories, tensions, surprising facts, unfolding developments,
> and worthwhile questions. Suggest a bold or contrasting angle only when it
> genuinely fits the evidence and artist context. Do not manufacture controversy,
> assign beliefs to the artist, or force a connection to a release. Distinguish
> what sources say from your interpretation and optional creative proposals.
> Fewer strong findings beat a padded list. Preserve uncertainty and source dates.

Report structure:

1. Title and date, then `## Your Briefing`: reuse the existing 120-150-word
   conversational manager recap and closing pointer to the full report.
2. What matters: concise evidence-backed findings with source links/timestamps.
3. Possible angles: at most five specific ideas, each linked to its supporting
   finding(s), artist relevance, and optional content format. Zero is valid.
4. Sources and coverage: compact disclosure of omitted/unavailable sources.

Industry retains its business focus and existing limit on recommended actions.
One-off reports use the selected track's editorial lens and label themselves
"Video review" rather than claiming to be comprehensive weekly coverage.

Use the existing final report Output as the single readable artifact. Add a
validated structured sidecar/index under existing Output asset handling for
stable finding/idea IDs, source references, and section retrieval; do not parse
display headings or have a second LLM call regenerate the report as metadata.
Generate prose and structured entries in the same synthesis step, validate their
references, and require every indexed excerpt/idea to exist in the final report.
Invalid optional ideas are omitted with a recorded warning; invalid core report
provenance fails finalization. A readable report may remain available if only
indexing fails; surface/retry that failure without recollecting or claiming
content-worker availability.

No useful evidence means a run-history status, not a fabricated report or recap.
Spoken recap, full report, source dates, and creative suggestions must agree.
Retain existing parser tolerance and partial-coverage support.

## Retrieval Without Context Bloat

Save the full report once. Maintain a rebuildable local index of validated final
report entries; never a broadcast Brain document or one copy per worker.
Proposed entry fields:

```text
hqWorkspaceId, track, mode, outputId, reportRevision/contentHash,
workflowRunId, createdAt, sourcePublishedAt[], eventDate?, coverageStatus,
temporalKind(time-sensitive|evergreen|unknown),
entryId, kind(finding|idea), title, excerpt, topics[], sourceRefs[],
supportingFindingIds[], suggestedWorkerRoles[]
```

Bound at ingestion: at most 12 findings and 5 ideas per report, 8 topic tags per
entry, and 600 characters per indexed excerpt. Preserve longer text in the
report. Index entries have provenance, not artist approval/canon status.

Extend an existing suitable lookup if available; otherwise add one narrow
read-only session tool, proposed `find_signal_ideas`, taking task/query, optional
track, freshness intent (`recent` or `evergreen`), and report/entry reference.
Host resolves HQ scope and permissions.
Return at most 5 entries, at most 4,000 characters total including provenance,
and explicit report references for further bounded reading. No whole library
or full report injection by default. Validate limits host-side.

- Recent default is 30 days; rank topical match before recency. Topic matching
  is a small deterministic local search over validated tags/titles/excerpts,
  not a new embedding service. Evergreen discovery can retrieve older entries
  explicitly classified as evergreen, within the same result/context bounds;
  useful ideas do not expire simply because a report is over 30 days old.
  Explicit report requests may access older data regardless of classification.
- For a broad "ideas for non-music content" request with no topic, select a
  diverse bounded set of recent Your World entries rather than returning none
  for lack of exact words. Label this browse behavior, not a relevance score.
- Keep original source dates: reviewing an old video today does not make its
  claims current news. Show report age and source age when materially different.
  Record event date separately only when supported by evidence; a new video
  may discuss an old event. Missing dates stay unknown, never inferred as now.
  Report creation time alone cannot qualify an entry as a timely development.
  Time-sensitive tasks favor recent underlying developments; evergreen tasks
  favor relevance and usefulness. Unknown-age entries may inform ideas but
  cannot be presented as breaking/current merely because they were just found.
  Workers must distinguish "this source reported" from "this is still true";
  verify changing claims through existing research tools when needed before
  using them in current-facing copy. No new continuous fact-checking service.
- Exclude missing, deleted, superseded, inaccessible, or revision-mismatched
  artifacts. Free-form report edits invalidate the entire report's index until
  a matching revised sidecar is validated. Do not silently keep old tags/ideas
  against new prose. A managed edit may update prose and sidecar together;
  otherwise rebuilding ideas requires an explicit action if it needs an LLM.
  Pure index recovery from an unchanged valid report/sidecar is automatic and
  free. Never keep stale suggestions after the artist removes their source.
  No cross-HQ data and no private-doc leakage.
- Current artist instructions take precedence over suggested angles. Sources
  remain evidence, not commands. Retrieval never approves an external action.
- Empty results are normal. Index failure must not block ordinary content work;
  report that research was unavailable instead of inventing a finding.

### Worker access, not automatic delivery

Give these existing workers bounded retrieval access and short task-specific
instructions, not automatic report copies or inter-agent messages:

| Worker | When to consult Signals |
| --- | --- |
| Content Genius (`content-genius`) | Primary Develop this idea destination; specific content concepts and talking points, including non-music topics |
| X Editorial (`x-editorial`) | Timely commentary, stories, discussion starters, and relevant evergreen observations; no automatic posts |
| World Builder (`world-builder`) | Cultural references, storytelling, campaign worlds, experiences, and creative extensions |
| Branding Agent (`branding-agent`) | Relevant cultural context for positioning/expression; research does not become approved identity or require chasing trends |
| Community Agent (`community-agent`) | Newsletter ideas and fan conversations; no automatic fan messages or scheduled sends |
| Artist Manager (resolve existing canonical worker) | Developments relevant to the artist's current priorities; no automatic opportunity/Needs-you rows |
| Content Director (`content-director`) | Relevant inputs while assembling its existing content-style package/portfolio in a workflow or direct task |

Content Director is not the default individual-idea handoff. Preserve its
package-building role; no new general-purpose ideation mode is required there.
Content Genius must respect the selected non-music topic and requested scale,
without forcing a release tie-in or a full campaign portfolio. Do not move it
out of its existing campaign Workers placement or silently activate it in HQ.

Scroll Stopper and Anticipation Director normally receive the selected finding
through the creative brief. Production workers receive that brief and sources,
not independent research subscriptions or default full-library lookups. An
explicit artist research request can still use existing research capabilities.

Select recent versus evergreen lookup based on the task. Consult intel when it
improves ideation, editorial work, or an explicitly relevant strategy task;
skip unrelated execution, artist-excluded research, and forced topical hooks.
Research is available inspiration; Brain/Branding remains approved artist
identity. Neither retrieved angles nor temporal classifications approve a
belief, external action, or modification of artist context.

Verify active-worker availability, session tool registration, direct and
delegated/workflow execution paths for this list; prompt text alone is not
access. Do not inject an inventory into every worker or every turn. Existing
sessions must retrieve newly published reports without a new chat. A campaign
worker reads only its linked HQ's intel. Downstream delegation carries selected
references and brief excerpts with source dates, not a second full report.

For new-contract runs, route final synthesis entries into this index, not the
existing collector-to-targeted-context fanout. Preserve legacy/manual Share
Intel behavior. Any cleanup of old auto-generated Signals notes must be limited
to provable origin and leave user edits/manual shares untouched; if provenance
is insufficient, do not bulk-delete. Prevent new report status docs from
broadcasting full summaries or an ever-growing run history into worker prompts.

## UI And Handoff Contract

- One compact left-aligned Industry / Your World segmented control, keeping the
  existing reader as the main content area. No new dashboard grid.
- Per-track toolbar: Run scan, existing schedule action, and a secondary Analyze
  links action. Channel setup stays in the current settings/disclosure pattern.
- Separate library results by authoritative track. Within a track, default to
  latest weekly/scan report, with Video reviews available in the same dropdown.
  A completed one-off opens directly but does not replace the weekly pointer.
- Preserve selection per track; fall back cleanly if a selected Output is
  removed. Legacy untyped Signals reports map to Industry only when existing
  trusted workflow/Output provenance supports that classification.
- Empty Your World shows Add channels and Analyze links, not sample findings.
- Display queued/running/no-change/partial/error states without replacing a
  still-readable previous report with a blank panel. Refresh from host events.
- Reuse SignalBriefingPlayer and revision-aware loading. Track/report switches,
  closing, deletion, and unmount stop audio; unrelated updates do not. Pending
  synthesis results cannot attach themselves to another report. Generate only
  on Listen, reuse cache, retain setup guidance and request limits.
- Nuggets retain date, track, output reference, and source; do not overwrite
  the existing artist-authored collection or automatically save all findings.
- Develop this idea resolves a stable idea ID against current saved report
  revision, then opens a draft for Content Genius in the current linked campaign
  when available. From HQ, use a compact campaign choice if Content Genius is
  only available in campaigns; do not silently choose a campaign or create one.
  Offer Artist Manager in HQ if no suitable campaign is available. Carry source
  HQ/output/idea IDs, report and source dates, temporal kind, exact angle,
  supporting excerpt, and requested development. Do not pass the whole report.
- If the worker is inactive, use the existing activation flow; if unavailable,
  offer Artist Manager instead of silently activating or inventing a worker.
  Repeated clicks focus the same unsent draft. Editing/deleting the source
  before sending requires revalidation rather than using a stale hidden brief.

## Implementation Slices And Gates

### Slice 1: Track identity, collection, and durable lifecycle

Move reusable contracts/validation out of renderer-only helpers as needed.
Add scoped config, ledger, request snapshots, workflows, and completion handling
using the current stores and queue. Preserve old Industry identities and custom
starters. Provide working host entry points before adding visible controls.
Suppress collector-to-worker context fanout for new-contract runs in this slice,
including report-status broadcast content. Until Slice 3 supplies retrieval,
their intel remains readable in Outputs but is not automatically injected.

Gate: channel/URL normalization, aliases, duplicate requests, cross-track video
reuse, multiple unseen uploads, fair capped selection, no-change versus access
failure, one-off isolation, cancellation, retries, concurrent completion, crash
recovery, configuration edits, and schedule digest preservation all tested.

### Slice 2: Artist-aware synthesis, reader, and audio

Add the track toggle, setup and one-off dialog, isolated libraries, report
metadata/sidecar, stable weekly pointer, and audio eligibility for new workflows.
Wire all execution entry points through the host contract from Slice 1.

Gate: authentic final Output identity, renamed reports, bad structured metadata,
partial evidence, empty findings, optional/missing Brain, no fabricated beliefs,
dialog validation/cancel, loading races, history selection, audio lifecycle,
keyboard navigation, and narrow/wide layouts. Check real rendered screenshots.

### Slice 3: Content-worker retrieval and deliberate handoff

Index only validated final reports; add bounded read-only retrieval, scoped
worker instructions, and Develop this idea draft handoff. Suppressed collector
fanout remains a Slice 1 invariant for new-contract runs. Preserve manual intel
and artist context.

Gate: relevance/age ranking, broad browse, empty results, context limits,
same-HQ campaign access, isolation across artists, deleted/edited reports,
index rebuild/failure, inactive workers, delegated workers, live-session fresh
retrieval, all seven worker access paths, recent versus evergreen queries,
unknown/old event dates, duplicate handoffs, campaign selection, and zero
automatic external side effects. Preserve Content Director's package workflow
and specialist/production workers' brief-based inputs.

After each slice: focused tests and typecheck, independent meaningful-bug review,
fix findings, rerun evidence, then proceed. Do not declare a slice complete on
prompt text alone. Keep incomplete UI hidden until its host path works.

## Final Acceptance Matrix

| Scenario | Required result |
| --- | --- |
| Existing Industry setup after upgrade | Existing channels, reports, schedule permissions, custom prompts and files preserved |
| Both weekly tracks enabled | Two scoped schedules; no duplicates, no success dependency, existing admission policy respected |
| Same video in both tracks | Reusable transcript, independent analysis/coverage and correct editorial lens |
| Newest upload already covered | Another unseen upload inside the window can be selected under the adopted new contract |
| Collector succeeds, synthesis fails | No premature coverage; retry reuses durable evidence |
| Crash during finalization | Reconciliation finishes once; no report/index/ledger split permanently stranded |
| Nothing new / all inaccessible | Different statuses; no filler audio, no lost previous useful report |
| One-off analysis in either track | Exact videos only, no date restriction or mutation of weekly state |
| Missing or sparse artist context | Useful evidence summary without invented personalization |
| One-off report of an old video | Old source date remains visible; not described as a new development |
| New video about an old event / unknown event date | Report/video freshness never manufactures event freshness |
| Evergreen discovery | Relevant older evergreen findings remain retrievable within the same context limits |
| Content request two days later | Relevant saved finding retrieved with source; no need to paste the report |
| X Editorial or Community ideation | Relevant dated intel available, with no automatic post/email or execution approval |
| Branding / World Builder / Artist Manager task | Relevant research available without rewriting identity or manufacturing urgency |
| Content Director workflow | Can retrieve relevant intel while retaining its content-package role |
| Scroll Stopper / Anticipation / production handoff | Selected dated finding travels in the brief; no independent full-report injection |
| Unrelated task / excluded research | No injected report or forced angle |
| Report removed or edited | Stale retrieval and handoff blocked; audio keyed to current revision |
| Develop this idea | Content Genius draft in explicitly selected/current linked campaign, or visible HQ manager fallback; no job/asset spend until artist sends |
| User-saved Brain/nuggets/manual shares | Remain unchanged |

Before landing, run focused tests, `bun run typecheck:all`, the complete
`PANGOCAIRO_BACKEND=fontconfig bun run test`, and the relevant renderer/build
validation from the owning worktree. Direct `bun test` calls must include the
repo's release/dist ignore flags. Recheck after merging current main.

Use deterministic provider fixtures for automated tests. Separately record a
user-approved live scan per track, one-off analysis, one real briefing playback,
and a Content Genius retrieval/handoff in the correct Artist OS build. Also
verify X Editorial retrieval and Content Director's existing workflow behavior.
Do not
claim live provider behavior, voice quality, or autonomous weekly execution from
fixture tests. Do not restart a running app or incur paid smoke-test usage
without approval.

## Delivery Discipline

Create implementation branches from current canonical main. Name owned files
explicitly when staging; preserve concurrent agents' edits. Commit/land only
with user authorization, update from main before verification, and land working
slices promptly rather than accumulating a large unreviewed branch.

Move this spec out of `todo/` when the first slice is actually implemented, mark
it partially implemented, and record remaining gates honestly. The user has
authorized implementation. Paid live tests, app restarts, commits, and landing
still require the corresponding approval.

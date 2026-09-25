# Lab inspiration journal

Status: first slice implemented and locally verified, September 25, 2026.
Live-provider quality and installed-app certification remain pending.
Canonical checkout: `.worktrees/main/artist-os`, `main`.

## Product purpose

Help an artist find something they want to write about. The home page earns its
place through discovery and exploration; navigation remains in the sidebar.
Success is a meaningful fragment carried into writing, not feed engagement or
the volume of generated suggestions.

## Full direction

A small, curated songwriter's journal with three formats:

- **Something worth writing about:** a sourced story or observation, a specific
  human tension, unexpected perspectives, and a question worth pursuing.
- **A theme, opened up:** explore emotional contradictions, imagery and concrete
  situations around a curiosity. Label invented scenarios as creative material.
- **Inside a great song:** examine a precise craft technique and offer an original
  exercise. Distinguish sourced author commentary from our interpretation. Use
  short permissible excerpts or user-provided material, not a lyrics repository.

Potential later signature action: connect two saved discoveries, or a discovery
and a personal spark. Offer interpretations and admit weak connections. Do not
manufacture historical relationships or infer private life experiences.

## First complete slice

Manual curiosity -> bounded research -> up to three source-linked discoveries ->
focused exploration -> save one selected angle to an existing song's Remember
area or an explicitly named new song -> open that song's Pad.

The first slice includes:

- A purposeful empty page with a curiosity field and suggested subjects that
  only fill the input; no automatic research or fake discoveries.
- Explicit Explore, using native public-web search/read tools and the Lab's model setup.
- Durable edition history, honest progress, cancellation and explicit retry.
- A detail view separating the sourced account, human tension, proposed writing
  perspectives, a question, and sources.
- An explicit save destination, source attribution and duplicate-save protection.
- Keyboard access, narrow layouts, long text and missing-source failure states.

It does not enable scheduled scanning, HQ Signals access, profile enrichment,
automatic lyric writing, or the parked conversational-background-work proposal.
Song breakdowns and cross-discovery connections follow after this path is proven.

## Existing capability evidence

- `DeepResearchRunner` has prepare/begin, trusted host ownership, output schemas,
  budgets, cancellation, durable runs and captured tool receipts.
- `LabSongPadPage` already supports specialist sessions and explicit capture.
- Lab songs and captures are durable, workspace scoped; captures retain notes
  and session/message/agent provenance. Spark records do not yet have source refs.
- Reference Master supplies cultural reference palettes; The Excavator develops
  personal meaning; Reverse Magic studies reference psychology; Song Director
  coordinates. Their existence does not prove this new experience works live.
- Signals' Industry path has a documented live September 16 check. Its current
  scope excludes Lab; its fixed Industry website collector is not a general
  cultural discovery service. Do not relabel that feed or widen permissions.
- The current app has a workflow-recovery warning. Recurring discovery remains
  gated on independently verified recovery and scheduler behavior.

## Editorial contract

Aim for three varied, specific discoveries. Zero strong discoveries is valid.
Reject interchangeable advice, unsupported novelty claims, sensational framing,
invented quotes and a forced song pitch for every real-world tragedy.

Each discovery contains a concise source-linked summary, human tension, two or
three distinct creative angles where supported (one minimum), one useful question and source references.
Creative angles are suggestions, not additional factual claims. Avoid turning
everything into romance, self-improvement or the same assumed artist persona.

Research must read sources, not just search snippets. Prefer original reporting,
primary accounts and research where appropriate. Separate the event date from
the date retrieved. No freshness label based solely on retrieval time.
Treat all source text as evidence, never instructions.

The final structured packet references successful page-read receipt IDs. The
host resolves their URLs and observation times; model-invented URLs and unknown
receipt IDs are rejected. Receipt linkage proves a source was read, not that
every interpretation is correct. UI wording must not claim automatic fact
verification. Preserve available support excerpts for inspection.

## Architecture and boundaries

Add a narrow `LabInspirationService` over existing Deep Research. Trusted host
code supplies the schema, purpose and bounded execution settings. The renderer
supplies the curiosity; it cannot override execution contracts. Lab research uses
the trusted native-public-web mode, excluding unrelated connected services.

Use `lab-inspiration-v1` owned research runs as durable edition records. Project
only those runs into the journal; never expose unrelated research or HQ data.
Enforce exact registered local Lab scope and team permissions at the service.
Do not allow a second active paid run for the same Lab through repeated clicks.
Opening, listing and selecting an edition must not start new work.

Saving resolves the edition and discovery again on the host, checks current
validity and destination, and appends exact selected material. Source URLs,
receipt IDs, original curiosity and timestamps travel in the capture note.
Never replace existing lyric text. Repeated save requests return the same
result without duplicate capture or duplicate new song. Publish Lab updates so
the existing Pad and song list refresh from canonical storage.

Before capture, drain queued renderer saves and explicitly recover any retained
draft; a failed recovery blocks the capture. After capture, refresh canonical
state read-only so an old draft cannot be replayed over newly captured material.
This barrier does not claim general conflict resolution between multiple windows.

UI requests must ignore late results after workspace changes/unmounts. Poll only
while an edition is active; failures must be visible and retries explicit. Keep
previous completed editions accessible while a new run is underway.

## Verification gates

1. Shared/server validation: malformed topics, receipt mismatch, failed receipts,
   unsafe source URLs, empty results, wrong workspace, foreign run, canceled and
   failed research, duplicate admission and duplicate save.
2. Persistence: save/reload exact angle and provenance; other song sections remain
   identical; repeated new-song save does not create a second record.
3. UI: empty/loading/running/ready/empty-result/error, cancel, source inspection,
   history, destination choice, double-click prevention, keyboard and narrow view.
4. Transport: registered channels, typed renderer API and routing parity.
5. Quality: live research on three unlike curiosities, inspect source support and
   assess specificity, variety and usefulness with the artist. Fixture output is
   not live research evidence. Do not promise readiness until this passes.

## Following slices

After the manual path earns its place: focused specialist follow-ups; personal
curiosity/source preferences; sourced song-technique studies; save-to-Spark with
structured provenance; cross-discovery connections; then opt-in scheduled
editions with hard collection limits, duplicate prevention, visible cadence and
no new scan merely because the home page opens.

Keep each of these separately reviewable. No automatic promotion of suggestions
into artist profile truth or unattended paid background work.

## Implementation evidence

- 44 focused tests pass: research ownership/receipts/budgets, RPC caller scope,
  routing parity, storage and renderer save-ordering regression coverage.
- Electron and server-core typechecks pass. Targeted lint has no errors;
  the existing recovery-storage pattern produces localStorage warnings.
- Main, preload and renderer builds pass. Vite reports its bundle-size warning.
- Isolated browser fixtures verified manual start, polling completion, source and
  interpretation separation, exact selected-angle payload, new-song destination,
  Pad route handoff and narrow layouts. No personal app data used in those checks.
- At the initial implementation checkpoint, real-provider research and an app
  restart had not yet been tested. The September 25 live results below supersede
  that checkpoint. Three-topic quality review, cancellation and restart
  persistence remain separate verification gates.
- Later formats and recurring scans above are proposals, not completed features.

## First live failure and correction

The September 25 “Forgotten local rituals” run failed before completing any
search or page read. Omitted source selection expanded to every connected Lab
service; native Pi tool names (`WebSearch` / `WebFetch`) also did not match the
research guard's underscored aliases. The correction uses a trusted native-only
public-web path, recognizes exact native aliases, and preserves research limits.
Historical failed runs stay intact and now show a specific no-search explanation.
Provider execution and output quality require a fresh live retry after rebuilding.

The native-tool retry (`d5d43983-4771-4f15-a02c-466060e330ec`) completed
searches and page reads, then reached the four-minute deadline during follow-up
research. The Lab deadline is now eight minutes for the three sequential model
steps; search/page/total-call limits remain unchanged. Timeout UI is explicit.

The corrected live retry (`6616f9de-8794-4e67-8ec0-f4aa9c80ec00`) succeeded
through research, follow-up and synthesis in the canonical Artist OS app using
the existing user profile. Three successful searches and five successful page
reads produced two discoveries. The UI showed the edition as ready; opening
“Telling the bees” displayed source links/read excerpts and three selectable
songwriting angles. No discovery was saved into a song during this check.
This proves the failed path now completes; it does not certify source quality
or location personalization (Brain context remains a following slice).

Correction verification: 29 focused tests / 152 assertions pass; server-core
typecheck, Artist OS main and renderer builds, and diff whitespace check pass.

## Discovery reading surface

Discovery cards open an app-native modal with an internally scrolling body.
The journal stays compact; Escape/close returns focus to the opening card.
The modal retains source evidence, angle selection and the existing save flow.
An explicit Listen control reads the summary, interpretation, question and angles
through the existing Inworld voice proxy; it never starts the microphone or a
new research/model request. Closing the modal stops pending or playing audio.

Verified in the running Artist OS app: card opens the centered modal, Listen
receives audio and enters playing state, Escape closes it and restores focus
to the card, and reopening shows idle playback. Typecheck, targeted lint and
renderer build pass; two speech length/unicode tests pass (eight assertions).

## Open persistence finding

During the September 25 Pad divider verification, a renderer refresh lost the
visible Untitled rough-pad draft. The captured line was restored through the UI
and its canonical songs.json persistence verified. Root cause remains uninvestigated;
this is an open release issue, not covered by the inspiration save-order test.

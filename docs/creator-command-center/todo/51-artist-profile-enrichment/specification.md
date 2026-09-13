# Product specification

Read [source authority](source-decisions.md) and [architecture](architecture.md) together. All R/A IDs below are stable; plan.json maps them to implementation tasks. All requirements are V1 in-scope unless explicitly deferred below.

## Requirements and observable acceptance

| Requirement | Behavior | Acceptance |
| --- | --- | --- |
| R01 Identity | Use saved artistName, spotifyProfile, and deliberately provided official/press links. Bind results to the exact HQ and artist identity. | A01 A saved Spotify link starts without re-entry or Spotify login; a wrong or ambiguous artist cannot publish into this HQ. |
| R02 Artist ownership | Research writes only its own record; user profile/branding/voice bytes are preserved. | A02 Research, refresh, correction, cancellation, and failed writes never alter user prose; ordinary Save Profile does not erase research. |
| R03 No analytics duplication | Pulse owns current Spotify metrics and history. Enrichment neither scrapes analytics nor persists a copied metric cache. | A03 Enrichment makes zero Spotify analytics requests and zero snapshot writes; existing Manager growth access remains available. |
| R04 Focused research | Deep Research runs automatically with bounded public search/read and identity-aware structured extraction. | A04 One click produces a tracked run and sourced findings without plan-approval UI; no message, follow, purchase, upload, or external write is executed. |
| R05 Evidence | Every published finding identifies its supporting source and date, including uncertainty and reported opinions. | A05 Invented URLs, unread pages, snippet-only claims, wrong-person facts, and unsupported numeric claims are withheld from agent context. |
| R06 Experience | Separate compact Career & public context section below Profile; usable empty, progress, partial, error, interrupted, and success states. | A06 User can navigate away, return, inspect sources, cancel, and refresh without losing profile edits or old findings. |
| R07 Corrections | Correct and Remove persist across refresh; corrections are explicitly user-reported. | A07 Rephrased/retried findings cannot resurrect removed facts or overwrite a correction; concurrent edits survive publication. |
| R08 Lifecycle | Deduplicate starts, fence late callbacks, persist before reporting success, preserve last good result on failure. | A08 Double click, disconnect, restart, identity change, permission loss, and cancellation produce no duplicate publication or cross-HQ writes. |
| R09 Agent utility | Manager and authorized campaign workers can consume concise career facts alongside separate artist direction and analytics. | A09 HQ chat, delegated/workflow launches, and relevant campaign focuses see the same revision; disabled/unauthorized research is absent everywhere. |
| R10 Permissions/privacy | Reuse existing access rules; pin workspace; only minimum intended public seeds reach research tools. | A10 A read-only member cannot start/publish/edit; permission revocation stops publication; private notes and credentials are not sent as discovery queries; existing disabled/routing controls survive reconstruction and restart. |
| R11 Freshness/history | Distinguish event date, article date, observation time, and recheck time. Refresh preserves historic achievements and labels stale associations. | A11 A ten-year-old award remains historical evidence; an old booking/label affiliation is not called current; failed refresh is not a fresh check. |
| R12 Verification/rollout | Prove thin end-to-end journey before expansion; no destructive migration or existing Pulse change. | A12 Fixture and live evidence remain separate; disabling the feature leaves profile/Pulse working and stored research recoverable. |

## Information scope

Include career milestones and achievements; notable releases and independently documented traction; credited collaborations and placements; notable performances/tours; press coverage; public professional affiliations and relationships. Public descriptions can be captured only as **Reported by [source]**, not as authoritative brand identity. Historic numerical achievements (for example an article reporting a release milestone) may be included with the exact metric/date/attribution, never relabeled as current analytics.

Exclude inferred personal beliefs, sensitive personal life, home/contact details, inferred fan demographics, automatic identity/branding rewrites, private account data, current monthly-listener scraping, a second Pulse, and automatic outreach/opportunity execution. The feature gathers public professional context about the artist, not a personal background investigation.

An opportunity is an interpretation made by Manager from evidence plus the artist's wishes. It does not become a profile fact. No new opportunity dashboard is required. Manager must state the basis and uncertainty and must not invent a warm relationship merely because two artists shared a lineup.

## Main journey

1. Open HQ → Profile. Existing fields and Save Profile remain. Keep Spotify URL visible as an ordinary profile field (already present). Add optional official website and supporting research links as independent research setup fields; do not overload socialLinks free text or add a compulsory onboarding step.
2. Press Enrich my profile. If Profile is dirty, offer inline **Save and enrich** or **Use saved profile**. Never silently save unsaved prose. Save-and-enrich uses the normal save operation successfully before capturing identity; a conflict preserves the draft. No modal approval ceremony.
3. With saved unambiguous identity and previously supplied seeds, run immediately. Otherwise show a compact inline identity form: artist name, Spotify URL or official artist page, optional press links, and **Start research**. An artist with no Spotify is supported. Do not demand press coverage. Name alone may discover candidates, but cannot auto-publish an ambiguous match.
4. Show stages **Finding sources → Checking matches → Building career context → Saving**. Stages reflect actual execution, not fabricated percentages. Existing report/progress view remains accessible; navigation does not cancel.
5. Identity matching first binds sources to the selected artist. Prefer direct canonical links from the official website; then corroborating known release/collaborator/location details. Name similarity alone is insufficient. If sources identify different people, ask one targeted identity question, retain the result privately, and do not merge biographies. Answer resumes a new bounded attempt using the additional seed, with old callbacks invalidated.
6. Publish validated supported findings automatically. Show counts and gaps: **Added 8 findings from 5 sources; no reliable live-history coverage found.** No low-coverage shame score. With zero usable facts, show **No supported findings found** rather than an empty success or invented biography.
7. Render grouped findings with short text and source/date details; show at most three per group with Show more. Actions are **Correct**, **Remove**, **Open source**; a correction edits the factual statement, not the artist's original fields. Refresh research is the same bounded pass using current seeds. It is manual in V1.

## Display/state contract

The section is beneath ArtistProfileForm within the existing Profile route, not a new sidebar destination. Intro: **Public career context researched for your agents. Your own profile and branding stay yours.** Before first run, show the action and optional explanation. Never display raw schema, provider errors, confidence decimals, or a legal checklist as primary copy.

Run state: idle → researching → validating → publishing → succeeded or partial. Alternatives: needs-identity, interrupted, cancelled, failed. Job progress maps onto existing Deep Research states; needs-identity and publication are adapter states, not a second execution engine. Older accepted findings remain visible during refresh; failure changes the run notice, not their timestamps. A source failure produces a partial result if other valid sources exist. Authentication failure points to the existing connection repair route only if no usable retrieval route exists.

Cancel invalidates the attempt before aborting child work. It prevents subsequent publication; any earlier committed revision remains. There is no automatic whole-run retry after restart. Existing Deep Research marks it interrupted; Retry research starts a bounded new attempt and reuses idempotency/dedup rules. Refresh errors do not create a blocking Needs you entry merely because the artist lacks press or analytics.

Identity change (Spotify artist ID, official identity anchor, or explicit switch of artist) makes the previous research ineligible for new agent context immediately. Keep an archived result accessible with its identity label; never show old-person facts as the new profile. Display-name correction alone need not change identity when stable anchors match. An analytics snapshot with a different artist ID is a discrepancy to surface, not authority to overwrite the user's saved Spotify field.

Keyboard-operable buttons, labeled link fields/errors, focus retained during live updates, restrained aria-live announcements, Escape closes only the identity editor (not the background run), narrow-layout wrapping, and no source navigation from unsafe URL schemes. Use existing theme/components; no redesign of HQ.

## Freshness and human control

Proposed defaults: current professional associations need recheck after 90 days; changing status claims become historical/last reported after that threshold. Historic events retain their event dates and are not invalidated solely by age. The section shows last successful research and last attempted refresh separately. Do not infer trend from a single dated press figure. Existing Pulse freshness rules continue unchanged.

Removed facts receive a persistent exclusion marker tied to artist identity and semantic subject/predicate key. Correction overlays the same key and is labeled **Corrected by you**; the source remains attached as historical provenance, not an endorsement of the correction. Automatic refresh cannot override either. Remove has immediate Undo; restoring a removed key is an explicit edit. Source disappearance does not erase previously supported history but labels it last verified and avoids claiming a fresh verification. Contradictions without resolution stay in the research report, excluded from the concise trusted context; user corrections are allowed without a press citation but visibly user-reported.

## Deferred and excluded

D01 Scheduled re-enrichment/monitoring: deferred; manual refresh proves value first.
D02 New analytics collectors, public monthly listeners, new Spotify OAuth/API: excluded; existing Pulse owns analytics and feature works without login.
D03 Automatic brand amendments: excluded; separate spec 43 and artist-owned workflow.
D04 Multi-artist HQ creation: deferred; bind to current HQ correctly without introducing that separate product upgrade.
D05 New opportunity dashboard/contact harvesting/outreach: deferred; existing Manager can reason from evidence, existing action approvals still apply.
D06 Guaranteed cross-device exactly-once research execution: excluded; shared-folder replication cannot provide that guarantee. Publication must use existing conflict mechanisms and never silently overwrite a competing edit.

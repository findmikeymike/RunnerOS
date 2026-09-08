# Campaign readiness context audit — 2026-09-07

## Findings

The voice runtime receives a bounded derived Manager Brief, not the full set of
Release Kit and Essentials documents. The previous snapshot hardcoded draft
asset coverage to master/lyrics/cover; the HQ brief dropped even that coverage.
Both the snapshot and brief limited missing checklist labels to five. The
snapshot included unselected optional items in that list and omitted completed
and in-progress item names. Release Photos could therefore survive while video
work and rollout never reached voice.

HQ profile/context gaps, catalog performance and a generated HQ nextMove were
adjacent to campaign information. Scope labels alone did not stop a live model
from proposing the unrelated HQ task when asked about release readiness.

## Corrected data path

1. Server snapshot reads the campaign-scoped Release Kit manifest, preserving
   malformed/unavailable state instead of treating failure as empty inventory.
   It records five core category counts: audio, artwork, video, images, plans.
   Restricted or unverified snapshots are not counted as usable ready assets.
2. Campaign Essentials uses included, non-skipped items and official totals.
   It supplies named done/in-progress/review/needed work, up to 40 items, with
   an explicit omission count. Unselected optional items are excluded.
3. Both HQ campaign focus and campaign briefs retain that inventory. Budget
   trimming removes lower-priority context first; missing item details cannot
   silently appear complete. HQ context gaps and catalog signals are scoped.
4. Voice opts out of generated HQ nextMove/campaign suggestedFocus. Default
   Command rendering still receives its recommendations. Voice answers the
   current topic using facts rather than reciting a queued recommendation.
5. Existing per-turn context refresh rebuilds the derived brief. No additional
   model request, asset hashing, promotion, or new write is added to this read.

Kit inventory is recorded approval metadata, not live byte verification or proof
that every required subtype exists. A video is not necessarily Canvas, and a
plan is not necessarily the rollout. Checklist completion is not Kit approval;
absence from Kit is not proof that work was never created elsewhere. Open work
is not automatically a launch blocker. Photos are not invented prerequisites
for artwork/video.

## Evidence

The local source audit found an empty approved Kit alongside two checklist items
marked done and nineteen open, including in-progress work. The new rendered
packet preserves that distinction and includes video, Canvas and rollout.
Logs retain scalar timings, not spoken transcripts; the user's account of the
spoken failure was checked against the saved packet, not a reconstructed audio
recording.

Fictional-only live tests on the configured DeepSeek Flash/off route exercised
campaign assessment, done-versus-approved conflict, Canvas/rollout, HQ separation
and an explicitly agreed Branding handoff. The final tested prompt answered
those subjects and rejected the invented photo prerequisite. Model wording and
prioritization still vary; the data contract and navigation boundary are tested
separately rather than treating one conversation as a universal guarantee.

Regression coverage includes foreign campaign manifests/items, malformed canon,
restricted/review/missing assets, skipped and optional items, known completion,
near-budget omissions, campaign selection, and voice-only recommendation removal.

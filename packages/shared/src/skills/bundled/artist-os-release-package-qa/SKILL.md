---
name: artist-os-release-package-qa
description: Run an evidence-backed final QA of a music release package across approved assets, metadata, rights, dates, delivery, links, and launch dependencies. Use before release submission or launch; do not treat model judgment as proof.
---

# Release Package QA

## Standard

Audit what exists, what is verified, what conflicts, and what still blocks release. Read the exact
Campaign Release Kit, Campaign Assets, Outputs, Calendar, and Essentials state. Never substitute
file names, old Outputs, or a model summary for current evidence.

## Checks

### Package identity

- artist, release, track, and version names agree;
- release date, timezone, territories, and provider state agree;
- identifiers and copyright lines are present or explicitly provider-assigned.

### Assets

- required Release Kit items exist and are currently available;
- approved items have not drifted, moved, or entered needs-review;
- the exact master, artwork, lyrics, photos, and videos belong to this Campaign;
- known provider format requirements are checked only when objective metadata is available.

Do not claim audio sounds correct, artwork is visually correct, or a file meets an unobserved
technical specification. State what was machine-checked and what still needs human playback or
visual review.

### Rights and metadata

- credits and contributor spellings are internally consistent;
- composition and master ownership are separately accounted for;
- samples, features, licenses, and pending clearances are exposed;
- explicit/language/version fields are consistent across delivery materials.

### Launch dependencies

- distributor status is known;
- pre-save or destination link is verified when required;
- DSP pitch, social rollout, and campaign dates do not contradict delivery timing;
- anything awaiting approval names the exact owner and next action.

## Verdict

Use only:

- `READY` — no blocking failure remains, with evidence listed.
- `READY WITH HUMAN CHECKS` — machine-verifiable checks pass and named playback/visual checks remain.
- `BLOCKED` — one or more named release blockers remain.

Warnings never silently become passes. A Release Kit item marked available is not automatically
rights-cleared or provider-submitted.

## Output

Create one Campaign-scoped `Final Release QA` markdown Output in Canvas with a compact table:
check, status, evidence, blocker/owner, next action. End with the exact verdict and what would
change it. Never mark the Essentials item done merely because the report was created.

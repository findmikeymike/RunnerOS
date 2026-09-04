---
status: implementation-in-progress
owner: agent
last_verified: 2026-09-01
source_of_truth: true
related: ./11-outputs-finals-asset-promotion-spec.md, ./13-scheduled-work-composer-execution-spec.md, ./23-release-kit-architecture-spec.md, ./25-release-kit-asset-use-social-scheduling-spec.md
---

# Release Manager And Essentials Execution

## Decision

Artist OS will ship one **Release Manager** worker for the operational side of a release.
It owns distributor preparation, pre-save setup, credits and metadata, rights and splits,
DSP pitches, and final release QA. These are different steps in one delivery chain, not
separate personas.

The Release Manager prepares exact packets, audits evidence, and guides connected account
work. It does not silently submit a release, accept legal terms, send documents, publish a
pre-save page, or submit a DSP pitch.

```text
Campaign truth + Release Kit + Essentials + release date
                            ↓
                      Release Manager
                            ↓
       metadata / rights / delivery / pitch / QA Outputs
                            ↓
               artist review and exact approval
                            ↓
       connected provider action or honest manual handoff
                            ↓
                   provider receipt / proof
```

## Why One Worker

The same facts recur across every release-ready task: artist and title, version, contributors,
ownership, explicit status, label and copyright lines, ISRC/UPC, release date, territories,
master, artwork, links, and platform accounts. Splitting those facts across several workers
would create contradictory packets and force the artist to repeat themselves.

Specialized judgment lives in four skills:

1. `artist-os-release-operations`
2. `artist-os-rights-and-credits`
3. `artist-os-release-package-qa`
4. `artist-os-dsp-editorial-pitch`

The worker uses the reserved internal slug `artist-os-release-manager`. The Artist OS prefix
prevents a normal user-created Release Manager or third-party skill from silently occupying a
safety-critical built-in identity.

## Essentials Ownership

| Essential | Owner | Completion evidence |
| --- | --- | --- |
| Distributor Upload | Release Manager | Provider draft/submission receipt or explicit manual confirmation |
| Pre-Save Link | Release Manager | Verified live URL tied to the correct release |
| Credits & Metadata | Release Manager | Complete reviewed metadata packet |
| Social Rollout | Social Publisher | Existing approved schedule and posting path |
| Rights & Splits | Release Manager | Reviewed rights packet with unresolved issues exposed |
| Final Release QA | Release Manager | Evidence-backed QA Output with no blocking failures |
| DSP Pitch | Release Manager | Approved pitch plus provider submission receipt or manual handoff |
| EPK / Press Kit | Comms Agent | Existing verified EPK Output |

Performance Clips remains owned by Raw Video Editor. Master, clean version, instrumental,
and stems are files, not LLM deliverables. Artist OS should add or select those files from
Campaign Assets, Outputs, or the Release Kit rather than pretend a chat worker can manufacture
proper source audio.

## Status Semantics

`skipped` means the artist deliberately decided an item is not applicable. It must never mean
"this item was added by a software update."

Migration rules:

- A new `core` item added to an existing Campaign enters `needed`.
- A new optional or conditional item remains excluded until the artist adds it.
- A historical explicit skip with an item-level timestamp remains skipped.
- An old auto-generated core skip with no item-level timestamp migrates to `needed`.
- UI strikethrough is reserved for a real N/A decision.

Status changes are explicit: the row control opens a quiet choice for `review`, confirmed `done`,
or `not applicable`. Starting a worker or successfully creating a workflow run creates
`in-progress`, and the row keeps the exact chat or run link. A successful lyrics transcription
creates `review` and keeps the exact audio review target. Merely opening workflow setup changes
nothing. No item becomes done merely because a chat, run, tool result, or Output exists.
Confirming done is the artist's timestamped manual attestation that the real asset, link, receipt,
or manual provider step was checked.

## Worker Contract

Release Manager starts from saved Campaign and Artist HQ truth. It asks only for material gaps.
It separates facts into `verified`, `artist-confirmed`, `missing`, and `conflicting` instead of
filling blanks with plausible guesses.

Every run produces one useful next artifact, not a giant generic checklist. The default Output
is a markdown packet shown in Canvas with Campaign scope and pending approval when external
action remains.

### Completion language

- `prepared`: the packet is ready for artist review.
- `ready to submit`: required facts and assets pass checks, but no provider action occurred.
- `submitted`: a provider receipt or exact human confirmation exists.
- `live`: the resulting release/link is visibly available at the verified URL.
- `blocked`: a named fact, asset, clearance, account, or provider step is missing.

The worker must never collapse these states into "done."

## Activation

Release Manager is activated only in Campaign workspaces. First installation adds it once to
existing Campaign workspaces, and new Campaign roots receive it when created. It reads shared
Artist HQ truth from the Campaign but does not appear as an HQ worker. Artist HQ, Creative Lab,
and general workspaces cannot activate it. A later user deactivation or deletion in a Campaign is
respected and is not reversed on every startup.

## Connector Strategy

### V1 reuse

- Spotify for Artists uses the existing saved Spotify browser profile.
- Google Drive and Gmail are optional for documents and approved handoffs.
- Release Kit, Campaign Assets, Outputs, and Artist Vault are read through existing host tools.
- No connector is required to prepare rights, metadata, or QA packets.

### Later provider profiles

Distributor and smart-link services do not share one trustworthy universal API. Add a generic
saved browser-account profile only after the exact account identity, dry-run payload, approval,
and receipt contract are defined. Provider presets may include DistroKid, TuneCore, CD Baby,
Feature.fm, Linkfire, or Hypeddit, but the product must not imply identical capabilities.

Until that exists, Release Manager creates a copy-safe handoff and can guide the artist through
the provider UI. It must label that result manual and never claim submission.

## Safety Invariants

- Never invent ISRC, UPC, IPI/CAE, PRO affiliation, legal names, ownership, splits, sample
  clearance, release dates, territories, platform URLs, or provider receipts.
- Composition ownership and master ownership are separate ledgers.
- Split totals must be checked, but a mathematical 100% does not prove legal agreement.
- Rights guidance is operational organization, not legal advice.
- No external action inherits approval from an earlier chat or another payload revision.
- Any change to the approved payload invalidates the old approval.
- A model statement is not completion evidence.

## V1 Acceptance

1. Existing Campaigns no longer show new core Essentials crossed out because of migration.
2. Performance Clips opens Raw Video Editor.
3. Distributor Upload, Pre-Save Link, Credits & Metadata, Rights & Splits, Final Release QA,
   and DSP Pitch all open the same Release Manager with item-specific kickoff context.
4. Release Manager and all four skills are installed and initially activated only for existing
   Campaign workspaces, without overriding later user deactivation.
5. Every Release Board action resolves to a shipped worker or workflow.
6. Worker chats, workflow runs, and tool review targets reopen from the originating Essentials row.
7. Focused Release Board, starter-agent, starter-skill, and typecheck suites pass.

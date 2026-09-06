---
status: current
owner: agent
last_verified: 2026-09-04
source_of_truth: true
---

# Not Yet Built

Creator Command Center specs with **no implementation in the tree**. Each was
verified unbuilt by searching for its defining symbol, not by trusting its
`status:` line.

Everything here is a complete spec, not a sketch. Any of them can be handed to
an implementing agent as-is.

| Spec | What it does | Verified unbuilt by |
| --- | --- | --- |
| [36 Capability Evolution Engine](./36-capability-evolution-engine-spec.md) | Turns weekly intel and usage friction into a few proposed system upgrades the artist can try, keep, then routinize | no `EvolutionProposal` or evolution service |
| [42 Campaign Release Path And Manager Orchestration](./42-campaign-release-path-orchestration-spec.md) | Turns Essentials into a date-aware five-phase release path and gives Artist Manager one deterministic Continue action over existing workers | no `CampaignReleasePath`, phase compiler, approved campaign packets, or content-intent contract |
| [43 Approved Branding Amendments](./43-approved-branding-amendments-spec.md) | Turns agreed Branding Agent work into a durable Output and an artist-approved, append-only Branding amendment without replacing user text | no `ArtistBrandingAmendment`, `BrandingAmendmentProposal`, or dedicated branding amendment tools |
| [44 State-Aware First-Use Guide](./44-state-aware-first-use-guide-spec.md) | Extends the existing question-mark Guide with an optional first-use setup path whose progress comes from real AI, Brain, Vault, and first-work state | no `ArtistSetupSnapshot`, onboarding presentation state, setup mode, or coach-mark target contract |
| [45 HQ / Campaign Scope Clarity](./45-hq-campaign-scope-clarity-spec.md) | One stated rule for where shared work lives, the unified timeline shown inside campaigns, and cross-owner channel-collision warnings — no new space, no new store | `collectArtistTimeline` has no RPC and only `manager-tools.ts` calls it; no `TimelineCollision` or `channel` on `TimelineEntry` |

Specs 38 and 41 remain at their existing paths for cross-reference stability,
but are implemented, not unbuilt. See the V1 integration review checklist for
remaining live acceptance checks.

## Rules For This Folder

- A spec belongs here only when **nothing** of it is built. Partially built work
  stays in the parent folder with an honest `status:` and its remaining scope in
  [`../../backlog/TO-DO.md`](../../backlog/TO-DO.md).
- When a spec ships, move the file back to the parent folder, update its
  `status:`, and move its README line back into the numbered index.
- Cross-references from here use `../` for specs in the parent folder.
- Spec 26 (Agent-Bound Messaging) left this folder once slices 1, 2, 4, and 4a
  shipped; it now lives in the parent folder as `partially-implemented`.
- Spec 39 (Artist Website) left this folder once Slice 1 shipped; it now lives
  in the parent folder as `partially-implemented`.

## Suggested Order

Independent of each other; ordered by leverage per unit of work.

1. **45 HQ / Campaign Scope Clarity** — Slices A and B are pure visibility on
   the existing timeline read model, no new store. Removes a real source of
   day-to-day confusion; Slice C waits on observing A and B.
2. **36 Capability Evolution Engine** — ship Slice 3 and stop to measure before
   building the draft and activation machinery.

Specs 31, 37, and 40 left this folder on 2026-09-04: 37 and 40 shipped in
full; 31 shipped its agent and skill and now lives in the parent folder as
`partially-implemented` with remaining slices in the backlog.

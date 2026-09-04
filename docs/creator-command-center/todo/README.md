---
status: current
owner: agent
last_verified: 2026-09-03
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
| [31 Catalog And Royalty Reconciliation](./31-catalog-royalty-reconciliation-spec.md) | Compiles every released song from Spotify and squares it against BMI/ASCAP registrations to find unregistered works | no `ISWC` handling anywhere in `packages/` |
| [36 Capability Evolution Engine](./36-capability-evolution-engine-spec.md) | Turns weekly intel and usage friction into a few proposed system upgrades the artist can try, keep, then routinize | no `EvolutionProposal` or evolution service |
| [37 Model Fallback Chain](./37-model-fallback-chain-spec.md) | User-picked Fallback 1 and 2 so a rate-limited model does not kill a session, workflow step, or scheduled run | no fallback logic in `agent/` or `config/`; workflow retries the same model (`runner.ts:712-752`) |
| [38 Community Email Engine And The Community Agent](./38-community-email-engine-spec.md) | Finishes the fan-list loop: Resend sending with one-click approve, inbound fan mail, engagement, capture doors, agent tools, and a Community Agent starter; Gmail stays the personal lane | no Resend API call anywhere; `community-email.ts:25-30` is a stub; no job status transition after create; no `community_*` session tools |
| [41 The Autonomous Website And Community Loop](./41-autonomous-website-and-community-loop-spec.md) | Master spec over 38 and 39: the weekly loop that updates the site, drains signups into Community, drafts the fan email, and puts one Monday Brief in Needs You; shared contracts for approval tiers, Change Receipts, subscriber handoff, and agent briefs; four slices with acceptance tests | no `ChangeReceipt`, `MondayBrief`, or `ApprovalPolicy` anywhere; no `website-agent` or `community-agent` starter; no deploy adapter |

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

1. **37 Model Fallback Chain** — smallest, and it stops unattended work from
   dying on a busy free-tier model. Everything else benefits.
2. **36 Capability Evolution Engine** — ship Slice 3 and stop to measure before
   building the draft and activation machinery.
3. **41 Autonomous Website And Community Loop** — build its Slice A first;
   it is the publishing and capture layer that 38 and 39 both wait on, and
   it defines the receipts and approval tiers every later slice writes to.
   Then 38 and 39 slices ship as steps of this loop rather than separately.
4. **38 Community Email Engine** — the fan list already exists and is well
   modeled; Slices 1 through 3 turn it into a working sender with no agent
   work, and Slice 4 gives the Community Agent hands. Highest compounding
   payoff for any artist with fans.
4. **31 Catalog And Royalty Reconciliation** — highest real-world payoff for an
   artist with a back catalog, but depends on a Spotify path and browser
   sessions for BMI/ASCAP.

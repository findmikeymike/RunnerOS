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
| [26 Agent-Bound Messaging](./26-agent-bound-messaging-spec.md) | A chat binds to an *agent*, not a session, so a specialist can be messaged and reply hours later | no `ChannelBinding` or `ChannelBindingTarget` anywhere in `packages/` |
| [31 Catalog And Royalty Reconciliation](./31-catalog-royalty-reconciliation-spec.md) | Compiles every released song from Spotify and squares it against BMI/ASCAP registrations to find unregistered works | no `ISWC` handling anywhere in `packages/` |
| [36 Capability Evolution Engine](./36-capability-evolution-engine-spec.md) | Turns weekly intel and usage friction into a few proposed system upgrades the artist can try, keep, then routinize | no `EvolutionProposal` or evolution service |
| [37 Model Fallback Chain](./37-model-fallback-chain-spec.md) | User-picked Fallback 1 and 2 so a rate-limited model does not kill a session, workflow step, or scheduled run | no fallback logic in `agent/` or `config/`; workflow retries the same model (`runner.ts:712-752`) |

## Rules For This Folder

- A spec belongs here only when **nothing** of it is built. Partially built work
  stays in the parent folder with an honest `status:` and its remaining scope in
  [`../../backlog/TO-DO.md`](../../backlog/TO-DO.md).
- When a spec ships, move the file back to the parent folder, update its
  `status:`, and move its README line back into the numbered index.
- Cross-references from here use `../` for specs in the parent folder.

## Suggested Order

Independent of each other; ordered by leverage per unit of work.

1. **37 Model Fallback Chain** — smallest, and it stops unattended work from
   dying on a busy free-tier model. Everything else benefits.
2. **26 Agent-Bound Messaging** — unblocks the deferred half of spec 33
   (worker-originated asks and external reply correlation).
3. **36 Capability Evolution Engine** — ship Slice 3 and stop to measure before
   building the draft and activation machinery.
4. **31 Catalog And Royalty Reconciliation** — highest real-world payoff for an
   artist with a back catalog, but depends on a Spotify path and browser
   sessions for BMI/ASCAP.

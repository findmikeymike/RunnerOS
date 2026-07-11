---
status: accepted
owner: team
last_verified: 2026-07-11
source_of_truth: true
---

# ADR-010 — Isolated RunnerOS Foundation

## Context

RunnerOS has many active worktrees, several containing unrelated uncommitted work. The creator-social integration tree contains useful operational patterns but its 11 local commits mix generic lifecycle concepts with Artist HQ UI and domain contracts. Upstream v0.11.1 also diverges from the customized origin mainline.

## Decision

Create Trade God as a dedicated worktree and branch in the existing RunnerOS repository, frozen from verified `origin/main` SHA `e7e96be32a5be394aefaf5712bdd711b96ad9d15`.

Use creator-social as a read-only architectural donor. Do not branch from or cherry-pick its entire unpushed stack. Evaluate the 15 upstream-only v0.11.1 commits separately and port them only after compatibility review.

## Why

- Preserves the complete customized RunnerOS control plane.
- Isolates files and branch state from 23 existing worktrees.
- Avoids inheriting dirty or creator-coupled work.
- Makes the base reproducible and auditable.
- Keeps future upstream integration explicit rather than accidental.

## Consequences

- Trade God initially carries creator-oriented RunnerOS surfaces already present in main; they remain dormant baggage, not Trade God contracts.
- Domain-neutral extraction happens only when a real trading slice needs it.
- Upstream upgrades require a separate evaluation lane.
- A separate repository may be considered later when Trade God has an independent release lifecycle; it is premature now.

## Reversal Path

Because the foundation is an isolated branch/worktree with no unique implementation yet, it can be removed without changing any protected branch. Removal requires explicit approval and only after confirming no unique commits or uncommitted files exist.

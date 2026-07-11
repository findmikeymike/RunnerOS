---
status: active
owner: team
last_verified: 2026-07-11
source_of_truth: false
---

# Trade God Handoff

## Mission

Build a local-first desktop trading intelligence system where deterministic analytics produce traceable evidence, specialist agents interpret that evidence, a head agent coordinates disagreement and context, and all trading actions pass through explicit policy and execution boundaries.

## Start Here

1. `docs/CURRENT.md`
2. `docs/architecture/OVERVIEW.md`
3. Active spec named by `CURRENT.md`
4. `docs/development/VERIFICATION.md`

## Current Truth

The project has rich vision, agent, and integration documents. It does not yet have a Trade God runtime. RunnerOS is the proposed host, but the correct clean integration base must be confirmed before implementation.

## Immediate Assignment

Create and execute the Phase 0 contract-kernel spec. The deliverable is one fixture-driven Order Flow sidecar response validated through typed contracts and displayed in Electron with health and failure state.

## Non-Negotiable Boundaries

- Agents use the typed trading client; they do not directly call providers, brokers, or sidecars.
- Contracts have no Electron, provider, broker, or LLM dependencies.
- Domain calculations are deterministic and testable without an LLM.
- UI does not own market truth or execution state.
- Python analytics live in independent sidecars, not inside agent folders.
- Every artifact records provenance, timestamps, schema version, producer version, and quality state.
- Live execution remains impossible until separate risk, approval, idempotency, reconciliation, and kill-switch gates pass.

## Definition of a Good Handoff

Replace this section after implementation with:

- exact worktree and branch;
- dirty/ahead/behind state;
- files changed;
- behavior now working;
- commands run and results;
- runtime proof still missing;
- next smallest action;
- blockers requiring human choice.

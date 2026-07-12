---
status: active
owner: team
last_verified: 2026-07-11
source_of_truth: false
---

# Trade God Handoff

## Mission

Build a local-first desktop trading intelligence system where deterministic analytics produce traceable evidence, specialist agents interpret it, a head agent coordinates context and disagreement, and all trading actions pass through explicit policy and execution boundaries.

## Exact Working Location

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/trade-god-foundation`
- Branch: `codex/trade-god-foundation`
- Frozen base: `origin/main` `e7e96be3`
- Implementation head before this docs refresh: `d215ed7a`
- Other RunnerOS worktrees: intentionally untouched

## Read First

1. `docs/trading/CURRENT.md`
2. `docs/trading/specs/foundation/phase-0-contract-kernel.md`
3. `docs/trading/development/VERIFICATION.md`
4. `docs/trading/architecture/OVERVIEW.md`

## Current Truth

The Phase 0 development walking skeleton is implemented. A project-owned ES fixture travels through a standalone Order Flow sidecar, validated contracts, a typed client, Electron supervision, narrow IPC/preload methods, and a visible Trade God workbench.

This is not yet a trading system. It has no live data, broker, account, order, or autonomous-execution capability. The real Electron user path and packaged sidecar have not been proven.

## Immediate Assignment

Run the real Electron app from this worktree, open `trade-god`, verify health and the known artifact, force one visible failure state, and record the evidence. Then implement packaged-sidecar bundling/resolution.

## Known Expected Artifact

- Total volume: `28`
- Buy volume: `17`
- Sell volume: `11`
- Delta: `6`
- POC: `5592.25`

The UI also exposes quality, trace ID, fixture checksum, content hash, and producer identity.

## Verification Truth

- Fast Trade God suite: 53 passed, 0 failed, 129 expectations across 11 files.
- Electron main, preload, and renderer production builds passed.
- Real Electron smoke: not run.
- Packaged sidecar: not implemented.
- Full monorepo typecheck: blocked by a pre-existing campaign-calendar failure at `packages/shared/src/campaign-calendar/index.ts:632`.
- Standalone package typechecks: unverified after prior tool-layer hangs.

## Non-Negotiable Boundaries

- Agents and UI use the typed trading client, never providers, brokers, or sidecars directly.
- Contracts remain independent of Electron, providers, brokers, and LLMs.
- Deterministic calculations remain testable without an LLM.
- UI never owns market truth or execution state.
- Analytics engines remain independent sidecars, not code hidden inside agent folders.
- Every artifact carries provenance, versions, timestamps, trace identity, and quality state.
- Live execution stays impossible until risk, approval, idempotency, reconciliation, and kill-switch gates exist.

## Next Smallest Actions

1. Real Electron success-path smoke.
2. Real Electron failure-state smoke.
3. Packaged-sidecar asset/copy/resolution path.
4. Restart-policy and partial-frame tests.
5. Active-computation cancellation.

## Do Not Do Yet

- Do not merge unrelated upstream changes.
- Do not build dozens of agents or the final UI.
- Do not add brokers or live execution.
- Do not describe tests or builds as runtime verification.

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

The Phase 0 walking skeleton is implemented for development and packaged-sidecar resolution. A project-owned ES fixture travels through a standalone Order Flow sidecar, validated contracts, a typed client, Electron supervision, narrow IPC/preload methods, and a visible Trade God workbench. The build now emits a self-contained sidecar bundle and packaged mode selects RunnerOS's bundled Bun.

This is not yet a trading system. It has no live data, broker, account, order, or autonomous-execution capability. The real visual Electron user path and a fully built packaged installer have not been proven.

## Immediate Assignment

At the first reliable desktop opportunity, run Electron from this worktree, open `trade-god`, verify health and the known artifact, force one visible failure state, and record the evidence. Until then, continue with active cancellation and trace-to-receipt work.

## Known Expected Artifact

- Total volume: `28`
- Buy volume: `17`
- Sell volume: `11`
- Delta: `6`
- POC: `5592.25`

The UI also exposes quality, trace ID, fixture checksum, content hash, and producer identity.

## Verification Truth

- Fast Trade God suite: 58 passed, 0 failed, 138 expectations across 12 files.
- Electron main, preload, and renderer production builds passed.
- Real Electron smoke: not run.
- Packaged sidecar bundle and resolution: implemented and integration-tested; actual packaged installer not built/smoked.
- Crash policy: failed work is not replayed; the sidecar restarts only on the next explicit request.
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
3. Actual packaged-app build/resource-layout smoke.
4. Active-computation cancellation.
5. Trace-to-persisted-receipt proof.

## Do Not Do Yet

- Do not merge unrelated upstream changes.
- Do not build dozens of agents or the final UI.
- Do not add brokers or live execution.
- Do not describe tests or builds as runtime verification.

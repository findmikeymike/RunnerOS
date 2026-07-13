---
status: active
owner: team
last_verified: 2026-07-13
source_of_truth: false
---

# Trade God Handoff

## Mission

Build a local-first desktop trading intelligence system where deterministic analytics produce traceable evidence, specialist agents interpret it, a head agent coordinates context and disagreement, and all trading actions pass through explicit policy and execution boundaries.

## Exact Working Location

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/trade-god-foundation`
- Branch: `codex/trade-god-foundation`
- Frozen base: `origin/main` `e7e96be3`
- Implementation head before the active slice: `840c83db`
- Other RunnerOS worktrees: intentionally untouched

## Read First

1. `docs/trading/CURRENT.md`
2. `docs/trading/specs/foundation/phase-0-contract-kernel.md`
3. `docs/trading/specs/market-data/phase-1-nautilus-market-data-spine.md`
4. `docs/trading/development/VERIFICATION.md`
5. `docs/trading/architecture/OVERVIEW.md`

## Current Truth

The Phase 0 walking skeleton is implemented for development and packaged-sidecar resolution. A project-owned ES fixture travels through a standalone Order Flow sidecar, validated contracts, a typed client, Electron supervision, narrow IPC/preload methods, and a visible Trade God workbench. The build now emits a self-contained sidecar bundle and packaged mode selects RunnerOS's bundled Bun.

This is not yet a trading system. It has no live data, broker, account, order, or autonomous-execution capability. The real visual Electron user path and a fully built packaged installer have not been proven.

Phase 1 has an isolated Python 3.12.9/NautilusTrader 1.230.0 adapter and provider-independent Trade God event, quality-report, and bounded-batch contracts. Python emits the exact full TypeScript golden/checksum and the replay quality matrix now handles malformed data, timestamps, sizes, price increments, aggressors, instruments, corruption, duplicates, ordering, and all-rejected batches with typed outcomes. A replay-only JSON-RPC process now exposes health, explicit capabilities, fixed-fixture loading, typed quality errors, and shutdown without accepting caller paths or granting live/broker/execution authority.

## Immediate Assignment

Supervise and contract-validate the fixture-only market-data command, then add replay/cancel lifecycle semantics and route a validated canonical batch into Order Flow. At the first reliable desktop opportunity, pause for the real Electron success/cancel/failure smoke and record the evidence.

## Known Expected Artifact

- Total volume: `28`
- Buy volume: `17`
- Sell volume: `11`
- Delta: `6`
- POC: `5592.25`

The UI also exposes quality, trace ID, fixture checksum, content hash, and producer identity.

## Verification Truth

- Fast Trade God suite: 62 passed, 0 failed, 150 expectations across 12 files.
- Electron main, preload, and renderer production builds passed.
- Real Electron smoke: not run.
- Packaged sidecar bundle and resolution: implemented and integration-tested; actual packaged installer not built/smoked.
- Crash policy: failed work is not replayed; the sidecar restarts only on the next explicit request.
- Active cancellation: proven through typed client, handler, and real stdio; workbench control compiles but is not visually smoked.
- Run receipts: atomic validated JSON receipts persist request, trace, artifact identity/hash, timing, and outcome under `<userData>/trade-god/run-receipts/`.
- Audit chain: the supervisor owns the trace before work starts; structured main logs, request, artifact, and receipt share it.
- Receipt-focused verification: 23 passed, 0 failed. Latest complete suite remains 62 passed; the attempted combined rerun hung in the tool layer and was stopped.
- Full monorepo typecheck: blocked by a pre-existing campaign-calendar failure at `packages/shared/src/campaign-calendar/index.ts:632`.
- Standalone package typechecks: unverified after prior tool-layer hangs.
- Phase 1 fixture adapter: 1 test passed after an observed failing test; Python `3.12.9`, NautilusTrader `1.230.0`, Darwin ARM64.
- Phase 1 canonical contracts: 20 tests passed and standalone typecheck passed after adversarial findings were reproduced and fixed.
- Phase 1 Python canonical adapter: 5 tests passed; Python and TypeScript full-batch goldens/checksums agree exactly.
- Phase 1 completed replay quality matrix: 9 tests passed with typed malformed and all-rejected failure paths.
- Phase 1 market-data RPC: 7 tests passed; complete Python suite: 16 tests passed. A real spawned process proved strict JSONL parsing, dependency-aware health, and shutdown, but Electron supervision/crash classification is not yet proven.
- Windows and Linux runtime/package compatibility: locked wheels exist but remain unverified.

## Non-Negotiable Boundaries

- Agents and UI use the typed trading client, never providers, brokers, or sidecars directly.
- Contracts remain independent of Electron, providers, brokers, and LLMs.
- Deterministic calculations remain testable without an LLM.
- UI never owns market truth or execution state.
- Analytics engines remain independent sidecars, not code hidden inside agent folders.
- Every artifact carries provenance, versions, timestamps, trace identity, and quality state.
- Live execution stays impossible until risk, approval, idempotency, reconciliation, and kill-switch gates exist.

## Next Smallest Actions

1. Supervise and contract-validate the fixture-only market-data process response.
2. Add replay/cancel and distinguish cancellation from sidecar crash.
3. Route the canonical replay batch into the Order Flow input boundary.
4. Real visual success/cancel/failure smoke at the first desktop opportunity.
5. Actual packaged-app build/resource-layout smoke.

## Do Not Do Yet

- Do not merge unrelated upstream changes.
- Do not build dozens of agents or the final UI.
- Do not add brokers or live execution.
- Do not describe tests or builds as runtime verification.

---
status: active
owner: team
last_verified: 2026-07-14
source_of_truth: false
---

# Trade God Handoff

## Mission

Build a local-first desktop trading intelligence system where deterministic analytics produce traceable evidence, specialist agents interpret it, a head agent coordinates context and disagreement, and all trading actions pass through explicit policy and execution boundaries.

## Exact Working Location

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/trade-god-foundation`
- Branch: `codex/trade-god-foundation`
- Frozen base: `origin/main` `e7e96be3`
- Implementation head before the active slice: `f5e71ba6`
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

Phase 1 has an isolated Python 3.12.9/NautilusTrader 1.230.0 adapter and provider-independent event, quality, batch, candle, series, and agent-snapshot contracts. Python emits the exact TypeScript golden/checksum; typed client/Electron supervision validates it; the replay engine produces current price and candle history under a no-lookahead watermark. One canonical batch now produces both the checksum-verified `order-flow-artifact@2` and the addressed snapshot reference consumed by `order-flow-specialist@0.1.0`. The specialist injects SHA-256-pinned doctrine, calls Runner's provider-neutral one-shot model seam, rejects unsafe or ungrounded output, and atomically stores `order-flow-interpretation@1`. Scripted-model orchestration is proven; authenticated real-model quality is not.

## Immediate Assignment

Complete one authenticated real-model evaluation, then add reconnect/gap/staleness and session-correctness gates before live data. JSONL remains limited to bounded control/replay: at most 1,000 requested events/sec and a measured 750,000-byte response frame. At the first reliable desktop opportunity, run the real Electron success/cancel/failure/provider-attachment smoke and record the evidence.

## Known Expected Artifact

- Total volume: `28`
- Buy volume: `17`
- Sell volume: `11`
- Delta: `6`
- POC: `5592.25`

The UI also exposes quality, trace ID, fixture checksum, content hash, and producer identity.

## Verification Truth

- Paced replay focused closure: 93 passed, 0 failed across 14 TypeScript files; Python market-data suite: 21 passed, 0 failed.
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
- Phase 1 market-data RPC: 7 tests passed; complete Python suite: 16 tests passed. A real spawned process proved strict JSONL parsing, dependency-aware health, and shutdown.
- Typed client/Electron supervision: 39 tests passed, 79 expectations; Electron main build passed. Real Python development supervision is proven. Packaged Python assets and installed-app runtime remain unproven.
- Replay/candles: 41 tests passed, 95 expectations; contract and market-state typechecks and Electron main build passed. No-lookahead, retry dedupe, invalid/live rejection, checksum validation, exact OHLC/volume/delta, history, and developing state are proven on bounded replay.
- Agent market context: 46 tests passed, 126 expectations; typechecks and Electron main build passed. Fresh/stale/no-data, limits/truncation, quality aggregation, exact batch/checksum mapping, content integrity, and analysis-only authority are proven. The scripted Order Flow specialist now consumes this path; authenticated-provider consumption is still unverified.
- Canonical Order Flow: 64 tests passed, 137 expectations across ten focused files. Contract/market-state typechecks, Electron main build, packaged sidecar build/health, exact mixed-precision math, bounded framing/cache behavior, corrupt/live rejection, v2 provenance/receipts, and the real Python-child -> Order-Flow-child path passed.
- Specialist context delivery: full snapshots persist atomically under `<userData>/trade-god/agent-context/`; specialists receive `agent-context-reference@1`, not copied market payloads; queue and authorized resolution produce `agent-context-delivery-receipt@1`. Concurrency, tamper, wrong-consumer, and path traversal checks pass. This seam alone did not prove consumption; the scripted specialist path below now does.
- Order Flow specialist: one real canonical batch binds artifact, snapshot, delivery receipt, trace, instrument, and checksums. A hash-pinned doctrine and structured output contract reach the model. Runtime gates reject stale/invalid evidence, changed measurements/identity, false feed claims, invented evidence, excessive confidence, conservative execution-policy matches, malformed JSON, and provider failure. Scenarios use evidence enums instead of executable prose; the model has no tools or broker route; stored interpretations use runtime-owned path-safe IDs.
- Evaluation: the scripted model passes a 6/6 deterministic rubric. The real-provider harness reached both configured Runner connections, but their credentials were unavailable to the headless process; no authenticated model result or quality claim exists.
- Paced replay: `market.replay_batch`, `market.replay_next`, and `market.cancel` are typed through contracts, client, real Python stdio, and Electron supervision. Pulls serialize per replay for natural backpressure; deadlines/cancellation interrupt waits without crashing the process; active sessions are capped at 64; final batch identity/checksum must match every emitted event.
- Measured JSONL policy: the real Darwin ARM64/Python 3.12.9 child sustained 966–978 events/sec in two observation trials at the protocol's fastest 1 ms pace; this is not claimed as raw transport capacity. A 750-event completion was 713,568 bytes; 800 was 761,067 bytes; 10,000 was 9,608,099 bytes. Replay completion and direct load now reject estimated responses above 750,000 bytes with typed `STREAMING_TRANSPORT_REQUIRED`; Electron's hard frame ceiling remains 1,000,000 bytes. Replay-next timeouts are pace-aware, so valid intervals above the default 5-second control timeout remain supported.
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

1. Run the real-provider harness after an approved credential is available and retain the scored receipt.
2. Add reconnect/gap/staleness and session-correctness gates.
3. Package the Python/Nautilus runtime after the delivery seam is stable.
4. Real visual success/cancel/failure smoke at the first desktop opportunity.
5. Actual packaged-app build/resource-layout smoke.

## Do Not Do Yet

- Do not merge unrelated upstream changes.
- Do not build dozens of agents or the final UI.
- Do not add brokers or live execution.
- Do not describe tests or builds as runtime verification.

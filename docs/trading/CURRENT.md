---
status: active
owner: team
last_verified: 2026-07-13
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-07-13
- Stage: Phase 1 canonical market data now powers the first specialist engine; Phase 0 still awaits real visual Electron smoke
- Current goal: add reference-based delivery of bounded market context to specialist agents
- Overall state: canonical emission, replay quality, fixture-only Python RPC, typed supervision, deterministic candles/context, and replay-only canonical Order Flow consumption are test-verified; agent delivery, paced replay/cancellation, packaged Python assets, the visual Electron path, and a built installer remain unverified
- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/trade-god-foundation`
- Branch: `codex/trade-god-foundation`
- Frozen base: `origin/main` at `e7e96be32a5be394aefaf5712bdd711b96ad9d15`
- Implementation head entering this slice: `3bdb38e6`

## Working Capability

`synthetic ES fixture -> Order Flow sidecar -> validated artifact -> typed client -> Electron supervisor/IPC/preload -> Trade God workbench`

`project-owned ES records -> isolated Python 3.12 sidecar -> Nautilus 1.230.0 TradeTick objects`

`market.load_fixture -> fixed project fixture -> validated canonical batch or typed quality error`

`validated canonical batch -> no-lookahead watermark -> current price + closed candle history + one developing candle`

`market state -> bounded/checksummed analysis-only agent snapshot -> future specialist consumers`

`real supervised Python market child -> canonical batch -> real supervised Order Flow child -> order-flow-artifact@2 + trade-run-receipt@2`

The workbench can request engine health, run the known fixture, and display total volume, buy/sell volume, delta, POC, quality, trace ID, checksums, producer identity, and failures.

## Recently Completed

- Established the isolated RunnerOS worktree without modifying the other 23 protected worktrees.
- Added versioned trading contracts and a project-owned deterministic ES fixture/testkit.
- Added the standalone Order Flow JSON-RPC sidecar and typed trading client boundary.
- Added Electron process supervision, constrained lifecycle, narrow local IPC, runtime resolution, preload exposure, and quit disposal.
- Added the typed `trade-god` route, command navigation entry, and diagnostic workbench.
- Added a self-contained packaged Order Flow sidecar build, packaged-source resolution, bundled-Bun selection, and packaged Electron bootstrap registration.
- Defined crash policy: never replay failed work; restart only on the next explicit request.
- Verified partial stdout-frame assembly.
- Added cooperative active cancellation inside the Order Flow handler and concurrent stdio request processing so cancel commands are not blocked behind running analysis.
- Exposed caller-owned cancellation IDs through the typed client, supervisor, narrow IPC/preload contract, shared Electron API, and workbench Run-to-Cancel control.
- Added atomic local run receipts joining fixture request, trace ID, artifact ID/content hash, timestamps, and outcome under Runner's user-data directory.
- Added supervisor-owned trace IDs and structured `analysis_started/succeeded/failed/canceled` main-process logs, completing the request/log/artifact/receipt audit chain.
- Audited 42 starred trading repositories and documented the integration strategy.
- Pinned NautilusTrader `1.230.0` and the local Python `3.12.9` interpreter in a separately locked market-data sidecar.
- Converted the four project-owned ES records into exact Nautilus `TradeTick` objects with stable instrument identity, prices, sizes, aggressor sides, trade IDs, and nanosecond timestamps.
- Added Nautilus-independent canonical market-trade event, quality-report, and bounded batch contracts with checked provenance, cross-field identity, reversible fixed-point values, JSON-safe extensions, and real canonical-output checksums.
- Ran an adversarial contract review and fixed negative-price rejection, empty defect states, impossible diagnostic counts, duplicate canonical source records, unsafe extensions, and placeholder golden checksums.
- Added deterministic Python emission of the complete four-event canonical batch; Python output equals the TypeScript-owned golden and produces the same SHA-256.
- Added fail-closed source checksum/count validation, visible duplicate exclusion, visible out-of-order degradation, and a single checksum-verified source-bytes input.
- Completed typed quality outcomes for malformed payloads/records, invalid timestamps, non-positive sizes, off-tick prices, unsupported aggressors, invalid instruments, and all-rejected batches without leaking raw parser/Nautilus errors.
- Added a replay-only Python JSON-RPC process with health, explicit capabilities, fixed-fixture loading, typed data-quality errors, and clean shutdown.
- Prevented RPC callers from supplying paths/manifests, explicitly denied live/broker/execution authority, rejected non-standard JSON numbers, and bounded request-id caching.
- Added typed market-data health/capability/error/load contracts and a `MarketDataClient` that rejects malformed, identity-mismatched, or unsafe responses before consumers see them.
- Added a reusable bounded JSONL sidecar process supervisor that distinguishes timeout, exit, and protocol corruption and correctly limits each frame even when multiple responses share one stdout chunk.
- Added `MarketDataSidecarManager`, real Python process tests, development launch resolution, lazy Electron-main runtime wiring, and clean joint disposal. Packaged mode intentionally exposes no market-data manager until Python assets exist.
- Added versioned candle/series contracts with exact fixed-point OHLC, side volume, delta, provenance, state, watermark, and explicit Unix-epoch alignment.
- Added a provider-independent replay engine that verifies canonical checksums, rejects live/invalid data, sorts event time deterministically, deduplicates retries across traces, enforces no lookahead, and never invents empty candles.
- Wired `loadFixtureSnapshot` through the supervised manager so the real pipeline returns current price, closed history, and a developing candle. Synchronous desktop replay is capped at 64 batches and 10,000 total events.
- Added `agent-market-snapshot@1`: current price, bounded recent trades/candles, freshness, aggregated quality, exact batch/checksum provenance, explicit truncation, and a content checksum.
- Hard-coded snapshot authority to analysis only with execution/order submission false, added stored-context integrity verification, and covered fresh, stale, degraded, truncated, and no-data states.
- Wired `loadFixtureAgentSnapshot` through the real supervised market-data manager. The artifact exists for consumers; no specialist or head-agent router consumes it yet.
- Added `trade.analyze_market_batch`, a provider-neutral replay-only Order Flow boundary that accepts canonical batches, independently verifies their checksum, uses exact mixed-precision arithmetic, tracks unknown-side volume, and emits `order-flow-artifact@2`.
- Added `CanonicalOrderFlowPipeline` and proved the real Python market-data child feeds the real supervised Order Flow child without Nautilus/provider objects entering the calculator.
- Added canonical `trade-run-receipt@2`, strict client-side artifact/provenance checks, bounded hashed request caching, pre-parse JSONL size rejection, and fail-closed live/corrupt input behavior.

## Next Actions

1. Add a versioned context-delivery seam for specialist agents with receipt/reference identity rather than prompt copying.
2. Route `agent-market-snapshot@1` by reference into the first specialist while keeping deterministic Order Flow on full canonical batches.
3. Add paced replay/cancel lifecycle semantics before increasing the 10,000-event control-path bound.
4. **Required at first possible desktop opportunity:** visually smoke Trade God Ready, fixture `28 / 6 / 5592.25`, cancellation, and one visible failure.
5. Build and smoke the packaged installer separately.
6. Review the 15 upstream-only v0.11.1 commits separately; do not merge them blindly.

## Blockers / Decisions Needed

- Physical access or reliable Computer Use access for the real visual Electron smoke.

The Phase 0 fixture, transport, contracts, worktree, and initial Nautilus compatibility policy are no longer open blockers. Phase 1 canonical market contracts are active work, not an external blocker.

## Verification State

- Complete fast Trade God suite: 62 passed, 0 failed, 150 expectations across 12 files.
- Electron `build:main`, `build:preload`, and `build:renderer` passed.
- The generated packaged sidecar bundle launched independently and answered a schema-valid health request.
- Packaged root selection, bundled-Bun selection, partial frames, and next-request restart behavior passed focused tests.
- Active cancellation passed from typed client through sidecar boundaries; the workbench control is build-verified but not visually smoked.
- Receipt-focused verification: 23 passed, 0 failed across contract, atomic store, supervisor, and runtime tests.
- The prior complete 62-test suite remains the latest full-suite result; a new combined closure command hung in the tool layer and was stopped, so no larger full-suite count is claimed.
- Audit-chain focused suite: 17 passed, 0 failed, 31 expectations; Electron `build:main` passed.
- Phase 1 Nautilus fixture adapter: 1 passed, 0 failed. Runtime proof: Python `3.12.9`, NautilusTrader `1.230.0`, Darwin ARM64.
- Red-green proof: the adapter test first failed on the absent module, then passed after implementation.
- Phase 1 canonical contracts: 20 passed, 0 failed across the complete contract package; standalone contract typecheck passed.
- Contract `$rival` findings were reproduced with failing tests, fixed, and re-verified.
- Phase 1 Python canonical adapter: 5 passed, 0 failed; full Python output equals the TypeScript golden and checksum.
- Adapter `$rival` findings fixed: false-valid source data and split-brain `bytes` versus `records` inputs.
- Phase 1 completed quality matrix: 9 passed, 0 failed, including typed malformed and all-rejected paths.
- Phase 1 market-data RPC: 7 passed, 0 failed; complete Python sidecar suite: 16 passed, 0 failed.
- Python RPC proof includes a real child process over stdin/stdout, strict parse failure, dependency-aware health, and clean shutdown.
- Typed market-data client/Electron supervision slice: 39 passed, 0 failed, 79 expectations across six files; production Electron main build passed.
- A real Python child process was supervised through health, exact canonical load, typed failure recovery, and clean shutdown. Timeout, crash, oversized protocol frames, and coalesced valid frames are distinguishable/tested at the generic process boundary.
- Replay/candle slice: 41 passed, 0 failed, 95 expectations across five files; contract and market-state standalone typechecks passed; Electron main build passed.
- Real supervised fixture-to-candle proof: current price `5592.00`; one closed 20-second candle and one developing candle at the `15:30:30` watermark. This is deterministic control-path proof, not live streaming.
- Agent snapshot closure: 46 passed, 0 failed, 126 expectations across five files; contract and market-state typechecks and Electron main build passed.
- Supervised context proof returns two of four recent trades, one closed candle, the developing candle, fresh state, mapped source/canonical checksums, and analysis-only authority. No real agent has consumed it yet.
- Canonical Order Flow closure: 64 passed, 0 failed, 137 expectations across ten focused files; contract and market-state typechecks, Electron main build, packaged Order Flow sidecar build, and self-contained bundle health test passed.
- Real process proof: the supervised Python/Nautilus fixture path emitted a canonical batch consumed by the supervised Order Flow child, producing exact `28 / 17 / 11 / 6 / 5592.25` output plus a trace-linked v2 receipt.
- Adversarial fixes verified: bounded hashed request cache, bounded pre-cancel state, pre-parse JSONL frame limit, complete client provenance checks, mixed-precision/unknown-side math, lower-price POC tie resolution, and live/corrupt input rejection.
- Windows and Linux Nautilus runtime/package smoke remain unverified.
- Frozen-lockfile install passed; focused RunnerOS control-plane baseline passed: 232 tests, 0 failures.
- Full monorepo typecheck remains blocked by a recorded pre-existing campaign-calendar error at `packages/shared/src/campaign-calendar/index.ts:632`.
- Standalone package TypeScript checking remains unverified because two prior invocations hung in the tool layer and were stopped.
- Real Electron interaction and a fully built packaged installer are not yet verified.
- Canonical Python emission, replay quality, fixture RPC, typed supervision, bounded deterministic candles/context, and replay-only canonical Order Flow consumption are implemented; paced replay/cancel, packaged Python assets, and agent-delivery routing remain unimplemented.

## Explicitly Not In Scope Yet

- Live broker connectivity, order placement, or autonomous execution.
- Production order-flow intelligence or real-time tick streaming.
- Full agent roster, charting workspace, or generalized plugin marketplace.
- Broad donor-code porting without license, provenance, and boundary review.

## Notes for the Next Agent

Read this file, `HANDOFF.md`, the Phase 0 spec, and `development/VERIFICATION.md`. Do not call bundle-level proof an installed-app smoke. At the first reliable desktop opportunity, verify Ready, run the fixture, confirm `28 / 6 / 5592.25`, and force one visible failure.

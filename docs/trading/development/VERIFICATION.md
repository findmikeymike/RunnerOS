---
status: active
owner: team
last_verified: 2026-07-13
source_of_truth: true
---

# Verification System

## Evidence Ladder

1. Static: formatting, schema generation, typecheck.
2. Unit: pure domain and calculation behavior.
3. Contract: producer/consumer compatibility and invalid payload rejection.
4. Integration: real process/transport/storage boundary with fixture.
5. Runtime: Electron path exercised in the intended worktree/process.
6. Failure: timeout, cancellation, crash, stale data, schema skew, restart.
7. Evaluation: quality, calibration, abstention, leakage, and regression.
8. Safety: permission, risk, idempotency, reconciliation, kill switch.

A lower rung does not prove a higher rung.

## Required Proof Record

```markdown
### YYYY-MM-DD — Capability / Spec ID
- Worktree/branch/commit:
- Environment/mode:
- Fixture/data provenance:
- Versions:
- Commands/actions:
- Expected:
- Actual:
- Artifact/receipt/trace ID:
- Failures tested:
- Result: pass | partial | fail
- Remaining proof:
```

## Phase 0 Gate

- Contract schemas generate and validate.
- Golden fixture returns byte-equivalent or semantically canonical artifact.
- Invalid schema/version is rejected with a typed error.
- Sidecar exposes health and capabilities.
- Timeout and cancellation terminate work safely.
- Sidecar crash is surfaced and restart behavior is known.
- Electron displays health, result, and error state through the real IPC path.
- Trace ID connects UI request, client, sidecar, artifact, and log.
- No secret or broker capability exists in the slice.

## Foundation Baseline — 2026-07-11

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/trade-god-foundation`
- Branch: `codex/trade-god-foundation`
- Base: `e7e96be32a5be394aefaf5712bdd711b96ad9d15`
- Dependency install: passed from frozen lockfile; zero vulnerabilities reported.
- Focused control-plane tests: 232 passed, 0 failed.
- Full typecheck: baseline failure in `packages/shared/src/campaign-calendar/index.ts:632` (`findLast` target library and implicit `any`).
- Isolation audit: all 23 protected pre-existing worktrees remained byte-identical in branch/status/HEAD output.
- Runtime/Electron smoke: not yet run; a development runtime now exists but has not been exercised through the real Electron user path.

## Phase 0 Slice 1 — Contracts and Deterministic Fixture

- Method: strict red-green TDD; both suites were observed failing on missing/unimplemented behavior before implementation.
- `packages/trading-contracts/tests/contracts.test.ts`: 8 passed.
- `packages/trading-testkit/tests/fixture-analysis.test.ts`: 4 passed.
- Combined focused run: 12 passed, 0 failed, 22 expectations.
- Proven: same-major protocol compatibility, health/capability validation, no live-order capability, decimal-string market metadata, artifact provenance/quality/content hash, typed errors, project-owned fixture checksum, altered-byte rejection, deterministic volume/delta/POC summary, repeatability.
- Not proven: standalone package TypeScript check. Two invocations hung in the command/tool layer and were interrupted; do not report typecheck success.
- At this slice boundary the JSON-RPC sidecar was not built; see Slice 2. Process supervision, typed client, and Electron IPC/UI remain unbuilt.

## Phase 0 Slice 2 — Standalone Order Flow Sidecar

- Method: red-green TDD; handler and stdio suites failed on missing/unimplemented behavior before implementation.
- Handler suite: 7 passed.
- Spawned stdio process suite: 1 passed with 6 expectations.
- Complete fast Phase 0 suite after implementation: 20 passed, 0 failed, 39 expectations.
- Proven: ready fixture-only health, explicit capability list without execution, schema-valid analysis artifact, trace propagation, identical duplicate response caching, conflicting duplicate-ID rejection, cancellation-before-start, method-not-found isolation, parse-error recovery, stdout-only protocol framing, clean stderr, and graceful shutdown.
- Not proven: cancellation during active computation, deadline timeout behavior through the process, oversized/partial frames, process crash/restart, trace mismatch rejection by a client, Electron supervision, or UI.

## Phase 0 Slice 3 — Typed Trading Client

- Method: red-green TDD; four client tests failed on the deliberate unimplemented stub before implementation.
- Client suite: 4 passed.
- Complete fast Phase 0 suite: 24 passed, 0 failed, 44 expectations across five files.
- Proven: typed health and analysis through the client boundary, protocol validation, generated request/trace/cancellation IDs, deadline construction, result-schema validation, response-ID validation, trace-mismatch rejection, malformed-success rejection, and typed domain-error normalization.
- Architectural effect: agents and UI now have one supported capability seam and do not need direct sidecar/provider imports.
- Not proven: process transport implementation inside the client, deadline enforcement against a stalled process, Electron supervision, restart, IPC, or renderer behavior.

## Phase 0 Slice 4 — Electron Sidecar Supervision

- Method: red-green TDD; three supervision tests failed on the deliberate unimplemented stub before implementation.
- Supervisor suite: 5 passed with 12 expectations.
- Complete fast Phase 0 suite: 29 passed, 0 failed, 56 expectations across six files.
- Proven: Electron-main-compatible child spawning, constrained environment, lazy startup, real health/analysis round trip, request correlation, deadline timeout, silent-child termination, pending-request rejection on crash, bounded stderr capture, oversized-line fail-closed behavior, and graceful shutdown with forced fallback.
- A clock mismatch was caught during green verification: the fixed historical client clock produced an honestly expired deadline against the real sidecar clock. The test clock was aligned; deadline enforcement was preserved.
- Oversized stdout and bounded stderr were added through their own red-green cycle after removing the initially untested implementation.
- Not proven: packaged Electron path resolution, automatic restart policy, IPC registration, renderer behavior, or real Electron smoke.

## Phase 0 Slice 5 — Narrow Local IPC Contract

- Method: red-green TDD; two IPC tests failed on the deliberate unimplemented stub before implementation.
- IPC suite: 2 passed with 6 expectations.
- Complete fast Phase 0 suite: 31 passed, 0 failed, 62 expectations across seven files.
- Proven: only health and fixture-analysis handlers are registered, calls delegate to the supervised typed boundary, disposal removes both handlers, and repeated disposal stops the manager exactly once.
- Boundary decision: Trade God remains a local desktop capability rather than entering RunnerOS remote workspace RPC routing.
- Not proven: registration from the real Electron bootstrap, preload exposure, app-termination lifecycle, renderer behavior, or real Electron smoke.

## Phase 0 Slice 6 — Runtime and Path Resolution

- Method: red-green TDD; runtime tests failed on the missing module before implementation.
- Runtime suite: 2 passed with 4 expectations.
- Complete fast Phase 0 suite: 33 passed, 0 failed, 66 expectations across eight files.
- Proven: explicit RunnerOS root resolution, real sidecar launch and health through registered IPC, disposal cleanup, and clear failure when no entrypoint exists.
- Not proven: packaged asset copy/bundle, real main-index invocation, preload exposure, app termination, renderer behavior, or Electron smoke.

## Phase 0 Slice 7 — Electron Main and Preload Wiring

- Method: preload adapter was added through red-green TDD; main-index startup/quit edits are thin configuration wiring around already-tested runtime/disposal behavior.
- Complete fast Phase 0 suite: 34 passed, 0 failed, 69 expectations across nine files.
- `apps/electron` `build:preload`: passed; generated bundle 842.9 KB.
- `apps/electron` `build:main`: passed; generated bundle 23.1 MB.
- Proven: development-only runtime registration, explicit root/runtime selection, exactly two preload methods, and quit-time disposal wiring compile into Electron bundles.
- Safety: packaged initialization is disabled until a packaged sidecar asset exists.
- Not proven: renderer behavior, packaged sidecar, automatic restart, or real Electron smoke.

## Phase 0 Slice 8 — Diagnostic Workbench

- Method: route and renderer shell were added through focused red-green tests.
- Complete fast Trade God suite: 53 passed, 0 failed, 129 expectations across 11 files.
- Route parser suite: 18 passed, 0 failed, 56 expectations.
- Workbench static-render suite: 1 passed, 0 failed, 4 expectations.
- `apps/electron` `build:renderer`: passed; warnings were limited to existing dependency/chunk notices.
- Proven: typed `trade-god` route parsing, command navigation entry, diagnostic shell rendering, and production renderer compilation. The implemented page requests health, runs the known fixture, and renders summary, provenance, quality, trace, and failure state through the two preload methods.
- Not proven: actual Electron launch, live click-path behavior, visual correctness, forced runtime failure behavior, packaged sidecar resolution, or restart policy.

## Phase 0 Slice 9 — Packaged Sidecar and Supervisor Policy

- Method: packaged resolution, artifact build, host selection, partial-frame handling, and restart policy were each introduced through focused failing tests before implementation/fixtures.
- Complete fast Trade God suite: 58 passed, 0 failed, 138 expectations across 12 files.
- `trade-god:build-sidecars`: passed and emitted `apps/electron/dist/trade-god/order-flow-engine.mjs`.
- Packaged artifact integration test: launched the self-contained bundle with Bun and received schema-valid ready health.
- Electron `build:main`, `build:preload`, and `build:renderer`: passed.
- Proven: source-versus-packaged entrypoint resolution, packaged app-root isolation, bundled-Bun selection, packaged bootstrap registration compiling into main, split stdout-frame assembly, and restart-on-next-explicit-request after a crash without replaying failed work.
- Policy: a crashed request fails visibly and is never automatically replayed; a later explicit request may start a fresh sidecar process.
- Not proven: electron-builder installer/resource layout, installed packaged-app execution, real visual workbench interaction, active-computation cancellation, or trace-to-persisted-receipt joining.

## Phase 0 Slice 10 — Active Sidecar Cancellation

- Method: handler and real stdio cancellation tests were observed failing before implementation.
- Complete fast Trade God suite: 60 passed, 0 failed, 145 expectations across 12 files.
- Packaged sidecar rebuild: passed.
- Electron `build:main`: passed.
- Proven: a cancellation ID can abort injected work already running, cancellation during fixture preparation is honored, the analysis returns a typed non-retryable `CANCELED` error, the handler remains healthy, and concurrent stdio processing allows cancellation to overtake an in-flight analysis request.
- Not proven: cancellation initiated from the typed client or workbench, forced cancellation of non-cooperative synchronous donor algorithms, or visual cancellation state.

## Phase 0 Slice 11 — Typed Workbench Cancellation Control

- Method: contract, client, IPC, and preload tests were observed failing before implementation.
- Complete fast Trade God suite: 62 passed, 0 failed, 150 expectations across 12 files.
- Packaged sidecar rebuild and Electron main/preload/renderer builds: passed.
- Proven: traceable cancellation acknowledgement schema, caller-owned cancellation ID, typed client cancel command, supervisor delegation, exactly three local IPC/preload capabilities, shared Electron API typing, and compiled Run-to-Cancel workbench state.
- Not proven: visual click-path cancellation in real Electron or forced cancellation of non-cooperative synchronous donor algorithms.

## Phase 0 Slice 12 — Persistent Run Receipts

- Receipt-focused suite: 23 passed, 0 failed, 37 expectations across four files.
- Proven: versioned receipt schema; atomic restrictive-permission JSON persistence; successful receipt joining fixture request, trace ID, artifact ID/content hash, timestamps, and outcome; runtime storage under `<userData>/trade-god/run-receipts/`.
- The attempted combined full-suite/main-build closure command hung in the tool layer and was stopped. Do not infer a new full-suite count or main-build result from this slice.
- Not proven: trace-correlated log record, visual receipt display, retention/indexing policy, or failure/cancellation persistence through a spawned end-to-end runtime.

## Phase 0 Slice 13 — Trace-Correlated Audit Logging

- Focused suite: 17 passed, 0 failed, 31 expectations across client, supervisor, and runtime tests.
- Electron `build:main`: passed.
- Proven: supervisor-owned trace before analysis starts; caller trace propagation through the typed client; structured start/success/failure/canceled log events; matching artifact and receipt trace; receipt/artifact identifiers in success logs.
- Not proven: visual user path, packaged installer, log retention/search UX, or a spawned failure/cancellation receipt audit.

## Phase 1 Slice 1 — Pinned Nautilus TradeTick Boundary

- Environment: isolated sidecar `.venv`, Python `3.12.9`, NautilusTrader `1.230.0`, Darwin ARM64.
- Dependency declaration: exact Nautilus version, local Python `3.12.9` pin, compatible Python 3.12 range in `pyproject.toml`, and full graph in `uv.lock`.
- License recorded from upstream package metadata: `LGPL-3.0-or-later`.
- Method: red-green TDD; the unit test first failed because `trade_god_market_data.fixture_adapter` did not exist.
- Focused suite: 1 passed, 0 failed.
- Proven: four project-owned ES records become Nautilus `TradeTick` objects with exact `ESU6.XCME` identity, decimal prices/sizes, aggressor sides, sequence trade IDs, and deterministic UTC nanosecond timestamps.
- Boundary: no Nautilus import was added to Trade God contracts, Electron, Order Flow, or agent code.
- Not proven: Windows/Linux runtime packaging, canonical Trade God market events, quality report, replay checksum, sidecar protocol, failure matrix, or Order Flow consumption.

## Phase 1 Slice 2 — Canonical Market-Data Contracts

- Method: red-green TDD plus `$rival`/`$fix`; missing exports failed first, then five adversarial test groups reproduced the review findings before repair.
- Complete contract package: 20 passed, 0 failed, 34 expectations across two files.
- Standalone `packages/trading-contracts` typecheck: passed.
- Golden examples: market-trade event, quality report, and bounded replay batch parse and agree exactly.
- Proven: nanosecond timestamps remain strings; price/size fixed-point values round-trip; negative prices are supported while size remains positive; event/batch/quality trace, instrument, counts, source, range, and checksums agree; canonical source records are unique; extension data is JSON-safe; the JSON control batch is capped at 10,000 events.
- Canonical checksum: real SHA-256 over sorted-key, no-whitespace UTF-8 JSON for the ordered event array.
- Boundary: the TypeScript contracts contain no Nautilus import.
- Not proven: Python emits these contracts, Python and TypeScript produce the same checksum, quality policies execute on bad records, replay reaches Order Flow, or candles/history exist.

## Phase 1 Slice 3 — Cross-Language Canonical Adapter

- Method: red-green TDD plus `$rival`/`$fix`; missing Python exports failed first, then false-valid quality and split-brain source inputs were identified and repaired.
- Python adapter suite: 5 passed, 0 failed.
- TypeScript contract suite after golden expansion: 20 passed, 0 failed.
- Proven: the full four-record source bytes become Nautilus ticks, canonical events, quality report, and bounded batch; Python output equals the TypeScript-owned golden object; both languages produce SHA-256 `bd90ebcf629d2fae7ffaec70f49f09caf85bc91f533ea69365ff2e5959efa05b`.
- Quality proven: source checksum mismatch fails closed with an invalid typed report; manifest count mismatch is fail-closed in code; duplicate source identities are excluded and counted; out-of-order accepted events are retained, flagged, and degrade the batch.
- Input integrity: records are parsed only from the checksum-verified bytes, so callers cannot validate one payload and emit another.
- Not proven: malformed JSON/record typing, invalid timestamp/size/precision/instrument reporting, sidecar RPC, Order Flow replay, candles, or historical storage.

## Phase 1 Slice 4 — Replay Quality Matrix

- Method: red-green TDD plus adversarial fail-closed review.
- Python adapter suite: 9 passed, 0 failed.
- Proven degraded outcomes: duplicate source identities are excluded; out-of-order events remain visible; malformed records, invalid timestamps, non-positive sizes, off-tick prices, and unsupported aggressors are rejected while valid records remain usable.
- Proven invalid outcomes: source checksum/count mismatch, checksum-verified malformed JSON/non-array payloads, invalid instrument metadata, and all-rejected batches raise `FixtureQualityError` with the actual typed quality report.
- Validation order: checksum rejection occurs before parsing untrusted bytes; canonical records derive only from verified bytes.
- Not proven: RPC framing/cancellation/crash behavior for the Python sidecar, Order Flow consumption, candles, or historical storage.

## Phase 1 Slice 5 — Fixture-Only Market-Data RPC

- Method: red-green TDD plus `$rival`/`$fix`; the focused suite first failed on the missing RPC module.
- Focused RPC suite: 7 passed, 0 failed. Complete Python market-data suite: 16 passed, 0 failed.
- Proven: newline-delimited JSON-RPC framing in a real child process; checksum-aware dependency health with degraded state; explicit replay-only capabilities; exact golden canonical batch loading; typed quality-error propagation; strict rejection of `NaN`/`Infinity`; bounded idempotency cache; duplicate request-id protection; clean shutdown.
- Input authority: RPC clients supply only fixture, trace, and batch IDs. The supervisor configures the fixture directory; caller paths and manifests are unreachable.
- Safety: capabilities explicitly deny live data, broker access, and trade execution.
- Not proven: Electron supervision, cancellation, crash classification/restart policy, replay pacing, Order Flow consumption, candles, or historical storage.

## Phase 1 Slice 6 — Typed Client and Electron Supervision

- Method: red-green TDD plus `$rival`/`$fix`; missing contracts/client/manager failed first, then coalesced-frame limits, extensible known capabilities, invalid outbound identities, and dependency truth were reproduced and repaired.
- Focused slice: 39 passed, 0 failed, 79 expectations across contract, client, generic process, market manager, and runtime tests.
- `apps/electron` `build:main`: passed.
- Proven contracts: replay-only capabilities deny live/broker/execution authority, allow only known v1 commands, and can add `replay_batch`/`cancel` without silently accepting order methods.
- Proven client boundary: response ID, schema, batch/trace/fixture identity, and typed errors validate before consumers receive data; invalid outbound identifiers never reach transport.
- Proven process boundary: real Python health/load/error/shutdown; bounded per-line framing; coalesced frames; timeout versus exit versus oversized protocol corruption; clean disposal.
- Runtime truth: a valid local `.venv` is discovered and wired lazily in development. Packaged mode deliberately has no market-data manager until Python assets are bundled and smoke-tested.
- Not proven: replay pacing, active cancellation, cancellation-versus-crash behavior in the market sidecar, packaged Python, Order Flow consumption, candles, or historical storage.

## Phase 1 Slice 7 — Deterministic Replay and Candle History

- Method: red-green TDD plus `$rival`/`$fix`; missing candle contracts/engine failed first, then client checksum coverage, explicit alignment, invalid-quality rejection, retry trace dedupe, provenance consistency, and synchronous scale bounds were added.
- Focused closure: 41 passed, 0 failed, 95 expectations across five files.
- Standalone `packages/trading-contracts` and `packages/trading-market-state` typechecks: passed.
- `apps/electron` `build:main`: passed.
- Proven: real supervised fixture -> checksum-verified canonical batch -> current price -> ordered closed candles + at most one developing candle.
- Integrity: event-time sort is deterministic; equal timestamps break by event ID; events beyond the watermark never affect state; final candles close only after the watermark reaches their exclusive end; repeated events across replay traces deduplicate; conflicting content, live mode, and invalid-quality batches fail closed.
- Exact math: OHLC comparisons and volume/delta aggregation use fixed-point `BigInt`, not floating point. Volume equals buy + sell + unknown and delta equals buy - sell.
- Alignment/gaps: v1 candles explicitly align to Unix-epoch intervals and do not synthesize empty candles; detected interior gaps carry `missing-candle-interval`.
- Runtime bound: synchronous Electron-main replay is capped at 64 batches and 10,000 total events. Larger/paced streams require the later replay/cancel worker or transport.
- Not proven: session-aligned/daily candles, persistent catalog/history, live streaming, paced replay/cancel, agent snapshots, Order Flow consumption, or packaged Python runtime.

## Phase 1 Slice 8 — Bounded Agent Market Snapshot

- Method: red-green TDD plus `$rival`/`$fix`; missing contract/builder/manager methods failed first, then batch-checksum mapping, no-data context, content integrity, current trade/candle agreement, provenance linkage, and issue-count truncation were tightened.
- Focused closure: 46 passed, 0 failed, 126 expectations across five files.
- Standalone contract and market-state typechecks: passed. Electron main build: passed.
- Proven artifact: `agent-market-snapshot@1` contains bounded recent trades, recent closed candles, developing candle, current price/event, freshness threshold/age, aggregate quality/counts/issues, mapped source/canonical checksums, truncation counts, and deterministic content hash.
- Authority: purpose is statically `analysis`; execution and order submission are statically false in the contract and emitted artifact.
- Context states: fresh, stale, and pre-first-event no-data behavior are tested. Larger trade/candle/issue requests fail before payload construction.
- Integrity: `assertAgentMarketSnapshotIntegrity` reparses and recomputes the content checksum, returning the stripped validated artifact for safe storage/passage.
- Runtime: the real supervised Python fixture can produce the agent snapshot through `MarketDataSidecarManager.loadFixtureAgentSnapshot`.
- Not proven: delivery to an actual head/specialist agent, context-store persistence/reference lookup, Order Flow consumption, live data, paced replay/cancel, packaged Python, or visual UI.

## Trading-Specific Integrity Tests

- Event time is distinct from receive/process time.
- No future information enters historical analysis.
- Session and timezone behavior crosses DST boundaries correctly.
- Duplicates and out-of-order inputs are deterministic.
- Missing intervals and stale feeds are flagged, not silently interpolated.
- Tick size, multiplier, currency, and price precision are explicit.
- Futures rollover/corporate action assumptions are encoded where relevant.
- Fees, slippage, latency, and fill assumptions are explicit in backtests.

## Completion Language

Use exact claims:

- “Implemented” means code exists.
- “Tests pass” means named automated checks passed.
- “Runtime verified” means the real user path was exercised.
- “Evaluated” means a recorded dataset and metric were used.
- “Safe for paper/live” requires the corresponding safety gate.

Never collapse these into “done.”

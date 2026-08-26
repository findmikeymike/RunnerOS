---
status: active
owner: team
last_verified: 2026-08-26
source_of_truth: true
---

# Verification System

## 2026-08-26 Options Autopilot Slice 2 — Parser, Resolver, Policy

- Red-green proof: parser and policy suites first failed on missing exports,
  then passed after pure brokerless implementation.
- Options-focused result: 28 passed, 0 failed, 94 expectations.
- Complete contract package: 65 passed, 0 failed, 164 expectations.
- Complete execution package: 204 passed, 0 failed, 648 expectations.
- `bun run typecheck:all`: passed.
- `git diff --check`: passed.
- Proven: exact long-call/put parsing with raw Discord lineage; explicit range
  ceilings; source quantity retained only as evidence; multi-leg, short,
  conditional, conversational, contradictory, incomplete, and invalid-calendar
  refusal; exact resolver response comparison; deterministic session/DTE,
  freshness, quote, spread, drift, size, fee, debit, and policy gates; bounded
  marketable/passive limits; and provider price-band tick enforcement.
- Rival fixes closed runtime artifact revalidation, invalid dates, duplicate
  contract/price interpretations, account-size timing, off-tick quote behavior,
  provider-versus-adapter identity coupling, future-resolved evidence, and
  integer-premium formatting.
- Not proven: durable route/source storage, account reservations, provider
  preview or submission, IBKR/Webull connectivity, renderer UI, Electron
  runtime, or any broker mutation.

## 2026-08-26 Options Autopilot Slice 1 — Contracts and Simulator

- Red-green proof: the focused suites first failed on the absent options
  contracts and simulator exports, then passed after implementation.
- Options-focused result: 14 passed, 0 failed, 53 expectations.
- Complete contract package: 65 passed, 0 failed, 162 expectations.
- Complete execution package: 190 passed, 0 failed, 609 expectations.
- `bun run typecheck:all`: passed.
- `git diff --check`: passed.
- Proven: versioned single-leg Discord evidence; exact standard option identity;
  quote chronology/mode integrity; paper-only entry-policy bounds; fee-inclusive
  decision, reservation, preview, intent, and receipt economics; six-place
  fixed-point arithmetic; exact tick rounding; and an idempotent deterministic
  fake provider covering contract ambiguity, preview, submit, partial fill,
  cancel, account truth, and client-order divergence.
- Rival fixes closed immutable Discord lineage omissions, zero/crossed quote
  acceptance, unsafe spread/0DTE policy modes, contradictory economic totals,
  nonpositive/off-tick simulator mutation, and incomplete receipt evidence.
- Not proven: Discord parsing, live contract resolution, IBKR/Webull connection,
  provider authentication, provider preview/order transport, durable gateway
  recovery, UI, real Electron runtime, or any broker order.

## 2026-08-10 Automatic Paper Mandate Coordinator

- Broad trading/Electron gate: 244 passed, 0 failed across 42 files.
- `bun run typecheck:all`: passed.
- Electron `build:main`, `build:preload`, and `build:renderer`: passed.
- `git diff --check`: passed.
- Proven locally: one durable standing mandate per account; restart persistence;
  explicit activation/revocation; exact active supported contracts; positive
  open-risk/daily-loss limits; ten-contract ceiling; four-hour maximum; no
  coordination without an attached adapter, released global halt, and active
  mandate; risk denial; mandate replacement/revocation invalidation; and full
  canonical mandate equality before execute.
- Rival regression proof covers revocation during risk evaluation and same-ID
  limit replacement during the final mandate read. Neither reaches execute.
- Runtime truth remains fail-closed: desktop startup supplies zero adapters, so
  a saved mandate and released halt still leave signed tickets at `created`.
- Not proven: real Tradovate authentication/token refresh, attached paper
  adapter, provider order, continuous reconciliation, partial-close protection
  resize, crash soak, or 50 clean paper lifecycles.

## 2026-08-10 Discord Execution Safety Closure

- Trade God/trading/security suite excluding the two ephemeral-port suites:
  321 passed, 0 failed, 889 expectations across 47 files.
- Trigger receiver suite including encrypted-vault HMAC resolution: 30 passed,
  0 failed.
- TradingView alert receiver suite: 3 passed, 0 failed.
- Transport parity suite: 2 passed, 0 failed.
- Total relevant evidence: 356 passed, 0 failed across 50 files.
- `bun run typecheck:all`: passed after the safety changes.
- `git diff --check`: passed.
- Electron `build:main`, `build:preload`, and `build:renderer`: passed with the
  new Trade God bootstrap entry.
- Newly proven in this closure: independent supported-futures economic-loss
  calculation rejects upstream understatement; expired explicit contracts fail
  closed using both local month admission and Tradovate's exact maturity date;
  public/restart reconciliation shares the durable provider-account mutation
  lock with entries and management.
- The repo-wide `bun test` run exposed one unrelated ads-operator expectation
  failure (`public-meta-ad-library-browser` versus its current route). No Trade
  God test failed in that run. A combined parallel port suite also caused
  ephemeral-port contention; both affected server suites passed in isolation.
- Live isolated config repair: both `discotrader` and
  `discotrader-management` are enabled POST-only safe receivers using the same
  secret reference.
- Live vault isolation: the byte-identical Trade God copies of Artist OS
  `credentials.enc` and `credentials.key` were moved to
  `~/.trade-god/isolated-vault-quarantine/2026-08-11T04-02-12-935Z/`. Artist OS
  files remain in place; Trade God now requires fresh credential enrollment.
- Runtime containment closure: packaged identity is fixed to `~/.trade-god`,
  `tradegod://`, loopback port `9201`, and its own Electron profile. Startup
  rejects Runner roots, external or remote Runner workspaces, unreadable registry
  evidence, and config/workspace symlink escapes before importing main. New
  workspace RPCs accept identity only and atomically reserve an app-owned path.
  Logout, privileged-audit, config-validation, prompt, help, and server-volume
  paths are product-owned. The focused containment suite passed, the live
  registry passed the boundary probe, `typecheck:all` passed, and main/renderer
  builds completed. This does not prove a packaged installer launch.
- Not proven: installed packaged app, real Discord entry delivery after rebuild,
  Tradovate credential/token exchange, paper provider order lifecycle,
  multi-target execution, Mirror Groups, live browser DOM automation, crash
  soak, or 50-lifecycle provider certification.

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

## Phase 1 Slice 9 — Canonical Order Flow Consumption

- Method: typed boundary implementation followed by `$rival`/`$fix`; the adversarial pass found unbounded request retention, incomplete returned-provenance comparison, and an oversized frame parsed before its size gate.
- Focused closure: 64 passed, 0 failed, 137 expectations across ten contract, client, calculator, RPC/stdio, receipt, manager, packaged-bundle, and real-pipeline files.
- Build/type proof: standalone contract and market-state typechecks passed; Electron main build passed; the self-contained packaged Order Flow sidecar rebuilt successfully.
- Real process proof: supervised Python 3.12/Nautilus fixture emission -> checksum-verified canonical batch -> supervised Bun Order Flow sidecar -> `order-flow-artifact@2` -> `trade-run-receipt@2`.
- Exact output: 4 events, total `28`, buy `17`, sell `11`, unknown `0`, delta `6`, POC `5592.25`.
- Boundary: the calculator receives only normalized canonical event fields. Provider/Nautilus objects and fixture-file access are absent from the v2 request and artifact calculation.
- Integrity: client verifies content hash plus batch/schema/trace/checksum/source/mode/quality/event count/instrument/session/time/config identity. Corrupt checksums, live batches, unsupported configs, oversized frames, and malformed inputs fail closed.
- Exact math: mixed price/size precision, unknown aggressor volume, and deterministic lower-price POC tie resolution use fixed-point `BigInt` arithmetic.
- Resource bounds: request identities are stored as bounded hashes, pre-cancel state is bounded, and JSONL frames are rejected before parsing above the declared line limit.
- Not proven: installed Electron UI uses this new path, agent-context delivery, live streaming, packaged Python assets, or real visual behavior.

## Phase 1 Slice 10 — Hardened Runtime Path and Specialist Context References

- Method: `$rival` review followed by `$fix`, focused proof, then a second adversarial storage-boundary pass.
- Focused closure: 66 passed, 0 failed across 12 files.
- Type/build proof: contract, market-state, and Electron typechecks passed; Electron main, preload, and renderer production builds passed.
- Runtime hardening proven: the real Electron IPC route uses the canonical Python -> Order Flow pipeline; one caller deadline covers market loading and analysis; active work is aborted on deadline; duplicate cancellation IDs cannot steal ownership; stopped analysis is rejected; started/succeeded receipt identity is stable; contradictory receipt and v2 artifact fields fail schema validation; JSONL input is bounded before unbounded line buffering.
- Context contracts: `agent-context-reference@1` binds context/schema/snapshot/trace/instrument/checksum/authority identity; `agent-context-delivery-receipt@1` records reference-only queue and authorized resolution states.
- Storage/routing proof: a full integrity-checked `agent-market-snapshot@1` is atomically stored once under `<userData>/trade-god/agent-context/`; the addressed `order-flow-specialist` boundary receives only its reference; wrong-consumer, forged-reference, concurrent-publication, and path-traversal cases fail closed.
- Boundary: deterministic Order Flow still consumes the full canonical batch, never the truncated agent snapshot.
- Not proven: an actual LLM specialist session resolving the reference, typed specialist interpretation output, paced replay/cancel, packaged Python assets, installed Electron behavior, or visual UI smoke.

## Phase 1 Slice 11 — Pull-Based Paced Replay and Cancellation

- Method: contract-first lifecycle, real Python handler/CLI concurrency proof, typed client/Electron wiring, then adversarial deadline and capacity checks.
- Python sidecar suite: 21 passed, 0 failed.
- Focused TypeScript closure: 93 passed, 0 failed across 14 files.
- Proven protocol: `market.replay_batch` starts a bounded `market-replay-session@1`; `market.replay_next` returns one ordered `market-replay-step@1` event per pull and a checksum-verified canonical batch only after all events; `market.cancel` returns an addressed typed cancellation receipt.
- Backpressure: each replay serializes pulls and waits for the consumer before advancing; no unsolicited event stream or second transport was introduced.
- Failure truth: cancellation and deadline interrupt an active wait as typed `canceled`/`timeout` market-data errors while health remains ready. Sidecar exit remains `JsonlSidecarExitedError`, not a cancellation.
- Bounds: pace is 1–60,000 ms; active replay sessions are capped at 64; request identities remain bounded; the canonical batch remains capped at 10,000 events.
- Client integrity: event index/count/remaining count, trace, batch, instrument, emitted order, final checksum, and complete batch identity validate before a caller receives completion.
- Build/type proof: contract, market-state, and Electron typechecks passed; Electron main production build passed. The trading-client package has no standalone typecheck script and is covered through its focused tests plus Electron typecheck/import path.
- Not proven in Slice 11: JSONL payload policy, raw transport capacity, reconnect/gap/staleness handling, session calendar correctness, packaged Python runtime, actual specialist reasoning, or visual Electron behavior. The payload policy is completed in Slice 12 below; unthrottled raw capacity remains intentionally unclaimed.

## Phase 1 Slice 12 — Measured JSONL Replay Policy

- Benchmark observation: `./.venv/bin/python benchmarks/benchmark_jsonl_replay.py --mode observe --counts 100,750,800,1000,10000 --pace-ms 1 --repeats 2` uses a benchmark-only sidecar that preserves the real RPC handler/adapter/replay/framing while disabling policy guards. It records hardware, Python, implementation digest, mode, and trial number so the payload curve remains reproducible after enforcement.
- Benchmark enforcement: `./.venv/bin/python benchmarks/benchmark_jsonl_replay.py --mode enforce --counts 750,800 --pace-ms 1 --repeats 3 --assert-policy` exercises production rejection.
- Baseline evidence: paced observation sustained 966–978 events/sec at the fastest supported 1 ms pace; this does not claim an unthrottled JSONL capacity. Completion frames measured 713,568 bytes at 750 events, 761,067 bytes at 800, 955,084 bytes at 1,000, and 9,608,099 bytes at 10,000.
- Enforced decision: bounded JSONL declares a 1,000 requested-events/sec protocol cap and enforces a measured 750,000-byte estimated response limit. Larger, faster, live, or unbounded flows require dedicated streaming; the canonical schema's 10,000-event maximum remains unchanged.
- Failure truth: unsafe replay and direct fixture load fail before emitting an oversized result as typed `STREAMING_TRANSPORT_REQUIRED` / `transport`; neither can crash the Electron supervisor on its 1,000,000-byte line ceiling. Replay-next requests use pace-aware timeouts while other control methods retain the normal timeout.
- Rival fixes: a real Electron child rejects a 1,000-event direct load without dying; a real 1.2-second replay interval succeeds despite a 1-second default control timeout; observation and enforcement evidence are independently reproducible.
- Focused proof after rival fixes: Python sidecar suite 27 passed; affected TypeScript suite 85 passed across 15 files with 248 expectations; contract and Electron typechecks passed; Electron main build and targeted Electron lint passed; enforced 750/800 benchmark gate passed across three trials.
- Evidence: `docs/trading/evidence/market-jsonl-replay-benchmark-darwin-arm64.json` and `docs/trading/evidence/market-jsonl-replay-policy-enforcement-darwin-arm64.json`.
- Not proven: Windows/Linux performance, sustained live streaming, reconnect/gap/staleness handling, session calendar correctness, packaged Python runtime, actual specialist reasoning, or visual Electron behavior.

## Phase 1 Slice 13 — First Bounded Order Flow Specialist

- Contracts: `order-flow-specialist-request@1` and `order-flow-interpretation@1` bind one trace, canonical batch, artifact checksum, snapshot checksum, addressed delivery, analysis-only authority, agent/doctrine versions, and a SHA-256-pinned doctrine. Bundled skill provenance is intentionally not claimed by the runtime artifact.
- Real-process integration: the Python market-data child emits one canonical batch used for both the real Order Flow child and the agent snapshot. The addressed reference is resolved and the exact joined evidence reaches a scripted structured-model adapter.
- Enforcement: runtime-owned path-safe interpretation IDs/timestamps; snapshot/artifact checksum revalidation; exact measurement/identity matching; conservative unavailable aggression provenance; trades-only depth; limited-sample confidence ceiling; required alternatives/no-trade reasons; allowlisted evidence; prohibited execution-language detection; stale/invalid pre-model refusal; malformed/provider failure propagation; atomic restrictive-permission storage.
- Evaluation: the deterministic rubric requires 6/6 checks for analyzed status, analysis-only authority, feed honesty, calibration, alternative hypothesis, and machine-coded evidence scenarios. The specialist has no tools or broker route; free-form analyst narrative is additionally rejected on conservative execution-language policy matches, but the hard safety boundary is structural rather than a claim that regex understands every possible synonym.
- Focused proof after rival fixes: 82 contract/Electron/provider-lifecycle tests passed with 201 expectations; the narrower specialist-contract/provider-lifecycle set accounts for 20 passing tests. Contract, server-core, and Electron typechecks, targeted Electron lint, Electron main build, and `git diff --check` passed.
- Real-provider attempt: both configured Runner backends initialized, but neither saved credential was available to the headless evaluator. No authenticated real-model output, trading quality, visual UI, or live-market behavior is claimed.
- Required remaining proof: approved credential real-model evaluation, retained scored receipt, real Electron provider-attachment smoke, reconnect/gap/session correctness, packaged Python, and installed app.

## Trading-Specific Integrity Tests

- Event time is distinct from receive/process time.
- No future information enters historical analysis.
- Session and timezone behavior crosses DST boundaries correctly.
- Duplicates and out-of-order inputs are deterministic.
- Missing intervals and stale feeds are flagged, not silently interpolated.
- Tick size, multiplier, currency, and price precision are explicit.
- Futures rollover/corporate action assumptions are encoded where relevant.
- Fees, slippage, latency, and fill assumptions are explicit in backtests.

## Unified Broker Entry Gateway — 2026-07-30

- Complete focused suite: 175 passed, 0 failed across 31 files with 582 expectations.
- Repository-wide `bun run typecheck:all`: passed.
- Electron main, preload, and renderer production builds: passed.
- Adversarial review: no unresolved gateway safety defect; checksum, certification, credential, browser-isolation, ambiguous-submit, and safe-exit boundaries remain fail-closed.
- Runtime/provider proof not claimed: no real Tradovate paper credential, WealthCharts selector bundle, 50-run real-provider paper soak, packaged installer smoke, or consequential canary.
- Activation remains impossible from renderer state alone. Certification evidence must match the installed adapter ID, adapter version, provider-contract version, connection, transport, and environment.

## Discord Follow-Up End-to-End Handoff — 2026-07-30

- Rival findings fixed: negated/delayed close false positives, unsafe `to be` breakeven matching, missing `flat`/`done`, stop quantity not bound to provider open quantity, and completed actions without provider evidence.
- Trade God's isolated port 9201 is used. HMAC/timestamp/body/rate gates run before the dedicated trusted handler; the `discotrader-management` slug rejects exact signed replay while releasing its reservation after transient failure.
- Electron instantiates the durable manager, runs pending-receipt recovery before new delivery, and attaches zero provider adapters.
- Focused proof: 29 trigger-server tests, 110 contract/execution tests with 296 expectations, and 4 Electron runtime tests passed; contract, execution, server-core, and Electron typechecks passed.
- Repository-wide `bun run typecheck:all` and Electron main, preload, and renderer production builds passed.
- Donor proof: the final DiscoTrader suite passes 276 tests; its typecheck and build pass. The smoke exposed a missing exact phrase, “taking off half here, and moving stop to BE”. Rival hardening also made missing HMAC configuration fail before network delivery, restricted reply authority to Discord's rendered reply context, and bound `posted_at` to the message snowflake.
- Runtime proof: the Trading workspace loaded two automations including the signed-only `discotrader-management` matcher. A fresh compound message produced two management actions, one sender push, and a durable `blocked` receipt under Runner user data with zero candidates and `No gateway mutation was attempted`.
- Replay proof: the exact byte-signed delivery returned HTTP 202 once and HTTP 409 `replay_detected` on the second request. An intentionally non-byte-exact probe failed closed with HTTP 401 `invalid_signature`.
- Still not proven: any certified paper adapter, provider mutation, 50-lifecycle soak, or consequential canary.

## DiscoTrader Rival Closure — 2026-07-30

- Entry tickets no longer stop at a library seam: the authenticated
  `discotrader` trigger validates the full ticket and registers it through the
  gateway intent source. Account routing is explicit or uniquely ready; it
  never guesses.
- Management idempotency is event-scoped. A retry of one Discord action is
  suppressed, while two distinct messages requesting the same reduction each
  execute once.
- DiscoTrader now persists entry and management handoffs in a SQLite outbox
  before network delivery, queues management authority before acknowledging
  Chrome, retries transient Runner failures, and does not resend rows already
  marked delivered. Direct entry tickets fail before network I/O when the HMAC
  secret is missing.
- Thread context is inferred only from an exact cross-channel reply or an
  operator-configured thread-parent mapping.
- Trade God focused proof: 210 tests passed across 33 files with 712
  expectations. Repository-wide typecheck and Electron main/preload/renderer
  builds passed.
- DiscoTrader proof: 283 tests passed; typecheck and production build passed.
- The direct entry route, retry recovery, and thread-parent mapping are
  automated-test proven. A running-app smoke and any provider mutation remain
  unproven.

## DiscoTrader Control Center — 2026-07-31

- Page contract: source, worker, broker-route, and approval states come from
  existing trusted APIs; the renderer does not own execution truth.
- Installation contract: `trade-desk` is absent from automatic starters and
  defaults. The explicit action writes the audited definition and activates it
  only in the selected workspace. A conflicting definition fails closed.
- Credential contract: `DT_MCP_TOKEN` is sent only to the encrypted
  source-credential API. It is not stored in the agent definition or docs.
- Authority contract: the worker uses `permissionMode: ask`; halt, flatten, and
  other live tools are not direct dashboard controls.
- Focused proof: 15 tests passed with 86 expectations, including hostile
  same-slug source and worker authority cases.
- Build proof: repository-wide typecheck plus Electron main, preload, and
  renderer production builds passed.
- Not proven: live user click-through, daemon authentication, worker chat, or
  any provider mutation.
- Broad-suite note: root `bun test` also traverses unrelated Artist OS tooling
  and Electron-only test harnesses. This run hit an Ads Operator route
  expectation plus missing Electron named exports and was stopped; it is not
  claimed as green.

## Completion Language

Use exact claims:

- “Implemented” means code exists.
- “Tests pass” means named automated checks passed.
- “Runtime verified” means the real user path was exercised.
- “Evaluated” means a recorded dataset and metric were used.
- “Safe for paper/live” requires the corresponding safety gate.

Never collapse these into “done.”

## Options Autopilot Slice 3A — Durable Debit Reservations — 2026-08-26

- Account capacity is admitted under a cross-process account lock before any
  provider delivery. Aggregate debit, daily initiated debit, open-position
  count, and duplicate-contract ownership fail closed.
- Full debit remains reserved through working, partial-fill, unknown, and
  halted states. Capacity releases only from a checksum-bound exact flat/not-
  sent proof persisted before the release transition.
- Restart checks reject tampered, duplicated, or misnamed reservation/proof
  evidence and repair crashed locks only under app single-instance startup
  authority.
- Verification: 12 focused options contract/store tests, 65 complete trading-
  contract tests, 210 complete trading-execution tests, repository-wide
  typecheck, and diff check passed.
- Not yet proven: gateway/provider preview, provider submission or
  reconciliation, broker paper execution, or live UI. Those remain later
  slices.

## Options Autopilot Slice 3B — Preview and Execution Journal — 2026-08-26

- The gateway is intentionally restricted to `fake-options@1`; structurally
  compatible real adapters are refused in this slice.
- Preview, immutable intent, exact provider request, command, and mutable
  execution record persist before one provider submit. The request checksum
  includes account, contract, instrument, buy-to-open action, LIMIT price,
  quantity, DAY time-in-force, regular-hours flag, and client order ID.
- Provider/account/quote/reservation truth is revalidated across preview. Replay
  requires the identical source/route/account/contract/policy/mandate evidence.
- Unknown-after-send never resubmits. Startup exact-client-ID reconciliation
  either adopts the one provider order/open position or releases capacity only
  after exact flat/no-send proof.
- Verification: 27 focused options gateway/ledger/simulator/contract tests and
  281 complete trading contract/execution tests passed. Repository-wide
  typecheck and diff check passed.
- Not yet proven: any IBKR/Webull order mutation, credential/session handling,
  real provider preview semantics, cancellation/expiry management, or live UI.

## Options Autopilot Slice 4 — Read-only Account Setup — 2026-08-26

- Trade God now has a dedicated Options Desk with guided IBKR paper and Webull
  sandbox setup. Credentials are accepted only in the modal, stored in the
  encrypted Trade God vault, and never returned to the renderer.
- Main-process verification is restricted to fixed official HTTPS hosts and
  read-only account, balance, position, and open-order requests. It requires the
  exact configured account ID. No order endpoint or provider execution adapter
  is attached in this slice.
- Verification evidence is immutable and checksum-bound to the exact account,
  credential generation, adapter version, and provider contract. Replacing a
  credential invalidates the active proof while retaining its audit history.
- The UI truthfully reports `Read-only · no orders`. Options contract lookup,
  quote entitlement, realtime data, certification, and execution remain
  unproven and visibly locked.
- Verification: 17 focused contract/service/IPC/preload/channel tests passed;
  repository-wide typecheck, renderer production build, and diff check passed.
  Runtime screenshots verified the empty account page and IBKR connection modal.
- Not yet proven: a real IBKR/Webull credential login, live options contract or
  quote access, provider paper order lifecycle, or unattended execution.

## Options Autopilot Slice 5A — Restricted Certification Authority — 2026-08-26

- A dedicated options certification runner is now separate from Discord,
  routes, standing mandates, agents, and the normal execution gateway.
- Its immutable evidence binds the exact account, credential generation,
  adapter/provider contract, one allowed contract, client-order prefix, maximum
  test debit, every required scenario, mutation count, and final flat proof.
- Eligibility is derived rather than trusted: every scenario must pass, at
  least four controlled provider mutations must be evidenced, and final truth
  must prove zero position and zero working orders. Malformed, expired, or
  over-$1,000 sessions fail before the runner can act.
- Verification: 12 focused certification/options-contract tests passed;
  repository-wide typecheck and diff check passed.
- Not yet proven: a provider-specific runner, any real broker mutation, or
  installation of manual-paper authority.

## Options Autopilot Slice 5B1 — Inert IBKR Paper Adapter — 2026-08-26

- A provider-neutral options adapter boundary now exists, but the normal
  options gateway remains restricted to the fake provider. The IBKR adapter is
  exported for isolated certification work only and is not composed into the
  desktop runtime.
- The adapter resolves one exact standard SMART/USD/multiplier-100 contract,
  requires realtime option quote evidence and the configured DU paper account,
  enforces one on-tick BUY-to-open LIMIT/DAY/RTH contract, and uses the official
  IBKR what-if and order endpoints.
- Broker warning replies are never auto-confirmed. A successful submission is
  not trusted from its acknowledgment: the adapter immediately re-reads the
  exact client-order ID and refuses incomplete, mismatched, or unsupported
  order truth.
- Verification: 22 focused adapter/gateway/certification/contract tests passed;
  repository-wide typecheck and diff check passed.
- Not yet proven: real IBKR authentication, live contract/tick response shape,
  OPRA entitlement, broker warning configuration, paper mutation, lifecycle
  certification, runtime attachment, or execution authority.
# Multi-account connections and Discord routes — 2026-07-31

- Multiple prop firms/accounts can coexist; connection identity remains exact
  and immutable.
- WealthCharts login confirmation is main-process owned, constrained to the
  approved origin, and cannot be forged by renderer save payloads.
- Removing a browser account clears its isolated persistent partition before
  deleting metadata.
- Discord routes bind immutable server/channel/trader IDs to one exact account;
  duplicates and missing/unready targets fail closed.
- Focused connection, route-store, IPC, preload, and channel-parity gate: 16
  tests pass.
- Repository typecheck and Electron main, preload, and renderer builds pass.

## Account routing and source catalog hardening — 2026-08-03

- Silent Discord source reassignment is rejected unless the caller proves the
  exact previous account; the UI requires a second explicit confirmation.
- Account deletion and route mutation share one serialized guard. Missing
  target accounts are rejected before route persistence, and legacy orphaned
  routes remain visible as blocked/removable.
- Renderer readiness uses `enabled && state=ready`; disabled certified accounts
  are not described as executable. Embedded account mutations refresh the
  parent broker summary, and route deletion failures surface to the operator.
- Trade God calls only the exact read-only `dt_signal_sources` MCP tool over the
  audited loopback bearer source. The picker accepts only complete,
  configured-enabled, daemon-allowed identities and retains an honest manual
  fallback.
- Focused Trade God proof: 26 tests pass with 121 expectations across runtime,
  route store, IPC, preload, renderer logic, and channel parity.
- DiscoTrader donor proof: 287 tests pass across 11 files; typecheck and diff
  check pass. The catalog has no message text, URLs, secrets, broker data, or
  write/enrollment authority.
- Repository-wide typecheck and Electron main, preload, and renderer production
  builds pass. Live daemon restart/catalog click-through is not yet claimed.

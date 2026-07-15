---
status: active
owner: team
last_verified: 2026-07-14
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-07-14
- Stage: Phase 1 now has its first bounded specialist runtime; Phase 0 still awaits real visual Electron smoke
- Current goal: adversarially close and visually expose the first Order Flow specialist, then move to reconnect/gap/session correctness before live data
- Overall state: the Order Flow specialist now joins deterministic artifacts with addressed context, runs through Runner's provider-neutral structured-model seam, validates and stores typed analysis-only interpretations, and refuses stale/invalid evidence; a real provider call was attempted but local saved credentials were unavailable to the headless evaluator, while reconnect/gap behavior, packaged Python assets, the visual Electron path, and a built installer remain unverified
- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/trade-god-foundation`
- Branch: `codex/trade-god-foundation`
- Frozen base: `origin/main` at `e7e96be32a5be394aefaf5712bdd711b96ad9d15`
- Implementation head entering this slice: `f5e71ba6`

## Working Capability

`synthetic ES fixture -> Order Flow sidecar -> validated artifact -> typed client -> Electron supervisor/IPC/preload -> Trade God workbench`

`project-owned ES records -> isolated Python 3.12 sidecar -> Nautilus 1.230.0 TradeTick objects`

`market.load_fixture -> fixed project fixture -> validated canonical batch or typed quality error`

`validated canonical batch -> no-lookahead watermark -> current price + closed candle history + one developing candle`

`market state -> bounded/checksummed analysis-only agent snapshot -> future specialist consumers`

`real supervised Python market child -> canonical batch -> real supervised Order Flow child -> order-flow-artifact@2 + trade-run-receipt@2`

`agent-market-snapshot@1 -> atomic local context store -> checksum-bound reference -> addressed specialist delivery receipt -> authorized resolution`

`market.replay_batch -> bounded replay session -> consumer-paced market.replay_next pulls -> completed canonical batch or typed cancel/timeout`

`bounded JSONL policy -> declared <=1,000 requested events/sec + measured <=750 KB response -> otherwise STREAMING_TRANSPORT_REQUIRED`

`canonical Order Flow artifact + resolved agent snapshot -> order-flow-specialist-request@1 -> bounded structured model -> validated/stored order-flow-interpretation@1`

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
- Hardened the real Electron canonical path after adversarial review: stable receipt identity, active deadlines across market loading and analysis, duplicate-cancellation ownership, stopped-service rejection, bounded pre-parse framing, and cross-field receipt/artifact invariants.
- Added `agent-context-reference@1` and `agent-context-delivery-receipt@1`, an atomic user-data context store, reference-only specialist queueing, consumer-bound resolution, idempotent concurrent publication, checksum/identity revalidation, and path-safe storage IDs.
- Routed the real supervised fixture snapshot to the addressed `order-flow-specialist` boundary and proved the queued payload contains a reference rather than a copied snapshot. This is a delivery seam, not proof that an LLM specialist reasoned over it.
- Added `market-replay-session@1` and `market-replay-step@1` with caller-owned replay/cancellation identity, bounded pace, deadline, cursor, event, completion, and cancellation contracts.
- Added a bounded pull-based Python replay registry and concurrent stdio dispatch so cancellation can overtake a waiting event without killing the sidecar. One pull per replay is serialized; active sessions are capped at 64.
- Added typed client/Electron start, next, cancel, and `replayFixture` flows. Consumer callbacks provide natural backpressure; completion is rejected unless every emitted event, cursor, identity, and checksum matches the canonical batch.
- Benchmarked the real Python child over JSONL at 100–10,000 generated canonical events. Reproducible two-trial observation mode sustained 966–978 events/sec at the protocol's fastest 1 ms pace; this is paced-path evidence, not an unthrottled transport ceiling. Payload size is the binding measured limit: 750 events completed at 713,568 bytes while 800 reached 761,067 bytes and 10,000 reached 9,608,099 bytes.
- Enforced a 750,000-byte safe response ceiling beneath Electron's 1,000,000-byte frame limit for replay completion and direct fixture load, retained the canonical 10,000-event schema bound, labeled 1,000 events/sec as the declared protocol target cap, bounded string RPC IDs, advertised the policy in typed capabilities, and return `STREAMING_TRANSPORT_REQUIRED` before unsafe work starts.
- Fixed the paced-replay transport mismatch found by cold review: `market.replay_next` now gets a per-request timeout derived from the declared replay pace while health/load retain the 5-second default; a real 1.2-second replay interval passes through Electron supervision.
- Added the versioned Order Flow specialist request/interpretation contracts with immutable trace, input hashes, exact deterministic measurements, feed capability, alternative hypothesis, machine-coded evidence scenarios/invalidation/expiry, and analysis-only authority.
- Added a joined pipeline that loads one canonical batch through the real Python market-data child, feeds that same batch to the real Order Flow child and snapshot builder, resolves only the addressed reference, verifies every identity/checksum, and submits one bounded structured-model request.
- Added deterministic admission gates for stale, unavailable, or invalid evidence; hostile model output is rejected if it changes measurements/identity, overstates feed capability, cites unknown evidence, omits required alternatives, exceeds limited-sample confidence, or matches the conservative execution-language policy. Scenario conditions are machine-coded rather than free-form prose, and the specialist has no tools or route to broker execution.
- Added atomic interpretation storage and a hidden one-shot Runner model carrier that uses the configured provider, structured output, no sources, safe permissions, and guaranteed session deletion.
- Added and bundled `order-flow-specialist@0.1.0` doctrine plus primary-source research on CME MBO/MDP aggression, trade classification uncertainty, order-flow impact, and spoofing/intent limits.
- Added a real-provider evaluation harness. Both saved Runner connections reached their backend initialization but lacked credentials in the headless evaluator; no real-model reasoning result is claimed yet.

## Next Actions

1. Complete one real-provider evaluation after an approved credential is available; do not represent scripted-model proof as model-quality proof.
2. Add reconnect/gap/staleness and session-correctness gates before any live-data work.
3. Design the dedicated live/unbounded streaming transport only when live-data work begins; keep JSONL as the bounded control/replay path.
4. Add an operator-facing interpretation surface only after the contract/runtime is accepted.
5. **Required at first possible desktop opportunity:** visually smoke Trade God Ready, fixture `28 / 6 / 5592.25`, cancellation, one visible failure, and specialist-provider attachment.
6. Build and smoke the packaged installer separately.

## Blockers / Decisions Needed

- Physical access or reliable Computer Use access for the real visual Electron smoke.

The Phase 0 fixture, transport, contracts, worktree, and initial Nautilus compatibility policy are no longer open blockers. Phase 1 canonical market contracts are active work, not an external blocker.

## Verification State

- JSONL policy and rival-fix proof: Python market-data suite 27 passed; two-trial observation evidence is reproducible; three enforced trials admit 750 events at 713,568 bytes and reject 800 events with typed `STREAMING_TRANSPORT_REQUIRED`; real Electron tests prove oversized direct loads fail typed without process death and replay pacing above the default request timeout succeeds.
- Electron `build:main`, `build:preload`, and `build:renderer` passed.
- The generated packaged sidecar bundle launched independently and answered a schema-valid health request.
- Packaged root selection, bundled-Bun selection, partial frames, and next-request restart behavior passed focused tests.
- Active cancellation passed from typed client through sidecar boundaries; the workbench control is build-verified but not visually smoked.
- Receipt-focused verification: 23 passed, 0 failed across contract, atomic store, supervisor, and runtime tests.
- Contract, market-state, and Electron standalone typechecks passed; Electron main, preload, and renderer production builds passed.
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
- Specialist runtime proof: 16 focused tests pass through the real Python and Order Flow children, joined context resolution, scripted structured-model analysis, 6/6 evaluation, atomic storage, hostile measurement/evidence/execution rejection, impossible scenario-state rejection, malformed/provider failure handling, and pre-model stale refusal. This proves orchestration and enforcement, not trading skill or live-model quality.
- Contract/server/Electron typechecks pass after provider-gateway wiring; the final focused gate passes 82 tests across contracts, real sidecars, joined specialist behavior, adversarial policy cases, storage, and provider-carrier lifecycle.
- Real-provider evaluator reached both configured Runner connection backends. Neither saved credential was available to the headless process, so real-model output remains unverified.
- Paced replay proof: complete real fixture replay respects the configured pace and consumer backpressure; active cancel and deadline return typed domain errors while the same Python process remains healthy. Process exit remains a separate supervisor error.
- Real Electron interaction and a fully built packaged installer are not yet verified.
- Canonical Python emission, replay quality, fixture RPC, typed supervision, bounded deterministic candles/context, replay-only canonical Order Flow, reference-only specialist delivery, typed specialist interpretation enforcement, paced replay/cancel, and measured JSONL transport limits are implemented; packaged Python assets and real-model quality remain unverified.

## Explicitly Not In Scope Yet

- Live broker connectivity, order placement, or autonomous execution.
- Production-grade order-flow intelligence or real-time tick streaming.
- Full agent roster, charting workspace, or generalized plugin marketplace.
- Broad donor-code porting without license, provenance, and boundary review.

## Notes for the Next Agent

Read this file, `HANDOFF.md`, the Phase 0 spec, and `development/VERIFICATION.md`. Do not call bundle-level proof an installed-app smoke. At the first reliable desktop opportunity, verify Ready, run the fixture, confirm `28 / 6 / 5592.25`, and force one visible failure.

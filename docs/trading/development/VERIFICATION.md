---
status: active
owner: team
last_verified: 2026-07-11
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
- Runtime/Electron smoke: not yet run; no Trade God runtime exists.

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

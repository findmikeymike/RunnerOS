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

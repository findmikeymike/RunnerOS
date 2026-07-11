---
status: current
owner: team
last_verified: 2026-07-11
source_of_truth: true
---

# Outcome Roadmap

The roadmap is gated by proof, not calendar dates. A phase may begin experimentally before the prior phase closes, but it cannot inherit an unverified foundation as fact.

## Phase 0 — Contract Kernel

Outcome: Electron can supervise one deterministic analytics sidecar and validate one fixture-derived artifact.

Gate: repeatable fixture result, schema/version rejection tests, timeout/cancel/crash behavior, and visible service health.

## Phase 1 — Order Flow Walking Slice

Outcome: recorded ES data becomes order-flow evidence, specialist interpretation, chart annotations, head-agent synthesis, and a journaled run.

Gate: end-to-end trace IDs, citations, invalidation, quality flags, replay determinism, and inspectable failure states.

## Phase 2 — Evaluation and Calibration

Outcome: the system can measure whether detections and agent conclusions are useful rather than merely fluent.

Gate: labeled fixtures, temporal-leak tests, confidence calibration, abstention scoring, regression baselines, and versioned evaluation reports.

## Phase 3 — Second Specialist, Same Seam

Outcome: add Volume Profile or Options without changing the core control-plane architecture.

Gate: shared envelope and artifact registry work; domain-specific code stays isolated; cross-agent disagreement is explicit.

## Phase 4 — Live Shadow Mode

Outcome: consume live data and generate analysis without any ability to send orders.

Gate: reconnect/gap/staleness handling, session/rollover correctness, backpressure, observability, and replay-vs-live parity checks.

## Phase 5 — Paper Execution

Outcome: approved trade plans become paper orders through a protected execution gateway.

Gate: deterministic pre-trade risk, approvals, idempotency, order-state machine, receipts, reconciliation, and kill-switch tests.

## Phase 6 — Bounded Live Execution

Outcome: narrowly scoped live orders are possible under explicit user policy.

Gate: broker certification, credential isolation, limits, incident runbooks, recovery drills, reconciliation, auditability, and human acceptance. Live remains opt-in and reversible.

## Parallel Research Lane

Open-source donor experiments may run in isolation. No donor becomes a dependency until license, provenance, contract fit, deterministic tests, operational behavior, and replacement cost are recorded.

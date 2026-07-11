---
status: active
owner: team
last_verified: 2026-07-11
source_of_truth: true
---

# Architecture Decision Log

Status values: proposed, accepted, superseded, rejected. Accepted decisions guide implementation until explicitly superseded.

## ADR-001 — RunnerOS as Control Plane

- Status: proposed
- Decision: extend RunnerOS for agent lifecycle, messaging, workflows, automations, context, permissions, outputs, and Electron rather than building a second orchestration platform.
- Why: these primitives already exist and match the product shape.
- Constraint: confirm the correct clean integration branch before implementation.
- Rejected: adopting an unrelated trading application as the entire shell.

## ADR-002 — Deterministic Engines Outside Agents

- Status: accepted
- Decision: calculations, normalization, scanning, backtesting, and execution logic live in deterministic libraries/services; agents interpret artifacts.
- Why: reproducibility, testing, latency, provenance, and safer failure behavior.
- Consequence: agents cannot invent numeric truth that the evidence layer should calculate.

## ADR-003 — Contract-First Modular Monorepo

- Status: accepted
- Decision: share versioned contracts and domain types while isolating sidecars and feature packages by responsibility.
- Why: enables modular replacement without premature distributed-system overhead.
- Rejected: one microservice per agent and one giant undifferentiated trading package.

## ADR-004 — Single Typed Trading Client

- Status: accepted
- Decision: agents and UI reach trading capabilities only through one typed client/capability registry.
- Why: central validation, policy, tracing, compatibility, errors, cancellation, and test fakes.

## ADR-005 — Replay-First Development

- Status: accepted
- Decision: every important analytical path starts with recorded, provenance-bearing fixtures and a controllable clock.
- Why: deterministic debugging, temporal integrity, regression evaluation, and safe iteration.

## ADR-006 — Thin Workbench Early, Final UX Later

- Status: accepted
- Decision: build a minimal chart/artifact/health/timeline surface with the first slice, then let working workflows shape the full UX.
- Why: architecture needs a real user path, while visual polish before runtime truth creates rework.

## ADR-007 — Execution Is a Separate Protected Plane

- Status: accepted
- Decision: trade plans cannot directly become orders. Deterministic risk, approval, idempotency, execution, receipts, and reconciliation form a separate boundary.
- Why: analytical confidence and authorization are different concerns.

## ADR-008 — Wrap Donors Behind Owned Contracts

- Status: accepted
- Decision: port algorithms/components selectively or wrap large kernels; never let donor-specific models become the platform contract.
- Why: license control, replacement ability, coherent domain semantics, and upgrade isolation.

## ADR-009 — Initial Local Transport

- Status: proposed
- Decision: use JSON-RPC over stdio for command/control; keep high-volume streaming out of the protocol until measurement justifies a separate channel.
- Open question: exact envelope, compatibility window, and stream threshold.

## ADR Template

```markdown
## ADR-NNN — Title
- Status: proposed | accepted | superseded | rejected
- Date:
- Context:
- Decision:
- Why:
- Consequences:
- Alternatives rejected:
- Migration/reversal path:
- Evidence:
```

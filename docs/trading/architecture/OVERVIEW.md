---
status: current
owner: team
last_verified: 2026-07-11
source_of_truth: true
---

# Architecture Overview

## Architectural Shape

RunnerOS is the control plane and Electron shell. Deterministic trading capabilities run behind typed service boundaries. Agents reason over artifacts and request capabilities through a single client. Execution is a separate protected plane.

```text
Electron workbench
      |
RunnerOS control plane
  agents | messages | workflows | schedules | context | permissions | receipts
      |
typed trading client
      |
versioned contracts and capability registry
      |
supervised sidecars
  market data | order flow | profile | options | backtest | trading kernel
      |
protected risk and execution gateway
      |
broker/exchange adapters
```

## Layers and Dependency Direction

### Contracts

Schemas for commands, events, artifacts, errors, health, capabilities, annotations, trade plans, and receipts. Zero Electron, provider, broker, storage, or LLM dependencies.

### Domain

Pure trading types and rules: instruments, sessions, bars/ticks, price precision, quality, hypotheses, order intents, and risk decisions. Deterministic wherever possible.

### Testkit

Fixtures, clocks, protocol conformance, fake clients, golden artifacts, failure injection, and temporal-leak checks.

### Sidecars

Independently runnable analytics/provider processes. Each declares health, capabilities, versions, schemas, required inputs, output artifacts, timeout behavior, and shutdown behavior.

### Trading Client

The sole supported access path from RunnerOS agents and UI to trading capabilities. It handles validation, transport, cancellation, retries only where safe, trace propagation, and normalized errors.

### Control-Plane Bridge

Maps RunnerOS sources, tools, workflows, messages, context, permissions, and receipts to trading contracts. It does not recalculate market analytics.

### Agent Packs

Versioned bundles of agent identity, doctrine, tools, skills, workflows, policy, fixtures, evaluations, and docs. Packs depend on the client and contracts, never on provider internals.

### UI

Workbench views, chart adapters, artifact inspectors, timelines, health, and approvals. UI state is presentation state; it does not own market, risk, or broker truth.

### Execution Plane

Risk policy, approval, idempotency, broker adapters, order state, receipts, reconciliation, and kill switches. No analytical agent directly reaches a broker.

## Proposed Repository Shape

```text
apps/electron/src/main/trading/        # supervision, IPC, security
apps/electron/src/renderer/features/trading/
packages/trading-contracts/
packages/trading-domain/
packages/trading-testkit/
packages/trading-client/
packages/trading-control-plane/
packages/trading-ui/
sidecars/market-data-gateway/
sidecars/order-flow-engine/
sidecars/profile-engine/
sidecars/trading-kernel-adapter/
sidecars/execution-gateway/
packs/index-desk/
docs/
```

Create a directory only when its first owned responsibility is implemented. Empty architecture is not progress.

## Runtime Data Path

1. Provider adapter receives raw data.
2. Normalizer attaches instrument, timezone, session, sequence, quality, and provenance.
3. Raw/normalized data is persisted append-only where appropriate.
4. Deterministic engine produces a versioned artifact.
5. Contract validator accepts or rejects it.
6. Agent receives a compact evidence bundle and produces a typed interpretation.
7. Head agent synthesizes compatible/conflicting theses.
8. UI renders artifacts and annotations through adapters.
9. Journal records the run, versions, evidence, conclusions, and later outcome.
10. Any trade plan enters a separate risk/approval/execution path.

## State Ownership

| State | Owner |
|---|---|
| Raw/normalized market events | Market data gateway/store |
| Derived analytics | Producing engine and artifact store |
| Agent/workflow lifecycle | RunnerOS control plane |
| Durable hypotheses/outcomes | Journal/context service |
| Chart interaction and panels | Renderer state |
| Risk decision | Risk engine |
| Order/fill/account truth | Execution gateway reconciled with broker |

## Storage Shape

```text
.trade-god/
  config/
  data/raw/
  data/normalized/
  data/derived/
  artifacts/
  runs/
  index.sqlite
  logs/
  migrations/
```

Use Parquet for larger market datasets, JSON for inspectable versioned artifacts, SQLite for indexes/metadata, and the OS keychain for credentials. Storage choices remain behind repositories so they can evolve.

## Transport

Begin with supervised local processes and JSON-RPC over stdio for commands/control. Add a dedicated streaming transport only after measured throughput/backpressure requires it. Do not send every tick through MCP or an LLM.

## Evolution Rules

- New provider: implement an adapter; preserve canonical domain contracts.
- New specialist: add an agent pack and domain artifacts; preserve the client seam.
- New chart library: replace the renderer adapter; preserve annotation contracts.
- New broker/kernel: replace an execution/kernel adapter; preserve risk and intent contracts.
- New model: change reasoning configuration and eval; preserve evidence/output schemas.
- Breaking contract: version, migrate, support a compatibility window, and record an ADR.

## Failure Is a First-Class State

Design for stale feeds, duplicates, out-of-order events, reconnect gaps, DST/session errors, futures rollover, corporate actions, precision mismatch, sidecar crash, schema skew, slow consumers, cancellation, partial results, expired approvals, broker rejection, uncertain order state, and reconciliation drift.

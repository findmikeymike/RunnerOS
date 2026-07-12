---
status: active
owner: team
last_verified: 2026-07-11
source_of_truth: true
spec_id: TG-FOUND-001
target_phase: 0
depends_on: []
---

# Phase 0 — Contract Kernel and Walking Skeleton

## Decision Summary

Prove Trade God’s foundational seam with one recorded ES fixture, one supervised Order Flow sidecar, one validated analysis artifact, and one thin Electron view. This intentionally tests architecture and failure handling before domain breadth, agents, streaming, or execution.

## User Outcome

As the builder, I can launch the desktop, see whether the Order Flow engine is compatible and healthy, run a known ES fixture, and inspect a validated artifact or an actionable failure.

## Scope

- Versioned request, response, artifact, error, health, and capability envelopes.
- Recorded fixture with provenance and market-time metadata.
- Independently runnable sidecar with health, capabilities, fixture analysis, cancel, and shutdown.
- Supervision and typed client path inside Electron/RunnerOS.
- Minimal page showing service state, fixture run, artifact JSON/summary, trace ID, and error state.
- Contract, integration, determinism, and failure tests.

## Non-Goals

- An LLM or specialist reasoning agent.
- Production order-flow algorithms or chart rendering.
- Live market data, streaming transport, broker, accounts, or orders.
- Generic plugin marketplace or universal sidecar framework.
- Shipping donor code before license and provenance review.

## Required Contracts

All envelopes include `schema_version`, `message_id`, `trace_id`, `created_at`, and producer identity/version.

### Analyze Fixture Request

- fixture ID and checksum;
- instrument ID and contract metadata;
- session/timezone;
- analysis configuration/version;
- deadline and cancellation ID.

### Analysis Artifact

- artifact ID/type/schema version;
- producer and algorithm versions;
- fixture/input IDs and checksums;
- event-time range and session;
- computed summary fields sufficient to prove the path;
- data-quality flags and warnings;
- deterministic configuration hash;
- created time and trace ID.

### Health / Capabilities

- lifecycle state: starting, ready, degraded, incompatible, stopping, stopped;
- protocol and artifact versions;
- supported commands and fixture mode;
- dependency status;
- last error without secrets.

### Error

- typed code;
- category: validation, incompatible, timeout, canceled, unavailable, internal;
- safe user message;
- retryability;
- diagnostic/trace ID.

## Fixture Requirements

- Legally usable and redistribution status recorded.
- Symbol/venue/contract, tick size, multiplier, currency explicit.
- UTC event timestamps plus exchange timezone/session definition.
- Source, capture method, transformations, row/event count, and checksum.
- No credentials or account information.
- Small enough for fast local tests while containing at least one meaningful deterministic calculation.

## Runtime Flow

1. Electron supervisor starts the sidecar with a constrained environment.
2. Client performs protocol handshake and reads capabilities.
3. UI shows ready, degraded, or incompatible.
4. User invokes the known fixture.
5. Client validates request and sends it with trace/deadline/cancellation IDs.
6. Sidecar verifies fixture checksum and calculates the artifact.
7. Client validates the returned artifact and stores the run receipt.
8. UI renders the summary, artifact metadata, trace ID, and warnings.
9. Cancellation, timeout, crash, or schema mismatch becomes a typed visible state.

## State Ownership

| State | Owner |
|---|---|
| Fixture bytes and metadata | Testkit fixture repository |
| Sidecar process lifecycle | Electron main-process supervisor |
| Request/run lifecycle | Trading client |
| Artifact content | Sidecar, validated by contracts |
| Display/selection state | Renderer |
| Run receipt | Control-plane run storage |

## Acceptance Criteria

- [x] A clean worktree can install/build using documented commands.
- [x] Health handshake detects compatible and incompatible versions.
- [x] Valid fixture returns a schema-valid artifact with full provenance.
- [x] Repeated runs produce canonical-equivalent output.
- [x] Altered checksum is rejected before analysis.
- [x] Invalid response payload never reaches UI as valid data.
- [x] Timeout, cancellation, and crash are distinguishable.
- [ ] Sidecar restarts or remains stopped according to documented policy.
- [ ] Electron real IPC path shows health, successful artifact, and error state.
- [ ] Trace ID joins request, logs, artifact, and receipt.
- [x] No live/provider/broker capability is reachable.

## Failure Cases to Force

- sidecar missing or cannot start;
- startup exceeds deadline;
- protocol version mismatch;
- fixture absent or checksum mismatch;
- malformed request and malformed artifact;
- analysis timeout;
- cancellation before and during calculation;
- sidecar exit mid-request;
- oversized/noisy stderr;
- duplicate message ID;
- Electron reload while sidecar is running.

## Implementation Slices

1. Approve envelope/version/error contracts and examples.
2. Add fixture metadata, checksum, replay clock, and golden expected artifact.
3. Build the independently runnable sidecar and conformance tests.
4. Build supervisor and typed client with trace/cancel/deadline behavior.
5. Add thin renderer route and IPC boundary.
6. Run real Electron and failure smoke tests.
7. Record evidence and promote spec from draft to verified only when every gate is proven.

## Open Questions

- Exact sidecar restart policy during development versus packaged desktop runtime.
- Packaged-sidecar asset location and build/copy convention.

## Evidence Log

- 2026-07-11: `@trade-god/contracts` and `@trade-god/testkit` implemented through red-green TDD; 12 focused tests passed.
- 2026-07-11: standalone Order Flow JSON-RPC handler and spawned newline-delimited stdio CLI implemented through red-green TDD.
- Complete fast Phase 0 suite: 20 passed, 0 failed, 39 expectations.
- 2026-07-11: typed client boundary added with response validation, trace enforcement, protocol checks, deadlines/cancellation IDs, and normalized domain errors.
- Complete fast Phase 0 suite after client: 24 passed, 0 failed, 44 expectations.
- 2026-07-11: Electron-compatible process supervisor added and verified against the real sidecar plus silent/crashing fixtures.
- Complete fast Phase 0 suite after supervision safety gates: 29 passed, 0 failed, 56 expectations.
- 2026-07-11: narrow local IPC registration added for health and fixture analysis with idempotent lifecycle disposal.
- Complete fast Phase 0 suite after IPC contract: 31 passed, 0 failed, 62 expectations.
- 2026-07-11: runtime factory added for explicit RunnerOS root resolution, real IPC health, cleanup, and missing-entrypoint failure.
- Complete fast Phase 0 suite after runtime resolution: 33 passed, 0 failed, 66 expectations.
- 2026-07-11: real Electron development main/preload wiring added; main and preload bundles passed.
- Complete fast Phase 0 suite after preload wiring: 34 passed, 0 failed, 69 expectations.
- 2026-07-11: typed Trade God route, command navigation, and diagnostic renderer workbench added; renderer production build passed.
- Complete fast Phase 0 suite after the workbench: 53 passed, 0 failed, 129 expectations across 11 files.
- Still open: real Electron smoke, packaged path resolution, restart policy, active-computation cancellation, partial-frame tests, and trace-to-persisted-receipt proof.

---
status: active
owner: team
last_verified: 2026-07-13
source_of_truth: true
spec_id: TG-DATA-001
target_phase: 1
depends_on: [TG-FOUND-001]
---

# Phase 1 — Nautilus Market Data Spine

## Decision

Use NautilusTrader as a replaceable deterministic market-data kernel behind a Trade God sidecar. Trade God owns the cross-process contracts, quality policy, artifacts, receipts, and agent-facing snapshots.

Do not copy Nautilus internals into RunnerOS and do not expose Nautilus Python objects or internal message-bus topics to Electron, agents, or feature engines.

## First Walking Slice

```text
project-owned recorded trades
→ Nautilus TradeTick objects
→ Trade God adapter
→ canonical immutable market-trade events
→ quality gate
→ deterministic replay batch
→ Order Flow engine input
→ validated snapshot + receipt
```

This slice proves the replaceable boundary before live feeds, books, storage scale, or additional domains.

## Why Nautilus

Nautilus already provides the expensive trading-domain machinery: normalized instruments and market events, nanosecond event/initialization timestamps, fixed-point values, data engines, subscriptions, order books, Parquet catalogs, replay/backtest contexts, adapters, cache, portfolio, risk, and execution components.

Trade God should consume those capabilities rather than recreate them. RunnerOS remains the agent/workflow/permission/UI control plane.

## Initial API Choice

Start with the stable public Python data model and catalog path:

- `TradeTick` for recorded trade events.
- `ParquetDataCatalog` when catalog persistence enters the slice.
- Public data loaders/wranglers for source conversion.
- A dedicated adapter process that serializes Trade God envelopes.

Do not mix Nautilus v1 Cython objects and v2 PyO3/Arrow objects in the first slice. The compatibility spike pins stable NautilusTrader `1.230.0`, local Python `3.12.9`, and a compatible Python `3.12.x` range; any v2 migration requires a separate decision and contract proof.

## Ownership Boundary

| Concern | Owner |
|---|---|
| Provider protocol and venue parsing | Nautilus adapter |
| Instrument precision and domain types | Nautilus |
| Internal subscription/data routing | Nautilus DataEngine/MessageBus |
| External cross-process envelope | Trade God contracts |
| Data-quality acceptance policy | Trade God quality gate |
| Replay mandate and deterministic clock | Trade God orchestration + Nautilus replay |
| Feature calculations | Trade God feature sidecars |
| Agent interpretation | Trade God specialist agents |
| Broker authority | Future execution enclave only |

## Canonical Market Trade Event v1

The adapter emits immutable events containing:

- schema and producer version;
- event ID and trace ID;
- instrument ID, venue, symbol, asset class;
- event time and receive/initialization time as UTC nanoseconds;
- price and size as decimal strings plus raw fixed-point values/precision;
- aggressor side when genuinely available, otherwise `unknown`;
- trade ID when supplied by the source;
- source/provider and source-record identity;
- replay/live mode;
- quality flags and transformation provenance.

Provider-specific fields may be retained only inside a namespaced extension object. Consumers cannot depend on them.

## Quality Gate v1

The gate must detect and report, never silently repair:

- invalid or unknown instrument metadata;
- non-positive size or invalid price precision;
- duplicate source records and event IDs;
- out-of-order event times;
- receive time earlier than event time beyond declared clock policy;
- missing trade IDs when the provider promises them;
- unsupported aggressor classification;
- session/timezone mismatch;
- gaps relative to the fixture manifest;
- checksum or event-count mismatch.

Output is a typed quality report with `valid`, `degraded`, or `invalid`, counts, flags, warnings, and provenance.

## Transport Boundary

Use newline-delimited JSON-RPC for the Phase 1 control path because Phase 0 already proves its supervision, limits, cancellation, errors, receipts, and packaging.

Do not use JSON-RPC for unbounded live tick throughput. The protocol declares at most 1,000 requested events/sec from its 1 ms minimum pace; that is a target cap, not a measured raw transport ceiling. The measured payload policy permits at most a 750,000-byte estimated response beneath Electron's 1,000,000-byte hard frame limit. The reproducible 2026-07-14 Darwin ARM64 observation sustained 966–978 paced events/sec; 750 generated events completed at 713,568 bytes, 800 reached 761,067 bytes, and 10,000 reached 9,608,099 bytes. Larger, faster, live, or unbounded flows require a dedicated transport such as Arrow IPC, shared memory, or a local binary stream. The canonical schema remains transport-independent.

## Sidecar Capabilities v1

- `market.health`
- `market.capabilities`
- `market.load_fixture`
- `market.replay_batch`
- `market.cancel`
- `market.shutdown`

No broker, account, order, execution, credential, or network-provider capability is reachable in this slice.

Current implementation checkpoint: `health`, `capabilities`, `load_fixture`, `replay_batch`, `replay_next`, `cancel`, and `shutdown` are test-verified with supervisor lifecycle semantics. Capabilities advertise the measured JSONL policy.

Electron checkpoint: the development Python process is now resolved, supervised, contract-validated, and disposed from Electron main. Packaged Python resolution remains intentionally absent until a self-contained asset is built and smoked.

Replay/candle checkpoint: canonical replay now produces checksum-verified current price, closed candle history, and at most one developing candle under an explicit watermark. V1 is Unix-epoch aligned, omits empty candles, and is synchronously bounded to 10,000 events; session-aligned and streamed history remain future work.

Agent-context checkpoint: `agent-market-snapshot@2` bounds recent trades/candles/issues, carries freshness/quality/mapped checksums/truncation plus continuity/session admission, hashes its deterministic content, and denies execution/order authority. The supervised manager emits it through checksum-bound addressed delivery to the Order Flow specialist.

Order Flow checkpoint: `trade.analyze_market_batch` accepts a bounded replay-only canonical batch and emits `order-flow-artifact@2` plus `trade-run-receipt@2`. A real supervised Python market-data child -> real supervised Order Flow child proof produces exact `28 / 17 / 11 / 6 / 5592.25` output. The calculator has no Nautilus/provider dependency; the truncated agent snapshot is intentionally not its input.

## Determinism Requirements

- Replaying identical bytes with identical configuration yields canonical-equivalent events and quality report.
- Event ordering is explicit and stable.
- Event time is distinct from receive/process time.
- Decimal/fixed-point conversion is reversible within declared precision.
- No wall-clock reads influence event content.
- Duplicate handling is deterministic.
- Checksums cover source bytes and canonical output.

### Canonical Event Checksum v1

`canonical_events_sha256` hashes the ordered event array encoded as UTF-8 JSON with recursively lexicographically sorted object keys and no insignificant whitespace. Market decimals and nanosecond timestamps remain strings; extension numbers are restricted to safe integers. Array order is preserved. Both the quality report and batch carry the same digest.

## Repository Harvest Plan

### NautilusTrader — ADAPTER

Use public data model, catalog, wrangler, replay, instrument, and later order-book APIs. Keep it separately versioned and replaceable.

### automated-goldbach — PORT INTERNALLY AFTER CODE AUDIT

Harvest owned canonical-ingestion contracts, versioned-run patterns, paper/risk boundaries, and golden tests where they improve this spec. Do not introduce a second competing market-event model.

### QuantDinger — SELECTIVE PORT AFTER CODE AUDIT

Harvest Apache-licensed provider resilience, retry/circuit-breaker, ledger, and reconciliation patterns after the canonical event seam is green.

## Implementation Slices

1. Pin and install Nautilus in an isolated Python environment; record license/version/platform proof.
2. Add canonical market-trade event and quality-report schemas with golden examples.
3. Build a fixture-only Nautilus adapter sidecar.
4. Convert the existing ES synthetic trades into Nautilus `TradeTick` objects.
5. Emit and validate canonical events plus a deterministic batch checksum.
6. Add duplicate, out-of-order, precision, timestamp, and checksum failure tests.
7. Feed the canonical batch into an Order Flow input adapter without allowing the Order Flow engine to read provider/Nautilus objects. **Complete.**
8. Persist the run artifact and trace-linked receipt. **Complete for the canonical replay path.**
9. Benchmark JSONL and record/enforce the threshold requiring a streaming transport. **Complete for Darwin ARM64/Python 3.12.9.**

## Acceptance Criteria

- [x] Nautilus version/license and local Python `3.12.9` are pinned; Darwin ARM64 is verified.
- [ ] Windows and Linux runtime/package compatibility is smoke-verified.
- [x] A project-owned ES fixture becomes valid Nautilus `TradeTick` objects.
- [x] Trade God canonical events validate without Nautilus imports in the contract package.
- [x] Decimal/fixed-point precision round-trips exactly for canonical fixture output and contract validation.
- [x] Identical fixture replay produces canonical-equivalent output and checksum across Python and TypeScript.
- [x] Duplicate and out-of-order behavior is deterministic and visible.
- [x] Bad timestamps, sizes, price increments, checksums, malformed records/payloads, and instrument metadata produce typed quality outcomes.
- [x] Bounded replay produces deterministic current price, closed history, and a developing candle without future-event leakage.
- [x] Bounded analysis-only agent context validates with freshness, quality, provenance, truncation, and content integrity.
- [x] Provider-neutral connect/reconnect, sticky sequence gaps, explicit resynchronization, staleness, and explicit session-window admission fail closed before specialist analysis.
- [x] The Order Flow engine consumes only Trade God canonical input on the new replay path.
- [ ] Trace joins source batch, adapter logs, quality report, feature artifact, and receipt.
- [x] Paced replay cancellation and deadline are typed domain outcomes while sidecar crash remains a distinct supervisor/transport failure.
- [x] Measured JSONL payload/rate limits are advertised and unsafe replay is rejected before session creation with a typed transport error.
- [x] No live/provider/broker/order capability is reachable from the implemented fixture-only RPC.

## Explicit Non-Goals

- Live provider credentials or WebSocket feeds.
- Full-depth order books.
- Provider-supplied bars, quotes, options, news, fundamentals, or corporate actions.
- Portfolio, risk, broker, or execution integration.
- Redis or distributed infrastructure.
- Agents or LLM interpretation.
- Generalized multi-engine plugin framework.

## Go/No-Go Gate

The canonical Order Flow seam, pull-based paced replay, measured JSONL threshold, and provider-neutral readiness guard satisfy the replay-side continuity/session gate. Do not claim live readiness until a real provider proves reconnect/resynchronization behavior, an authoritative exchange calendar proves holiday/rollover windows, and dedicated-stream plus packaged-runtime gates pass.

## Grounding

Nautilus official documentation confirms that its `DataEngine` routes trades, quotes, bars, books, and custom data; its message bus uses pub/sub, request/response, and command/event patterns; its catalog persists core market data in Parquet; and its adapters normalize provider APIs into its domain model. The first slice intentionally wraps these public capabilities rather than reproducing them.

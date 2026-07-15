# Trade God Market Data Engine

Replay-only NautilusTrader adapter. This sidecar owns Nautilus-specific domain objects; Trade God contracts must never import them.

## Pinned runtime

- Local Python pin: `3.12.9` (`pyproject.toml` permits compatible `3.12.x` runtimes)
- NautilusTrader: `1.230.0`
- License: `LGPL-3.0-or-later`
- Initial supported platform: macOS ARM64, with upstream wheels also published for Linux ARM64/x86-64 and Windows x86-64.

The dependency graph is locked in `uv.lock`. Create the isolated environment with `uv sync --python 3.12.9`.

The focused test is verified on Darwin ARM64. Windows and Linux wheels are present in the lock, but those platforms remain unverified until packaging smoke runs there.

## Current capability

The project-owned ES fixture is converted into exact Nautilus `TradeTick` objects and emitted as the provider-independent Trade God canonical batch. Python and TypeScript agree on the full golden payload and canonical SHA-256. Source checksum/count mismatch fails closed; duplicate records are excluded and out-of-order input is visibly degraded.

The quality gate also returns typed outcomes for malformed payloads/records, invalid timestamps, non-positive sizes, off-tick prices, unsupported aggressors, and invalid instrument metadata.

The newline-delimited JSON-RPC command exposes health, capabilities, fixture load, paced replay/next/cancel, and shutdown. It accepts only the supervisor-configured project fixture ID—never caller-supplied paths or manifests. Health degrades if the configured fixture is missing or checksum-invalid. Capabilities explicitly deny live data, broker access, and execution and advertise the measured bounded-JSONL policy. Responses are one line each, non-standard JSON numbers are rejected, request IDs/caching are bounded, and data-quality failures include the typed quality report.

The replay protocol declares a 1 ms minimum pace (at most 1,000 requested events/sec) and enforces a measured 750,000-byte response limit; this applies to replay completion and direct fixture load. Unsafe work returns `STREAMING_TRANSPORT_REQUIRED` before an oversized result is emitted. There is no live data, network provider, broker, account, order, or execution capability.

## Verify

```bash
./.venv/bin/python -m unittest discover -s tests -v
./.venv/bin/python benchmarks/benchmark_jsonl_replay.py --mode observe --counts 100,750,800,1000,10000 --pace-ms 1 --repeats 2
./.venv/bin/python benchmarks/benchmark_jsonl_replay.py --mode enforce --counts 750,800 --pace-ms 1 --repeats 3 --assert-policy
```

Launch manually from this directory:

```bash
./.venv/bin/python -m trade_god_market_data.cli \
  --fixture-root ../../packages/trading-testkit/fixtures/es-demo
```

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

The quality gate also returns typed outcomes for malformed payloads/records, invalid timestamps, non-positive sizes, off-tick prices, unsupported aggressors, and invalid instrument metadata. The fixture-only RPC command is the next slice. There is no live data, network provider, broker, account, order, or execution capability.

## Verify

```bash
./.venv/bin/python -m unittest discover -s tests -v
```

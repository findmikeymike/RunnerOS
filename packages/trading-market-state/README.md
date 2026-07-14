# Trade God Market State

Provider-independent deterministic replay, candle history, and bounded agent market context.

## Pipeline

`canonical replay batches -> checksum verification -> event-time ordering/deduplication -> candle series -> agent market snapshot`

The package never imports NautilusTrader, Electron, a broker, or an LLM.

## Public builders

- `buildMarketReplaySnapshot`: current price, closed candles, and at most one developing candle under an explicit watermark.
- `buildAgentMarketSnapshot`: analysis-only context with recent trades, bounded candles, freshness, quality, mapped batch provenance, truncation metadata, and a content checksum.
- `assertAgentMarketSnapshotIntegrity`: schema and content-checksum verification for stored or passed snapshots.

## V1 policy

- replay input only; live and invalid-quality batches fail closed;
- Unix-epoch-aligned intervals; no synthetic empty candles;
- maximum 64 batches and 10,000 total events per synchronous replay;
- maximum 500 recent trades, 200 closed candles, and 100 quality issues in agent context;
- agent snapshots explicitly deny execution and order-submission authority.

Session-aligned bars, persistent catalogs, paced replay/cancellation, and live streaming remain separate future slices.

## Verify

```bash
bun test
bun run typecheck
```

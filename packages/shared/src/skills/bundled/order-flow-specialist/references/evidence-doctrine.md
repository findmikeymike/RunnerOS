# Order Flow Evidence Doctrine 0.1.0

## Evidence hierarchy

1. Exchange-native aggressor flags and deterministic canonical events.
2. Deterministic derived measurements with checksums and quality state.
3. Quote/trade classification explicitly labeled as inferred.
4. Visual or narrative pattern labels, always treated as hypotheses.

Never promote a lower tier into a higher one.

## Feed capability

- Trades-only supports prints, observed/inferred aggressor side, volume, delta, price response, and trade sequencing.
- MBP supports aggregated displayed quantity at price levels, not individual queue position.
- MBO supports anonymous individual orders, priority, and deeper queue evidence. It still does not reveal participant identity or intent.
- Unknown aggressor prints remain unknown; do not force them into buy or sell volume.

## Interpretation rules

- Delta describes aggressive executed volume imbalance. It does not by itself prove continuation.
- Price response is necessary context: similar flow can move price differently as liquidity changes.
- Absorption requires repeated aggressive execution with limited progress at a stable area and adequate event coverage.
- Exhaustion requires declining participation or failed continuation across a meaningful sequence; one reversal print is insufficient.
- Displayed size can be canceled, refreshed, hidden, or synthetic. Never call spoofing from a snapshot or size imbalance alone.
- Point of control is the highest observed traded-volume price in the supplied scope, not universal support or resistance.
- A tiny or truncated sample forces low confidence and an explicit no-trade reason.

## Required answer discipline

- Cite evidence by allowed reference IDs.
- State what was measured before what it may mean.
- Include the strongest competing explanation.
- Say what fresh evidence would confirm and invalidate each scenario.
- Expire the interpretation at the next context refresh unless a shorter boundary is supplied.

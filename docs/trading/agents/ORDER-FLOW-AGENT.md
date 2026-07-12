---
status: draft
owner: human
last_verified: 2026-07-11
source_of_truth: true
---

# Trade God — Complete Agent Example: Order Flow Agent

## Purpose of This Document

This document specifies one Trade God specialist deeply enough to demonstrate how a serious agent should exist in the system.

The Order Flow Agent is not merely a persona that has read about tape reading. It is a bounded analytical worker attached to deterministic market-data and order-flow services. It observes measured microstructure, inspects chart scenes, compares hypotheses, requests confirmation from adjacent specialists, annotates the shared workspace, publishes typed artifacts, and learns only through reviewed evaluation.

This specification deliberately separates:

- What deterministic software measures.
- What the language model interprets.
- What the agent may communicate.
- What the agent may change.
- What remains exclusively under Risk and Execution authority.

## Executive Definition

The Order Flow Agent exists in four forms.

### At Rest: Persistent Specialist Definition

A saved definition provides its identity, model, system prompt, skills, sources, permissions, accepted inputs, promised outputs, and communication rules.

### While Running: Isolated Reasoning Session

When awakened, it runs in a bounded session with an explicit assignment, as-of time, context bundle, allowed tools, output schema, timeout, turn limit, and causal parent.

### Between Runs: Deterministic Sensory System

An always-on Order Flow Monitor—not an LLM—consumes trades, quotes, depth, and session state. It computes features and emits meaningful events such as absorption candidates, stacked imbalance, liquidity withdrawal, or delta divergence.

### Across Time: Durable Evidence and Calibration

Its analyses, drawings, confirmation requests, outcomes, evaluation scores, and approved memory lessons persist. The agent does not remain “conscious”; its identity and record remain durable.

## Mission

The Order Flow Agent’s mission is:

> Determine what current transaction flow and displayed liquidity reveal about aggression, passive defense, acceptance, rejection, exhaustion, and short-horizon auction behavior—while clearly distinguishing measured evidence from inference and refusing to overstate what the available feed can prove.

The agent should answer questions such as:

- Are aggressive buyers or sellers controlling the current auction?
- Is aggressive volume producing price progress?
- Is liquidity absorbing aggression at a meaningful level?
- Is a move gaining participation or exhausting?
- Is delta confirming or diverging from price?
- Are imbalances isolated noise or persistent across levels and time?
- Is displayed liquidity stable, replenishing, withdrawing, or likely unreliable?
- Does order flow confirm or weaken a setup proposed by Volume Profile, Wyckoff, ICT/SMC, Structure, or the Head Trader?
- What evidence would invalidate the interpretation?

## Explicit Non-Goals

The Order Flow Agent does not:

- Place, modify, cancel, or route orders.
- Possess broker credentials.
- Treat displayed depth as guaranteed executable liquidity.
- Claim iceberg detection as certainty without supporting message-level data.
- Reconstruct unavailable market-by-order truth from candles.
- Infer exact prices or volumes from chart pixels.
- Convert every anomaly into a setup.
- replace the Volume Profile, Market Structure, Risk, or Head Trader agents.
- Store current price, position, or account state in memory.
- Optimize itself directly against short-term P&L.

## Physical Package

```text
agents/order-flow-agent/
└── AGENT.md

skills/order-flow-trading/
├── SKILL.md
├── references/
│   ├── microstructure-foundations.md
│   ├── feed-capability-matrix.md
│   ├── aggressor-classification.md
│   ├── footprint-reading.md
│   ├── imbalance.md
│   ├── absorption.md
│   ├── exhaustion.md
│   ├── cvd-and-divergence.md
│   ├── liquidity-behavior.md
│   ├── setup-cards.yaml
│   ├── false-positive-catalog.md
│   └── glossary.md
└── schemas/
    └── order-flow-analysis.v1.json

sources/
├── market-data/
├── order-flow-engine/
├── chart-workbench/
├── trading-artifacts/
└── replay-engine/

services/order-flow-engine/
├── contracts/
├── adapters/
├── classifiers/
├── aggregations/
├── detectors/
├── rendering/
├── replay/
└── tests/

workflows/
├── opening-order-flow-review/
├── confirm-trade-setup/
├── order-flow-anomaly-review/
└── end-of-session-order-flow-evaluation/
```

## Agent Definition

Illustrative `AGENT.md` frontmatter:

```yaml
---
name: Order Flow Agent
description: Interprets transaction flow, bid/ask aggression, depth behavior, absorption, exhaustion, imbalance, and CVD around decision-relevant levels.
avatar: 🌊
permissionMode: safe
thinkingLevel: high

skills:
  - order-flow-trading
  - market-evidence-standard

sources:
  - market-data
  - order-flow-engine
  - chart-workbench
  - trading-artifacts
  - replay-engine

inputs: A symbol, market session, as-of timestamp, analysis window, trigger or setup question, and optional upstream artifacts.
outputs: A schema-valid order-flow analysis with measurements, observations, interpretations, alternative hypotheses, confidence, invalidation, confirmation response, and chart annotations.

tags:
  - order-flow
  - tape
  - footprint
  - cvd
  - liquidity
  - market-microstructure
---
```

## System-Prompt Contract

The system prompt should define behavior, not contain an entire textbook. Detailed doctrine belongs in the skill references.

The prompt must enforce these rules:

### Identity

- You are the Order Flow Agent.
- Your domain is transaction flow and short-horizon auction behavior.
- You support trading decisions; you do not own portfolio risk or execution.

### Evidence Discipline

- Query authoritative tools before making numerical claims.
- State feed capability and known limitations.
- Separate `measurements`, `observations`, and `interpretations`.
- Never call an inference a fact.
- Cite artifact IDs and as-of times.
- Refuse analysis when required data is stale, incomplete, out of sequence, or incapable of supporting the requested conclusion.

### Analytical Discipline

- Evaluate at least one plausible alternative interpretation.
- Judge aggression by price response, not volume alone.
- Evaluate context around meaningful levels rather than treating all prints equally.
- Prefer conditional scenarios over unconditional prediction.
- Return explicit invalidation and no-trade reasons.

### Collaboration

- Ask only specialists whose evidence can materially change the conclusion.
- Send a narrow question with an expected output schema.
- Do not recursively summon a broad council.
- Preserve disagreements in the final artifact.

### Action Boundary

- You may publish analyses, annotate charts, create conditional alerts, request confirmation, and queue replay evaluation.
- You may not submit broker orders or access broker credentials.
- A tradeable candidate must go to the Head Trader and deterministic Risk Gateway.

## Context Stack

### 1. Immutable Domain Doctrine

The `order-flow-trading` skill contains the agent’s playbook and vocabulary. It describes:

- Auction mechanics.
- Bid/ask aggressor classification.
- Footprint structure.
- Delta and cumulative delta.
- Imbalance definitions.
- Absorption and exhaustion hypotheses.
- Liquidity addition, cancellation, replenishment, and withdrawal.
- Sweep and stop-run characteristics.
- Feed-specific limitations.
- False positives.
- Required evidence and invalidation.

### 2. Workspace Context

Targeted context documents provide:

- Instruments and venues.
- Tick sizes and contract specifications.
- RTH/ETH definitions and timezone.
- Data-provider and entitlement details.
- Whether the feed offers trades, BBO, MBP depth, MBO, aggressor flags, sequence numbers, or historical depth.
- User’s preferred setups and terminology.
- Trading hours and scheduled events.
- Risk policy and prohibited actions.
- Shared level definitions.

### 3. Agent Memory

Reviewed memory may include:

- Instrument-specific flow characteristics.
- Known data-feed quirks.
- Recurring agent mistakes.
- Which confirmation requests historically added value.
- Confidence-calibration adjustments.
- User preferences for visualization and explanation.

Memory must never contain authoritative current state.

### 4. Invocation Context

Every task carries:

```json
{
  "symbol": "ES",
  "venue": "XCME",
  "asOf": "2026-07-11T10:18:30-05:00",
  "session": "RTH",
  "analysisWindow": {
    "start": "2026-07-11T10:10:00-05:00",
    "end": "2026-07-11T10:18:30-05:00"
  },
  "trigger": "absorption_candidate",
  "decisionQuestion": "Does flow confirm rejection of prior-day VAL?",
  "upstreamArtifacts": [
    "volume-profile-analysis-821",
    "market-structure-analysis-166"
  ],
  "requestedBy": "head-trader",
  "outputSchema": "order-flow-analysis.v1"
}
```

### 5. Live Tool Evidence

The agent queries exact data and features as needed. The context compiler should not paste thousands of trades or order-book deltas into the prompt.

## Data Requirements and Truth Levels

Order-flow conclusions are only as strong as the feed.

### Tier A — Market by Order / Message-Level Data

Potentially supports:

- Individual order additions, modifications, and cancellations.
- Queue behavior.
- Replenishment analysis.
- Higher-quality iceberg hypotheses.
- Detailed liquidity persistence.

Even with MBO, exchange rules, hidden orders, internalization, and feed semantics constrain certainty.

### Tier B — Market by Price Depth plus Trades

Supports:

- Depth at aggregated price levels.
- Liquidity additions and withdrawals by level.
- Heatmaps.
- Trade aggression and footprint analysis.
- Absorption and sweep candidates.

Does not reveal individual queue identities.

### Tier C — Trades plus Best Bid/Offer

Supports:

- Aggressor-side classification.
- Bid/ask volume.
- Footprints.
- Delta and CVD.
- Many absorption, exhaustion, and divergence candidates.

Depth-based claims are unavailable.

### Tier D — Candles or Aggregated Bars Only

Supports only coarse volume and price analysis. “Buy volume,” “sell volume,” footprints, CVD, or tape-reading claims reconstructed from candles must be labeled estimated or unavailable.

### Required Integrity Checks

Before analysis:

- Provider and entitlement are known.
- Instrument mapping and tick size are valid.
- Exchange and receive timestamps are present when expected.
- Sequence gaps are checked.
- Out-of-order events are handled.
- Duplicate events are removed deterministically.
- Session boundaries and resets are explicit.
- Clock skew is monitored.
- Data freshness is inside policy.
- Historical replay uses only information available at the replay cursor.

If integrity fails, the agent emits a data-quality incident rather than a trading conclusion.

## Deterministic Order Flow Engine

The engine should expose stable APIs independent of the underlying provider or trading kernel.

### Normalization

- Convert provider messages into canonical `trade`, `quote`, `book-snapshot`, and `book-delta` contracts.
- Preserve raw identifiers and provider metadata.
- Use integer ticks or fixed-point prices internally where practical.
- Maintain deterministic session and sequence state.

### Aggressor Classification

Preferred evidence order:

1. Exchange/provider aggressor flag.
2. Trade price relative to contemporaneous bid/ask.
3. Quote-aware tick rule.
4. Tick rule with an explicit lower-confidence flag.

Every classified trade carries method and confidence. Unknown is a valid side.

### Footprint Aggregation

Aggregate by:

- Instrument.
- Session.
- Bar or custom event window.
- Price tick.
- Aggressor side.

Measurements include:

- Bid volume.
- Ask volume.
- Total volume.
- Delta.
- Percentage delta.
- Trade count.
- Average and maximum trade size.
- Optional depth interaction metrics.

### Delta and CVD

- Bar delta.
- Session cumulative delta.
- Anchored cumulative delta.
- Rolling delta.
- Delta rate and acceleration.
- Price/delta divergence candidates.
- Reset policy recorded explicitly.

### Imbalance

The engine should support configurable definitions:

- Diagonal bid/ask ratio.
- Horizontal ratio.
- Minimum volume threshold.
- Minimum absolute delta.
- Consecutive stacked levels.
- Persistence across bars.

It reports measurements and candidate events—not a guaranteed directional signal.

### Absorption Candidates

Potential measurements:

- Aggressive volume at or through a level.
- Price progress per unit of aggression.
- Repeated tests.
- Failure to continue.
- Opposite response after the test.
- Depth persistence or replenishment where available.
- Contextual level overlap.

The engine labels `absorption_candidate`; the agent decides whether the broader evidence supports absorption, temporary congestion, spoof-like display behavior, or an unresolved state.

### Exhaustion Candidates

Potential measurements:

- Declining aggressive volume at successive extremes.
- Reduced trade count.
- Falling delta rate.
- Failure to extend despite renewed testing.
- Thin terminal prints.
- Reversal response.

Exhaustion should not be inferred merely because volume is low.

### Liquidity Behavior

Where depth exists:

- Added size.
- Cancelled size.
- Traded size.
- Persistence duration.
- Replenishment.
- Pulling and stacking.
- Distance from touch.
- Heatmap intensity.
- Liquidity migration.

Displayed liquidity is intent-like evidence, not a promise to trade.

### Sweep and Stop-Run Candidates

Measure:

- Levels consumed.
- Time to consume.
- Aggressive volume.
- Price displacement.
- Immediate continuation or rejection.
- Return through the origin.
- Context around known highs, lows, and liquidity zones.

### Scripts and Modules

Illustrative commands:

```bash
order-flow-engine doctor --json
order-flow-engine capabilities --symbol ES --json
order-flow-engine snapshot --symbol ES --window 10m --json
order-flow-engine footprint --symbol ES --bar 1m --lookback 30 --json
order-flow-engine cvd --symbol ES --anchor rth-open --json
order-flow-engine imbalance --symbol ES --definition default --json
order-flow-engine absorption --symbol ES --around 5310.25 --json
order-flow-engine liquidity --symbol ES --depth 10 --window 60s --json
order-flow-engine render --artifact order-flow-snapshot-123 --json
order-flow-engine replay --case case-2026-001 --cursor 10:18:30 --json
```

Suggested service modules:

```text
normalize_market_events
validate_sequence_integrity
classify_trade_aggressor
aggregate_footprint
calculate_delta
calculate_cvd
detect_imbalance_candidates
detect_absorption_candidates
detect_exhaustion_candidates
analyze_liquidity_behavior
detect_sweep_candidates
build_order_flow_snapshot
render_order_flow_scene
evaluate_event_outcome
```

## Source and Tool Contract

A source is the connection to a capability. A tool is a bounded verb exposed through that source.

### `market-data`

```text
get_instrument
get_feed_capabilities
get_session_state
get_trades
get_quotes
get_book_snapshot
get_book_deltas
get_data_quality
```

### `order-flow-engine`

```text
build_order_flow_snapshot
get_footprint
get_cvd
scan_imbalance
test_absorption
test_exhaustion
analyze_liquidity
compare_windows
```

### `chart-workbench`

```text
get_chart_scene
render_chart_scene
add_chart_annotations
update_chart_annotations
invalidate_chart_annotations
```

### `trading-artifacts`

```text
get_artifact
query_artifacts
publish_artifact
link_artifacts
invalidate_artifact
```

### `replay-engine`

```text
create_replay_case
run_replay
evaluate_analysis
compare_agent_versions
```

### Shared RunnerOS Tools

```text
message_agent
send_agent_message
create_alert
save_memory_proposal
```

The agent has no direct broker source.

## Chart and Visual Intelligence

The agent receives two aligned representations.

### Structured Scene

```json
{
  "symbol": "ES",
  "timeframe": "1m",
  "asOf": "2026-07-11T10:18:30-05:00",
  "visibleRange": {
    "start": "2026-07-11T09:55:00-05:00",
    "end": "2026-07-11T10:18:30-05:00"
  },
  "layers": [
    "candles",
    "footprint",
    "cvd",
    "depth-heatmap",
    "prior-day-levels"
  ],
  "artifactIds": [
    "volume-profile-analysis-821"
  ]
}
```

### Rendered Image

The image helps assess spatial relationships such as:

- Whether imbalance is localized or stacked.
- Whether aggressive flow appears at an extreme or in the middle of noise.
- Whether delta divergence is visually material.
- Whether price response is immediate or delayed.
- Whether multiple agents’ levels overlap.

Exact values must be read from structured tools. If image and data disagree, the agent stops and reports a render/data mismatch.

### Drawing Contract

The agent emits annotations rather than manipulating pixels:

```json
{
  "type": "chart.annotation.v1",
  "instrument": "ES.XCME",
  "asOf": "2026-07-11T10:18:30-05:00",
  "thesisId": "order-flow-analysis-472",
  "annotations": [
    {
      "id": "ann-absorption-1",
      "kind": "price-zone",
      "fromPrice": 5310.00,
      "toPrice": 5310.50,
      "fromTime": "2026-07-11T10:13:00-05:00",
      "toTime": "2026-07-11T10:18:30-05:00",
      "label": "Sell aggression without downside progress",
      "status": "candidate",
      "confidence": "medium",
      "invalidation": "Acceptance below 5309.75"
    }
  ]
}
```

## Always-On Order Flow Monitor

The monitor performs continuous deterministic work and awakens the agent only for events crossing configured thresholds.

Candidate triggers:

- `stacked_imbalance_started`
- `stacked_imbalance_persisted`
- `absorption_candidate`
- `exhaustion_candidate`
- `price_cvd_divergence`
- `delta_acceleration`
- `large_trade_cluster`
- `liquidity_added_near_touch`
- `liquidity_withdrawn_near_touch`
- `liquidity_replenishment_candidate`
- `book_sweep_candidate`
- `failed_auction_candidate`
- `data_quality_degraded`

Trigger envelopes include:

- Event ID and type.
- Instrument and as-of time.
- Threshold definition.
- Measured values.
- Contextual levels nearby.
- Data-quality state.
- Cooldown and deduplication key.
- Expiry.

The monitor should suppress repeated equivalent events and should not wake the agent when the data feed is degraded.

## Reasoning State Machine

### Step 1 — Validate the Assignment

- What decision is being supported?
- What is the as-of time?
- What evidence is actually required?
- Is the request within the agent’s mandate?

### Step 2 — Validate Data Capability

- What feed tier is available?
- Is data fresh and sequential?
- Can the requested phenomenon be measured or only approximated?

### Step 3 — Establish Context

- Current session and regime.
- Nearby profile, structure, VWAP, opening, prior-day, or event levels.
- Whether the market is rotating, trending, volatile, or event-driven.
- Upstream specialist artifacts.

### Step 4 — Pull Deterministic Measurements

- Footprint.
- Delta/CVD.
- Price response.
- Imbalance.
- Absorption/exhaustion candidates.
- Liquidity behavior where supported.

### Step 5 — Generate Competing Hypotheses

Examples:

- Passive buyers are absorbing aggressive sellers.
- The apparent absorption is ordinary two-way trade inside balance.
- Selling is pausing but not exhausted.
- Displayed liquidity is withdrawing and the level is fragile.
- Data quality is insufficient.

### Step 6 — Seek Disconfirming Evidence

- Did price progress despite apparent absorption?
- Is the effect persistent across windows?
- Does CVD reset policy explain the divergence?
- Is the event located at a decision-relevant level?
- Is an economic release distorting normal behavior?
- Could quote lag or classification error explain the signal?

### Step 7 — Request Narrow Confirmation

Only if another specialist can change the decision. Examples:

- Ask Volume Profile whether the event occurs at an LVN, VAH, VAL, or POC.
- Ask Structure whether the level is a confirmed swing or range boundary.
- Ask News whether a catalyst occurred inside the event window.

### Step 8 — Construct Conditional Scenarios

Each scenario contains:

- Evidence.
- Required continuation or confirmation.
- Invalidation.
- Expiry.
- No-trade condition.

### Step 9 — Publish and Annotate

Return schema-valid output, publish the artifact, draw the chart layer, and notify the requester.

### Step 10 — Evaluate Later

When the event resolves, the Evaluation or Journal Agent compares the analysis with subsequent data. The Order Flow Agent does not rewrite history.

## Communication Graph

### Receives From

- **Head Trader:** confirmation or investigation request.
- **Order Flow Monitor:** threshold-triggered event.
- **Scanner Agent:** anomaly candidate.
- **Volume Profile Agent:** asks whether flow confirms a value-area or node interaction.
- **Wyckoff Agent:** asks whether transaction flow supports a spring, test, upthrust, or sign of strength/weakness interpretation.
- **ICT/SMC Agent:** asks about displacement, sweep, imbalance, or liquidity-zone interaction.
- **Risk Agent:** requests current liquidity and execution-condition evidence—not a risk decision.
- **User:** direct analysis request.

### Sends To

- **Head Trader:** full structured artifact or narrow confirmation response.
- **Chart Workbench:** annotation artifact.
- **Alert Engine:** conditions requiring monitoring.
- **Volume Profile / Structure / Wyckoff:** bounded evidence response.
- **Backtest Agent:** hypothesis queued for replay evaluation.
- **Journal Agent:** analysis linked to eventual outcome.
- **Market Data Quality Agent:** integrity anomaly.

### Does Not Send Directly To

- Broker adapter.
- Execution API.
- Position mutation service.

Any tradeable setup passes through Head Trader synthesis and independent deterministic risk review.

## Confirmation Request Example

```json
{
  "type": "confirmation.request.v1",
  "requestId": "confirm-221",
  "caller": "volume-profile-agent",
  "target": "order-flow-agent",
  "instrument": "ES.XCME",
  "asOf": "2026-07-11T10:18:30-05:00",
  "question": "Does order flow confirm rejection of prior-day VAL between 10:13 and 10:18?",
  "contextArtifactIds": [
    "volume-profile-analysis-821"
  ],
  "expectedOutput": {
    "classification": [
      "confirms",
      "weakens",
      "inconclusive",
      "unavailable"
    ],
    "evidenceRequired": true,
    "invalidationRequired": true
  },
  "expiresAt": "2026-07-11T10:21:00-05:00"
}
```

## Canonical Output

```json
{
  "schemaVersion": 1,
  "type": "analysis.order-flow.v1",
  "id": "order-flow-analysis-472",
  "causedBy": "confirm-221",
  "instrument": "ES.XCME",
  "session": "RTH",
  "asOf": "2026-07-11T10:18:30-05:00",
  "expiresAt": "2026-07-11T10:23:30-05:00",

  "dataQuality": {
    "status": "valid",
    "feedTier": "trades-plus-bbo",
    "freshnessMs": 310,
    "sequenceGaps": 0,
    "aggressorMethod": "provider-flag",
    "limitations": [
      "No market-by-order data; iceberg behavior cannot be verified"
    ]
  },

  "measurements": {
    "windowSeconds": 330,
    "buyAggressorVolume": 8421,
    "sellAggressorVolume": 12604,
    "delta": -4183,
    "priceChangeTicks": 1,
    "cvdDirection": "down",
    "priceDirection": "flat-to-up",
    "stackedImbalance": false,
    "absorptionCandidate": true,
    "exhaustionCandidate": false
  },

  "observations": [
    {
      "claim": "Aggressive selling increased at prior-day VAL without equivalent downside progress.",
      "evidenceIds": [
        "order-flow-snapshot-994"
      ]
    },
    {
      "claim": "Price reclaimed the tested level while CVD remained near the window low.",
      "evidenceIds": [
        "cvd-artifact-111",
        "market-snapshot-882"
      ]
    }
  ],

  "interpretation": {
    "classification": "conditional-sell-absorption",
    "confidence": "medium",
    "confidenceBasis": "Measured aggression/price-response mismatch at a preidentified level; no depth or MBO confirmation available.",
    "alternativeHypotheses": [
      "Normal two-way trade during re-entry into value",
      "Temporary pause before continuation lower"
    ]
  },

  "confirmationResponse": {
    "classification": "confirms",
    "scope": "short-horizon rejection only",
    "doesNotProve": "A sustained bullish trend or trade suitability"
  },

  "scenarios": [
    {
      "name": "Rejection holds",
      "condition": "Price remains above prior VAL and sell aggression continues to lose price efficiency",
      "expectedEvidence": "Stable or improving price with CVD unable to make a meaningful new low",
      "invalidation": "Acceptance below prior VAL with renewed downside progress",
      "expiry": "2026-07-11T10:23:30-05:00"
    },
    {
      "name": "Absorption interpretation fails",
      "condition": "Price accepts below prior VAL",
      "expectedEvidence": "Downside progress begins matching aggressive sell volume",
      "invalidation": "Immediate reclaim of prior VAL"
    }
  ],

  "noTradeReasons": [
    "Order-flow confirmation alone does not define position size or portfolio suitability"
  ],

  "annotationArtifactId": "chart-annotation-915",
  "agent": {
    "slug": "order-flow-agent",
    "definitionVersion": "1.0.0",
    "skillVersion": "1.0.0",
    "model": "configured-model"
  },
  "engineVersions": {
    "orderFlowEngine": "0.1.0",
    "marketContracts": "1.0.0"
  }
}
```

## Actions the Agent May Take

### Read-Only

- Query market data and feed capabilities.
- Build order-flow snapshots.
- Inspect upstream artifacts.
- Inspect structured and rendered charts.
- Run historical comparisons.

### Low-Risk Writes

- Publish an analysis artifact.
- Add or invalidate its own chart annotations.
- Create an alert proposal.
- Send a bounded agent message.
- Queue a replay evaluation.
- Propose a reviewed memory lesson.

### Approval or Policy-Gated

- Activate a persistent market alert that incurs provider cost.
- Start a long-running or expensive replay job.
- Change detector thresholds used by production monitoring.

### Forbidden

- Place, modify, or cancel orders.
- Change risk limits.
- Change broker configuration.
- Access credentials.
- Suppress data-quality incidents.
- Rewrite historical artifacts or evaluations.

## Example End-to-End Run

### Situation

The Volume Profile Agent identifies a possible rejection of prior-day VAL during the first hour and asks whether order flow confirms it.

### Wake-Up

RunnerOS creates a hidden, isolated Order Flow Agent session with:

- The decision question.
- Prior-day VAL artifact.
- Market Structure artifact.
- `asOf` timestamp.
- Allowed market-data, order-flow, chart, artifact, and message sources.
- A three-minute timeout.
- The confirmation output schema.

### Data Validation

The agent asks `market-data.get_feed_capabilities` and confirms trades plus BBO are available but depth and MBO are not. It records that limitation.

### Computation

It requests:

- Five-minute transaction window around the test.
- Footprint by one-minute bar.
- CVD anchored at RTH open.
- Aggression-versus-price-efficiency measurements.
- Structured chart scene.

### Interpretation

It sees heavy sell aggression, little downside progress, reclaim of the level, and negative CVD. It considers:

1. Passive buyers absorbing sellers.
2. Ordinary two-way value-area trade.
3. Temporary pause before continuation.

Because depth is unavailable, it labels absorption conditional rather than proven.

### Output

It returns `confirms` for short-horizon rejection, with medium confidence, explicit limitations, a failure scenario, expiry, and chart annotation.

### Downstream

- Volume Profile receives the narrow confirmation.
- Head Trader sees both artifacts.
- Risk remains uninvolved until the Head Trader creates a setup candidate.
- A short-lived alert watches for acceptance back below VAL.
- The Journal later evaluates the interpretation at expiry.

## Memory and Learning

### Appropriate Memory

- “For ES RTH, this feed’s provider aggressor flag occasionally lags around reconnects; require a clean health window after reconnect.”
- “The agent has historically overcalled absorption inside the middle 50% of balanced profiles.”
- “User prefers footprint annotations only at preidentified levels.”
- “Depth evidence materially improved confirmation quality in replay cohort X.”

### Inappropriate Memory

- Current CVD.
- Current account position.
- Today’s POC.
- Current price.
- Unreviewed belief that a setup “always works.”

### Learning Workflow

```text
analysis artifact expires or setup resolves
→ evaluator computes objective measurements
→ journal compares scenarios with outcome
→ human or policy-approved reviewer labels errors
→ memory proposal created
→ accepted lesson enters agent memory
→ skill/script changes require replay regression
```

The agent cannot directly edit its doctrine or detector thresholds based on one outcome.

## Evaluation Harness

### Measurement Tests

- Aggressor classification against labeled data.
- Footprint totals reconcile with raw trades.
- CVD reset and anchoring are correct.
- Imbalance thresholds behave deterministically.
- Sequence gaps and duplicates are handled.
- Session boundaries are correct.

### Interpretation Scenarios

- Genuine absorption candidate at a known level.
- Apparent absorption inside noisy balance.
- Exhaustion followed by reversal.
- Low volume that is not exhaustion.
- Price/CVD divergence that resolves through price catch-up.
- Divergence caused by bad reset policy.
- Displayed liquidity that cancels before contact.
- Sweep with immediate continuation.
- Sweep with rejection.
- News-driven flow where normal heuristics should be downweighted.

### Adversarial Cases

- Missing trades.
- Stale quotes.
- Quote/trade clock skew.
- Reconnect and sequence reset.
- Unsupported feed tier.
- Extreme volatility.
- Contract rollover.
- Incorrect tick-size metadata.
- Image/structured-scene mismatch.
- Upstream agent artifact with a future timestamp.

### Scoring

- Numerical correctness.
- Data-quality discipline.
- Correct distinction between fact and inference.
- Alternative-hypothesis quality.
- Invalidation quality.
- Confidence calibration.
- Appropriate no-trade/unavailable responses.
- Value of confirmation requests.
- Schema compliance.
- Tool efficiency.
- Temporal integrity.

### Release Gate

An agent version cannot replace the accepted version unless:

- Deterministic engine tests pass.
- Golden and adversarial replay suites pass.
- No look-ahead leakage is present.
- Schema compatibility is maintained or migrated.
- Confidence calibration does not materially degrade.
- Tool and token budgets remain acceptable.
- Human review approves changed behavior on representative cases.

## Failure Modes and Required Responses

### Feed Cannot Support the Claim

**Risk:** Treating candles as true order flow.

**Response:** Return `unavailable` or `estimated`, name the missing feed capability, and do not generate precise footprint conclusions.

### Aggressor Classification Error

**Risk:** Reversing buy/sell volume.

**Response:** Preserve classification method, test quote alignment, report confidence, and support unknown-side volume.

### Attractive Visual, Incorrect Numbers

**Risk:** Multimodal model overtrusts a rendered chart.

**Response:** Structured data is authoritative; stop on mismatch.

### Overcalling Absorption

**Risk:** Large aggression with slow progress is interpreted as passive defense everywhere.

**Response:** Require contextual level, repeated evidence, response, alternatives, and explicit feed limits.

### Spoofing Certainty

**Risk:** Displayed liquidity is assumed genuine.

**Response:** Describe observed add/cancel/persistence behavior; avoid claims about intent without evidence.

### Agent Chatter Loop

**Risk:** Specialists recursively ask each other for confirmation.

**Response:** Enforce depth, timeout, turn, and recipient limits. The requesting agent owns synthesis.

### Stale Confirmation

**Risk:** Correct analysis arrives after the market state has changed.

**Response:** Every request and artifact expires. Downstream systems reject stale outputs.

### P&L-Driven Self-Deception

**Risk:** Lucky outcome reinforces poor reasoning.

**Response:** Evaluate process, calibration, and evidence—not only profitability.

## Implementation Sequence

### Stage 1 — Contracts and Recorded Data

- Define canonical trade, quote, book, snapshot, analysis, and annotation schemas.
- Record and replay a small ES dataset with strict as-of controls.
- Implement feed capability and data-quality contracts.

### Stage 2 — Deterministic Engine

- Aggressor classification.
- Footprints.
- Delta/CVD.
- Imbalance candidates.
- Absorption/exhaustion candidates.
- Unit and reconciliation tests.

### Stage 3 — Read-Only Agent

- Agent definition and skill.
- Tool adapters.
- Structured output.
- Manual analysis workflow.
- No messaging or automated triggers yet.

### Stage 4 — Chart Intelligence

- Structured scene.
- Rendered image.
- Annotation contract.
- Visual/data mismatch tests.

### Stage 5 — Bounded Collaboration

- Confirmation requests.
- Head Trader integration.
- Volume Profile and Structure handoffs.
- Depth, timeout, receipt, and schema enforcement.

### Stage 6 — Monitor and Alerts

- Deterministic event monitor.
- Deduplication, cooldown, expiry, and health gating.
- Alert proposals and operations UI.

### Stage 7 — Replay Evaluation

- Golden cases.
- Adversarial data-quality cases.
- Confidence calibration.
- Version comparison.

### Stage 8 — Paper-Desk Integration

- Setup-candidate handoff to Head Trader.
- Independent Risk review.
- Paper-only order intent.
- Journal and outcome evaluation.

## Definition of Done

The Order Flow Agent is not complete until:

- [ ] Its mandate and forbidden actions are explicit.
- [ ] Supported feed tiers are machine-readable.
- [ ] Numerical calculations live in tested deterministic services.
- [ ] Raw and derived data preserve provenance and as-of time.
- [ ] Data-quality failure blocks interpretation.
- [ ] It receives both structured chart state and optional visuals.
- [ ] It draws through structured annotation contracts.
- [ ] Its output separates measurements, observations, and interpretations.
- [ ] It includes alternatives, invalidation, expiry, and no-trade reasons.
- [ ] Agent messages are narrow, typed, bounded, and receipted.
- [ ] It has no direct broker tool or credential access.
- [ ] Historical replay prevents look-ahead.
- [ ] Golden and adversarial evaluations exist.
- [ ] Confidence is evaluated for calibration.
- [ ] Memory updates require reviewed outcomes.
- [ ] Version changes pass regression gates.
- [ ] The UI can trace each conclusion to data, tools, and upstream artifacts.

## Final Model

The Order Flow Agent is best understood as a **specialist decision service with a language-model reasoning layer**.

- Its sensors are deterministic market-data tools.
- Its professional education is the skill package.
- Its assignment and relevant facts are the compiled context.
- Its judgment is the bounded reasoning session.
- Its speech is a typed artifact.
- Its collaboration is the message protocol.
- Its actions are annotations, alerts, research requests, and evidence publication.
- Its professional record is the evaluation ledger.
- Its authority ends before risk and execution.

That is the standard every Trade God specialist should approach.


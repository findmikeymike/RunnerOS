---
status: draft
owner: human
last_verified: 2026-07-11
source_of_truth: true
---

# Trade God — Integrations and Open-Source Harvest Map

## Purpose

This document is the canonical source of truth for deciding what Trade God should port, wrap, embed, study, reimplement, or reject from Michael’s public GitHub **Trading** star list.

It covers all 42 repositories present in that list on July 11, 2026. The audit looked beyond stars and README claims to current language, repository structure, license signals, activity, architecture, and concrete reusable components.

This is an architectural harvesting plan—not permission to copy everything marked useful. Every actual integration still requires:

- A fresh license and dependency review.
- A code-quality and security review.
- Reproducible deterministic tests.
- Market-data provenance and temporal-integrity checks.
- A decision about whether to port code, consume a service, or independently implement a requirement.

## Executive Decision

No starred trading repository should replace RunnerOS as the Trade God control-plane foundation.

The recommended composition remains:

```text
RunnerOS
└── desktop, agents, skills, context, memory, workflows, schedules,
    messages, permissions, approvals, outputs, receipts

Trade God contracts
└── canonical market, feature, artifact, annotation, message,
    thesis, order-intent, risk-decision and execution schemas

NautilusTrader sidecar
└── deterministic market events, books, portfolio, risk, replay,
    execution and reconciliation

Selective open-source harvest
└── data adapters, analytics, options calculations, signal engines,
    chart components, research workers, strategy examples and tests
```

The most important new finding is that **QuantDinger is the richest selective code donor**, while **OrderFlow-Analysis-Pro**, **GammaMind**, **ChartNagari**, **tradingview-mcp-jackson**, and Michael’s own **automated-goldbach** contain strong vertical pieces.

NautilusTrader remains the strongest trading kernel, but it should be wrapped rather than copied into Trade God.

## Integration Modes

### PORT

Bring specific licensed modules into Trade God, preserve attribution, adapt them to canonical contracts, and add independent tests.

### EMBED

Use a library as a dependency through its supported API. Avoid internal forks unless necessary.

### ADAPTER

Run the project or model behind a stable Trade God service boundary. Trade God owns the contract; the dependency remains replaceable.

### REBUILD

Use the project as a requirements, behavior, or product-design reference. Implement the capability independently rather than copying source.

### STUDY

Retain only conceptual, research, workflow, or visual lessons. Do not create a runtime dependency.

### SCOUT

Use a repository as a technology-discovery feed. Every linked project requires a separate audit.

### REJECT

Do not port. The project is stale, unlicensed, too thin, too risky, duplicative, or insufficiently validated.

## Priority Legend

- **P0:** Begin harvesting during the foundation/first-desk build.
- **P1:** High-value after contracts and deterministic evaluation exist.
- **P2:** Useful research or clean implementation reference.
- **P3:** Low-priority idea source.
- **Reject:** No production port.

## Complete Repository Disposition

| Repository | License signal | Priority | Mode | Primary value |
|---|---|---:|---|---|
| [QuantDinger](https://github.com/brokermr810/QuantDinger) | Apache-2.0 | P0 | PORT selectively | Agent gateway security, data-source resilience, strategy/backtest infrastructure, broker patterns, ledgers and reconciliation |
| [automated-goldbach](https://github.com/mikeybeezy/automated-goldbach) | No public license; Michael-owned | P0 | PORT internally | Canonical ingestion, event contracts, versioned runs, paper adapter, risk controls and golden tests |
| [OrderFlow-Analysis-Pro](https://github.com/mahmoud20138/OrderFlow-Analysis-Pro) | MIT | P0 | PORT selectively | Footprint, delta, CVD, order book, volume profile and order-flow pattern engines |
| [GammaMind](https://github.com/salazargodthrin-hash/gamma-mind) | MIT via `LICENSE.md` | P0 | PORT selectively | Options analytics, provider normalization, typed agents, disagreement handling and reports |
| [ChartNagari](https://github.com/Ju571nK/ChartNagari) | MIT | P0 | PORT selectively | Multi-timeframe signal rules, quality scoring, sequence tracking, MCP, alerts and safety patterns |
| [tradingview-mcp-jackson](https://github.com/LewisWJackson/tradingview-mcp-jackson) | MIT with platform notice | P0 | ADAPTER then PORT | TradingView chart, drawing, data, layout, indicator, replay and watchlist control |
| [smart-money-concepts](https://github.com/joshyattridge/smart-money-concepts) | MIT | P0 | PORT worker | Tested deterministic SMC/ICT feature functions and fixtures |
| [optionsderivatives](https://github.com/FoundationalResearch/optionsderivatives) | MIT | P0 | PORT skill | Options/derivatives doctrine and Greeks reference |
| [CVD-Divergence](https://github.com/Eipix/CVD-Divergence) | MIT | P1 | PORT algorithm | Compact extrema/divergence models and chart vocabulary |
| [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) | LGPL-3.0 | P0 | ADAPTER | Primary deterministic trading kernel |
| [QuantConnect LEAN](https://github.com/QuantConnect/Lean) | Apache-2.0 | P1 | ADAPTER | Secondary engine, brokerage coverage and reality models |
| [dxCharts Lite](https://github.com/devexperts/dxcharts-lite) | MPL-2.0 | P1 | EMBED/evaluate | Canvas charting, panes, custom drawers, events, hit testing and snapshots |
| [ai-hedge-fund](https://github.com/virattt/ai-hedge-fund) | MIT | P1 | PORT selectively | Analyst graph, typed shared state, risk/portfolio handoff and workflow UI |
| [FinGPT](https://github.com/AI4Finance-Foundation/FinGPT) | MIT code | P1 | ADAPTER | Financial NLP, sentiment and model/evaluation workers |
| [Kronos](https://github.com/shiyu-coder/Kronos) | MIT code | P2 | ADAPTER | Replaceable financial time-series model worker |
| [cross-market-state-fusion](https://github.com/humanplane/cross-market-state-fusion) | MIT | P2 | ADAPTER/research | Cross-market feature fusion and Apple-Silicon MLX experimentation |
| [gamma-scalping](https://github.com/alpacahq/gamma-scalping) | MIT | P1 | PORT as test strategy | Gamma-scalping and delta-rehedging workflow example |
| [MCP Options Order Flow](https://github.com/fintools-ai/mcp-options-order-flow-server) | MIT | P1 | PORT contracts | MCP/protobuf options-flow tools, monitoring and context formatting |
| [OrderFlowBot-NinjaTrading](https://github.com/marksantiago290/OrderFlowBot-NinjaTrading) | MIT | P2 | PORT state ideas | Semi-automatic/manual state transitions and ATM lifecycle patterns |
| [FinceptTerminal](https://github.com/Fincept-Corporation/FinceptTerminal) | AGPL/custom commercial requirement | P1 design | STUDY | Terminal information architecture, screen inventory and research UX |
| [WyckoffTradingAgent](https://github.com/YoungCan-Wang/WyckoffTradingAgent) | AGPL-3.0 | P1 domain | STUDY/compatible service | Wyckoff engine, signal lifecycle, feedback, candidate policy and replay |
| [flowsurface](https://github.com/flowsurface-rs/flowsurface) | GPL-3.0 | P1 design | STUDY/REBUILD | WebGPU heatmap, ladder, time-and-sales, stream aggregation and fixed-point units |
| [candleview](https://github.com/0xhappyboy/candleview) | AGPL-3.0 | P2 | STUDY | Programmable financial chart architecture |
| [CSharp-NT8-OrderFlowKit](https://github.com/gbzenobi/CSharp-NT8-OrderFlowKit) | No identified license | P2 | STUDY | Volumetric bars, imbalances, POC and NinjaTrader order-flow concepts |
| [Dexter](https://github.com/virattt/dexter) | No identified license | P1 concepts | STUDY/REBUILD | Financial research tools, memory, compaction, permissions, cron and evaluations |
| [atlas-gic](https://github.com/chrisworsey55/atlas-gic) | Nonstandard/unclear | P2 | STUDY | Autoresearch and self-improvement experiment patterns |
| [polymarket-pipeline](https://github.com/brodyautomates/polymarket-pipeline) | No identified license | P2 | STUDY | News-to-event classification pipeline and prediction-market workflow |
| [Market-Swarm-Agents](https://github.com/TheSnowGuru/Market-Swarm-Agents-) | GPL-3.0 | P3 | STUDY | Role taxonomy and debate/swarm ideas |
| [OrderFlow-Scalper](https://github.com/mahmoud20138/OrderFlow-Scalper) | No identified license | P3 | STUDY | Threaded monitoring and setup-state ideas; not execution code |
| [Q-Agents](https://github.com/wcqqq1214/q-agents) | MIT | P2 | STUDY then audit | Multi-agent quant workflow/research experiments |
| [MAHORAGA](https://github.com/ygwyg/MAHORAGA) | Unclear | P3 | STUDY | Sentiment and adaptive-agent concepts |
| [MTF EMA/ALMA Strategy](https://github.com/Dropio12/MTF-EMA-ALMA-Strategy-with-RSI-Supertrend-and-Advanced-Volume-Delta-Divergence-Visualization) | MPL-2.0 | P3 | STUDY | Visualization and composite-alert ideas only |
| [wyckoff-ai-model](https://github.com/AlexMGalvez/wyckoff-ai-model) | No identified license | Reject | REJECT | Stale TensorFlow.js LSTM experiment; possible ontology reference only |
| [ai-finance-trading-agent](https://github.com/SecretResell/ai-finance-trading-agent) | No identified license | Reject | REJECT | Unverified LSTM/SARSA notebook |
| [TheStoneMX Quantum View AI](https://github.com/TheStoneSpain/TheStoneMX-Quantum-View-AI) | No identified license | Reject | REJECT | Thin unvalidated prototype |
| [deep_trader](https://github.com/deependersingla/deep_trader) | No identified license | Reject | REJECT | Stale 2018 reinforcement-learning experiment |
| [reddit-sentiment-analysis](https://github.com/asad70/reddit-sentiment-analysis) | MIT | P3 | REBUILD | Simple VADER/ticker-counting prototype; current ingestion needs redesign |
| [senate-stock-watcher-data](https://github.com/timothycarambat/senate-stock-watcher-data) | No identified license | P3 | REBUILD ingestion | Disclosure schema idea; use current authoritative filings |
| [Sensibull realtime ingestor](https://github.com/studiogangster/sensibull-realtime-options-api-ingestor) | No identified license | Reject dependency | STUDY | WebSocket/reconnect concepts only; private API and terms risk |
| [institutional-trading-dashboard-nk](https://github.com/namankhandelwal900-boop/institutional-trading-dashboard-nk) | No identified license | Reject logic | STUDY UI | Screen inventory only; no institutional-grade evidence |
| [best-of-algorithmic-trading](https://github.com/merovinh/best-of-algorithmic-trading) | CC-BY-SA-4.0 list | P2 scout | SCOUT | Ranked technology-discovery feed |
| [awesome-quant](https://github.com/wilsonfreitas/awesome-quant) | No runtime license identified | P2 scout | SCOUT | Broad quant-resource discovery feed |

## P0 Detailed Harvest Plans

### 1. QuantDinger

#### Why it matters

QuantDinger is the closest repository in the list to an AI-native trading operating stack. It contains useful production-shaped infrastructure without replacing Trade God’s need for RunnerOS or NautilusTrader.

#### Strongest components

**Data-source layer**

- Base source interface.
- Provider factory.
- Cache manager.
- Circuit breaker.
- Rate limiter.
- Explicit source errors.
- Market-specific source adapters.

Candidate source path:

```text
backend_api_python/app/data_sources/
```

Trade God destination:

```text
services/market-data/providers/
services/market-data/resilience/
```

**Agent Gateway**

- Agent-specific API surface.
- Scoped tokens.
- Token hashing and access controls.
- Paper-only defaults.
- Agent-call auditing.
- Market, strategy, backtest, portfolio and job routes.

Candidate paths:

```text
backend_api_python/app/routes/agent_v1/
backend_api_python/app/services/agent_token_service.py
```

Trade God should not copy the agent runtime. Port the capability-scoping and audit patterns into RunnerOS sources, action policy and the execution gateway.

**Strategy and backtest infrastructure**

- Dataframe/indicator strategies.
- Event-driven script strategies.
- Backtest limits and presets.
- Execution and cache layers.
- Strategy versions, logs, positions and reviews.
- Experiment evolution, optimizers, scoring and regime logic.

**Execution operations**

- Broker capability contracts.
- Fill recovery.
- Position synchronization.
- Pending-order phases.
- Grid ledger reconciliation.
- Portfolio monitoring.
- Alpaca and IBKR adapters.
- Multiple crypto-venue adapters.

#### What not to transplant

- Its full Flask application.
- Its user/billing/community system.
- A second portfolio source of truth beside Nautilus.
- A second agent runtime beside RunnerOS.
- Broker adapters without independent secret, retry, fill and reconciliation review.

#### Acceptance gate

- Extracted module has a Trade God contract.
- Original Apache notices are retained.
- Failure and timeout behavior are explicit.
- Deterministic tests are independent of QuantDinger’s database/UI.
- No live route bypasses Trade God policy and receipts.

### 2. Michael’s Automated Goldbach

#### Strongest components

- CSV ingestion and schema validation.
- Monotonic timestamp and duplicate enforcement.
- Timezone normalization.
- Canonical cleaned data and validation reports.
- Primitive/event contract scaffold shared with the automated ICT tool.
- Versioned backtest run folders.
- `backtest_summary.json`, `trade_log.csv`, and `equity_curve.csv` artifacts.
- Broker-neutral execution adapter.
- Paper adapter.
- Maximum position, daily loss and emergency kill switch.
- Append-only order logs.
- Golden deterministic tests.

#### Trade God role

This should become the first internal strategy pack and the proving ground for:

- Data contracts.
- Strategy contracts.
- Run artifacts.
- Replay.
- Paper execution.
- Risk receipts.
- Regression tests.

The Goldbach strategy’s claimed edge remains independent from the infrastructure. It must pass realistic commissions, slippage, walk-forward evaluation and unseen periods.

#### Licensing action

The public repository has no standard license file. Because it is Michael-owned, internal reuse is possible, but ownership and intended distribution should be formalized before Trade God is shared commercially.

### 3. OrderFlow-Analysis-Pro

#### Strongest components

```text
data/models.py
data/candle_builder.py
data/bybit_feed.py
data/mt5_feed.py
data/database.py
analytics/volume_profile.py
analytics/delta.py
analytics/footprint.py
analytics/orderbook.py
patterns/absorption.py
patterns/initiative.py
patterns/sweep.py
patterns/exhaustion.py
patterns/divergence.py
signals/profile_framing.py
signals/aggregator.py
dashboard/websocket_manager.py
```

#### Trade God destination

```text
services/order-flow-engine/
├── normalization/
├── footprint/
├── delta/
├── volume-profile/
├── order-book/
├── detectors/
├── event-monitor/
└── replay/
```

#### Required hardening

- Define exact trade-aggressor classification.
- Separate true bid/ask flow from estimates.
- Validate MT5 and Bybit feed semantics separately.
- Preserve exchange/receive time and sequence quality.
- Add raw-trade reconciliation.
- Add recorded replay fixtures.
- Treat absorption, exhaustion and initiative as candidates, not facts.
- Remove direct signal/execution coupling.

### 4. GammaMind

#### Strongest components

**Options analytics**

```text
chain_normalizer.py
greeks.py
gamma_exposure.py
max_pain.py
walls.py
surface.py
concentration.py
```

**Provider architecture**

- Base provider contract.
- Provider registry.
- yfinance, Polygon, Databento and Tradier-oriented adapters.

**Agent architecture**

- Typed specialist specs.
- Typed per-agent schemas.
- Deterministic and LLM execution modes.
- Disagreement detector, resolver and consensus representation.
- Debate flow.
- Session memory.
- Structured memo/report generation.

#### Trade God destination

```text
services/options-engine/
agents/options-*/
skills/options-*/
packages/trading-contracts/options/
```

#### Required hardening

- Normalize contract multipliers, expiries, rates, dividends and exercise style.
- Make GEX assumptions explicit; open interest does not reveal dealer side with certainty.
- Validate max-pain and wall calculations independently.
- Remove yfinance as a production truth source.
- Preserve provider timestamp and chain completeness.
- Keep forecast output out of risk/execution authority.
- Remove committed cache/backup artifacts during extraction.

### 5. ChartNagari

#### Strongest components

- ICT, SMC, Wyckoff, TA and candlestick rule taxonomy.
- Multi-timeframe parallel analysis.
- Signal quality scoring.
- Higher-timeframe context filters.
- Signal sequence tracking.
- Per-symbol alert overrides.
- Cooldown and anti-spam behavior.
- Backtest and signal-performance tracking.
- MCP tool schemas and tests.
- Execution dispatcher, deduplication and HMAC patterns.
- Kill-switch and execution-status UI.

#### Trade God destination

```text
services/technical-structure-engine/
services/signal-lifecycle/
sources/trading-mcp/
apps/electron/trading/signal-operations/
```

#### Required hardening

- Reproduce every rule against fixed fixtures.
- Identify any future-bar confirmation.
- Separate features from scoring policy.
- Remove “AI interpretation” from deterministic signal calculation.
- Prevent multi-timeframe alignment leakage.
- Keep execution patterns behind Trade God’s enclave rather than importing its execution path.

### 6. TradingView MCP Jackson

#### Strongest components

The repository has clean separation across CLI commands, core logic and MCP tools for:

```text
alerts
batch
capture
chart
data
drawing
health
indicators
layout/pane
Pine
replay
stream
tabs/UI
watchlists
```

#### Trade God role

- Immediate bridge to an existing TradingView Desktop session.
- Chart capture and structured state collection.
- Agent-driven drawing and layout operations.
- Indicator and watchlist control.
- Replay workflow prototyping.

#### Boundary

TradingView automation is fragile and should not become authoritative market data or permanent chart state. Trade God’s native chart scene and annotation ledger should eventually become canonical.

The source is MIT, but the repository explicitly notes that its code license grants no rights to TradingView software, data, trademarks or intellectual property. Usage must comply with TradingView terms.

### 7. Smart Money Concepts

#### Strongest functions

- Fair value gaps.
- Swing highs and lows.
- BOS and CHoCH.
- Order blocks.
- Liquidity.
- Previous highs/lows.
- Session windows.
- Retracements.

The repository includes fixed expected-result CSV fixtures, which is unusually valuable.

#### Required hardening

- Make swing confirmation delay explicit.
- Prevent future-bar data from leaking into the signal timestamp.
- Version definitions because ICT/SMC terminology is subjective.
- Return deterministic features, not a final trade recommendation.
- Add instrument/timeframe robustness tests.

### 8. Options/Derivatives Skill

The existing `SKILL.md` and Greeks reference are a strong starting point for the Options Agent’s professional doctrine.

Port:

- Option-pricing vocabulary.
- Greeks relationships.
- Strategy evaluation framework.
- Hedging and volatility-trading concepts.

Do not use skill prose as the pricing engine. Calculations come from the deterministic Options Engine.

### 9. CVD Divergence

Port the MIT model vocabulary and compact detection logic:

- `Divergence`.
- `DivergenceType`.
- `PriceExtremum`.
- Extremum pairing.
- Chart annotation semantics.

Reimplement in the Trade God order-flow language with:

- Explicit confirmation delay.
- No repainting.
- True CVD source requirements.
- Recorded expected outputs.
- Divergence expiry and invalidation.

## Wrapped Engine Plans

### NautilusTrader

Use through a versioned service boundary for:

- Canonical event processing.
- Trades, quotes and order books.
- Backtesting and replay.
- Simulated exchange.
- Portfolio and accounting.
- Risk and execution.
- Reconciliation.
- Broker/data adapters.

Do not expose Nautilus internal objects directly to the UI or agents. Convert them into Trade God contracts. Pin a stable version and treat adapter upgrades as migrations.

### QuantConnect LEAN

Use only when it has a material advantage:

- Brokerage or asset coverage.
- Securities models.
- Universe selection.
- Consolidators and scheduling.
- Fill, fee, slippage and margin models.
- Mature historical research path.

LEAN and Nautilus must never manage the same live account state concurrently. A workspace selects one authoritative engine per account/strategy.

### dxCharts Lite

Evaluate these pieces:

- Multiple panes and Y scales.
- Custom data-series drawers.
- Dynamic objects.
- Crosshair and event hit testing.
- Highlights and navigation map.
- Snapshot component.
- React integration.

MPL-2.0 generally creates file-level source obligations for modified MPL files. Keep library use isolated, record modifications and obtain legal review before commercial distribution.

### FinGPT and Kronos

Treat both as replaceable model workers.

FinGPT may support:

- Financial sentiment.
- News classification.
- Financial instruction-following research.
- Model/dataset evaluation patterns.

Kronos may support:

- Probabilistic time-series scenarios.
- Representation experiments.
- Candidate forecasting features.

Neither model may become authoritative market state, risk, or execution logic. Record model and dataset terms separately from repository code licenses.

## High-Value Study Repositories

### FinceptTerminal

Study:

- Screen and navigation inventory.
- Fundamentals, economics and research organization.
- Portfolio/risk presentation.
- Native desktop performance choices.
- Provider and analytics grouping.

Do not port source without an executed commercial license if Trade God will be used in a business or distributed commercially. Fincept’s license file explicitly imposes a paid commercial-license requirement for business/internal use.

### WyckoffTradingAgent

This is the richest Wyckoff domain reference in the list.

Study:

```text
wyckoff_engine.py
wyckoff_events.py
wyckoff_v2_structure.py
signal_lifecycle.py
signal_feedback.py
candidate_ranker.py
candidate_quality.py
strategy_policy_governor.py
backtest_replay.py
backtest_report.py
backtest_grid_ranking.py
market_breadth.py
sector_rotation.py
premarket_public_brief.py
```

The generic CLI agent runtime, memory, subagents, scheduler and workflows overlap with RunnerOS and should not be adopted.

Because the repository is AGPL-3.0, direct integration must remain license-compatible. For a closed commercial Trade God, use public Wyckoff methodology and independently specified requirements rather than copying source.

### flowsurface

Use as the primary microstructure visual specification:

- Rust exchange adapter architecture.
- Fixed-point price, quantity and time types.
- Tick/time aggregation.
- WebGPU order-book heatmap.
- Ladder.
- Time and sales.
- Cumulative delta and open interest.
- Multi-pane layouts.
- Optional audio cues.

GPL-3.0 prevents casual source transplantation into a proprietary desktop application. Either remain license-compatible, use the application separately, or independently implement the requirements.

### Dexter

Study its finance tool inventory:

- Filings and filing reader.
- Earnings.
- Fundamentals and financial statements.
- Ratios.
- Beneficial ownership.
- Institutional holdings.
- Insider trades.
- Segment data.
- News and screening.

Also study:

- Research planning and scratchpads.
- Subagent progress.
- Memory chunking, MMR and temporal decay.
- Context compaction.
- Cron/heartbeat patterns.
- Permissions engine.
- Financial-agent evaluation dataset.

No direct code port should occur until a valid license is identified.

## Technology Radar Sources

### best-of-algorithmic-trading

Import project metadata—not runtime code—into a Trade God technology radar:

- Category.
- Project URL.
- License.
- Language.
- Activity.
- Stars/forks as weak signals only.
- Trade God relevance.
- Audit status.

### awesome-quant

Use as a broader discovery feed for:

- Pricing and derivatives libraries.
- Statistical packages.
- Data sources.
- Backtest engines.
- Portfolio optimization.
- Research and education.

Every linked dependency remains untrusted until independently audited.

## Canonical Component Map

| Trade God component | Primary donor | Secondary donor/reference | Final ownership |
|---|---|---|---|
| Control plane | RunnerOS | Dexter, ai-hedge-fund patterns | RunnerOS |
| Trading contracts | automated-goldbach + new schemas | QuantDinger API conventions | Trade God |
| Market-data provider layer | QuantDinger | Nautilus adapters | Trade God gateway |
| Data resilience | QuantDinger | Provider SDK practices | Trade God gateway |
| Trading kernel | NautilusTrader | LEAN where needed | Selected engine per account |
| Order-flow engine | OrderFlow-Analysis-Pro | CVD Divergence, NT8 kit | Trade God deterministic service |
| Order-flow visual requirements | flowsurface | dxCharts custom drawers | Trade God chart workbench |
| Options engine | GammaMind | optionsderivatives, gamma-scalping | Trade God deterministic service |
| Technical structure engine | ChartNagari | smart-money-concepts | Trade God deterministic service |
| Wyckoff requirements | Public methodology | WyckoffTradingAgent reference | Trade God deterministic service + agent skill |
| Chart bridge | tradingview-mcp-jackson | Existing TradingView desktop | Replaceable source adapter |
| Native charts | Lightweight Charts or evaluated dxCharts | flowsurface UX | Trade God chart workbench |
| Financial research | Direct provider tools | Dexter and FinGPT patterns | Trade God research services |
| Agent workflow patterns | RunnerOS | GammaMind, ai-hedge-fund | RunnerOS contracts |
| Strategy lab | automated-goldbach | QuantDinger, LEAN/Nautilus | Trade God |
| Execution security | Trade God enclave | QuantDinger patterns | Trade God deterministic policy |
| Replay/evaluation | Nautilus + Trade God harness | automated-goldbach golden tests | Trade God |

## Duplicate-System Rules

### One agent runtime

RunnerOS remains the agent/session/workflow/message runtime. Do not import the full agent runtimes from QuantDinger, Dexter, ai-hedge-fund, GammaMind, ChartNagari or WyckoffTradingAgent.

Harvest their domain schemas, tools, evaluation ideas and UI patterns.

### One canonical contract set

Every provider and donor converts into Trade God schemas. Do not allow each imported project to preserve its own incompatible symbol, bar, option, signal, order, portfolio or timestamp model across the app.

### One authoritative portfolio per account

Nautilus, LEAN, QuantDinger and broker SDKs cannot all own positions. The selected trading kernel plus broker reconciliation is authoritative.

### One execution enclave

No imported bot or strategy retains direct broker access. All order proposals become Trade God `order.intent` records and pass through policy, approval, idempotency and reconciliation.

### One chart scene

TradingView, dxCharts and native rendering may coexist during transition, but Trade God’s chart scene and annotation ledger become canonical.

### One artifact ledger

Imported agents and engines publish through Trade God artifacts. Project-specific Markdown/JSON reports may be attached but cannot become separate hidden truth stores.

## Licensing and Provenance Policy

### Before copying code

- Capture repository URL and exact commit SHA.
- Capture the license file and notices.
- Confirm the relevant file is covered by that license.
- Review dependencies and generated assets separately.
- Record whether modifications require disclosure.
- Record attribution requirements.
- Record model and dataset terms independently.
- Obtain legal review for AGPL, GPL, MPL, custom, unclear or commercial-restriction cases.

### Permissive does not mean trusted

MIT and Apache code can still contain:

- Security vulnerabilities.
- Incorrect financial logic.
- Data leakage.
- Hidden provider assumptions.
- Unlicensed copied code or assets.
- Unsafe execution behavior.

### No-license repositories

Public visibility does not grant reuse rights. No source code should be copied from a repository without an identified license unless Michael owns the code and ownership/distribution is documented.

### Copyleft projects

AGPL, GPL and MPL have materially different obligations. “Put it in a sidecar” is not a universal legal exemption. The integration and distribution model requires project-specific review.

## Porting Workflow

Every harvested component follows this sequence.

### 1. Intake Record

Create:

```text
source repository
commit SHA
license
files/modules considered
reason for use
target Trade God component
owner
```

### 2. Contract First

Define the Trade God input/output contract before copying or adapting implementation.

### 3. Baseline the Donor

- Run existing tests.
- Capture expected outputs.
- Identify missing test classes.
- Record provider and environment assumptions.

### 4. Extract Minimally

Port the smallest coherent module. Avoid copying entire applications, UI systems, authentication stacks or databases.

### 5. Normalize

- Symbols.
- Prices and tick sizes.
- Quantities and contract multipliers.
- Timezones and calendars.
- Provider timestamps.
- Session definitions.
- Error and data-quality states.

### 6. Add Trade God Tests

- Golden fixtures.
- Temporal-integrity tests.
- Missing/stale-data cases.
- Provider mismatch cases.
- Replay determinism.
- Schema validation.
- Permission tests for actions.

### 7. Run in Shadow Mode

Compare imported output with the existing or manually reviewed baseline without influencing orders.

### 8. Promote or Reject

Promotion requires measured value. A donor module can be rejected after extraction if it adds complexity without reliable improvement.

## Recommended Extraction Order

### Wave 1 — Contracts and Strategy Proving Ground

1. Reuse automated-goldbach ingestion/run/event patterns.
2. Define Trade God market, feature, strategy, artifact and receipt contracts.
3. Add source/commit/license provenance to every imported module.

### Wave 2 — Data and Reliability

1. Port QuantDinger provider base/factory concepts.
2. Port cache, rate-limit and circuit-breaker patterns.
3. Establish provider health, capability and freshness contracts.

### Wave 3 — Market Structure Services

1. Extract OrderFlow-Analysis-Pro calculations into a standalone service.
2. Add CVD Divergence under explicit non-repainting rules.
3. Port smart-money-concepts as a tested worker.
4. Extract ChartNagari feature/rule definitions after fixture reproduction.

### Wave 4 — Options Desk

1. Extract GammaMind chain normalizer and options calculations.
2. Port optionsderivatives doctrine into the Options Agent skill.
3. Use gamma-scalping as a replay strategy card.
4. Convert options-flow MCP contracts into native Trade God tools.

### Wave 5 — Visual Workbench

1. Integrate tradingview-mcp-jackson as the bridge.
2. Establish canonical chart scene and annotation schemas.
3. Evaluate Lightweight Charts versus dxCharts for the native base.
4. Independently implement footprint, ladder, time-and-sales and heatmap requirements informed by flowsurface.

### Wave 6 — Agent and Research Patterns

1. Map ai-hedge-fund analyst graph into RunnerOS workflows.
2. Recreate GammaMind disagreement handling through typed artifacts.
3. Implement direct provider-based financial tools inspired by Dexter.
4. Add FinGPT and Kronos only as optional evaluated workers.

### Wave 7 — Trading Kernel and Execution

1. Add Nautilus behind Trade God contracts.
2. Establish replay, portfolio, risk and paper execution.
3. Port QuantDinger agent-token/paper-lock/audit patterns into the execution gateway.
4. Add LEAN only for a proven coverage gap.

## Integration Acceptance Checklist

- [ ] Repository and exact commit recorded.
- [ ] License and notices recorded.
- [ ] File-level reuse rights verified.
- [ ] Dependency and model/dataset terms reviewed.
- [ ] Trade God contract exists before implementation.
- [ ] Module does not create a second source of truth.
- [ ] Provider assumptions are explicit.
- [ ] Timestamps, timezones and as-of semantics are validated.
- [ ] Numerical outputs reconcile against fixtures.
- [ ] Look-ahead and repainting tests exist.
- [ ] Failure, timeout and stale-data behavior are explicit.
- [ ] No broker credential reaches an agent or imported strategy.
- [ ] External actions pass through policy and receipts.
- [ ] Existing donor tests pass or their failure is understood.
- [ ] Independent Trade God tests pass.
- [ ] Shadow/replay comparison completed.
- [ ] Performance, latency and cost are acceptable.
- [ ] Observability and version reporting exist.
- [ ] Rollback or replacement path exists.
- [ ] Documentation reflects implementation truth.

## Final Recommendation

The first three repositories to mine at code level are:

1. **QuantDinger** for provider resilience, agent gateway security, strategy operations, ledgers and broker patterns.
2. **OrderFlow-Analysis-Pro** for the initial deterministic order-flow engine.
3. **GammaMind** for the initial options engine and typed disagreement architecture.

Michael’s **automated-goldbach** should be ported alongside them as the first owned strategy pack and the proof that contracts, replay, paper execution, risk and regression artifacts work end to end.

The first external engine to integrate should be **NautilusTrader**.

The first temporary chart integration should be **tradingview-mcp-jackson**.

The first native technical workers should be built from **smart-money-concepts**, validated **ChartNagari** rules, and independently specified Wyckoff requirements.

The governing rule is simple:

> Port deterministic calculations, resilient adapters, schemas, tests, evaluation harnesses and proven operational patterns. Rebuild agent workflows inside RunnerOS. Wrap large engines. Quarantine models. Copy no trading claim, backtest result or execution path without independent reproduction.


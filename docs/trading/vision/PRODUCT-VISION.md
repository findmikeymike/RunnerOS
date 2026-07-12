---
status: draft
owner: human
last_verified: 2026-07-11
source_of_truth: true
---

# Trade God — Product Vision and System Architecture

## Executive Thesis

Trade God is not “ChatGPT for trading,” a collection of indicator bots, or a dashboard with an AI sidebar. It is a **desktop trading operating system**: a visible market command center powered by a hidden network of bounded specialist agents, deterministic analytics, event-driven workflows, persistent context, chart-native artifacts, and a hardened execution enclave.

The product should feel like a fusion of:

- A professional trading terminal.
- Claude Desktop or Codex Desktop for specialist intelligence and tool use.
- RunnerOS for agents, workflows, automations, context, permissions, and receipts.
- A research laboratory for scanners, backtests, replay, models, and notebooks.
- A trading desk where specialists communicate through explicit evidence and typed handoffs.

The AI is underneath the product—not the visual center of it. Users should primarily see charts, watchlists, profiles, scanners, briefs, theses, alerts, portfolio state, operations, and evidence. Conversation is one control surface among many.

The core product promise is:

> Give an individual trader the coordinated analytical depth, operational discipline, memory, and specialist coverage of a serious multi-desk trading operation—without pretending that language models should own market truth, risk, or broker execution.

## Decisive Foundation Choice

Trade God should begin as a **first-class Trading Workspace inside the RunnerOS monorepo**, not as a hard fork of a trading terminal and not merely as a collection of prompts.

RunnerOS remains the control plane:

- Desktop application shell.
- Agent definitions and activation.
- Skills and reference knowledge.
- Sources, MCP servers, APIs, and local CLIs.
- Agent-to-agent messaging.
- Workflows, automations, scheduled jobs, and triggers.
- Workspace context and memory.
- Permissions, approvals, receipts, and artifacts.
- Background sessions and model routing.

Trading-specific functionality enters through a custom workspace UI, trading contracts, and isolated services. The product can later be packaged or branded separately as “Trade God” or “RunnerOS Trading Edition” without prematurely splitting the engine.

No surveyed open-source project is strong enough to serve as the whole product. The correct strategy is compositional:

- **RunnerOS** is the brain and operating room.
- **NautilusTrader** is the recommended deterministic trading spine.
- **TradingView Lightweight Charts** is the initial chart surface.
- **Python/Rust analytics services** are the senses.
- **Specialist agents** are analysts and coordinators.
- **The execution enclave** is the only component allowed to touch broker authority.

## Product Principles

### 1. Deterministic truth before generative interpretation

Prices, positions, orders, Greeks, profiles, indicators, fills, P&L, risk, and timestamps come from deterministic systems. Agents may interpret those facts but must not fabricate or mentally calculate them.

### 2. Typed artifacts before chat transcripts

Agents exchange structured observations, analyses, chart annotations, theses, confirmation requests, risk decisions, and receipts. Free-form conversation may accompany them, but it is not the canonical system state.

### 3. Context is compiled, not dumped

Each agent receives only the doctrine, instruments, policies, memory, current market state, upstream artifacts, and tools relevant to its assignment. Raw tick history and giant chat logs are queried through tools rather than inserted into prompts.

### 4. Specialists over one omniscient mega-agent

The Head Trader coordinates. Domain specialists do the analysis. The Risk Agent evaluates exposure. The Execution Gateway enforces policy. No agent gets every tool or every permission.

### 5. Visual work is first-class

Charts are not screenshots attached after the fact. They are shared workspaces with structured scene state, versioned annotations, provenance, replay, and agent-specific layers.

### 6. Paper, replay, and shadow mode before live authority

Every analytical and execution path earns trust through historical replay, walk-forward evaluation, shadow decisions, paper trading, failure injection, and calibrated receipts before live use.

### 7. Evidence can disagree

The system must preserve conflicting analyses. A Wyckoff Agent and Order Flow Agent may disagree. The Head Trader should see the conflict, evidence, confidence, and invalidation conditions—not a falsely unanimous answer.

### 8. No hidden autonomy

Every background action has an origin, mandate, data snapshot, tool history, policy boundary, result, and receipt. Autonomy is explicit, scoped, expiring, and reversible.

## The Three-Plane Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  EXPERIENCE PLANE                                                       │
│  Charts • Watchlists • Scanners • Briefs • Portfolio • Journal • Ops   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│  AGENT CONTROL PLANE — RunnerOS                                        │
│  Head Trader • Specialists • Skills • Context • Memory • Workflows     │
│  Schedules • Messages • Approvals • Artifacts • Receipts • Evaluation  │
└───────────────────────┬──────────────────────────────┬──────────────────┘
                        │ selected snapshots/artifacts │ approved intents
┌───────────────────────▼──────────────────────────────▼──────────────────┐
│  DETERMINISTIC TRADING PLANE                                           │
│  Data adapters • Event bus • Feature engines • Replay • Portfolio      │
│  Risk policy • Execution gateway • Broker reconciliation • Kill switch │
└─────────────────────────────────────────────────────────────────────────┘
```

The agent control plane and trading data plane must remain separate.

- High-frequency ticks, quotes, depth, and order events never flow through the general LLM queue.
- Deterministic monitors reduce streams into meaningful events and snapshots.
- Agents awaken for interpretation, investigation, planning, escalation, and communication.
- Only selected analysis artifacts and approved order intents cross into the execution boundary.

## Major Components

### Desktop Experience

The desktop application should provide these primary workspaces:

#### Command Center

- Market regime summary.
- Today’s catalysts and scheduled risk.
- Current hypotheses and conflicts.
- Active alerts and triggered workflows.
- Portfolio exposure and risk state.
- Agent operations, failures, and pending approvals.

#### Chart Workbench

- Multi-chart layouts and linked symbols/timeframes.
- Price, volume, order flow, profile, volatility, and event overlays.
- Agent-specific annotation layers.
- “Why is this here?” provenance for every drawing.
- Replay mode with strict as-of controls.
- Compare-current-to-historical-pattern views.

#### Scanner Lab

- Deterministic scanners.
- Agent-authored scanner hypotheses.
- Saved universes and ranking criteria.
- Evidence drill-down.
- Replay and forward-validation results.

#### Research Desk

- Fundamentals, filings, transcripts, economic data, news, sentiment, and thematic research.
- Cited research artifacts rather than ephemeral summaries.
- Company, instrument, sector, macro, and event dossiers.

#### Strategy and Backtest Lab

- Strategy definitions and parameters.
- Historical replay.
- Walk-forward testing.
- Parameter stability and regime analysis.
- Cost, slippage, liquidity, and capacity assumptions.
- Agent change comparisons.

#### Portfolio and Risk

- Positions, orders, fills, exposures, Greeks, correlations, concentration, and loss limits.
- Risk-envelope configuration.
- Approval inbox.
- Kill switches and incident state.

#### Operations

- Agent inboxes and job queue.
- Workflow runs.
- Scheduled jobs.
- Data-source health.
- Tool and service health.
- Model usage and cost.
- Receipts and audit logs.

#### Journal and Evaluation

- Thesis-to-outcome trace.
- Chart state at decision time.
- What each agent believed.
- What evidence was missing or wrong.
- Setup performance and confidence calibration.
- Human review and approved memory updates.

### Agent Runtime

An agent is a persistent definition that becomes an isolated runtime session when invoked. Its definition includes:

- Identity and mandate.
- Model and reasoning level.
- Permission mode.
- Skills and references.
- Allowed sources and tools.
- Accepted inputs and promised outputs.
- Communication rules.
- Action boundaries.

At runtime, the context compiler assembles a bounded context bundle. A run may originate from the user, Head Trader, another agent, workflow, schedule, webhook, scanner, market event, or evaluation harness.

### Market Data Gateway

The gateway normalizes provider-specific feeds into versioned internal contracts:

- Instrument metadata.
- Bars.
- Trades.
- Quotes.
- Book snapshots and deltas.
- Options chains and Greeks.
- Corporate actions.
- Fundamentals.
- Economic series.
- News and event records.

Every record must preserve provider, venue, entitlement, receive timestamp, exchange timestamp when available, sequence information, and data-quality flags.

### Deterministic Feature Services

Examples include:

- Technical structure and swing extraction.
- Volume and volume-profile computation.
- Order-flow aggregation.
- Options volatility and exposure analytics.
- Market breadth.
- Cross-asset state.
- Regime classification.
- Fundamental ratios and revisions.
- Sentiment aggregation.
- Pattern-candidate detection.

These services return measurements and candidate classifications. Agents interpret, compare, explain, and decide what investigation should happen next.

### Trading Kernel

NautilusTrader is the recommended default kernel because it supplies a deterministic event-driven foundation for market data, books, portfolio state, risk, execution, reconciliation, backtesting, and live-trading parity. It should be pinned to a known version and hidden behind Trade God’s own stable API.

QuantConnect LEAN may later operate as a secondary compatibility engine when its asset, brokerage, or reality-model coverage is materially useful. Two kernels must never co-own one live account or strategy state.

### Execution Enclave

The enclave is a separate trust zone containing:

- Broker credentials stored through the operating-system keychain or equivalent secure storage.
- Account and instrument allowlists.
- Deterministic risk rules.
- Order-intent validation.
- Idempotency and stale-intent rejection.
- Order throttles.
- Broker adapters.
- Reconciliation.
- Emergency stop controls.

Agents cannot access broker secrets or direct broker network routes. They may submit an `order.intent` to the enclave. The enclave may reject it regardless of agent confidence or user-interface state.

## Canonical Data and Artifact Contracts

Trade God should standardize a small number of versioned envelopes:

```text
market.instrument.v1
market.bar.v1
market.trade.v1
market.quote.v1
market.book-delta.v1
market.snapshot.v1
feature.snapshot.v1
analysis.artifact.v1
chart.annotation.v1
confirmation.request.v1
trade.thesis.v1
trade.setup-candidate.v1
order.intent.v1
risk.decision.v1
execution.event.v1
agent.message.v1
action.receipt.v1
evaluation.result.v1
```

Every analytical artifact should contain:

- Schema version.
- Unique ID and causal parent IDs.
- Instrument and market session.
- `asOf` time.
- Data sources and freshness.
- Input artifact IDs and hashes.
- Deterministic feature-engine versions.
- Agent, model, prompt, skill, and tool versions.
- Measurements.
- Observations.
- Interpretations.
- Alternative hypotheses.
- Confidence and calibration basis.
- Conditions, targets, and invalidations.
- Known limitations and no-trade reasons.
- Chart annotation references.
- Creation time and expiry.

This makes analysis reproducible and prevents an attractive paragraph from becoming invisible system truth.

## Context and Memory Architecture

Context is divided into separate truth classes.

### Market Truth

Raw and normalized market, account, order, and portfolio records. These are authoritative and queried through deterministic services.

### Derived Features

Rebuildable calculations keyed by instrument, timeframe, session, as-of time, input version, and engine version.

### Research Knowledge

Filings, transcripts, economic releases, news, provider documentation, trading doctrine, and cited external research. Semantic search is appropriate here.

### Workspace Context

User goals, traded markets, session definitions, risk policy, terminology, preferred setups, provider constraints, and operating procedures. Documents are routed to only the agents that need them.

### Agent Memory

Reviewed lessons, domain-specific preferences, known error patterns, and calibration notes. Agent memory must never replace fresh market or portfolio queries.

### Run Context

The exact assignment, as-of time, trigger, upstream artifacts, allowed tools, time budget, output schema, and completion contract for one invocation.

### Decision Ledger

Immutable theses, confirmation requests, risk decisions, approvals, order intents, execution events, and outcomes. The ledger is the basis of journal review and evaluation.

## Specialist Desk Map

The initial roster may include:

### Coordination

- Head Trader / CIO.
- Market Operations Coordinator.
- Skeptical Reviewer.

### Market State

- Market Data Quality Agent.
- Regime Agent.
- Cross-Market Agent.
- Breadth Agent.

### Technical and Auction Structure

- Price Structure Agent.
- Volume Profile Agent.
- Order Flow Agent.
- Wyckoff Agent.
- ICT / Smart Money Concepts Agent.
- Volatility Agent.

### Fundamental and Event Research

- Fundamental Agent.
- Macro Agent.
- News and Catalyst Agent.
- Sentiment Agent.
- Filings and Transcript Agent.

### Derivatives

- Options Chain Agent.
- Options Flow Agent.
- Volatility Surface Agent.
- Dealer Exposure Agent.

### Research and Validation

- Scanner Agent.
- Quant Research Agent.
- Backtest Agent.
- Replay Agent.
- Model Evaluation Agent.

### Capital and Operations

- Portfolio Agent.
- Risk Agent.
- Execution Coordinator.
- Journal Agent.
- Compliance and Audit Agent.

Not all agents need to run for every decision. The Head Trader chooses the smallest useful team based on the problem.

## Agent Communication Model

Agent communication is a durable task protocol—not an endless group chat.

Every request specifies:

- Caller and target.
- Task and decision being supported.
- Context references.
- Allowed skills and sources.
- Expected output and JSON schema.
- Priority.
- Timeout, turn budget, and depth limit.
- Whether progress updates are allowed.

Every result returns:

- Status.
- Child session and receipt IDs.
- Structured output.
- Summary.
- Tools used.
- Duration.
- Error or timeout information.

Agents may request narrow confirmations. For example, the Volume Profile Agent may ask the Order Flow Agent whether absorption is present at a value-area boundary. It should not send its entire session transcript or recursively summon a full trading council.

## Workflows, Schedules, and Triggers

### Time-Based

- Overnight summary.
- Pre-market brief.
- Opening-range review.
- Scheduled economic-event preparation.
- Midday state check.
- Closing review.
- Daily journal.
- Weekly strategy evaluation.

### Event-Based

- Price enters or exits a significant zone.
- Profile structure changes.
- Order-flow anomaly occurs.
- Options exposure crosses a threshold.
- News or filing arrives.
- Data feed becomes stale or inconsistent.
- Portfolio risk approaches a limit.
- Broker state diverges from local state.

### State-Based

- Market transitions from balance to imbalance.
- A thesis becomes confirmed, invalidated, expired, or conflicted.
- A setup candidate becomes eligible for risk review.
- A paper-trading evaluation reaches its sample threshold.

Deterministic monitors should emit these triggers. Agents decide what the event means and whether further investigation is justified.

## Chart-Native Intelligence

The Chart Workbench owns a canonical scene graph:

- Instrument, timeframe, session, and as-of state.
- Visible series and feature layers.
- User and agent drawings.
- Drawing provenance and thesis links.
- Replay cursor.
- Selected events and artifacts.

Agents consume both structured scene data and rendered images.

- Structured data supplies exact values.
- Images supply spatial gestalt.
- Agents must never infer exact prices solely from pixels.
- Conflicts between rendered and structured state are treated as data-quality incidents.

Agents draw by emitting `chart.annotation` artifacts. They do not directly manipulate canvas pixels or browser DOM. An annotation can be accepted, hidden, compared, replayed, expired, or invalidated.

## Open-Source Integration Strategy

Third-party projects occupy one of four integration modes.

### Embed

Use permissively licensed libraries directly when their role is narrow and stable.

- TradingView Lightweight Charts for the initial chart layer.
- Selected MIT/Apache indicator and analysis libraries after tests.

### Sidecar or Adapter

Keep engines behind Trade God contracts.

- NautilusTrader for trading-kernel functions.
- LEAN for later compatibility use cases.
- Qlib and RD-Agent for offline quant research.
- Broker and data-provider SDKs.

### Workflow or Doctrine Donor

Rebuild the useful idea inside Trade God rather than adopting the runtime.

- TradingAgents for analyst-role decomposition and debate patterns.
- `ai-hedge-fund` and multi-agent trading projects for desk archetypes.
- FinceptTerminal and OpenBB Workspace for terminal capability and UX inspiration.

### Study and Reimplement

Use code or visuals only as research when licensing, quality, maintenance, or architecture makes direct integration unsafe.

- GPL chart/order-flow projects.
- Unlicensed indicator repositories.
- Thin prototypes with unverified calculations.
- Repositories making extraordinary backtest claims without robust evidence.

Licenses must be rechecked at integration time. Network/service separation is not a magical license exemption, and legal review may still be required for commercial distribution.

## Order-Intent and Risk Boundary

An agent may construct a proposal:

```text
instrument
side
order type
entry condition
maximum quantity or risk budget
stop/invalidation
targets
time-in-force
expiry
supporting thesis IDs
required approvals
```

The deterministic gateway independently checks:

- Instrument and account authorization.
- Market state and trading hours.
- Data freshness.
- Position, exposure, leverage, and concentration.
- Maximum order and daily-loss limits.
- Risk at stop.
- Spread, liquidity, slippage, and volatility.
- Duplicate and idempotency keys.
- Stale-intent expiry.
- Strategy and user policy.
- Broker connectivity and reconciliation state.

Initial modes:

1. Research only.
2. Shadow decisions.
3. Replay.
4. Paper trading with human confirmation.
5. Paper trading with bounded automation.
6. Live trading with human confirmation.
7. Narrow live autonomy under an expiring risk envelope.

No mode silently upgrades itself.

## Observability and Receipts

Every important action should be reconstructable:

- Why the agent ran.
- What exact context it received.
- Which tools and versions it used.
- What data was fresh or stale.
- Which other agents it contacted.
- What artifact it produced.
- What approval or policy applied.
- What action occurred.
- Whether the observed result matched the intended result.

Operational views should expose:

- Queue depth and stuck runs.
- Service health and data lag.
- Tool failures.
- Model latency and cost.
- Agent timeout and retry rates.
- Schema-validation failures.
- Broker/local-state divergence.
- Open incidents and disabled capabilities.

## Evaluation System

Agents are not accepted because their prose sounds expert. They are evaluated on replayable tasks.

Evaluation dimensions include:

- Measurement correctness.
- Evidence completeness.
- Temporal integrity and look-ahead prevention.
- Scenario quality.
- Invalidation clarity.
- Confidence calibration.
- Appropriate no-trade decisions.
- Usefulness of agent-to-agent requests.
- Tool choice and efficiency.
- Robustness to missing, stale, or contradictory data.
- Stability across model or skill changes.

Each agent needs:

- Golden scenarios.
- Adversarial scenarios.
- Missing-data cases.
- Stale-data cases.
- Conflicting-evidence cases.
- Replay scorecards.
- Version-to-version regression gates.
- Human review criteria.

P&L is an outcome measure, not sufficient proof of analytical quality. Short-term profitability can result from luck, leakage, overfitting, or hidden exposure.

## Recommended First Vertical Slice

Build one coherent paper-only index desk rather than dozens of shallow agents.

Suggested scope:

- ES futures for centralized order-flow and auction data.
- SPY/SPX context for index, options, and cross-market analysis.
- One reliable market-data path.
- Native charts and agent annotation layers.
- Head Trader.
- Market Data Quality Agent.
- Volume Profile Agent.
- Order Flow Agent.
- News/Catalyst Agent.
- Options Context Agent.
- Risk Agent.
- Journal/Evaluation Agent.

Golden workflow:

```text
Overnight ingestion
→ pre-market brief
→ regime and catalyst map
→ prior/overnight/current profile construction
→ opening order-flow monitoring
→ specialist artifacts and chart annotations
→ bounded confirmation requests
→ Head Trader synthesis
→ deterministic risk review
→ paper order or explicit no-trade
→ execution receipt
→ end-of-session evaluation and memory proposal
```

## Phased Roadmap

### Phase 0 — Contracts and Proof Architecture

- Create a dedicated clean worktree.
- Define internal market, feature, artifact, context, annotation, message, order-intent, risk, and receipt schemas.
- Document licensing and provider constraints.
- Build service health contracts.
- Establish replay clock and strict as-of semantics.

Exit gate: the same recorded scenario can be replayed deterministically with no future-data leakage.

### Phase 1 — Read-Only Research Cockpit

- Market data gateway.
- Chart Workbench.
- Profile and order-flow deterministic services.
- Initial specialist agents.
- Artifact ledger and provenance.
- Manual and scheduled briefs.

Exit gate: agents produce numerically grounded, schema-valid, replayable analyses and annotations.

### Phase 2 — Replay and Evaluation

- Historical event replay.
- Golden scenario suite.
- Agent scorecards.
- Confidence calibration.
- Change regression tests.
- Journal and outcome linkage.

Exit gate: accepted agents meet explicit quality bars across unseen replay periods.

### Phase 3 — Paper Trading

- Portfolio and risk state.
- Order-intent contract.
- Deterministic gateway.
- Paper broker adapter.
- Approval UI.
- Reconciliation and kill switch.

Exit gate: repeated paper sessions complete with correct risk checks, receipts, recovery, and reconciliation.

### Phase 4 — Bounded Automation

- Expiring risk envelopes.
- Event-driven setup monitoring.
- Automated paper execution within policy.
- Incident drills and stale-state recovery.

Exit gate: automation stops safely under feed loss, broker errors, duplicate events, stale signals, and state divergence.

### Phase 5 — Narrow Live Pilot

- One broker.
- One account.
- Limited instruments.
- Small hard-capped exposure.
- Human confirmation.
- Live observability and incident procedure.

Exit gate: evidence supports expanding scope; expansion is never automatic.

## Anti-Goals

Trade God should not become:

- A swarm that chats endlessly without durable outputs.
- A prompt marketplace disguised as a trading system.
- A black-box signal seller.
- A system that reconstructs unavailable order flow and presents it as truth.
- A strategy optimizer that hides overfitting.
- An autonomous broker client controlled directly by an LLM.
- A giant monolith combining UI, market feeds, research, risk, and execution in one process.
- A copy-paste accumulation of incompatible open-source projects.
- A system where memory can override current positions, prices, or broker state.
- A terminal that foregrounds AI theater instead of trading work.

## Initial Architecture Decisions

### ADR-001: RunnerOS is the control-plane foundation

**Decision:** Extend RunnerOS with a first-class Trading Workspace and trading services. Do not hard-fork immediately.

**Reason:** RunnerOS already owns expensive generic primitives. Keeping one engine reduces duplicated orchestration and lets trading-specific boundaries mature before product separation.

### ADR-002: Separate agent and market/execution planes

**Decision:** High-frequency and authoritative trading state remains outside the general agent runtime.

**Reason:** LLM queues are inappropriate for deterministic sequencing, latency, market truth, risk, and reconciliation.

### ADR-003: NautilusTrader is the default kernel candidate

**Decision:** Integrate behind a pinned, versioned sidecar API; do not couple product contracts to its internal types.

**Reason:** Its event-driven Rust core and backtest/live architecture complement RunnerOS without attempting to replace the UI or agent layer.

### ADR-004: Agents produce typed artifacts

**Decision:** Canonical outputs are schema-valid artifacts with provenance, not only prose.

**Reason:** Coordination, evaluation, replay, UI, and safety all require machine-readable state.

### ADR-005: Execution is an enclave

**Decision:** Agents cannot possess broker credentials or place orders directly.

**Reason:** Risk authority must remain deterministic, auditable, and independently rejectable.

### ADR-006: Visuals are structured and replayable

**Decision:** Agents read structured scene state plus images and draw through annotation contracts.

**Reason:** Exact measurements require data; useful spatial reasoning benefits from visuals; replay and provenance require structured drawings.

## Product Success Criteria

Trade God succeeds when:

- A user can understand the market state without interrogating a chatbot.
- Specialist analyses are visibly grounded in current data.
- Every important claim links to evidence and an as-of snapshot.
- Agents can disagree without losing their individual reasoning.
- Chart annotations are attributable and replayable.
- A full thesis can be traced from trigger through analysis, risk, action, and outcome.
- Replay produces the same deterministic features and system state.
- Agent changes are evaluated before release.
- The system chooses no-trade when evidence is weak.
- Paper and live actions are protected by deterministic policy, approval, idempotency, reconciliation, and kill switches.
- Third-party components can be upgraded or replaced without rewriting the whole product.

## Final Product Framing

Trade God should be understood as an **installable trading institution for one operator**.

The user is not hiring one magical robot trader. They are operating a disciplined desk:

- Deterministic systems observe and calculate.
- Specialists interpret defined domains.
- The Head Trader synthesizes rather than impersonating every specialist.
- Risk has independent authority.
- Execution has restricted authority.
- Every conclusion leaves evidence.
- Every action leaves a receipt.
- Every outcome becomes evaluation material.

That architecture is what turns an impressive demo into a trustworthy trading operating system.


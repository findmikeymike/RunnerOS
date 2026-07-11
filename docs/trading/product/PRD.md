---
status: draft
owner: human
last_verified: 2026-07-11
source_of_truth: true
---

# Trade God Product Requirements

## Product Thesis

Trade God is not a chatbot with trading tools. It is an evidence-first trading operating system: deterministic market engines, specialist reasoning agents, shared context, visual analysis, replay and evaluation, workflow automation, and carefully bounded execution inside one desktop command center.

## Primary User

An active discretionary/systematic trader who wants many expert lenses without managing fragmented terminals, scripts, dashboards, chats, and repositories.

## Core Job

Turn raw market information into a traceable decision process:

`observe -> calculate -> interpret -> challenge -> synthesize -> plan -> approve -> act -> reconcile -> learn`

## Product Principles

1. Evidence before narrative. Agents cite deterministic artifacts and data quality.
2. Replay before real time. Every important analysis path must work on fixed fixtures.
3. Advice before action. Execution capability advances through explicit safety stages.
4. Specialists stay specialized. Shared infrastructure does not erase domain doctrine.
5. Disagreement is information. The head agent exposes conflicts instead of flattening them.
6. Context is scoped. Session facts, durable doctrine, hypotheses, and outcomes have distinct lifecycles.
7. One owner per state. Market data, derived analytics, workflow state, UI state, and broker truth cannot have competing authorities.
8. Desktop is a workbench, not the engine. Analytics and contracts remain independently testable.

## Required Capability Domains

- Market data ingestion, normalization, replay, quality, and session semantics.
- Charting and typed agent annotations.
- Order flow, volume profile, Wyckoff, ICT/smart money, technical structure.
- Fundamentals, news, sentiment, macro, options, and cross-asset context.
- Scanners, alerts, scheduled jobs, research workflows, and backtesting.
- Head-agent synthesis, specialist messaging, task queues, and evidence bundles.
- Journaling, hypothesis tracking, outcome attribution, calibration, and evaluation.
- Paper trading, risk policy, approval, execution, receipts, and reconciliation.

## First Valuable Experience

The user selects an ES replay session, runs Order Flow analysis, sees footprint/CVD/profile evidence and typed annotations on a chart, asks the specialist why, receives a confidence-bounded thesis with invalidation, and can inspect every input and artifact that produced it.

## Success Measures by Stage

### Foundation

- Same fixture and versions produce the same deterministic artifact.
- Contract/version failures are visible and safe.
- A sidecar crash cannot crash or corrupt the desktop.

### Intelligence

- Specialist claims cite evidence IDs and timestamps.
- Evaluations measure detection accuracy, calibration, abstention, and temporal leakage.
- Adding a second specialist does not require rewriting the first.

### Workflow

- Agents can message, queue, schedule, and compose work with traceable runs.
- Context retrieval is relevant, scoped, and provenance-preserving.

### Trading Safety

- Paper/live modes are unmistakable.
- Every order intent passes deterministic policy and idempotency checks.
- Broker truth is reconciled and kill switches work under failure injection.

## Non-Goals for Initial Releases

- Promising profitable trades.
- Fully autonomous live trading.
- Supporting every broker, data vendor, asset, and analysis doctrine.
- Copying entire open-source applications into one monolith.
- Using LLM output as the source of numeric market truth.

## Product Acceptance Rule

A capability is not “real” because a prompt describes it or a screen mocks it. It becomes real only when its contract, runtime path, failure states, evaluation evidence, and user-visible behavior are verified.

---
status: active
owner: team
last_verified: 2026-07-31
source_of_truth: false
---

# Futures Hub

## Decision

The legacy Campaign workspace becomes the Trade God Futures Hub.

We keep its useful workspace boundary:

- workspace-scoped sessions and worker runs
- agents, skills, sources, files, and context
- calendar and automations
- local persistence and workspace switching

We replace its artist-specific home, campaign brief, release board, artist profile/voice/network, and campaign-worker language. This conversion is confined to the `trade-god-foundation` worktree.

## Job

Each Futures Hub is a focused trading desk for a market, strategy, or active idea. The first hub should answer:

1. What is happening now?
2. What contracts and levels am I watching?
3. What alerts, news, and agent findings changed?
4. What is the current thesis, risk, and invalidation?
5. What research or follow-up is queued?

## First Surface

- session state and market status
- workspace watchlist
- unified TradingView/Discord alert feed
- relevant headlines and calendar events
- active theses and invalidations
- assigned specialist agents and recent findings
- research files, notes, and journal outputs

Order Flow remains a specialist subpage, not the Futures Hub home.

## Agent Integration Contract

Every imported agent needs:

- a unique role and owner
- explicit inputs and allowed tools
- a typed or inspectable output
- evidence/provenance requirements
- analysis-only authority by default
- a clear trigger: manual, alert-driven, scheduled, or delegated

Initial role candidates are market overview, futures research, session preparation, order flow, alert triage, and risk/thesis review. Agent files will be reviewed before import; no bulk activation.

## First Acceptance Gate

- Product-facing Campaign/artist language is gone from the converted hub.
- Existing workspace switching, sessions, workers, sources, skills, and persistence still work.
- The hub has an honest empty/loading/failure state and does not imply live data when IBKR is disconnected.
- One selected agent can run from the hub and return a traceable result without execution authority.

## Implementation Checkpoint

The first overview shell is implemented:

- the legacy Campaign and non-HQ home paths now land on Futures Overview
- the sidebar labels the route `Futures Overview`
- IBKR health, alert readiness, new-signal count, and workspace watchlist state drive the top desk strip
- the body prioritizes the futures board, desk priorities, attention stream, news, watchlist, session reference, breadth, sectors, and cross-asset drivers
- missing feeds and calendars show explicit unavailable/pending states
- agent management remains under Workers

The watchlist is now scoped per Futures Hub workspace with fallback support for the prior global preference.

The overview now includes a lazy-loaded TradingView Lightweight Charts 5.2 panel:

- ES/NQ/YM/RTY selector strip
- 1m/5m/15m/1h and ETH/RTH controls
- responsive candlestick and volume panes
- a visibly labeled project-owned synthetic ES preview while live data is offline
- attribution and an analysis-only status footer

The preview travels as validated `market-candle-series@1` through local IPC/preload and supports each timeframe/session control. It is not recorded market history and makes no live-price claim. Unsupported NQ/YM/RTY selections stay empty until their real feeds or separately approved fixtures exist.

`chart-annotation@1` is the renderer-independent contract for user and agent drawings. The first adapter supports horizontal levels and event markers. Trend lines and price zones are already typed but await their native renderer primitives.

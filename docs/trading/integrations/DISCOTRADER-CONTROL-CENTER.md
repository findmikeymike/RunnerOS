---
status: implemented
owner: team
last_verified: 2026-07-31
---

# DiscoTrader Control Center

## What It Is

The Control Center is the setup and readiness page for DiscoTrader. It does not
place orders itself.

Open it from the Futures sidebar: **DiscoTrader**.

## One-Time Setup

1. Start the donor daemon:

   ```bash
   cd ~/CAS4/DiscoTrader/v2 && npm start
   ```

2. Copy `DT_MCP_TOKEN` from DiscoTrader's `.env`, paste it into the Control
   Center, and select **Connect source**.
3. Select **Install worker**.

The source config and token are scoped to the current Trading workspace. The
token is stored through Runner's encrypted source-credential API and is not
written into the worker.

The `trade-desk` definition lives in the app's global agent library because
that is Runner's agent-storage contract. Activation remains limited to the
workspace where the button was pressed. The page does not silently seed or
activate it. If a different definition already owns the `trade-desk` slug, the
page refuses activation and opens it for review.

## Using the Worker

Select **Open worker**, then **Run** to open its normal chat composer.

The worker:

- starts with `dt_status`;
- reads pending tickets and broker/local position state through the
  `discotrader` source;
- uses immutable ticket IDs rather than choosing size;
- stops on unconfirmed fills or reconciliation mismatch;
- requires approval for live tools;
- reports receipts rather than inventing state.

Halt, release, partial close, stop movement, close, and flatten remain deliberate
Trade Desk tools. They are not direct dashboard buttons.

## Current Boundary

Source reachability means the local MCP tool catalog loaded. It does not mean a
broker adapter is certified or live. Trade God's desktop execution runtime
still attaches zero provider adapters until one exact paper connection passes
its certification and soak gates.

## Verification

- 15 focused page, roster, worker-contract, and bundled-skill tests pass with 86
  expectations.
- Repository-wide typecheck passes.
- Electron main, preload, and renderer production builds pass.
- Live page setup/activation smoke remains a user action.
- The broad root `bun test` run is not a clean release gate in this checkout:
  it hit an unrelated Ads Operator route expectation plus Electron named-export
  test-harness errors and was stopped. The focused feature gate is green.

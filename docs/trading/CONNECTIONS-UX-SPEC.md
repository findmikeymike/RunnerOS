# Trade God Connections UX

## Goal

Store every Discord trader once, then route that trader to Futures or Options accounts from the matching desk.

## Navigation

- `DiscoTrader` is presented as `Futures`.
- `Accounts` is presented as `Connections`.
- Internal route IDs remain unchanged so saved navigation state and deep links keep working.

## Connections page

Connections owns two setup views:

- **Accounts** — Futures prop accounts and Options broker accounts, separated by a Futures/Options switch.
- **Discords** — one market-neutral catalog of every Discord server, channel, and immutable trader ID.

Adding a Discord never chooses an account and never enables trading.

## Routing

Routing belongs to the market desk because each market needs different rules:

- **Futures Desk** — choose one saved Discord and one futures account or Mirror Group.
- **Options Desk** — choose one saved Discord, one options account, and the options debit/price-protection rules.

The user flow is deliberately simple: choose Discord, choose account, review the market-specific rules, save route.

## Shared source contract

A Discord source contains only identity and presentation data:

- source ID
- nickname
- Discord server ID
- Discord channel ID
- Discord trader/user ID
- optional thread ID
- active or archived state

It contains no broker account, sizing, mandate, activation, or execution authority.

## Preservation contract

This change must not alter:

- `~/.trade-god` product identity or storage roots.
- Encrypted credential keys or vault records.
- Futures `TradingConnection`, `SignalRoute`, Mirror Group, mandate, or certification records.
- Options connection, certification, route, sizing, authority, or custody records.
- Browser partition/session IDs.
- Gateway, provider, paper-only, halt, or activation behavior.

Existing Futures and Options routes are projected into the shared Discord catalog by immutable Discord identity. The original routes remain the execution source of truth and are not rewritten.

## Compatibility

- Keep the internal `discotrader` view key while presenting it as Futures.
- Keep the internal `accounts` view key while presenting it as Connections.
- Preserve existing session-storage values.
- Preserve existing saved Webull, IBKR, prop-account, Discord-route, and browser-session records.
- Block archiving a Discord while an active Futures or Options route still references it.

## Verification

- Existing saved Discord routes appear in the shared catalog without re-entry.
- Adding a Discord does not require an account.
- Futures routing uses only Futures targets.
- Options routing uses only Options targets and retains its debit and price-protection policy.
- Removing or editing a catalog item cannot silently retarget an active route.
- Focused store, IPC, routing, renderer, typecheck, build, persistence, and visual checks pass.

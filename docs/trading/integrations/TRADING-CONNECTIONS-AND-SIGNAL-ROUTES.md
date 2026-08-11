---
status: implemented
last_verified: 2026-08-03
---

# Trading Connections and Signal Routes

Open **Futures → DiscoTrader**. The same manager remains available under
**Settings → Trading Connections**, but the primary product workflow now lives
on the DiscoTrader page.

Add one connection per exact prop account and environment. Firm names are not
hardcoded, so multiple prop firms can coexist when they use a supported route.
Tradovate credentials stay in the encrypted vault. WealthCharts gets one
isolated persistent browser partition per account. After sign-in, select
**I'm signed in**; Trade God confirms the approved provider origin and records
the operator confirmation. Removing the account clears that partition.

Browser login, account identity, and execution certification are separate
states. A saved login never enables orders. The account remains locked until
its exact adapter passes the paper lifecycle gate.

Each account card has its own **Discord sources** area. Add one route per
monitored trader/channel/account path. Routes use
immutable server, channel, and user IDs; display names are labels only.
The picker reads DiscoTrader's bearer-authenticated, read-only
`dt_signal_sources` catalog and offers only complete identities whose trader is
configured/enabled and whose channel is allowed by the daemon. Manual immutable
ID entry remains available when the daemon is offline. Observation proves only
that the daemon received the source before; it does not prove a Discord tab is
currently open.

Duplicate routes are refused. Moving a source to another account requires a
second explicit reassignment confirmation; the store rejects silent moves.
Missing, disabled, uncertified, or
unready target accounts fail closed.

Channel monitoring enrollment remains owned by DiscoTrader's extension and
daemon allowlist. This Trade God registry routes only messages the daemon has
already observed and authenticated.

The current route contract selects one exact account per signal. It does not
silently fan one message into multiple prop accounts.

The proposed fan-out contract is specified in
`../specs/execution/multi-account-mirror-groups.md`. It remains design-only:
the current runtime still routes each signal to exactly one account.

Account deletion and route mutation share one serialized runtime guard, so a
route cannot race an account deletion and become orphaned. Legacy orphaned
routes are shown as blocked with an in-app removal action. **Execution ready**
means both `enabled` and `state=ready`; certified-but-disabled accounts are
labelled disabled.

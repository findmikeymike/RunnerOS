---
status: implemented
last_verified: 2026-07-31
---

# Trading Connections and Signal Routes

Open **Settings → Trading Connections**.

Add one connection per exact prop account and environment. Firm names are not
hardcoded, so multiple prop firms can coexist when they use a supported route.
Tradovate credentials stay in the encrypted vault. WealthCharts gets one
isolated persistent browser partition per account. After sign-in, select
**I'm signed in**; Trade God confirms the approved provider origin and records
the operator confirmation. Removing the account clears that partition.

Browser login, account identity, and execution certification are separate
states. A saved login never enables orders. The account remains locked until
its exact adapter passes the paper lifecycle gate.

Add one Discord route per monitored trader/channel/account path. Routes use
immutable server, channel, and user IDs; display names are labels only.
Duplicate enabled routes are refused. Missing, disabled, uncertified, or
unready target accounts fail closed.

Channel monitoring enrollment remains owned by DiscoTrader's extension and
daemon allowlist. This Trade God registry routes only messages the daemon has
already observed and authenticated.

The current route contract selects one exact account per signal. It does not
silently fan one message into multiple prop accounts.

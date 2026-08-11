---
status: active
owner: team
last_verified: 2026-08-10
source_of_truth: true
audit_id: TG-AUDIT-DISCORD-EXEC-2026-08-10
---

# Discord Signal Execution Readiness

## Verdict

**NOT READY FOR AUTOMATED PROVIDER EXECUTION.**

The signed Discord entry and follow-up paths are now materially safer and the
desktop product is isolated, but the runtime deliberately has no provider
adapter attached and incoming tickets stop at a durable `created` intent. This
is the correct fail-closed state until the P0 gates below are completed with a
real paper account.

The app currently supports account/source setup, signed signal receipt,
deterministic parsing, lineage, monitoring, and paper-adapter development. It is
not yet a nonstop trade copier.

## Required User Outcome

1. Add multiple Discord trader identities.
2. Add multiple exact prop/broker accounts using API credentials or isolated
   browser login.
3. Route each Discord identity to one account or a versioned Mirror Group.
4. Arm only explicit paper accounts under bounded risk and time authorization.
5. Convert one entry signal into independently owned, protected child trades.
6. Resolve later partial exits, stop moves, target changes, and flatten messages
   to the exact active parent/children.
7. Reconcile provider truth continuously and recover safely after restart.

## Verified Fixes in This Audit

- Removed all implicit account fallback. An unmapped Discord identity fails
  closed instead of choosing the environment default or only ready account.
- Bound source kills to the durable route identity instead of one message ID.
- Deferred exact early follow-ups and retry them after the entry becomes
  protected; they are no longer permanently discarded.
- Serialized Discord follow-ups and blocked older messages from regressing a
  newer accepted stop instruction.
- Removed false flatten phrases such as `I'm out of patience` and `done here
  analyzing this`.
- Added no-widen stop enforcement for long and short positions.
- Bound one Discord source event and one donor ticket identity to one durable
  intent; either identity being reused for different evidence now fails closed.
- Required the immutable Discord posted timestamp and rejected signals that
  arrive after their route validity window. Donor latency now binds the
  posted-to-ticket-created interval used by DiscoTrader itself.
- Reject multiple targets at ingestion instead of silently discarding all but
  the first. Multi-target execution remains unimplemented.
- Repaired dead-process entry and management claim markers.
- Quarantined a connection after an uncertain provider submit.
- Made Tradovate modification reconciliation require the exact requested
  quantity, type, TIF, and stop/limit price to become provider-visible.
- Refused to declare a position closed while a working contract order could
  reopen it.
- Restricted management targets to the exact Tradovate entry/child order graph.
- Removed broker mutation tools from the Trade Desk worker. It now has a strict
  read-only MCP tool allowlist and cannot bypass the gateway.
- Added encrypted-vault storage for the DiscoTrader webhook secret; shell
  environment setup is no longer the only packaged-app path.
- Added persistent global execution halt IPC/UI and emergency halt on fatal
  main-process/renderer failure. The gateway starts halted, keeps an in-process
  emergency latch even if storage fails, and refuses process exit when durable
  containment cannot be confirmed.
- Added a provider-account ownership lease before provider snapshot/admission.
  Until a portfolio reservation ledger exists, one account can have only one
  unresolved execution across all instruments.
- Added a process-wide and cross-process provider-account mutation lock. Entry,
  modify, cancel, partial-close, and flatten requests are serialized; the lock
  is persisted, dead-process repairable, and held through normal, public, and
  restart reconciliation, including emergency flatten.
- Bound Tradovate risk snapshots to canonical provider state rather than wall
  clock milliseconds; unchanged state retains its identity and changed state
  cannot reuse it.
- Carried DiscoTrader's deterministic maximum USD loss into the checksummed
  intent, then independently recomputed economic loss from the stop distance,
  contracts, and a gateway-owned tick/point-value specification. Understated
  upstream risk now fails closed before claim; the larger declared/computed
  value is enforced against fresh P&L and authorization budgets.
- Added deterministic provider-bound risk decision issuance: the gateway reads
  the exact account snapshot, records allow/deny against its state identity,
  and only allows later execution if provider state is still identical.
- Added explicit month-code/year parsing (`ESU6`, `M2KZ26`) to canonical expiry.
  Expired explicit contracts and root-only signals are non-executable. The
  Tradovate adapter also requires exact provider-returned contract ID/name and
  unexpired `contractMaturity.expirationDate` evidence before submit.
- Isolated trading browser sessions from generic browser listing, reuse,
  destruction, and state broadcasts.
- Forced packaged Trade God identity/config/runtime variables before importing
  the main process, preventing Artist OS shell variables from merging the apps.
- Registered `tradegod://` consistently and added packaged protocol metadata.
- Stopped future migrations from copying the complete Artist OS credential
  vault into Trade God. The already-copied live vault/key were verified as
  byte-identical and moved to a recoverable Trade God-only quarantine; Artist
  OS was not changed. Trade God must now enroll its own credentials.
- Made future app-data migration stage fully before one atomic destination
  rename, so a crash cannot leave a half-migrated final store.
- Repaired the live isolated Trading workspace so both signed `discotrader` and
  `discotrader-management` receivers exist.

## P0 — Blocks Any Automated Paper Order

| Gate | Current truth | Required proof |
|---|---|---|
| Provider runtime | `adapters: []`; no order I/O | Attach one exact paper adapter only after certification |
| Admission | webhook creates `created` intent only | Deterministic risk decision + explicit bounded authorization + execute coordinator |
| Risk | gateway independently computes supported-futures loss and can issue a provider-bound decision; ingestion does not invoke a time-bounded arming coordinator | Provider-certify economic specs, wire paper arming, and prove budget rollover/session expiry |
| Contract identity | past-month/root symbols fail closed and Tradovate requires exact provider ID/name plus unexpired maturity | Add authoritative rollover policy for root signals and real provider evidence |
| Position ownership | durable provider-account lease and flat-account preflight now exist | Add lease visibility and real-provider restart/adverse proof |
| Provider queue | durable per-account mutation lock serializes commands through reconciliation | Real-provider crash, stale-lock, cross-process, and adverse ordering proof |
| Multi-account | Mirror Groups are specification only | Parent plan, independent children, all-member admission, visible partial outcomes |
| Multiple targets | `order-intent@1` has one target; source now rejects many | Versioned allocation/child-leg contract and protection-resize lifecycle |
| Continuous truth | Tradovate REST performs one immediate reconciliation | User-data stream or bounded polling, reconnect/backoff, token refresh, stale-feed halt |
| Real evidence | simulated tests only | Real Tradovate paper entry, fill, bracket, move, partial, flatten, restart, and unknown-submit drills |

No provider adapter may be activated while any P0 gate is open.

## P1 — Required Before Browser Execution

- Implement a provider-specific named automation port. The current
  WealthCharts driver is an interface and deterministic fixture, not live DOM
  automation.
- Prove authentication by exact provider account identity, environment, and
  visible trade permission. Matching the website origin is not authentication.
- Use stable accessible selectors and semantic element assertions; never raw
  screen coordinates as the primary control.
- Before every click: focus the isolated session, wait a bounded settle period,
  re-read the exact visible ticket, compare the full action digest, then make
  one action.
- After every action: capture confirmation evidence, re-read Orders/Positions,
  and halt on selector drift, ambiguity, overlays, stale state, or changed
  ticket values.
- Use bounded, observable pacing and cursor travel for UI stability—not bot
  evasion. No action may be hidden from the operator or designed to defeat a
  provider control.
- Add one per-session command queue, heartbeat, crash detection, screenshot
  evidence retention, and an operator takeover path.
- Certify each provider UI/version separately. A saved browser session is not
  execution certification.

## P1 — Required Before Multi-Account Mirroring

- Implement the versioned Mirror Group contracts in
  `multi-account-mirror-groups.md`; do not overload `connection_id`.
- Freeze group revision and child quantities at entry time.
- Create one deterministic parent and one independent child per account.
- Require all children to pass connection, capability, risk, authorization,
  flat-account, and protection preflight before the first mutation.
- Acquire all ownership leases in globally sorted order, then persist exact
  child dispatch grants.
- After dispatch begins, reconcile every child independently. Never hide or
  auto-reverse partial group outcomes.
- Resolve follow-ups to the parent lineage, then plan each active child using
  its own fill, quantity, stop, target, and provider IDs.

## Provider Research Confirmed 2026-08-10

- Tradovate separates production simulation and live base URLs and requires
  bearer authentication. Official reference:
  https://partner.tradovate.com/resources/reference/api-cheat-sheet
- Automated orders must set `isAutomated: true`; native `placeOSO` supports two
  linked OCO children. Official reference:
  https://partner.tradovate.com/api/rest-api-endpoints/orders/place-oso
- A successful modify response is explicitly not a guarantee that the order
  changed. The app must verify the new provider-visible order state. Official
  reference:
  https://partner.tradovate.com/api/rest-api-endpoints/orders/modify-order
- `liquidateposition` requests cancellation of open orders and closure of the
  position but is explicitly not a guarantee. Flat + no working contract order
  is therefore required before closure. Official reference:
  https://partner.tradovate.com/api/rest-api-endpoints/orders/liquidate-position
- Tradovate documents one simultaneous client connection per customer unless
  the account has a multi-connection subscription. Runtime connection strategy
  must respect the account's allowance. Official API reference:
  https://api.tradovate.com/
- Tradovate exposes `GET /contract/find?name=...` for exact contract lookup.
  `GET /contractMaturity/item?id=...` supplies the provider expiration date.
  The adapter now requires both exact identity and future maturity before
  submit. Official contract library reference:
  https://api.tradovate.com/

## Release Evidence Matrix

Each provider/account version must pass all rows in paper mode with durable
receipts before activation can be offered:

1. Exact login/account/environment verification.
2. Expired credential and reconnect recovery.
3. Market, limit, stop, and stop-limit rejection/acceptance boundaries.
4. Native stop + target visible after full and partial fills.
5. Stop move exact-price verification and no-widen rejection.
6. Partial exit with remaining stop/targets resized and verified.
7. Full flatten with zero position and zero reopening working orders.
8. Duplicate webhook, duplicate process, crash-before-claim, crash-after-claim,
   uncertain submit, and restart reconciliation.
9. Concurrent entry/follow-up ordering on one account/instrument.
10. Manual/unowned exposure rejection.
11. Global, source, group, and connection kill behavior.
12. 50 consecutive protected paper lifecycles plus explicit adverse drills.

## Next Build Order

1. Implement time-bounded paper arming and the created-to-approved execution coordinator.
2. Add Tradovate credential/token lifecycle and real-time/poll reconciliation.
3. Provider-certify contract economics/calendar behavior, then attach the exact
   paper adapter behind certification only.
4. Run one-account paper lifecycle evidence, including restart and mutation locks.
5. Implement partial-close/protection resize and multiple target allocations.
6. Implement Mirror Group contracts/parent coordinator/UI.
7. Certify multi-account paper mirroring.
8. Build one browser provider only if API access is unavailable.

## Honest Completion Boundary

This audit closes dangerous false-ready paths. It does not claim provider-ready
automation. The next intelligent pivot is real Tradovate paper connectivity;
it requires the user's Tradovate API credential/account access and explicit
paper-only authorization after the remaining P0 runtime work is implemented.

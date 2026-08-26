---
status: draft
owner: team
last_verified: 2026-08-26
source_of_truth: true
spec_id: TG-EXEC-004
target_phase: Options Desk Phase 0-1
depends_on:
  - TG-EXEC-001 unified broker entry gateway
  - Discord source authentication and exact signal routing
  - Discord follow-up management and immutable trade lineage
  - Trade God workspace containment closure
---

# Discord Single-Leg Options Autopilot

## Decision Summary

Trade God will add an **Options Automation** module that can monitor approved
Discord traders, resolve an exact listed option contract, apply deterministic
quote and entry-price guardrails, and route a paper order through one certified
broker API adapter. The first provider targets are IBKR paper and Webull
OpenAPI sandbox/paper, certified independently.

The first release supports only buying and later selling a single standard US
equity or ETF call or put. It does not support short options, spreads, combos,
index options, futures options, browser execution, or agent-invented contracts.

The order path is:

```text
authenticated Discord message
  -> conservative options parser
  -> exact source/account route
  -> exact provider contract resolution
  -> fresh NBBO quote
  -> deterministic spread + price-drift decision
  -> bounded marketable or passive limit order
  -> durable gateway and provider reconciliation
  -> exact-position follow-up management
```

The product will not use an uncapped market order for option entry. A tight
spread may produce a **marketable limit at the current ask**, capped by the
operator's maximum chase price. This behaves like an immediate order when the
quote remains available while preventing an unexpected fill above the cap.
Market orders do not guarantee price, while buy limit orders cap the price paid;
this is the reason for the default. See the SEC's
[order-type bulletin](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins-14)
and [trade-execution overview](https://www.investor.gov/introduction-investing/investing-basics/how-stock-markets-work/executing-order).

## User Outcome

As an operator, I can connect one or more paper brokerage accounts, assign each
approved Discord trader/channel to an exact account and options-entry policy,
and let Trade God buy eligible calls or puts without paying beyond my configured
price, size, liquidity, expiry, or loss limits.

I can see why every signal was entered, worked as a limit, skipped, canceled,
or blocked. Later follow-up messages operate only on the exact position created
from that Discord signal.

## Scope

### Included

- Long calls and long puts opened with `BUY_TO_OPEN`.
- Closing Trade God-owned contracts with `SELL_TO_CLOSE`.
- Standard US-listed equity and ETF options with multiplier `100`.
- One option leg per trade.
- Exact Discord guild/channel/thread/trader routing to one exact account.
- Explicit underlying, expiration, strike, right, and source entry premium.
- Fresh top-of-book bid, ask, sizes, quote source, and timestamps.
- Absolute and percentage bid/ask spread limits.
- Absolute and percentage unfavorable entry-drift limits.
- A bounded marketable-limit path for tight spreads.
- A bounded passive-limit path for wider but still eligible spreads.
- Durable cancellation, partial-fill, uncertain-submit, and restart recovery.
- Exact position follow-ups: full close, deterministic partial close, reconcile,
  and option-premium stop/target management once separately certified.
- Paper accounts only until the complete retained certification gate passes.

### Initial account shape

- Multiple broker accounts may be connected.
- IBKR and Webull accounts remain separate provider authorities; there is no
  automatic provider fallback or order migration.
- Multiple Discord sources may be configured.
- Each source route points to exactly one account and one immutable policy
  revision.
- One signal does not mirror to multiple accounts in Phase 1.
- One account may receive multiple sources, but the account-level limits apply
  across all of them.
- Until Stage 6 proves the portfolio reservation ledger, each account may have
  only one active/working option lineage at a time; other eligible signals block
  visibly rather than queue for late execution.

## Non-Goals

- Multi-leg spreads, calendars, butterflies, condors, straddles, or combos.
- Selling to open, naked options, covered calls, cash-secured puts, or assignment
  strategies.
- Index, cash-settled, futures, adjusted, flex, binary, or nonstandard-deliverable
  options.
- Automatic strike, expiration, right, or contract selection when the Discord
  message is incomplete.
- Converting an underlying-price stop or target into an option-premium price.
- Inferring quantity from the Discord trader's account size.
- Averaging down, adding to an existing option position, rolling, or reopening.
- 0DTE automation in the initial release.
- Extended-hours execution.
- Browser automation for options orders.
- True market orders for entry.
- Live-money authority before provider-specific paper certification.
- Research agents, options-flow analytics, or Options Oracle directly submitting
  broker commands.

## Current Reality

Trade God already has reusable foundations for:

- authenticated Discord entry and follow-up messages;
- exact source-to-account routing;
- immutable source binding and deduplication;
- durable execution intent, command, receipt, and reconciliation stores;
- connection, source, and global halts;
- exact provider-account mutation locks;
- mandate, certification, activation, and recovery gates;
- exact trade-family follow-up resolution.

Those foundations currently model futures execution. There is no implemented or
certified options order contract, chain resolver, options quote authority, IBKR
options adapter, Webull options adapter, or Options Automation page. Existing
Options Oracle work is a research boundary only and grants no execution
authority.

The current gateway also owns an entire provider account for one unresolved
execution at a time. Supporting several simultaneous option contracts in one
account therefore requires a new portfolio debit-reservation ledger plus exact
per-contract ownership; the existing account-wide ownership key must not be
silently reused as if portfolio concurrency already exists.

## Experience / Runtime Flow

### One-time setup

1. User opens **Options Automation**.
2. User chooses IBKR or Webull and connects an approved paper/sandbox account.
3. Main process verifies session health, account identity, option permissions,
   market-data availability, and that the selected account is paper.
4. User selects a Discord server, channel or thread, and exact trader identity.
5. User assigns that source to one exact account.
6. User chooses or creates an entry policy containing spread, price-drift,
   sizing, time, expiration, and aggregate account limits.
7. UI restates the policy in plain language.
8. User runs a read-only quote test and retained paper lifecycle certification.
9. User activates the exact account, source, and policy revision. Global and
   account halts remain the final release gate.

### Entry

1. A signed Discord message arrives with immutable message and author evidence.
2. Parser detects a single-leg long call or put entry.
3. Route resolver freezes the exact account and policy revision.
4. Contract resolver produces one canonical option identity and provider ID.
5. System loads a fresh live NBBO quote and contract trading rules.
6. Pricing policy calculates spread, source-price drift, debit risk, and the
   maximum permitted buy price.
7. The decision is durably stored before provider I/O.
8. Eligible tight-spread signals create a marketable limit at the ask, never
   above the chase cap.
9. Eligible wide-spread signals create a bounded passive limit or are skipped,
   according to policy.
10. Ineligible signals create a visible skip/block receipt and zero orders.
11. Gateway submits one idempotent paper order and reconciles provider truth.
12. UI shows working, partially filled, filled, canceled, rejected, or unknown.

### Follow-up

1. A later Discord message is resolved through the original source message,
   reply/thread evidence, trader identity, and frozen option contract.
2. Gateway reconciles the exact account, provider contract, owned position, and
   working orders.
3. A deterministic management plan is persisted before mutation.
4. `all out` first cancels and proves terminal every owned working entry/exit
   order, then sells only the confirmed Trade God-owned quantity to close. If
   entry is partially filled, its remainder is canceled before the filled
   quantity is closed.
5. `take half` works only when it produces a positive integer smaller than the
   open quantity. One contract cannot be halved.
6. `cancel`, `no fill`, or an exit message received while entry is still working
   cancels the owned working entry and prevents any later fill from reopening
   the lineage.
7. Duplicate, ambiguous, stale, edited, or contradictory messages produce zero
   provider mutation.

## System Boundaries

| Component | Owns | Must not own |
|---|---|---|
| Discord source adapter | Authenticated raw message and immutable source evidence | Contract guessing, account choice, risk, broker I/O |
| Options parser | Candidate fields and explicit ambiguity | Provider IDs, quotes, sizing, order submission |
| Route store | Exact source -> account + policy revision | Fallback account selection |
| Contract resolver | Canonical contract and provider instrument ID | Directional thesis or alternative contract selection |
| Quote adapter | Fresh provider-authoritative bid/ask/size and trading rules | Entry decision |
| Entry policy engine | Pure deterministic eligibility and order-price decision | Provider I/O or mutable UI state |
| Risk engine | Contract count, maximum debit, aggregate limits | Signal interpretation |
| Options reservation store | Atomic account capacity, working/unknown debit reservations, restart recovery | Provider submission or discretionary sizing |
| Execution gateway | Idempotency, locks, commands, reconciliation, halts | Research or discretionary contract selection |
| Broker adapter | Exact provider translation, rate-limit scheduling, and provider truth | Policy decisions, Discord parsing, or fallback to another broker |
| Agent | Structured parsing proposal and plain-language explanation | Credentials, certification, risk override, direct broker tools |
| Renderer | Setup, state, review, controls, explanations | Secrets, quote truth, execution truth, self-certification |

## Contracts

### `discord-options-signal@1`

Required entry evidence:

| Field | Type | Rule |
|---|---|---|
| `message_id` | string | Immutable and unique within channel |
| `author_id` | string | Immutable Discord identity |
| `guild_id` | string | Required for routed server source |
| `channel_id` | string | Exact routed channel |
| `thread_id` | string/null | Preserved when present |
| `reply_to_message_id` | string/null | Preserved when present |
| `posted_at` | ISO timestamp | Discord event time |
| `received_at` | ISO timestamp | Trusted Trade God receipt time |
| `raw_text` | string | Immutable evidence |
| `content_checksum` | SHA-256 | Covers all immutable fields |
| `underlying` | string | Explicit normalized ticker |
| `expiration` | ISO date | Exact expiration date |
| `strike` | decimal string | Exact strike, no float |
| `right` | `call` or `put` | Explicit or unambiguous `C/P` token |
| `action` | `buy_to_open` | Only allowed opening action |
| `reference_entry` | decimal string | Explicit option premium, not underlying price |
| `reference_kind` | `single_price`, `trader_fill`, or `entry_range` | Freezes what the posted premium means |
| `reference_range` | optional low/high | If supplied, high is the reference anchor and hard source ceiling |

Optional evidence:

- explicit source quantity;
- trader label for display only;
- source stop or target only when explicitly labeled as option premium;
- client-provided ticker alias, retained but not trusted for execution.

Rules:

- `SPY 580C Friday @ 1.25` may resolve if `Friday` maps to exactly one listed
  expiration using the exchange calendar and message timestamp.
- `SPY calls`, `next week calls`, `same strike`, `starter`, `lotto`, `calls now`,
  or a signal without an option-premium reference cannot auto-execute.
- A price range such as `1.20-1.30` freezes both values; `1.30` is the reference
  and hard ceiling. Policy chase allowance cannot pay above a trader-posted
  range in this version.
- If text does not distinguish a trader fill from an actionable entry price,
  the signal needs review rather than silently choosing a reference kind.
- The parser may normalize formatting but cannot substitute a nearby listed
  strike or expiration.

### `option-contract-identity@1`

Required:

- canonical underlying;
- expiration date;
- exact decimal strike;
- right: call or put;
- currency `USD`;
- asset class `US_EQUITY_OPTION` or `US_ETF_OPTION`;
- multiplier `100`;
- standard deliverable flag;
- provider instrument ID such as IBKR `conid`, or Webull's exact option-contract
  identity and order-leg fields;
- provider local/OCC symbol when available;
- listing and smart-routing eligibility;
- minimum price increment and applicable increment bands;
- contract-resolution timestamp and checksum.

Exactly one provider contract must match. Zero or multiple results block.
Adjusted or nonstandard multiplier/deliverable contracts block.

### `option-quote-snapshot@1`

Required:

- connection and account ID;
- canonical contract ID and provider instrument ID;
- provider environment and market-data mode;
- bid, ask, bid size, ask size;
- provider timestamp when available;
- trusted local receive timestamp;
- quote age at decision time;
- delayed/indicative/halted flags;
- minimum tick at the proposed price;
- source/provenance and checksum.

Validation:

- bid and ask are positive;
- ask is greater than or equal to bid;
- midpoint is positive;
- quote is live, fresh, same-account, same-contract, and not halted;
- displayed ask size is at least the intended order quantity for automatic
  marketable entry in the initial release;
- no missing, `NaN`, crossed, or negative values.

Options liquidity is assessed from both spread and displayed size. The Options
Industry Council describes a liquid market as having a tight spread and
meaningful size; a wider spread can indicate difficulty hedging or limited
liquidity. See its [liquidity FAQ](https://www.optionseducation.org/referencelibrary/faq/general-information)
and [bid/ask explainer](https://www.optionseducation.org/news/understanding-the-bid-and-ask-prices-for-options).

### `options-entry-policy@1`

Every enabled source route freezes an immutable policy revision containing:

#### Signal timing

- `max_signal_age_ms`;
- `max_ingest_delay_ms`;
- regular-session-only flag;
- earliest and latest entry time;
- allowed weekdays;
- `min_days_to_expiration`;
- `max_days_to_expiration`.

#### Quote quality

- `max_quote_age_ms`;
- `min_bid_size` and `min_ask_size`;
- `max_spread_abs` in option-premium dollars;
- `max_spread_pct` as spread divided by midpoint;
- both spread limits must pass unless policy explicitly chooses the stricter
  derived threshold mode.

#### Price drift

- `max_chase_abs`: maximum dollars above source reference;
- `max_chase_pct`: maximum percent above source reference;
- `max_favorable_retrace_pct`: optional block when the option has fallen too far
  below the source price, indicating a potentially stale or invalid thesis;
- both chase limits apply; the lower resulting cap wins.

#### Working limit behavior

- `tight_spread_action`: initially only `marketable_limit` or `skip`;
- `wide_spread_action`: `passive_limit` or `skip`;
- `passive_limit_offset_abs`;
- `working_order_ttl_ms`;
- `max_reprice_attempts`;
- `reprice_interval_ms`;
- `cancel_at_signal_expiry`;
- no reprice may exceed the frozen chase cap.

#### Sizing and risk

- sizing mode: `fixed_contracts` or `max_debit_budget`;
- fixed quantity or maximum debit dollars;
- maximum contracts per order;
- maximum debit per trade, including estimated fees;
- maximum aggregate open option debit per account;
- maximum daily option debit initiated;
- maximum open option positions;
- maximum active positions per Discord source;
- durable maximum-debit reservation for every prepared, working, partially
  filled, or submit-unknown entry;
- source quantity behavior: `ignore` or `use_with_cap`;
- duplicate-contract entry policy: initially `block`.

`maximum open option positions` is forced to `1` per account until the Stage 6
portfolio-concurrency gate passes; the UI cannot raise it earlier.

Account limits are admitted under one per-account lock. The full worst-case
debit is reserved before the first provider mutation, counts against concurrent
signals, and is released only after exact cancellation or terminal proof.
Partial fills convert only the filled portion into open-position debit; an
unknown submit keeps the full reservation.

#### Expiration custody

- exact provider exercise/cutoff calendar and account setting;
- no-new-entry deadline by expiration;
- certified automatic close-start and hard operator-escalation deadlines;
- explicit do-not-exercise handling where the provider supports it;
- no automatic activation if the adapter cannot prove a deterministic
  expiration-custody plan for an unattended position.

#### Activation

- paper-only environment;
- exact broker adapter, certification level, and certification checksum;
- exact account;
- exact source route;
- exact mandate expiry;
- global, account, and source halts.

No hidden defaults may activate execution. The setup UI must persist an explicit
policy or leave the route read-only. Manual-confirmed sandbox entry requires
`options-sandbox-entry-certified`; automatic Discord entry requires
`options-paper-autopilot-certified` for the exact installed adapter descriptor.

### `options-debit-reservation@1`

Portfolio concurrency is not authorized by the existing account-wide execution
lease. Options use two separate durable controls:

1. an account admission lock covering capacity calculation and reservation;
2. an ownership lease keyed by provider + environment + account + canonical
   option contract.

Every reservation persists:

- reservation ID, intent ID, account, source, policy, mandate, and exact contract;
- reserved contracts, limit price, multiplier, estimated fees, and worst-case
  debit;
- account capacity snapshot and complete active-reservation-set checksum;
- state: `prepared`, `working`, `partially-filled`, `submit-unknown`,
  `open-position`, `releasing`, `released`, or `halted`;
- filled/open quantity and the exact linked execution-record checksum;
- created, updated, expiry, terminal-proof timestamps, and content checksum.

Admission acquires the account lock, reloads provider account truth plus every
non-released reservation, and atomically creates the new reservation before any
preview or order submission. A reservation-set change invalidates the decision.
The per-contract ownership lease blocks a second lineage for the same contract
without blocking independently reserved contracts in the same account.

Release rules:

- rejected-before-send releases after durable proof that provider delivery did
  not occur;
- canceled working quantity releases only after exact provider terminal proof;
- partial fill retains open debit for the filled quantity until the position is
  broker-proven flat and retains working debit until the remainder is terminal;
- submit/cancel unknown retains the full reservation and latches the account;
- restart repairs stale local locks, replays reservations against exact provider
  truth, and admits no new entry until every inconsistent reservation is halted
  or reconciled;
- missing, duplicated, checksum-invalid, or orphaned reservation evidence is an
  integrity failure, never free capacity.

### `options-entry-decision@1`

The pure policy engine persists:

- source, route, account, contract, quote, and policy checksums;
- source reference price;
- bid, ask, midpoint;
- `spread_abs = ask - bid`;
- `spread_pct = spread_abs / midpoint * 100`;
- `unfavorable_drift_abs = max(0, ask - reference)`;
- `unfavorable_drift_pct = unfavorable_drift_abs / reference * 100`;
- `favorable_retrace_pct = max(0, reference - ask) / reference * 100`;
- absolute chase cap;
- percentage chase cap;
- effective chase cap: the lower cap;
- chosen order action and exact limit price;
- planned quantity and maximum debit;
- pass/block reason codes;
- decision timestamp, expiry, and checksum.

### Entry pricing algorithm

Given:

```text
R = source reference premium, or the high end of an explicit source range
S = optional hard source ceiling; for a range, S equals the high end
B = current best bid
A = current best ask
M = (B + A) / 2
T = valid provider tick at the proposed price
```

Calculate:

```text
spread_abs = A - B
spread_pct = (A - B) / M * 100
absolute_cap = R + max_chase_abs
percentage_cap = R * (1 + max_chase_pct / 100)
chase_cap = min(absolute_cap, percentage_cap, S when present)
```

Order selection:

| Conditions | Decision |
|---|---|
| Quote invalid, delayed, stale, crossed, halted, or missing | Block |
| Signal stale, incomplete, ambiguous, or expired | Block |
| `A > chase_cap` | Skip as `PRICE_MOVED_BEYOND_CAP` |
| Favorable retrace exceeds configured thesis threshold | Skip as `PRICE_COLLAPSED_FROM_SIGNAL` |
| Spread and displayed-size gates pass | Buy limit at `min(A, chase_cap)`, rounded down to tick |
| Spread fails but passive mode is enabled and all other gates pass | Submit bounded passive limit |
| Spread fails and passive mode is disabled | Skip as `SPREAD_TOO_WIDE` |

Passive limit:

```text
passive_candidate = max(B + T, min(M, R + passive_limit_offset_abs))
passive_limit = round_down_to_tick(min(passive_candidate, chase_cap))
```

The passive order must remain above the current bid and at or below the midpoint
and chase cap. If tick rounding makes those conditions impossible, skip.

Every reprice repeats quote validation and policy evaluation using the same
frozen source, route, contract, and chase cap. Repricing never changes quantity,
contract, account, source reference, or policy revision.

### Suggested paper-only starter preset

This is a test preset, not a production recommendation:

| Setting | Paper starting value |
|---|---:|
| `max_signal_age_ms` | `30,000` |
| `max_ingest_delay_ms` | `10,000` |
| `max_quote_age_ms` | `1,000` |
| `max_spread_abs` | `$0.10` |
| `max_spread_pct` | `10%` |
| `max_chase_abs` | `$0.10` |
| `max_chase_pct` | `8%` |
| `max_favorable_retrace_pct` | `20%` |
| `min_ask_size` | intended contract quantity |
| `min_days_to_expiration` | `1` |
| `working_order_ttl_ms` | `15,000` |
| `max_reprice_attempts` | `0` |
| sizing | `1 fixed contract` |
| true market orders | disabled |

These values must be measured in paper execution and tuned by option-price band.
A single absolute spread threshold is insufficient across a $0.20 option and a
$10.00 option, which is why both absolute and percentage gates exist.

### `options-provider-preview@1`

For adapters that expose order preview, the gateway persists a preview artifact
before submission containing:

- preview ID and provider request/response IDs;
- exact adapter, provider-contract, environment, credential-generation, account,
  contract, route, decision, reservation, and mandate checksums;
- exact side, position intent, order type, limit price, quantity, time in force,
  and serialized provider request checksum;
- provider-estimated debit, commissions/fees, buying-power impact, warnings,
  rejects, and any option-permission result;
- provider and trusted receive timestamps, maximum age, result, and checksum.

Preview is not authority. While holding the exact provider-account mutation lock,
the gateway obtains the preview, persists it, reloads account/position/open-order
truth and a fresh quote, revalidates the reservation set and every policy gate,
then persists the execution command binding the preview checksum. Any drift,
warning that changes economics, stale preview, or provider/request mismatch
blocks before place-order. External/manual drift after submission is handled by
the existing unknown/divergence halt and reconciliation path.

### `options-order-intent@1`

Required:

- immutable intent ID;
- source and decision checksums;
- exact connection/account;
- exact canonical contract and provider instrument ID;
- action `BUY_TO_OPEN`;
- order type `LIMIT`;
- exact limit price and quantity;
- time in force `DAY`;
- regular-hours-only;
- planned maximum debit and fees;
- policy and mandate checksums;
- debit reservation ID/checksum;
- valid-until timestamp;
- unique provider client-order ID;
- idempotency checksum.

The provider command additionally binds the exact preview checksum when preview
is supported. An adapter that declares preview support cannot submit without a
fresh checksum-valid preview artifact.

The broker adapter receives this intent only after the gateway independently
revalidates connection readiness, certification, mandate, halts, account truth,
position ownership, fresh quote, policy checksum, and order expiry.

IBKR's Web API order flow requires an account, exact contract ID, side, order
type, time in force, and quantity, and returns an order ID for tracking. Market
data requires the correct session, permissions, and subscribed data. See the
official [IBKR Web API documentation](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)
and [order workflow](https://ibkrcampus.com/campus/ibkr-api-page/web-api-trading/).

### Provider adapter profiles

The canonical option intent is provider-neutral. Each connected account freezes
one exact adapter ID, adapter version, provider-contract version, environment,
capability checksum, credential generation, and account identity. Changing any
of them re-latches the account and global option-entry halts and requires new
read-only verification and provider-specific certification.

No adapter may route to another provider when its own session, data, rate limit,
or order endpoint is unavailable. A Webull-routed signal cannot fall back to
IBKR, and an IBKR-routed signal cannot fall back to Webull.

#### Webull OpenAPI options adapter

The first Webull adapter uses the official OpenAPI, not browser automation or an
unofficial reverse-engineered client.

Initial scope and mapping:

- Webull Trading API is the initial path for the operator's own account. Connect
  API OAuth is a later distribution path for other users' Webull accounts and
  must be implemented and certified as a distinct auth profile.
- Retail Trading API credentials are App Key/App Secret plus any required 2FA
  token state. All secrets and rotating tokens stay in the encrypted
  main-process vault.
- The account must be an exact Webull sandbox/paper account for initial rollout.
  Production credentials cannot satisfy a paper mandate.
- Only standard US single-stock and ETF options are admitted. Webull excludes
  index options from this API surface, which matches initial scope.
- Every order uses `instrument_type: OPTION`, `market: US`, `combo_type: NORMAL`,
  `option_strategy: SINGLE`, one and only one option leg, and a canonical exact
  comparison of underlying, expiration, strike, right, and multiplier before
  and after submission.
- Intended mapping is entry `side: BUY` + `position_intent: BUY_TO_OPEN` and exit
  `side: SELL` + `position_intent: SELL_TO_CLOSE`. This mapping is not considered
  implemented or certified until the exact current sandbox request, response,
  order-detail, position, and rejection behavior are retained. Any missing,
  rejected, ignored, or contradictory position intent blocks rather than
  degrading to a generic buy or sell.
- Options entry is always `LIMIT`. Webull OpenAPI does not support `MARKET` for
  options. Phase 1 uses `DAY` only, even though Webull documents GTC for buy-side
  option orders.
- A deterministic client order ID is unique per account, no longer than Webull's
  documented 32-character limit, collision-checked against durable receipts and
  provider order detail before submission.
- The read-only preview endpoint is required before place-order, but preview is
  advisory only. Gateway risk, quote, contract, and ownership checks remain the
  authority.
- HTTP option snapshots, order detail by client order ID, positions, and account
  truth are authoritative. MQTT market-data and gRPC order events are wake-up
  hints only until a complete, sequenced stream is proven.
- Open orders/history are not accepted as sole current truth because Webull
  documents processing delay. Exact order detail by client order ID is required
  for reconciliation.
- The adapter owns a bounded per-app-key scheduler. Protective cancel, exact
  order-detail reconciliation, and exits outrank new entries. HTTP 429 never
  causes a blind submit retry.
- Request signing uses a fresh nonce and UTC timestamp. Clock drift, 2FA/token
  expiry, key rotation, or signature failure latches the Webull account before
  any new provider mutation.

Provider-contract blocker:

- Webull's current options guide documents only generic `BUY`/`SELL` sides and
  its examples omit `position_intent`, while the 2026-03-28 official changelog
  says the field supports `BUY_TO_OPEN`, `BUY_TO_CLOSE`, `SELL_TO_OPEN`, and
  `SELL_TO_CLOSE`. Until Webull sandbox proves the current wire contract, the
  adapter capability `verified_position_intent` remains `false` and submission
  is unavailable.
- Certification must prove the provider honors the requested intent, returns it
  consistently in order detail, rejects mismatched side/intent pairs, and cannot
  turn the permitted exit into a new short position. If those proofs are not
  possible, Webull stays read-only for this module.
- `verified_option_nbbo_size` also remains `false` until the exact sandbox option
  snapshot or subscribed quote fixture proves live bid, ask, bid size, ask size,
  timestamps, and delayed-data status. Missing size blocks automatic entry.

Market-data requirements:

- Automatic decisions require Webull's separate **OPRA Real-Time Non-display**
  OpenAPI subscription. A Webull mobile/desktop market-data subscription does
  not satisfy this requirement.
- Sandbox option data is 15 minutes delayed without the applicable real-time
  OpenAPI subscription. Delayed sandbox data may exercise parsing and simulated
  pricing, but cannot certify or run automatic entry.
- Webull documents one-device access for LV1/LV2 data. A competing device/session
  or lost subscription keeps the route halted.

Official references: [Webull OpenAPI overview](https://developer.webull.com/apis/docs/about-open-api/),
[options trading](https://developer.webull.com/apis/docs/trade-api/options/),
[retail Trading API application](https://developer.webull.com/apis/docs/authentication/IndividualApplicationAPI/),
[Connect API](https://developer.webull.com/apis/docs/connect-api/about-connect-api/),
[market-data permissions](https://developer.webull.com/apis/docs/market-data-api/overview/),
[rate limits](https://developer.webull.com/apis/docs/rate-limits/), and the
[2026-03-28 position-intent changelog](https://developer.webull.com/apis/docs/changelog/).

### `options-execution-receipt@1`

Persist:

- complete source, contract, quote, decision, intent, command, and adapter
  checksums;
- exact provider-preview request/response/checksum, or an explicit
  adapter-capability reason that preview is unavailable;
- debit reservation ID, checksum, state, and terminal/release proof;
- provider order ID and client-order ID;
- submitted, acknowledged, filled, canceled, and reconciled timestamps;
- requested quantity, cumulative fill quantity, remaining quantity;
- every fill price and fee;
- average fill price and actual debit;
- final broker order status;
- owned position quantity;
- recovery/reconciliation evidence;
- final result and typed failure code;
- receipt checksum.

## Commands and Events

| Name | Meaning | Retry rule |
|---|---|---|
| `options.signal.received` | Authenticated Discord evidence accepted | Message-ID idempotent |
| `options.contract.resolve` | Resolve exact listed contract | Read-only retry permitted before decision expiry |
| `options.quote.snapshot` | Obtain fresh quote | Read-only retry permitted within bounded deadline |
| `options.entry.decide` | Pure policy calculation | Same evidence produces same decision |
| `options.debit.reserve` | Atomically reserve worst-case account debit | Idempotent by intent; never infer missing capacity |
| `options.order.preview` | Persist provider advisory preview | Read-only retry requires a new preview artifact |
| `options.entry.submit` | One broker mutation | Never blind retry after send/unknown |
| `options.entry.cancel` | Cancel working remainder | Idempotent by provider/client order identity |
| `options.entry.reconcile` | Adopt exact provider truth | Read-only; no replacement order |
| `options.position.close` | Sell exact owned quantity to close | Durable request ID; no blind retry |
| `options.position.reconcile` | Verify position/order truth | Read-only |
| `options.debit.release` | Release after exact terminal/flat proof | Idempotent by reservation and proof checksum |

Provider events are hints. REST/provider snapshots remain authoritative unless a
future adapter proves a sequenced complete event stream.

## Errors

| Code | Retryable | User-facing meaning | Safe result |
|---|---:|---|---|
| `OPTIONS_SIGNAL_INCOMPLETE` | No | Missing exact contract or entry premium | Needs review; zero order |
| `OPTIONS_SIGNAL_AMBIGUOUS` | No | More than one contract interpretation | Blocked |
| `OPTIONS_SIGNAL_STALE` | No | Signal arrived too late | Skipped |
| `OPTIONS_CONTRACT_NOT_FOUND` | No | Exact listed contract unavailable | Blocked |
| `OPTIONS_CONTRACT_AMBIGUOUS` | No | Provider returned multiple matches | Blocked |
| `OPTIONS_CONTRACT_UNSUPPORTED` | No | Adjusted/nonstandard/wrong asset class | Blocked |
| `OPTIONS_PROVIDER_CONTRACT_UNVERIFIED` | No | Required provider field/capability is undocumented, conflicting, ignored, or unproven | Adapter remains read-only |
| `OPTIONS_QUOTE_UNAVAILABLE` | Yes, bounded | No usable live quote | Blocked until fresh quote |
| `OPTIONS_QUOTE_STALE` | Yes, bounded | Quote is older than policy | Blocked |
| `OPTIONS_MARKET_DATA_PERMISSION` | No automatic retry | Provider lacks real-time options data permission | Keep account halted; guide subscription/setup |
| `OPTIONS_MARKET_DATA_DELAYED` | No | Quote is delayed or indicative, including default delayed Webull sandbox data | Zero automatic order |
| `OPTIONS_SPREAD_TOO_WIDE` | No | Liquidity cost exceeds policy | Passive limit or skip |
| `OPTIONS_PRICE_MOVED_BEYOND_CAP` | No | Ask exceeds source chase limit | Skipped |
| `OPTIONS_PRICE_COLLAPSED_FROM_SIGNAL` | No | Option fell beyond thesis threshold | Skipped |
| `OPTIONS_RISK_LIMIT` | No | Quantity/debit/account limit exceeded | Blocked |
| `OPTIONS_RISK_RESERVATION_CONFLICT` | Yes after reconciliation | Concurrent/pending debit is already reserved | Zero new order |
| `OPTIONS_RISK_RESERVATION_INTEGRITY` | No automatic retry | Reservation ledger is missing, orphaned, or checksum-invalid | Halt account; repair from provider truth |
| `OPTIONS_EXISTING_CONTRACT_POSITION` | No | Same account/contract already owned or manual | Blocked |
| `OPTIONS_ORDER_EXPIRED` | No | Working deadline elapsed | Cancel and reconcile |
| `OPTIONS_SUBMIT_UNKNOWN` | No automatic retry | Provider may have received order | Halt account; reconcile exact ID |
| `OPTIONS_PARTIAL_FILL` | No replacement by default | Some contracts filled | Cancel remainder; manage actual fill |
| `OPTIONS_PROVIDER_DIVERGENCE` | No | Account has unexplained position/order truth | Halt account |
| `OPTIONS_SESSION_COMPETING` | Yes after operator action | Broker session is unavailable/competing | Keep halted |
| `OPTIONS_PROVIDER_RATE_LIMITED` | Yes, bounded for reads only | Provider quota is exhausted | Prioritize cancel/reconcile; expire new decision |
| `OPTIONS_PROVIDER_AUTH_INVALID` | Yes after operator action | Credential, token, nonce, clock, or signature rejected | Keep account halted; reconnect |
| `OPTIONS_PREVIEW_REJECTED` | No | Provider preview rejected permissions, buying power, or exact request | Zero order |
| `OPTIONS_PREVIEW_STALE_OR_DRIFTED` | Yes with a new decision | Preview or post-preview truth no longer matches | Expire decision; zero order |

## Concrete Examples

### Valid tight-spread entry

Discord:

```text
BUY SPY 2026-09-18 650C @ 1.25
```

Policy:

```json
{
  "max_spread_abs": "0.10",
  "max_spread_pct": "10",
  "max_chase_abs": "0.10",
  "max_chase_pct": "8",
  "tight_spread_action": "marketable_limit"
}
```

Fresh quote:

```json
{ "bid": "1.27", "ask": "1.30", "bid_size": 30, "ask_size": 22 }
```

Decision:

- spread: `$0.03`, approximately `2.33%` of midpoint;
- absolute cap: `$1.35`;
- percentage cap: `$1.35` after valid tick normalization;
- current ask is within cap;
- submit `BUY 1 LIMIT 1.30 DAY`.

### Valid passive-limit entry

Signal reference: `$1.25`.
Quote: `$1.15 x $1.35`.
The spread fails the tight-spread gate, but the ask remains within the chase
cap. With passive mode enabled, the system may work a bounded limit near the
midpoint according to the exact policy formula. It does not cross the ask and
does not later reprice above `$1.35`.

### Skipped chase

Signal reference: `$1.25`.
Quote: `$1.36 x $1.45`.
Effective chase cap: `$1.35`.
Result: `OPTIONS_PRICE_MOVED_BEYOND_CAP`; zero broker order.

### Blocked ambiguity

```text
SPY calls here around 1.25
```

Expiration and strike are missing. Result: `OPTIONS_SIGNAL_INCOMPLETE`; zero
contract lookup capable of producing an executable intent.

### Blocked unsupported strategy

```text
BUY SPY 650/655 call spread Friday @ 1.20
```

Result: `OPTIONS_STRATEGY_UNSUPPORTED`; zero order. The parser retains evidence
but cannot degrade the message into one selected leg.

## Time and Market Semantics

- All event timestamps are stored in UTC.
- UI displays exchange and operator-local time.
- US exchange calendar determines sessions and expiration dates.
- Phase 1 enters during regular option trading hours only.
- Quote age is measured from trusted receipt; provider timestamp is preserved.
- A quote event never extends the Discord signal's validity.
- Duplicate Discord messages return the prior receipt.
- Edited messages cannot create or modify an order.
- Out-of-order follow-ups cannot regress a newer accepted action.
- Corporate-action-adjusted and nonstandard options are rejected.
- Decimal prices use strings/fixed-point arithmetic and provider tick rules.
- Contract multiplier is provider-proven and must equal `100`.
- Phase 1 requires at least one full day to expiration; 0DTE is blocked.
- New entries are blocked after the configured session cutoff.
- Positions approaching expiration are prominently alerted. Automated expiry
  liquidation is a later separately certified capability.

Long options can lose the entire premium, and in-the-money contracts may be
exercised at expiration depending on broker procedures. This is why maximum
debit and expiration controls are first-class. See the OCC's
[standardized-options disclosure](https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document)
and OIC's [long-call risk summary](https://www.optionseducation.org/strategies/all-strategies/long-call).

## State Model

```text
received
  -> parsed
  -> blocked | needs-review | routed
routed
  -> contract-resolved
  -> blocked
contract-resolved
  -> quoted
  -> blocked
quoted
  -> eligible | skipped
eligible
  -> prepared
prepared
  -> submitting
submitting
  -> working | partially-filled | filled | rejected | submit-unknown
working
  -> partially-filled | filled | canceled | expired | reconcile-halted
filled/partially-filled
  -> active
active
  -> closing | closed | reconcile-halted
closing
  -> closed | partial | close-unknown | reconcile-halted
```

Every transition is append-only or checksum-bound. Terminal skip/block receipts
are retained. No state transition can increase quantity after the initial intent.

## Agent Behavior

The agent may:

- extract a candidate ticker, expiration, strike, right, source premium, and
  management phrase;
- cite the exact source text supporting each extracted field;
- explain a deterministic block/skip decision in plain language;
- ask the operator for missing information when manual review is enabled.

The agent must abstain when:

- contract fields are missing or conflict;
- premium could refer to the underlying rather than the option;
- more than one contract could match;
- the message is conditional, conversational, retrospective, or edited;
- the trader appears to discuss a spread or short option;
- quantity/management target is ambiguous.

The agent cannot:

- select a nearby strike or expiration;
- change the account or policy route;
- set quantity or loosen risk limits;
- read credentials;
- call broker tools;
- override quote, contract, risk, certification, or halt gates;
- turn research output into execution authority.

## UI States

### Options Automation home

The default page is operator-facing, not developer-facing:

1. **Automation status** — Off, Setup needed, Paper ready, Running, Halted.
2. **Connected accounts** — IBKR/Webull, paper/sandbox badge, market-data
   permission, health, and activation.
3. **Discord sources** — who is monitored and which account receives trades.
4. **Entry rules** — plain-language spread, chase, size, and expiration limits.
5. **Signals** — Entered, Working, Skipped, Needs review.
6. **Active positions** — exact option, quantity, average price, debit, source.
7. **Recent activity** — human-readable audit trail.

Advanced diagnostics, contract IDs, checksums, provider responses, and adapter
versions remain collapsed behind **Technical details**.

### Guided setup

```text
Choose IBKR or Webull -> Connect paper/sandbox account -> Verify account and live data
-> Run guided sandbox certification -> Enable manual paper testing
-> Add Discord source -> Set buying rules -> Certify exits and expiration safety
-> Review and activate automation
```

### Plain-language policy copy

Example:

> Buy at the current ask only when the bid/ask gap is no more than $0.10 and
> 10%. Never pay more than $0.10 or 8% above the trader's posted price. If the
> spread is wider, work a limit for up to 15 seconds. Skip anything older than
> 30 seconds or expiring today. Maximum one contract and $300 debit.

### Required states

- loading;
- broker disconnected;
- session competing;
- no market-data permission;
- delayed Webull sandbox data;
- provider application or API key still pending;
- provider connected read-only;
- provider contract needs verification;
- manual paper ready, automation still locked;
- automatic paper certified;
- Webull 2FA/token reconnection required;
- provider rate limited;
- empty source list;
- setup incomplete;
- paper ready but halted;
- active;
- stale quote;
- skipped with reason;
- working limit with countdown and cancel control;
- partial fill;
- provider truth unknown;
- recovery required;
- expiration warning;
- incompatible contract/adapter.

All critical states use text plus icon/color. Keyboard navigation, focus order,
screen-reader labels, reduced motion, and accessible confirmation dialogs are
required.

## Security and Safety

- Credentials remain in the encrypted main-process vault.
- Renderer receives only connection status and opaque references.
- Discord source authenticity and replay protection remain mandatory.
- Exact source/account routing has no fallback account.
- Exact account routing has no fallback broker.
- One gateway is the only broker mutation authority.
- Broker adapter is paper-only until exact retained certification.
- `BUY_TO_OPEN` and `SELL_TO_CLOSE` are the only allowed actions.
- Gateway independently proves the resulting order cannot open a short position.
- Same account + provider option contract has one active Trade God lineage.
- Existing manual/unowned exposure or working orders on the same contract block.
- Maximum debit uses `limit price * multiplier * quantity + estimated fees`.
- Account aggregate debit and daily initiated debit are independently enforced.
- Missing quote, data subscription, contract rules, or account truth blocks.
- True market orders remain disabled.
- Submit-unknown never retries and latches the account halt.
- Partial fill cancels the remainder by default and manages actual filled size.
- External/manual position drift latches the account halt.
- Every working order has a visible operator cancel action.
- Emergency global and account halts remain available.
- No clean install can activate without paper lifecycle evidence.

## Observability and Receipts

Every signal has one trace joining:

```text
Discord evidence -> route -> contract -> quote -> decision
-> risk -> command -> broker order -> fills -> position -> follow-ups
```

Metrics:

- signals received, parsed, blocked, skipped, entered;
- skip reasons by source/account;
- quote age and spread distributions;
- source-to-ask drift;
- decision-to-submit and submit-to-fill latency;
- requested limit versus average fill;
- working-limit fill/cancel/partial rates;
- provider errors, unknown submits, reconciliation divergence;
- realized paper slippage and fees;
- expiration-risk alerts.

Logs never contain credentials or full account secrets. Operator exports use
redacted account labels and retain immutable IDs/checksums separately.

## Evaluation Plan

### Parser fixtures

- exact ISO expiration, US date, `Friday`, and monthly/weekly formats;
- calls and puts;
- decimal and range premium;
- missing strike/expiry/right/reference;
- spreads, short options, rolls, and commentary rejected;
- edited, duplicate, stale, and conditional messages;
- replies and follow-ups with exact lineage.

### Pricing fixtures

- tight/wide spread at different premium bands;
- absolute passes but percentage fails, and inverse;
- ask exactly at each cap;
- ask one tick beyond cap;
- tick-band changes;
- quote moves during decision;
- favorable collapse threshold;
- zero/missing/crossed/delayed quotes;
- insufficient displayed size;
- passive price impossible after rounding;
- reprice remains within frozen cap.

### Broker/adversarial fixtures

- duplicate submit and restart;
- timeout before send, after send, and after provider acknowledgment;
- partial fill then cancel;
- concurrent signals competing for the final account debit/position capacity;
- crash after debit reservation and before/after submit;
- cancel unknown;
- competing broker session;
- wrong account or contract returned;
- manual same-contract position/order appears;
- provider order ID reused/mismatched;
- stale event after newer REST truth;
- account disconnected during working order;
- close race with manual/provider fill;
- exit/cancel arrives while entry is working or partially filled;
- expiration close deadline, failed close, and do-not-exercise evidence;
- no accidental `SELL_TO_OPEN`.
- IBKR and Webull route isolation; provider outage cannot redirect the order;
- Webull client-order-ID length and collision;
- Webull option-leg/position-intent mismatch;
- Webull preview passes but order/account truth changes before submit;
- Webull delayed quote, lost OPRA entitlement, competing data device, 429, clock
  skew, nonce/signature rejection, 2FA/token expiry, and key rotation;
- Webull gRPC/MQTT duplicate, stale, malformed, disconnected, and missing events;
- protective cancel and reconciliation remain available under new-entry quota
  pressure.

### Certification authority boundary

Certification cannot depend on an adapter already being certified. A dedicated
main-process **sandbox certification runner** is the sole bootstrap authority:

- accepts only an exact registered sandbox/paper account and an installed
  adapter whose descriptor is still uncertified;
- requires an explicit operator-started certification session naming provider,
  account, adapter/version, provider-contract, capabilities, and maximum test
  debit;
- keeps normal global, account, source, mandate, and Discord execution disabled;
- cannot consume a Discord message, standing mandate, route, or agent tool call;
- can place only deterministic certification fixtures with reserved client IDs,
  one-contract maximum, bounded total debit, and a short expiry;
- persists every preview, command, acknowledgment, fill, cancel, close,
  reconciliation, failure-injection step, and final flat/zero-working-order proof;
- never retries an unknown submit/cancel, and latches the account on uncertainty;
- applies no certification itself. A separate trusted apply step validates the
  immutable completed evidence before enabling manual-confirmed paper mode.

The runner first completes read-only contract, option-quote-size, permissions,
auth-lifecycle, position-intent, account, and order-detail conformance. Only then
may it place controlled sandbox orders. Normal Options Automation remains halted
throughout this bootstrap.

### Certification levels

1. `options-read-only-verified` proves account/environment identity, auth
   lifecycle, exact contract mapping, live quote/size/timestamp/delay semantics,
   option permission, preview schema, order-detail schema, and zero mutations.
2. `options-sandbox-entry-certified` is created only by the restricted runner.
   It adds retained preview/place/cancel/full-close/reconcile lifecycles, exact
   position-intent and no-short proof, unknown-submit containment, restart,
   client-order-ID collision, final flat truth, and zero working orders. This
   level permits only explicit operator-confirmed sandbox entry.
3. `options-paper-autopilot-certified` additionally requires the complete
   management/expiration implementation and the full matrix below. Only this
   exact level can satisfy automatic source activation.

The automatic-paper matrix requires:

- 50 clean paper entry-to-close lifecycles per exact adapter version,
  provider-contract version, capability checksum, environment, and auth profile;
- retained tight-spread marketable-limit and wide-spread passive-limit cases;
- preview success, rejection, fee/buying-power drift, expiry, and post-preview
  account/quote/reservation drift;
- every uncertain-submit and restart boundary;
- partial fills, cancellation, exit-before-entry-fill, and cancellation unknown;
- follow-up full and deterministic partial closes;
- expiration close/cutoff/escalation and do-not-exercise handling;
- account, source, connection, global halt, and reservation-admission races;
- Webull exact one-leg mapping, `position_intent` success/rejection/mismatch,
  option quote-size schema, auth/2FA restart, and client-order-ID collision;
- full reconciliation proving no unowned positions/orders;
- zero production/live-money orders during certification;
- final sandbox account flat with zero owned or unowned working orders.

IBKR and Webull certify separately. Webull automatic-entry certification
requires real-time OpenAPI OPRA data; default delayed sandbox data cannot satisfy
quote freshness or lifecycle evidence. Trading API App Key/App Secret and
Connect API OAuth are distinct auth profiles and cannot reuse certification.

## Acceptance Criteria

- [ ] One valid single-leg signal resolves to exactly one standard option.
- [ ] Missing/ambiguous fields produce zero broker I/O.
- [ ] Spreads and short-option messages cannot degrade into a one-leg entry.
- [ ] Quote freshness, market-data mode, bid/ask, size, and tick are proven.
- [ ] Both absolute and percentage spread gates are enforced.
- [ ] No buy order can exceed the lower absolute/percentage chase cap.
- [ ] Tight-spread entry uses a capped limit, never a true market order.
- [ ] Wide-spread entry either uses the exact passive formula or skips.
- [ ] Sizing independently enforces maximum debit and aggregate account limits.
- [ ] Concurrent entries cannot exceed account limits; durable reservations
      survive restart and unknown submit.
- [ ] Independent contracts can coexist only after per-contract ownership and
      the complete account reservation ledger are proven; same-contract entries
      remain blocked.
- [ ] Duplicate/restart behavior cannot submit a second order.
- [ ] Submit-unknown halts and reconciles without retry.
- [ ] Partial fill cancels the remainder and manages only confirmed quantity.
- [ ] Follow-ups resolve the exact source-created option lineage.
- [ ] An exit/cancel follow-up prevents an owned working entry from filling
      afterward, and partial fill closes only after the remainder is terminal.
- [ ] Same-contract manual/unowned exposure blocks entry and management.
- [ ] Renderer and agent cannot access credentials or call broker methods.
- [ ] Paper/live environment is unmistakable in UI and receipts.
- [ ] A broker outage, auth failure, or rate limit cannot redirect a signal to
      another provider.
- [ ] Webull remains read-only until sandbox proves one-leg `LIMIT` orders,
      exact `BUY_TO_OPEN`/`SELL_TO_CLOSE` intent, quote sizes, and collision-safe
      client IDs against the installed provider-contract version.
- [ ] Delayed Webull sandbox quotes cannot reach automatic entry or
      certification.
- [ ] Automatic mode cannot activate without a certified expiration-custody
      plan for unattended positions.
- [ ] Manual paper entry requires exact `options-sandbox-entry-certified`;
      automatic Discord entry requires exact `options-paper-autopilot-certified`.
- [ ] The sandbox certification runner cannot consume Discord, routes, mandates,
      agents, production credentials, or production accounts.
- [ ] Every placed order binds a fresh provider preview and post-preview
      revalidation when the adapter declares preview support.
- [ ] Every skip, block, order, fill, cancel, and follow-up is auditable.

## Verification Commands

| Command/action | Proves | Expected result |
|---|---|---|
| Contract schema tests | Versioned exact option identity and evidence | All pass |
| Parser golden suite | Conservative signal extraction/abstention | All pass |
| Property tests for pricing policy | No price exceeds cap across decimals/ticks | All pass |
| Reservation-store crash/concurrency suite | No capacity oversubscription or false release | All pass |
| Gateway failure-injection suite | Idempotency, halt, recovery | All pass |
| Broker adapter conformance suite | Exact paper provider translation/truth | All pass |
| Provider preview binding suite | Preview, final truth, and command remain exact | All pass |
| Certification-runner authority suite | Sandbox fixtures cannot reach normal execution authority | All pass |
| UI component/accessibility suite | Plain-language and safe controls | All pass |
| Paper retained lifecycle runner | Real provider behavior | 50 clean lifecycles |
| Full typecheck and build | Repository integration | Clean |

## Rollout and Reversal

### Stage 0 — Contracts and simulator

- Feature flag hidden by default.
- No broker adapter.
- Parser, resolver interface, policy, receipts, and fake provider only.

### Stage 1 — Read-only broker connection

- IBKR and Webull contract discovery, live paper/sandbox quotes, account,
  position, and order truth.
- No order submission.

### Stage 2 — Restricted sandbox certification

- Normal execution and every Discord route remain halted.
- Operator starts the exact sandbox certification runner.
- Read-only conformance precedes controlled one-contract fixtures.
- Retained provider evidence must finish flat with zero working orders.
- A trusted apply step independently validates and installs only
  `options-sandbox-entry-certified`.

### Stage 3 — Manual-confirmed paper entry

- One account, one contract, one fixed quantity.
- User confirms every eligible order.
- Marketable limit only; no repricing.

### Stage 4 — Management and expiration custody

- Working-entry cancel/no-fill and exit-before-fill ordering.
- Exact-lineage full and deterministic partial closes.
- Provider-specific expiration close, cutoff, escalation, and do-not-exercise
  workflow.
- Restart and failure injection prove no stranded working entry or position.

### Stage 5 — Automatic paper entry

- Exact source/account policy activation.
- Tight-spread and bounded passive-limit paths.
- Activation is impossible until Stage 4 earns
  `options-paper-autopilot-certified` for the exact
  adapter/provider-contract/capability version.

### Stage 6 — Additional paper brokers/accounts

- One certified adapter at a time.
- Per-contract ownership and durable account debit reservations are required
  before more than one simultaneous option position per account.
- No cross-account mirroring until separately specified.

Reversal disables the feature flag, latches all option-account halts, cancels
working Trade God-owned option orders, reconciles every account, and preserves
all receipts. Rollback must not remove the adapter version needed to reconcile
an open position.

## Risks and Edge Cases

1. **Wrong option contract** — exact provider ID, standard deliverable, and
   checksum binding; ambiguity blocks.
2. **Poor fill from a fast option quote** — capped marketable limit, quote age,
   spread/size gates, no true market order.
3. **Signal chasing** — lower absolute/percentage cap wins; no reprice beyond it.
4. **Signal became invalid after premium collapsed** — configurable favorable
   retrace block; no assumption that cheaper is always better.
5. **Broker netting merges positions** — one active lineage per account/contract;
   additional entries block.
6. **Manual trade collision** — account-wide provider truth and ownership check.
7. **Partial fill** — cancel remainder, record actual position, no replacement.
8. **Unknown submit/cancel** — halt and reconcile; never blind retry.
9. **Expiration/exercise** — no 0DTE initially; certified custody and exit
   automation are prerequisites for automatic entry, not a later enhancement.
10. **Market-data permission or delayed quote** — block rather than substitute.
11. **Competing IBKR session** — remain halted and require operator resolution;
    IBKR documents a single active brokerage session per username.
12. **Discord ambiguity/slang** — agent abstains; deterministic validator owns
    executable eligibility.
13. **Provider tick bands** — adapter resolves current contract rules before
    price normalization.
14. **Underlying corporate action** — adjusted/nonstandard contracts blocked.
15. **Fees make risk exceed cap** — estimated fees included pre-entry; actual
    fees reconciled afterward.
16. **Provider fallback duplicates or misroutes** — route freezes one provider,
    account, and adapter checksum; outage blocks rather than reroutes.
17. **Webull delayed sandbox data** — delayed flag blocks automation and cannot
    count toward certification.
18. **Webull order-list delay** — reconcile by exact client order ID/order
    detail plus positions; open-order/history lists alone are insufficient.
19. **Webull key/token/2FA lifecycle** — secret rotation is atomic, stale
    credential generations fail closed, and renderer never receives secrets.
20. **Provider quota exhaustion** — bounded scheduler reserves capacity for
    cancel, order detail, reconciliation, and exit ahead of new entries.
21. **Concurrent risk oversubscription** — per-account admission lock and
    durable worst-case debit reservations cover working and unknown orders.
22. **Exit arrives before entry completes** — cancel and prove the working
    remainder first, then close only confirmed fills.
23. **Unattended expiration/exercise** — provider-specific custody deadline and
    escalation are activation requirements, not a warning-only feature.

## Open Questions

| Question | Proposed answer | Decision gate |
|---|---|---|
| First broker | Build provider-neutral contracts, then spike IBKR paper and Webull sandbox in parallel; enable only an independently certified adapter | Approve before adapter implementation |
| IBKR connection | Compare Web API with local IB Gateway/TWS API against session, unattended-auth, market-data, and recovery requirements | Read-only technical spike |
| Webull initial auth | Trading API App Key/App Secret for the operator's own account; Connect OAuth is a later separately certified product flow | Confirm intended distribution before implementation |
| Webull market data | Require OpenAPI OPRA Real-Time Non-display; delayed sandbox is simulation-only | Confirm subscription and read-only proof |
| Webull position intent | Treat official documentation conflict as a hard capability block; enable submit only after exact sandbox proof of open/close semantics | Read-only mapping plus controlled certification fixture |
| Webull quote size | Require a retained live option fixture with bid/ask sizes and delayed flag; otherwise keep automatic entry unavailable | Read-only provider spike |
| Webull paper semantics | Use approved sandbox/test account; read-only spike proves auth/contracts/quotes/preview, then the restricted certification runner proves place/cancel/close/reconcile | Provider technical spike and retained certification |
| True market order | Keep disabled; marketable limit at ask provides a cap | Operator approval |
| Starter X/Y values | Use paper preset only, then tune by premium band from retained fills | Before automatic paper stage |
| Wide-spread behavior | Bounded passive limit, zero automatic reprices initially | Paper evidence |
| Source signal without premium | Needs review; never automatic | Operator approval |
| Source quantity | Ignore by default; account policy owns quantity | Operator approval |
| 0DTE | Excluded initially | Separate spec/certification |
| SPX/NDX/index options | Excluded initially | Separate cash-settlement/expiry spec |
| Broker-native stops/targets | Only option-premium orders after provider certification | Follow-up phase |
| Options Oracle | Research packet input only, never execution authority | Separate integration spec |

## Implementation Plan

1. Close and verify the Trade God workspace-containment mutation boundary.
2. Add versioned option signal, contract, quote, policy, decision, intent, and
   receipt schemas plus fixed-point helpers, `options-debit-reservation@1`, and
   `options-provider-preview@1`.
3. Build parser golden fixtures and explicit multi-leg/short-option refusals.
4. Build pure contract-resolution interface and fake option-chain provider.
5. Build pure quote/spread/drift/sizing policy with property tests.
6. Implement the durable account debit-reservation store, atomic admission,
   per-contract ownership, restart recovery, and corruption/orphan refusal.
7. Extend the gateway with option asset identity, preview binding,
   `BUY_TO_OPEN`/`SELL_TO_CLOSE` invariants, and final post-preview revalidation.
8. Build the Options Automation page and guided read-only setup.
9. Spike IBKR Web API versus IB Gateway/TWS API; document the selected adapter
   contract and session lifecycle.
10. Run a strictly read-only Webull spike for sandbox application/auth, exact
    option contract, OPRA quote/size/delay schema, preview, order-detail/event
    schemas, rate limits, and documented position-intent behavior. Do not claim
    place/cancel/close proof from this step.
11. Implement read-only IBKR paper and Webull sandbox contract, quote, account,
    position, and order reconciliation behind separate exact adapters.
12. Implement the restricted sandbox certification runner and immutable evidence
    verifier with no Discord, mandate, route, agent, or production authority.
13. Run controlled sandbox fixtures for preview/place/cancel/close/reconcile,
    Webull position intent and quote size, partial fill, unknown submit, restart,
    auth failure, and final flat/zero-working-order proof.
14. Apply `options-sandbox-entry-certified` through the separate trusted evidence
    validator; normal execution remains halted until this succeeds.
15. Enable manual-confirmed single-contract paper orders on that exact certified
    adapter/version/provider-contract only.
16. Implement and certify working-entry cancellation, exact-lineage follow-up
    closes, partial-fill ordering, and provider-specific expiration custody.
17. Re-run the retained lifecycle matrix, including failure injection and 50
    clean entry-to-close paper lifecycles after management is complete, then
    independently apply `options-paper-autopilot-certified`.
18. Enable exact-source automatic paper entry behind explicit policy activation.
19. Permit multiple simultaneous contracts only after the reservation ledger and
    per-contract ownership pass concurrency, crash, orphan, and capacity tests.
20. Run a bounded paper soak per adapter before considering any live-money
    proposal.

## Evidence Log

| Date | Evidence | Result | Remaining gap |
|---|---|---|---|
| 2026-08-26 | Existing Trade God execution, routing, follow-up, and certification docs reviewed | Reusable control plane identified | Options contracts/provider absent |
| 2026-08-26 | SEC order-type/trade-execution guidance reviewed | Capped limit chosen over true market entry | Provider paper proof required |
| 2026-08-26 | OCC/OIC options risk and liquidity material reviewed | Debit, spread/size, expiration gates specified | Values require paper calibration |
| 2026-08-26 | IBKR Web API session, market-data, contract, and order docs reviewed | Provider spike boundaries specified | Adapter choice unresolved |
| 2026-08-26 | Webull official OpenAPI auth, options, market-data, order, and rate-limit docs reviewed | Webull sandbox adapter boundaries specified; limit-only entry aligns with policy | API application, real-time OPRA entitlement, implementation, and certification remain |
| 2026-08-26 | Cold rival review of provider, risk, certification, preview, and rollout boundaries | Added durable debit reservations, certification bootstrap levels, fail-closed Webull contract proof, preview evidence, and exit-before-auto sequencing | Code, sandbox credentials, provider fixtures, and retained lifecycle evidence remain |

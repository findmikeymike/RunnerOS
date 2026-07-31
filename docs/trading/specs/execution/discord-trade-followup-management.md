---
status: active
owner: team
last_verified: 2026-07-30
source_of_truth: true
---

# Discord Trade Follow-Up Management

## Outcome

A trusted Discord trader can follow an activated entry with natural-language
management such as:

- `taking off half here, moving stops to BE`
- `not loving this, closing here`
- `all out`
- `move stop to 5601.25`

Trade God resolves the message to exactly one active gateway trade, reconciles
current broker truth, persists the source and complete ordered plan before
broker mutation I/O, and routes each
mutation through the existing durable execution gateway.

The resolver never means "the globally most recent trade."

## Current Boundary

Already implemented:

- immutable Discord ticket to `order-intent@1`;
- one durable execution gateway;
- partial-close, modify, cancel, and flatten commands;
- management command checksums and idempotency;
- restart reconciliation and kill switches;
- exact adapter/version certification.

Missing before this spec:

- a signed follow-up message contract;
- conservative management-only language parsing;
- immutable author/channel/reply/thread context;
- exact active-trade resolution;
- durable message-level deduplication;
- compound-action ordering and resume;
- normalized protection-order identity for safe stop movement;
- an audit receipt joining the Discord message to gateway commands.

## Research Decisions

### Discord context

Discord message objects expose immutable message and author IDs. Replies carry a
`message_reference` with the referenced message and channel IDs. Thread channels
have their own ID and a `parent_id`. Message text requires the privileged
`MESSAGE_CONTENT` intent for a bot integration; the existing visible-DOM
collector must therefore continue supplying equivalent immutable fields when a
bot connection is unavailable.

Resolution evidence strength:

1. reply to the entry message or a prior accepted follow-up;
2. same thread plus explicit symbol;
3. same channel plus explicit symbol;
4. same author and same thread/channel with exactly one active trade.

No cross-channel "latest trade" fallback is allowed.

### DiscoTrader donor

DiscoTrader v2 already proves useful management doctrine:

- management parsing occurs before entry parsing;
- partial exit precedes full exit;
- `stopped out` is reconciliation, not a new close;
- multi-action messages retain every action;
- partial close retires/resizes protection;
- ambiguous position resolution does not guess.

Trade God reuses those rules but not DiscoTrader's independent position or
broker authority.

### Provider management

Tradovate documents `modifyorder`, `cancelorder`, and
`liquidateposition`; every request remains only a request until provider truth
is reconciled. The normalized gateway therefore needs the exact active
protection order, quantity, type, and price in reconciliation evidence before a
stop can be moved safely.

## Contracts

### `discord-management-message@1`

Required:

- immutable message ID;
- immutable author ID;
- channel ID;
- optional guild, thread, parent-channel, and reply target IDs;
- raw text;
- posted and observed timestamps;
- explicit edit flag;
- SHA-256 content checksum.

Edited messages are retained as evidence but cannot create a new mutation.

### `execution-protection-order@1`

Normalized reconciliation may identify:

- provider order ID;
- role: stop loss or take profit;
- quantity;
- normalized order type;
- limit/stop price when present;
- working state.

The gateway moves a stop only when exactly one active stop-loss order belongs to
the resolved trade.

### `discord-management-receipt@1`

The durable receipt joins:

- source message and checksum;
- resolution strategy and candidate intent IDs;
- resolved intent ID;
- ordered logical actions;
- concrete gateway payload for each issued action;
- per-action status and management command ID;
- final status and error;
- timestamps and receipt checksum.

The exact partial-close quantity is persisted before execution. A replay uses
that quantity rather than recalculating "half" from a smaller position.

## Management-Only Parser

Allowed automatic interpretations:

| Language | Logical action |
|---|---|
| half, 50%, one of two, explicit contracts | partial close |
| all out, closing here/now, flat, done | flatten |
| move stop(s) to BE, breakeven, entry | move stop to verified average fill |
| move stop to an explicit price | move stop to exact price |
| stopped out, stop hit | reconcile only |

Rules:

- questions, conditionals, retrospectives, and commentary are non-actionable;
- vague `tighten`, `trail`, or `take some` without configured deterministic
  sizing is blocked;
- a fractional close must produce an exact integer contract quantity;
- quantity must be positive and smaller than confirmed open quantity;
- a full close cannot be combined with another action;
- duplicate or contradictory actions block the whole message;
- the parser may reject but never invent an entry or increase exposure.

## Trade Resolution

Eligible records:

- source type is Discord;
- source author matches exactly;
- gateway has a claimed command;
- state is non-terminal and compatible with the requested management;
- persisted DiscoTrader source artifact passes integrity checks.

Resolution:

1. If the message replies to an entry or prior accepted follow-up, that target
   is authoritative. If it is no longer eligible, stop; do not fall back.
2. Otherwise require the same channel/thread and apply any explicit symbol and
   side.
3. Exactly one candidate resolves.
4. Zero candidates becomes `orphaned`.
5. More than one becomes `ambiguous`.

Display names, timestamps alone, and "most recent" ordering are never identity
evidence.

## Ordered Execution

`taking off half, moving stop to BE`:

1. Reconcile the selected trade.
2. Require protected state and confirmed open quantity.
3. Persist a plan containing the exact partial-close quantity.
4. Issue the partial close through the gateway.
5. Reconcile and require the remaining position protected.
6. Resolve the current single active stop-loss order.
7. Persist the concrete stop modification.
8. Move it to the verified average fill price.
9. Reconcile and persist the completed receipt.

If any step is rejected, unknown, divergent, unprotected, or unsupported:

- stop the remaining plan;
- preserve the receipt for recovery;
- rely on gateway reconciliation/kill-switch behavior;
- never retry with a newly calculated quantity or another adapter.

`closing here` issues one gateway flatten command and reconciles flat.

`stopped out` issues no mutation; it reconciles broker truth.

## Persistence and Recovery

- A message receipt is created with exclusive-create semantics before broker
  mutation I/O. Read-only preflight reconciliation occurs first.
- Duplicate message IDs return the durable receipt.
- Every logical action obtains a concrete payload before its gateway call.
- Restart resumes the same persisted action plan.
- Each gateway command is keyed by the immutable Discord message checksum plus
  action index. Retrying one source action reuses its command, while an
  identical instruction from a different Discord message remains a distinct
  requested action.
- Receipt and source tampering fail closed.

## Test Matrix

Parsing:

- exact user examples;
- comma, newline, and `and` compound clauses;
- partial before full-exit precedence;
- stopped-out reconciliation;
- question/conditional/retrospective refusal;
- unsupported vague management refusal.

Resolution:

- reply to exact entry;
- reply to prior follow-up;
- same author/channel with one trade;
- explicit symbol among multiple trades;
- wrong author;
- cross-channel message;
- deleted/closed reply target;
- multiple matching trades;
- missing/tampered source artifact.

Execution:

- half then BE in strict order;
- exact integer sizing;
- odd-quantity half refusal;
- close-now flatten;
- duplicate message replay;
- identical reductions from two different Discord messages both execute once;
- crash after partial close and resume without a second partial;
- first-action failure prevents the second;
- ambiguous management acknowledgment halts;
- stop movement requires one active normalized stop;
- no adapter switching.

Integrity:

- message checksum;
- receipt checksum;
- immutable candidate/resolution evidence;
- concrete payload persisted before I/O;
- management command IDs joined back to the receipt.

## Acceptance Criteria

- [x] Follow-up messages are immutable, checksum-bound, and deduplicated.
- [x] The same immutable Discord author is required.
- [x] Replies and threads outrank channel-level inference.
- [x] The resolver never uses a global latest-trade fallback.
- [x] Exactly one active gateway trade is required.
- [x] Partial close quantity is deterministic and persisted before I/O.
- [x] Compound actions execute sequentially and resume idempotently.
- [x] Breakeven uses the verified average fill.
- [x] Stop movement requires exactly one identified active stop-loss order.
- [x] Full close uses the gateway flatten path.
- [x] `stopped out` reconciles without submitting a close.
- [x] Every outcome has a durable source-to-command receipt.
- [x] Unsupported, orphaned, ambiguous, edited, or stale messages do nothing.
- [x] Focused tests, typechecks, production builds, rival review, and fixes pass.

## External Integration Gate

DiscoTrader v2 now pushes one immutable signed management envelope per source
message. The sender writes that envelope to a SQLite outbox before acknowledging
the Chrome delivery and retries transient Runner outages. Trade God instantiates
the durable manager in Electron and routes the
dedicated `discotrader-management` slug directly from the existing trigger
server after HMAC, timestamp, body, rate, and exact-replay gates. Pending
receipts recover before new delivery. The runtime attaches zero provider
adapters until a real paper connection is certified.

Thread identity is accepted only when the extension observes an exact
cross-channel reply or the operator supplies an explicit thread-to-parent
channel mapping. Unknown thread styling remains empty rather than guessed.

The Trading workspace now has an enabled `WebhookReceive` matcher for
`discotrader-management`, with `secretEnv` set to the same secret value as
DiscoTrader's `DT_RUNNER_HMAC_SECRET`. The donor sends `kind: "management"`
plus the full immutable management message to:

`http://127.0.0.1:9101/v1/triggers/<trading-workspace-id>/discotrader-management`

The end-to-end local observe-only path is now runtime-proven: the donor sender,
installed matcher, and running Electron receiver accepted live local messages,
persisted durable blocked receipts, and explicitly attempted no gateway
mutation. No broker or paper-certified adapter claim is made yet.

## Primary Sources

- [Discord Message Resource](https://docs.discord.com/developers/resources/message)
- [Discord Gateway and Message Content Intent](https://docs.discord.com/developers/events/gateway)
- [Discord Threads](https://docs.discord.com/developers/topics/threads)
- [Tradovate API](https://api.tradovate.com/)

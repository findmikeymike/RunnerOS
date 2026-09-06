---
status: draft
owner: team
last_verified: 2026-08-28
source_of_truth: true
spec_id: TG-EXEC-005
target_phase: Options Desk provider expansion
depends_on:
  - TG-EXEC-004 discord single-leg options autopilot
  - TG-EXEC-001 unified broker entry gateway
  - Trade God runtime and credential isolation
---

# Robinhood Agentic Options Adapter

## Decision Summary

Trade God will integrate Robinhood through Robinhood's official **Trading MCP**
at `https://agent.robinhood.com/mcp/trading`. It will not use Robinhood's
undocumented private web/mobile APIs, browser automation, credential scraping,
or a model with unrestricted access to Robinhood tools.

The integration will be a deterministic main-process broker adapter. Trade
God's existing parser, route, price, size, risk, durable intent, recovery, and
audit layers remain authoritative. The adapter translates already-approved
commands into an allowlisted Robinhood MCP tool call and validates the returned
provider truth.

Robinhood's public documentation confirms long options, quote/instrument/order/
position reads, order review, placement, and cancellation. It does not publish
the complete authenticated tool input/output schemas or an Agentic paper
environment. Therefore implementation begins with authenticated schema capture
and read-only qualification. Live mutation remains unavailable until the exact
tool contract proves account selection, limit-price semantics, stable order
identity, and safe crash reconciliation.

Official sources:

- [Agentic Trading overview](https://robinhood.com/us/en/support/articles/agentic-trading-overview/)
- [Trading with your agent](https://robinhood.com/us/en/support/articles/trading-with-your-agent/)
- [Agentic Trading product page](https://robinhood.com/us/en/agentic-trading/)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

## User Outcome

As a Trade God user, I can click **Connect Robinhood**, sign in through
Robinhood, create or select my dedicated Agentic account, and see a clear
connection badge without copying API keys.

After qualification, I can route an approved Discord options source to that
exact Agentic account. Trade God can buy and close only the supported long
single-leg calls and puts within my existing spend, spread, chase, time, and
position rules.

## Confirmed Provider Facts

Verified from Robinhood's public product documentation and read-only endpoint
metadata on 2026-08-28:

| Fact | Consequence for Trade God |
|---|---|
| The official transport is Streamable HTTP MCP | Use the official MCP SDK in the Electron main process |
| MCP endpoint is fixed | Do not accept a user-supplied Robinhood URL |
| OAuth protected-resource metadata is advertised by `WWW-Authenticate` | Perform standards-based discovery, not hardcoded token capture |
| OAuth uses authorization code plus refresh token | Persist and rotate tokens in the Trade God vault |
| PKCE method is `S256` | Refuse authorization without PKCE |
| Dynamic client registration is advertised | Register the installed Trade God desktop client on user action |
| Token endpoint authentication method is `none` | Treat Trade God as a public native client; no embedded client secret |
| Robinhood exposes an opaque `internal` scope | Request only the server-advertised scope; never invent broader scopes |
| Agentic onboarding/authentication is desktop-only | Open the system browser and complete a loopback callback flow |
| A primary Robinhood account in good standing is required | Explain this prerequisite before opening sign-in |
| The agent can read all Robinhood accounts | Filter and retain only the exact selected Agentic account in broker records |
| The agent can trade only in the dedicated Agentic account | Reject primary, retirement, joint, or other non-Agentic accounts |
| Long equities, long options, and crypto are supported | This adapter enables only existing Trade God long-option scope |
| Options tools include instruments, chains, quotes, positions, orders, review, place, and cancel | The public surface appears sufficient, subject to schema qualification |
| Robinhood permits trading without per-order confirmation when the user configures it | Trade God's own activation and risk gates remain required |
| Robinhood provides notifications and a visible activity feed | Useful secondary evidence, never the execution source of truth |
| The user can disconnect the agent in Robinhood | UI must explain local disconnect versus Robinhood-side revocation |
| No Agentic paper/sandbox environment is publicly documented | No automated live mutation during initial integration |

Observed OAuth metadata:

```text
resource: https://agent.robinhood.com/mcp/trading
authorization server issuer: https://agent.robinhood.com/mcp/trading
authorization endpoint: https://robinhood.com/oauth
registration endpoint: https://agent.robinhood.com/oauth/trading/register
token endpoint: https://api.robinhood.com/oauth2/token/
grant types: authorization_code, refresh_token
response type: code
PKCE: S256
token endpoint auth: none
scope: internal
```

These URLs are discovery evidence, not permission to bypass discovery. Runtime
must verify the protected-resource and authorization-server metadata each time
a new authorization is initiated and fail closed if issuer/resource origins or
security properties change.

## Unknowns That Block Mutation

The following must be captured from authenticated `tools/list` and harmless
read/review calls before an adapter may place an order:

1. Exact JSON Schema for every required tool input and structured result.
2. How the Agentic account is distinguished from other returned accounts.
3. Whether every read and mutation accepts or returns exact account identity.
4. Robinhood's stable option instrument identifier and OCC-symbol behavior.
5. Whether quotes include bid, ask, sizes, timestamp, delay/market status, and
   minimum tick information.
6. Whether `review_option_order` returns exact contract, side, quantity, limit,
   estimated debit, fees, buying-power impact, warnings, and account.
7. Whether `place_option_order` accepts a caller-supplied idempotency/client
   order ID and returns it on later order reads.
8. Whether order history can be filtered or deterministically reconciled by
   that client ID after a timeout or process crash.
9. Exact statuses for working, partial, filled, canceled, rejected, expired,
   and pending-cancel orders.
10. Whether partial-fill quantities and average fill prices are always present.
11. Whether sell-to-close can be expressed explicitly and cannot become
    sell-to-open.
12. Whether cancellation returns terminal truth or merely acknowledges a
    request.
13. Whether tool calls return JSON in `structuredContent`, JSON text, or another
    envelope, and whether this remains stable across sessions.
14. Published or observed rate limits and retry hints.
15. Token lifetime, refresh-token rotation behavior, and remote revocation path.

If Robinhood does not expose a caller-controlled idempotency key, automatic
entry remains blocked. Trade God must not infer exactly-once order ownership by
matching symbol, price, quantity, and time because two legitimate identical
orders are possible. An unknown submit then becomes a visible locked incident
requiring operator reconciliation; it is never retried automatically.

## Scope

### Included

- Official Robinhood Trading MCP only.
- One dedicated Robinhood Agentic account per connection.
- OAuth 2.1-style authorization code flow with PKCE and refresh.
- Long standard US-listed equity/ETF calls and puts only.
- `BUY_TO_OPEN` and owned-position `SELL_TO_CLOSE` only.
- DAY limit orders during regular market hours.
- Exact option contract resolution and fresh bid/ask quotes.
- Read-only connection verification and order review.
- Exact position, order, cancellation, and restart reconciliation when the
  authenticated provider contract proves it is possible.
- Existing Discord routing, bounded-dollar sizing, max-spread, max-chase,
  maximum contract, expiration, stale-signal, and account-risk policies.
- Existing full-close and whole-contract partial-close follow-up behavior.
- Local disconnect and Robinhood-side disconnect instructions.

### Non-Goals

- Robinhood username/password capture.
- Robinhood private REST endpoints or reverse-engineered mobile APIs.
- Browser-driven Robinhood trading.
- Giving an LLM general access to `place_option_order`.
- Equities, crypto, futures, event contracts, or multi-leg options in this spec.
- Short options, rolling, averaging down, or adding to positions.
- Choosing a contract not explicit in the Discord signal.
- Reading or trading a non-Agentic Robinhood account.
- Treating OAuth success as broker verification.
- Treating a review/preview as an executed or certified order.
- Claiming paper certification when Robinhood provides no paper environment.
- Weakening the existing gateway's exact-account, idempotency, or recovery
  rules to accommodate a provider limitation.

## Current Reality

Trade God currently has:

- provider-neutral long-option contracts and deterministic entry policy;
- Discord entry and follow-up routing;
- durable debit reservation, intent, receipt, and recovery stores;
- provider adapter interface for contract resolution, quotes, preview, submit,
  cancel, order lookup, and account snapshot;
- IBKR and Webull provider-specific implementations;
- an official MCP SDK and a generic OAuth implementation elsewhere in the
  inherited codebase;
- an isolated Trade God credential and runtime root.

Required changes:

- `OptionsProvider` currently allows only `ibkr | webull`;
- `OptionsConnection` currently allows only `paper | sandbox` and two auth
  profiles;
- the provider adapter descriptor currently allows only `paper | sandbox`;
- activation/certification contracts assume mutation-safe non-live testing;
- runtime construction selects only IBKR or Webull;
- connection UI asks for provider-specific manual credentials rather than an
  MCP OAuth sign-in;
- the generic MCP OAuth client identifies itself as Runner/Claude Code and uses
  general source credential plumbing, so it must not be reused as-is for a
  product-owned broker authority.

No Robinhood code, OAuth token, account, tool schema, read proof, preview, or
order is implemented or certified by this document.

## Experience / Runtime Flow

### Connect

1. User opens **Connections → Accounts → Options**.
2. User chooses **Robinhood** from **Connect broker**.
3. UI explains: dedicated Agentic account, live funds only, primary Robinhood
   account prerequisite, options approval required, and automation stays off.
4. User clicks **Continue to Robinhood**.
5. Main process discovers and validates Robinhood OAuth metadata.
6. Main process dynamically registers `Trade God Desktop` with an exact
   localhost loopback redirect URI and `application_type: native` where
   supported.
7. Main process creates PKCE verifier/challenge and CSRF state, starts the
   loopback callback listener, then opens the system browser. Both the
   authorization and token requests include the exact MCP `resource` URI as
   required by the MCP authorization specification.
8. User signs in directly with Robinhood and completes Agentic onboarding.
9. Main process exchanges the code, stores tokens in the isolated Trade God
   credential vault, and closes the callback listener.
10. App starts an authenticated MCP session, lists tools, validates the required
    allowlist, and stores a hash of tool names plus schemas.
11. App calls read-only tools, identifies exactly one tradable Agentic account,
    and asks the user to confirm its masked identity and label.
12. App stores a read-only connection revision and proof. UI shows **Connected
    · automation off**.

### Read-only qualification

1. Resolve one explicit option using `get_option_instruments` and, if needed,
   `get_option_chains`.
2. Fetch a quote with `get_option_quotes`.
3. Read the exact Agentic account's positions and orders.
4. Run `review_option_order` for a one-contract, low-debit DAY limit order.
5. Verify the review matches account, contract, action, quantity, limit,
   maximum debit, fees/warnings, and buying-power impact.
6. Persist a redacted qualification journal and schema fingerprints.
7. Do not call `place_option_order`.

### Mutation flow after certification

1. Existing Trade God logic creates and persists the exact immutable plan.
2. Adapter rechecks token generation, MCP schema fingerprint, exact Agentic
   account, account capacity, contract, quote freshness, position/order truth,
   and authority.
3. Adapter runs `review_option_order` and validates exact economic equality.
4. Gateway persists the reviewed provider preview before mutation.
5. Adapter checks for the deterministic client order ID.
6. Adapter calls `place_option_order` once.
7. Adapter requires exact provider order ID plus client order ID/account truth.
8. Gateway polls `get_option_orders` until a supported state is observable.
9. Timeout or transport loss after send enters `submit-unknown`; no blind retry.
10. Startup recovery reconciles by exact client order ID before any new order.

### Follow-up management

The existing source message lineage resolves the exact Trade God-owned
Robinhood position. Before a close, the adapter:

1. reconciles any working entry remainder;
2. cancels that remainder and proves terminal status;
3. proves one exact owned long position and no conflicting order;
4. reviews an exact `SELL_TO_CLOSE` DAY limit;
5. submits no more than the owned whole-contract quantity;
6. reconciles order and position truth;
7. never converts a close into a short position.

## System Boundaries

| Component | Owns | Must not own |
|---|---|---|
| Robinhood OAuth service | Discovery, DCR, PKCE, callback, refresh, token generation | Account routing, order policy, broker commands |
| Robinhood MCP transport | Authenticated Streamable HTTP sessions and tool calls | Model reasoning or retry policy |
| Robinhood tool contract registry | Allowlist, schemas, fingerprints, compatibility state | Credentials or mutable orders |
| Robinhood options adapter | Exact translation and provider response normalization | Discord parsing, sizing, fallback, discretion |
| Existing options gateway | Intent, idempotency, locks, recovery, halts, receipts | Provider-specific guessing |
| Existing policy engine | Eligibility, quantity, spread, chase, limit price | Provider I/O |
| Renderer | Sign-in, connection state, routing, explanations, explicit controls | Tokens, raw account lists, execution truth |
| LLM/agent | Parse candidate signal and explain decisions | Direct Robinhood tools or credentials |

## Contracts

### Provider enum and connection

Add `robinhood` without changing existing IBKR/Webull records.

```ts
type OptionsProvider = 'ibkr' | 'webull' | 'robinhood'

type RobinhoodOptionsConnection = {
  provider: 'robinhood'
  environment: 'live'
  auth_profile: 'robinhood-agentic-mcp-oauth'
  endpoint: 'https://agent.robinhood.com/mcp/trading'
  account_ref: string                // exact Agentic account ID
  account_label: string              // user-visible, no secrets
  credential_ref: string             // isolated vault locator
  credential_generation: string      // changes on auth/refresh/reconnect
  tool_contract_checksum: string     // required schema fingerprint
  state: 'credentials-saved' | 'read-only-verified' | 'blocked'
  read_only: true
  execution_enabled: false
}
```

`environment: live` is a schema migration, not permission to execute. Live
authority remains a separate append-only artifact.

### OAuth credential

Stored only in the Trade God credential vault:

```ts
type RobinhoodOAuthCredential = {
  issuer: 'https://agent.robinhood.com/mcp/trading'
  resource: 'https://agent.robinhood.com/mcp/trading'
  client_id: string
  access_token: string
  refresh_token?: string
  token_type: 'Bearer'
  expires_at: string
  scope?: string
  registration_checksum: string
  generation: string
}
```

Never log or expose tokens, authorization codes, PKCE verifier, account numbers,
positions, or raw Robinhood response bodies.

### Tool contract manifest

Persist a redacted, checksum-verified manifest containing:

- MCP protocol version and server info;
- required tool names;
- exact input/output schema fingerprints;
- capture timestamp;
- adapter version;
- supported argument/result mapping;
- qualification result;
- incompatible/missing fields;
- overall checksum.

Required read tools:

- `get_accounts`
- `get_portfolio`
- `get_option_instruments`
- `get_option_quotes`
- `get_option_positions`
- `get_option_orders`
- `review_option_order`

Required mutation tools:

- `place_option_order`
- `cancel_option_order`

No other Robinhood tools are callable through this adapter. Tool descriptions
are untrusted display text; the local adapter contract controls behavior.

### Adapter mapping

| Trade God operation | Robinhood tool(s) | Required proof |
|---|---|---|
| `resolveContract` | `get_option_instruments`, optionally `get_option_chains` | One standard USD 100x contract, exact expiry/strike/right |
| `quote` | `get_option_quotes` | Exact instrument, fresh bid/ask/size/timestamp and tradability |
| `preview` | `review_option_order` | Exact account/side/quantity/limit/debit/fees/warnings |
| `submit` | `place_option_order`, then `get_option_orders` | Exact provider ID and deterministic client ID |
| `cancelOrder` | `cancel_option_order`, then `get_option_orders` | Exact target and terminal truth |
| `getOrderByClientId` | `get_option_orders` | Exactly one order with caller-controlled client ID |
| `snapshotAccount` | `get_option_positions`, `get_option_orders`, `get_portfolio` | Exact Agentic account, positions, working orders, capacity |

If a required proof is unavailable, the corresponding capability is marked
incompatible rather than synthesized.

### MCP result envelope

Accept only a locally validated MCP `CallToolResult`:

- `isError !== true`;
- exact known tool name and schema fingerprint;
- structured JSON from `structuredContent`, or one JSON text block only;
- no conflicting duplicate content blocks;
- no model-generated prose used as order truth;
- strict parser rejects unknown/missing critical fields;
- response account and instrument must match the request.

## State Model

```text
not-connected
  -> authorizing
  -> credentials-saved
  -> schema-qualified
  -> read-only-verified
  -> preview-qualified
  -> live-certification-required
  -> manual-live-authorized
  -> autopilot-authorized

any state -> reconnect-required
any state -> incompatible
any state -> revoked
mutation -> submit-unknown -> operator-reconciliation-required
```

Rules:

- OAuth expiry may refresh in place, but refresh-token rotation increments the
  credential generation and invalidates stale authority.
- Tool schema fingerprint change immediately revokes mutation authority.
- Account identity or Agentic capability change blocks the connection.
- Remote disconnect, 401/403, refresh failure, or invalid grant blocks new
  entries; risk-reducing action is allowed only when fresh provider truth and a
  valid token still exist.
- `submit-unknown` owns the account mutation lane until exact reconciliation.

## Error Contract

| Code | Retry | User message | Safe behavior |
|---|---:|---|---|
| `RH_AUTH_CANCELED` | User | Robinhood sign-in was canceled | Save nothing |
| `RH_AUTH_METADATA_CHANGED` | No | Robinhood connection security changed | Block and require app update/review |
| `RH_AUTH_EXPIRED` | Refresh | Robinhood needs you to reconnect | Block new entries |
| `RH_AGENTIC_ACCOUNT_MISSING` | User | Finish creating your Robinhood Agentic account | Read-only setup incomplete |
| `RH_ACCOUNT_AMBIGUOUS` | No | Trade God could not identify one exact Agentic account | Store no route |
| `RH_OPTIONS_NOT_APPROVED` | User | Options are not enabled for this Agentic account | Block option actions |
| `RH_TOOL_CONTRACT_CHANGED` | No | Robinhood updated its trading connection | Requalify; revoke mutation authority |
| `RH_QUOTE_INCOMPLETE` | Fresh read | Robinhood did not return a complete live option quote | Skip signal |
| `RH_REVIEW_MISMATCH` | No | Robinhood's order review did not match the planned trade | Zero mutation |
| `RH_IDEMPOTENCY_UNAVAILABLE` | No | Robinhood cannot safely recover this automatic order | Automation unavailable |
| `RH_SUBMIT_UNKNOWN` | Reconcile only | Robinhood may have received the order; Trade God will not resend it | Lock route/account |
| `RH_RATE_LIMITED` | Reads only | Robinhood is temporarily limiting requests | Back off; never retry a mutation blindly |
| `RH_REMOTE_REVOKED` | User | Robinhood disconnected Trade God | Block and reconnect |

## Security and Safety

- Fixed HTTPS endpoint and exact Robinhood origin allowlist.
- Standards-based protected-resource and authorization-server discovery.
- PKCE S256, cryptographic state, exact loopback redirect, five-minute timeout.
- Exact RFC 8707 `resource` parameter on authorization, code exchange, and
  refresh requests so Robinhood tokens stay audience-bound to Trading MCP.
- Callback server binds only to `127.0.0.1`, never `0.0.0.0`.
- Dynamic registration occurs only after a user clicks Connect.
- Tokens live only in the Trade God encrypted vault; never workspace files,
  renderer state, logs, crash reports, screenshots, or source manifests.
- Dedicated broker OAuth service uses Trade God product identity, not Runner,
  Artist OS, generic workspace sources, or Codex credentials.
- Main process owns MCP transport. Renderer receives redacted status only.
- Strict tool allowlist; mutation tools are unreachable from generic chat/MCP
  source execution.
- No user-entered endpoint, headers, tokens, or account ID.
- All provider text and schemas are untrusted input and size-limited.
- No automatic mutation without schema-qualified adapter, exact account,
  preview equality, provider authority, route authority, and global release.
- Robinhood's own disconnect remains an independent emergency stop.
- Trade God's global halt and route pause remain immediately available.
- No provider fallback. A Robinhood failure never sends the order to IBKR,
  Webull, or a browser.

## UI States

### Connection card

- **Not connected** — `Connect Robinhood`.
- **Finish setup** — onboarding or Agentic account incomplete.
- **Connected · automation off** — OAuth and account verified.
- **Checking options** — read-only qualification running.
- **Ready for previews** — instruments, quotes, positions, orders, and review
  qualified; no real order authority.
- **Live test required** — exact contract qualified but real lifecycle unproven.
- **Ready for manual live test** — explicit capped authority exists.
- **Automation ready** — only after complete retained certification.
- **Reconnect Robinhood** — expired/revoked credentials.
- **Robinhood changed its connection** — tool schema drift; requalification.
- **Order status uncertain** — prominent account lock with reconcile action.

The connect modal says plainly:

> Robinhood uses a dedicated Agentic account with real funds. Trade God will
> connect read-only first. Nothing is placed when you connect.

No API keys or account numbers are requested. Account identity is masked. The
user can rename the local display label without changing provider identity.

## Observability and Receipts

Every session records redacted structured evidence:

- connection/trace ID;
- adapter and MCP protocol versions;
- tool contract checksum;
- credential generation checksum, never token material;
- exact masked account identity checksum;
- tool name, request checksum, response checksum, latency, and outcome;
- Robinhood order ID and client order ID where supported;
- review/submit/reconcile lineage;
- rate-limit and auth events;
- connection, authority, and schema invalidations.

Raw portfolios and positions are not written to general logs. Full trading
artifacts remain inside the isolated Trade God audit root.

## Evaluation Plan

### Offline contract fixtures

Build a deterministic fake Robinhood MCP server covering:

- OAuth discovery, DCR, PKCE, callback, refresh, and token rotation;
- valid and malicious `tools/list` schemas;
- structuredContent and single-JSON-text responses;
- exact and ambiguous Agentic account discovery;
- option resolution ambiguity and nonstandard contracts;
- stale, delayed, crossed, incomplete, and schema-drifted quotes;
- matching and mismatched order reviews;
- working, partial, filled, canceled, rejected, and unknown orders;
- mutation timeout before send, during send, and after provider acceptance;
- duplicate client ID with same and different economics;
- cancellation acknowledgement without terminal truth;
- token expiry and remote revocation during every mutation boundary;
- non-Agentic account injection and cross-account response contamination;
- rate limiting and malformed/oversized MCP output.

### Authenticated read-only qualification

- Capture `tools/list` without storing secrets or raw account data.
- Hash the exact required tool schemas.
- Prove one exact Agentic account.
- Prove options approval and fresh quotes.
- Prove exact positions/orders reads.
- Prove an order review with zero mutation.

### Live certification

There is no public Agentic sandbox. Any live certification requires a separate,
explicit operator-approved plan with:

- dedicated minimally funded Agentic account;
- exact low-debit liquid contract;
- one-contract maximum;
- DAY limit order only;
- strict maximum debit and spread/chase caps;
- market-hours supervision;
- cancel and close recovery plan;
- final flat/zero-working-order proof;
- no autopilot authority created from one smoke test.

The existing 50-lifecycle autopilot evidence requirement remains. It cannot be
silently relabeled as satisfied by fake fixtures, previews, or one live trade.

## Acceptance Criteria

### Connection and read-only

- [ ] User connects through Robinhood-hosted OAuth without entering credentials in Trade God.
- [ ] Tokens persist across relaunch only in the isolated Trade God vault.
- [ ] App identifies exactly one tradable Agentic account and rejects all others for mutation.
- [ ] Required tool schemas are captured, strictly validated, hashed, and version-bound.
- [ ] Positions, orders, contract, quote, and review are proven against the exact account.
- [ ] Connect and verify produce zero provider mutation.
- [ ] Disconnect removes local authority and clearly directs remote revocation when required.

### Adapter compatibility

- [ ] Exact standard contract resolution is proven.
- [ ] Quote includes enough evidence for existing spread/chase/freshness policy.
- [ ] Review returns exact economics and account identity.
- [ ] Provider supports deterministic client order identity and exact restart lookup, or automatic mutation remains blocked.
- [ ] Sell-to-close cannot exceed or invert the exact owned long position.
- [ ] Schema change invalidates certification and authority before mutation.

### Execution safety

- [ ] No Robinhood mutation tool is reachable from generic chat or source tooling.
- [ ] One persisted intent maps to at most one provider order.
- [ ] Unknown submit is never blindly resent.
- [ ] Partial fills, cancels, closes, and restart recovery preserve exact lineage.
- [ ] Token/account/schema/authority changes during execution fail closed.
- [ ] A final retained provider journal proves flat account and zero working orders.
- [ ] Autopilot remains unavailable until its separate full evidence gate passes.

## Verification Commands

| Command/action | Proves | Expected result |
|---|---|---|
| Focused contracts tests | Robinhood enum/migration remains compatible | Pass |
| OAuth fake-server suite | DCR/PKCE/refresh/callback isolation | Pass |
| MCP contract suite | Allowlist/schema/result validation | Pass |
| Robinhood adapter suite | Mapping, idempotency, reconciliation | Pass |
| Options gateway suite | Provider addition preserves existing safety | Pass |
| IPC/preload tests | Renderer cannot receive secrets or call broker tools | Pass |
| `bun run typecheck:all` | Cross-package contract agreement | Pass |
| Electron main/preload/renderer builds | Packaged integration compiles | Pass |
| Authenticated read-only smoke | Real tools/account/quote/review compatibility | Retained proof, zero orders |
| Relaunch smoke | Token refresh and saved connection survive restart | Same exact account, no reconnect when token valid |

## Rollout and Reversal

1. Ship behind `robinhood_options_connection` with mutation hard-disabled.
2. Enable OAuth and read-only verification.
3. Capture and approve the real tool contract manifest.
4. Enable order review only.
5. Implement adapter against frozen schemas and fake MCP fixtures.
6. Run an explicitly approved one-contract live certification.
7. Enable manual live order authority for the exact connection revision only.
8. Keep Discord autopilot disabled until full lifecycle evidence passes.

Rollback revokes local Robinhood authorities, disconnects MCP sessions, removes
local tokens when requested, and leaves immutable audit evidence. Existing
IBKR/Webull records and routes are untouched.

## Risks and Edge Cases

1. **No paper environment:** live certification has real-money risk. Mitigation:
   read/review first, separate explicit micro-live gate, dedicated budget.
2. **No client idempotency field:** crash-safe automatic orders may be
   impossible. Mitigation: do not weaken gateway; block autopilot.
3. **Tool schemas are undocumented and may change:** runtime drift could alter
   semantics. Mitigation: exact schema fingerprint and authority invalidation.
4. **MCP is designed for agent tools, not necessarily high-frequency broker
   reconciliation:** latency/rate limits may be unsuitable. Mitigation: bounded
   low-frequency Discord strategy, measurement, no performance claim.
5. **Read access spans all Robinhood accounts:** privacy/cross-account risk.
   Mitigation: exact Agentic filtering, redaction, no general renderer access.
6. **Review and place may be separate moving snapshots:** economics can change.
   Mitigation: re-quote, short review expiry, strict equality/caps.
7. **Provider returns prose or incomplete JSON:** unsafe truth parsing.
   Mitigation: strict local result schema; prose never authorizes mutation.
8. **Token refresh rotates credentials during a plan:** stale authority risk.
   Mitigation: generation binding and final revalidation.
9. **User disconnects remotely while a position exists:** management access may
   vanish. Mitigation: block new entry immediately; warn user to manage in
   Robinhood if API access is gone.
10. **Identical manual and automated orders coexist:** ownership ambiguity.
    Mitigation: require provider client ID; never infer ownership by economics.
11. **Options approval changes:** prior connection proof becomes stale.
    Mitigation: fresh capability check at review/submit.
12. **Expiration/assignment behavior is not documented for MCP:** automatic
    expiration custody remains blocked until separately proven.

## Open Questions and Gates

These are provider-contract questions, not product choices for the user:

- Does `place_option_order` accept and later return a caller-controlled client
  order ID?
- Can `get_option_orders` retrieve exact current and historical order truth
  after restart?
- Does every tool return the exact Agentic account ID?
- Are bid/ask size, timestamps, market-data mode, and tick rules available?
- Does review expose fees and buying-power impact as structured fields?
- Is `SELL_TO_CLOSE` explicit and protected from position inversion?
- Is remote token revocation exposed, or must users disconnect in Robinhood?
- What are the MCP rate limits and retry headers?
- What expiration, exercise, and do-not-exercise controls are exposed?

Mutation implementation stops at the first unanswered critical gate. The
correct result may be a high-quality read-only Robinhood connection until
Robinhood exposes the missing recovery contract.

## Implementation Plan

### Slice 0 — Authenticated contract discovery

- Add a development-only, read-only probe using the Trade God vault.
- Implement OAuth discovery/DCR/PKCE with product-owned identity.
- Authenticate interactively and capture redacted `tools/list` schemas.
- Call only account/instrument/quote/position/order/review tools.
- Produce a compatibility report resolving every open gate.
- No order tool call.

### Slice 1 — Contracts and migrations

- Add `robinhood` provider and `live` environment compatibility.
- Add Robinhood auth profile and tool-contract checksum.
- Preserve all IBKR/Webull records byte-for-byte.
- Add migration, downgrade, malformed, and schema-drift tests.

### Slice 2 — Product-owned OAuth and MCP client

- Extract reusable OAuth mechanics without reusing Runner/general-source
  credential identity or storage.
- Bind callback to loopback, store tokens in Trade God vault, implement refresh.
- Add fixed-origin MCP client, allowlist, timeouts, size limits, and redaction.
- Add fake OAuth/MCP adversarial suite.

### Slice 3 — Read-only connection UI

- Add Robinhood to broker dropdown.
- Implement one-click sign-in/onboarding, masked Agentic account confirmation,
  verify/reconnect/disconnect, and relaunch persistence.
- Show honest readiness tiers; automation remains off.

### Slice 4 — Read adapter

- Implement exact account, contract, quote, positions, orders, and preview
  normalization against the captured schema manifest.
- Add contract fixtures and cross-account/schema-drift attacks.

### Slice 5 — Mutation adapter, only if idempotency gate passes

- Implement submit, lookup, cancel, partial-fill, and snapshot mapping.
- Prove unknown-submit recovery without resend.
- Integrate gateway/runtime/certification with mutation disabled by default.

### Slice 6 — Supervised live certification

- Create a separate operator-approved runbook and retained journal.
- Execute at most one low-debit contract under a hard live cap.
- Prove review, place, reconcile, cancel/close, restart, and final-flat truth.
- Keep autopilot off.

### Slice 7 — Manual then automatic authority

- Enable explicit two-step manual live order authority first.
- Collect required real lifecycle evidence.
- Enable exact-route Discord authority only after the complete existing
  autopilot gate passes and a final holistic review is clean.

## Evidence Log

### 2026-08-28 — Public research and unauthenticated endpoint probe

- Robinhood public documentation confirms official Trading MCP, dedicated
  Agentic account, long options, option read/review/place/cancel tools, desktop
  onboarding, and user disconnect.
- Unauthenticated MCP initialization correctly returned HTTP 401 with protected
  resource metadata.
- Protected resource metadata and authorization server metadata confirmed the
  fixed resource/issuer, DCR, authorization code, refresh token, PKCE S256,
  public-client token exchange, and opaque `internal` scope shown above.
- Complete tool schemas remain inaccessible until user authentication.
- No Agentic paper/sandbox documentation was found.
- No code, credentials, account connection, preview, or order was created.

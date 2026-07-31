---
status: draft
owner: team
last_verified: 2026-07-30
source_of_truth: true
spec_id: TG-EXEC-001
target_phase: 5-6
depends_on:
  - TG-FOUND-001
  - TG-DATA-001
---

# Unified Broker Entry Gateway

## Decision Summary

Trade God will place and manage orders through one provider-neutral execution
gateway. Each trading connection selects a certified adapter using either an
official API or a dedicated persisted browser session. Agents and UI surfaces
submit typed, immutable order intents; they never receive credentials, cookies,
broker SDKs, or unrestricted browser control.

This is an extensible adapter system, not a universal click bot. A platform is
usable only after its exact operations and environment have passed paper
certification. An API is preferred when both routes are healthy and certified.
A browser route is a first-class fallback for platforms without a usable API,
but it must verify the account, visible order draft, submit result, and broker
state before it can claim success.

The first recommended delivery pair is:

1. Tradovate API adapter for Apex Tradovate accounts.
2. WealthCharts browser adapter for Apex WealthCharts accounts.

Rithmic, ProjectX, and IBKR follow behind the same contracts. This specification
does not activate consequential execution by itself.

## User Outcome

As the operator, I can connect a chosen futures account once and let approved
Trade God workflows enter, protect, modify, cancel, and close trades through
the safest supported route, while retaining visible control, exact receipts,
and an immediate kill switch.

## Scope

- A single execution contract for API and browser transports.
- Trading Connections in Settings with stored API credentials or browser
  sessions.
- Per-firm, per-platform, per-account, and per-program configuration.
- Per-operation capability detection and certification.
- Immutable order intents, bounded authorization, risk checks, idempotency,
  execution receipts, and reconciliation.
- Market, limit, stop, stop-limit, bracket/OCO, cancel, modify, partial close,
  and flatten when the selected adapter proves support.
- Paper certification before bounded evaluation, performance, or live
  activation.
- Explicit support for standing mandates as well as per-order approval.
- A registry that can add any future platform without changing agent contracts.
- Import of the proven execution-lifecycle ideas from DiscoTrader v2.

## Non-Goals

- One generic browser script that guesses how to trade any website.
- Direct broker or browser access from an analytical agent.
- Storing passwords, tokens, cookies, or account numbers in prompts or project
  files.
- Silent fallback from one transport to another after an uncertain submission.
- Claiming an order filled because an HTTP request or button click succeeded.
- Automatic consequential activation merely because credentials are present.
- Bypassing platform rules, geographic controls, MFA, CAPTCHA, or account
  ownership checks.
- Reusing social-posting browser partitions for trading.
- Activating consequential execution during the current market-data/UI phase.

## Current Reality

Verified in this checkout:

- `packages/trading-client` is the intended single client boundary.
- `packages/trading-contracts` owns provider-independent schemas.
- Electron main owns trusted IPC, supervision, and secure runtime access.
- `browser-pane-manager.ts` already creates dedicated Electron browser
  instances, supports persisted `persist:` partitions, CDP automation,
  interaction locks, security-challenge detection, and screenshots.
- `scheduled-social-browser-executor.ts` already demonstrates the useful
  pattern: verify the exact persisted profile, visible account identity,
  approved tuple/digest, final draft, submit, and receipt.
- The credential vault exists under `packages/shared/src/credentials`.
- The architecture already reserves a separate execution plane for risk,
  approval, idempotency, broker adapters, reconciliation, receipts, and kill
  switches.
- IBKR is currently a market-data onboarding path only. It is not an execution
  adapter.

Assumptions:

- The operator will provide the account-specific authorization basis and risk
  envelope before consequential activation.
- Browser automation remains visible and local for any consequential use.
- Provider contracts and UI selectors can change; certification therefore
  expires by adapter version rather than lasting forever.
- DiscoTrader v2 commit `664a41d` is a donor implementation, not a second
  execution authority.

## Research Findings

### Apex platform reality

Apex currently documents three account platform families: Rithmic, Tradovate,
and WealthCharts. The accounts are platform-specific and are not convertible.
Rithmic also feeds multiple third-party frontends, so “Apex support” is not one
technical integration.

| Apex route | Preferred transport | Why | Initial status |
|---|---|---|---|
| Tradovate | Official API | REST/WebSocket order and user-state interfaces | First API adapter |
| WealthCharts | Persisted browser | Web-native DOM and Broker Portfolio are documented; no public developer API was found | First browser adapter |
| Rithmic | Official R Protocol or R API+ | Direct execution route, but production access requires dev kit and conformance | Research/certification lane |
| Rithmic third-party desktop frontend | Native adapter only if needed | These are distinct desktop apps, not one browser surface | Not initial scope |

Apex's public agreement defaults to manual order entry, but expressly recognizes
prior written consent as an exception. A private permission is therefore stored
as an external authorization record on the connection; it does not weaken Trade
God's technical safety gates.

### Provider capability summary

| Provider | Official path | Important constraint | Trade God treatment |
|---|---|---|---|
| Tradovate | REST plus WebSocket | Automated orders must set `isAutomated: true`; user synchronization should use `user/syncrequest` | API-first |
| Rithmic | R API+ or R Protocol | Production credentials require conformance; R Protocol uses WebSocket and protobuf | Direct API after conformance |
| WealthCharts | Browser DOM plus Broker Portfolio | Browser UI exposes order entry, brackets, positions, orders, and statuses | Browser-first, selector-certified |
| ProjectX | REST plus SignalR | API subscription required; user hub streams accounts, orders, positions, and trades | Reuse DiscoTrader learnings |
| IBKR | TWS/IB Gateway socket or Web API | TWS API requires TWS/IB Gateway; sessions and reauthentication must be handled | Later independent broker adapter |

### Research-backed design consequences

- A command acknowledgment is not a fill. Execution reports, trades, positions,
  and open orders must be reconciled.
- Native bracket/OCO behavior is preferred over separately managed exits.
- Risk rules differ by account program and platform; they cannot be a single
  firm-wide constant.
- Rithmic production access is a commercial/conformance dependency, not only a
  coding task.
- WealthCharts has enough documented browser state to build a named adapter,
  but “no public API found” is an inference, not proof that a private API does
  not exist.
- ProjectX is a useful adapter family for compatible firms, but it is not
  assumed to be the default Apex route.

## Experience / Runtime Flow

### Connect an account

1. The operator opens **Settings -> Trading Connections -> Add**.
2. The operator chooses firm, platform, account environment, and transport
   preference: `auto`, `api`, or `browser`.
3. For API, the trusted runtime stores the secret and returns only a credential
   reference. For browser, Trade God opens a dedicated visible session and the
   operator signs in.
4. The adapter reads the visible/API account identity and capabilities.
5. The operator selects the exact account and configures its risk policy,
   authorization basis, and approval mode.
6. Trade God runs read-only diagnostics, then paper certification.
7. The connection remains entry-disabled until its required certification level
   and an expiring consequential enablement are both present.

### Execute a trade

1. DiscordTrader, a Trade God worker, an alert, or the UI produces an immutable
   `order-intent@1`.
2. The risk engine evaluates current broker/account truth and emits
   `risk-decision@1`.
3. An exact per-order approval or a matching standing mandate emits
   `execution-authorization@1`.
4. The gateway atomically claims the intent and resolves one certified adapter.
5. The adapter performs a fresh account, environment, session, market, and
   capability preflight.
6. The adapter submits exactly once using an idempotency key/action digest.
7. The gateway treats the immediate response as acknowledgment only.
8. Provider events and snapshots are normalized into order, fill, position, and
   account-risk truth.
9. Required protection is attached and independently confirmed.
10. The gateway emits a checksum-bound `execution-receipt@1`.
11. The Futures Hub displays the same reconciled truth and a visible emergency
    control.

### Recover an uncertain submit

1. The adapter records `submit_unknown` if transmission or browser submission
   may have occurred but confirmation is missing.
2. The gateway prohibits retries and transport fallback.
3. The adapter queries open orders, executions, and positions using the original
   client tag, time window, account, symbol, side, and quantity.
4. It either adopts the broker order, proves no order exists, or remains halted
   for operator intervention.

## System Boundaries

| Component | Owns | Must not own |
|---|---|---|
| Trading source/agent | Evidence and proposed intent | Credentials, broker calls, final risk truth |
| Trading client | Typed capability calls | Provider-specific logic |
| Execution gateway | Claims, state machine, routing, idempotency, reconciliation | Strategy reasoning |
| Risk engine | Account/program policy decision | Order submission |
| Authorization service | Exact approvals and standing mandates | Broker credentials |
| API adapter | Provider authentication, translation, events, reconciliation | Business risk policy |
| Browser adapter | Named UI interaction and visible verification | Generic browsing or strategy decisions |
| Credential/session vault | Secret and persisted-session custody | Order intent |
| Broker/platform | External order, fill, position, and account truth | Trade God internal approval |
| Renderer | Status, setup, user controls, receipts | Broker truth or execution state |

## Architecture

```text
Discord / Alert / Worker / UI
             |
       order-intent@1
             |
   Risk + Authorization Gates
             |
      Execution Gateway
        /           \
 API Adapter     Browser Adapter
        \           /
       Broker / Platform
             |
 Orders + Fills + Positions + Account
             |
       Reconciliation Store
             |
   Receipt + Futures Hub + Journal
```

All entry points converge before execution. DiscordTrader becomes an intent
source; it does not remain a parallel process with independent broker authority.

## Connection and Route Model

```ts
type ExecutionEnvironment =
  | 'paper'
  | 'evaluation'
  | 'performance'
  | 'live'

type EnvironmentClass = 'rehearsal' | 'consequential'

type TransportPreference = 'auto' | 'api' | 'browser'

interface TradingConnectionV1 {
  schema: 'trading-connection@1'
  connectionId: string
  displayName: string
  firm: { slug: string; name: string }
  platform: { slug: string; name: string }
  environment: ExecutionEnvironment
  transportPreference: TransportPreference
  accountRef: string
  accountDisplay: { label: string; last4?: string }
  credentialRef?: string
  browserSessionRef?: string
  riskPolicyRef: string
  authorizationBasisRef: string
  approvalPolicyRef: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}
```

`accountRef`, `credentialRef`, and `browserSessionRef` are opaque references.
Raw account numbers, secrets, and cookies are never serialized into this
contract.

Only `paper` is a rehearsal environment. `evaluation`, `performance`, and
`live` are all consequential: they may affect account eligibility, rewards, or
real capital and therefore use the same strict activation gate.

### Browser session naming

Each trading connection receives a distinct persistent partition:

```text
persist:trading-<firm-slug>-<platform-slug>-<connection-id>
```

It must never share a partition with:

- social accounts;
- generic in-app browsing;
- research agents;
- another trading account;
- an adapter test running against a different environment.

### Route resolution

`auto` resolves using this exact order:

1. Enabled connection and matching account/environment.
2. Operation capability is present.
3. Adapter certification covers the operation and environment.
4. Authentication and session are healthy.
5. Fresh broker/account snapshot is available.
6. API wins over browser when both pass.

The selected route is frozen when the intent is claimed. It cannot silently
switch after submission begins.

### Capability model

Capabilities are declared and probed independently:

```ts
interface ExecutionCapabilitiesV1 {
  readAccounts: boolean
  readOrders: boolean
  readPositions: boolean
  readExecutions: boolean
  submitMarket: boolean
  submitLimit: boolean
  submitStop: boolean
  submitStopLimit: boolean
  nativeBracket: boolean
  nativeOco: boolean
  modifyOrder: boolean
  cancelOrder: boolean
  partialClose: boolean
  flatten: boolean
  streamingEvents: boolean
}
```

An adapter may be usable for reads but blocked for order submission.

## Contracts

### Order intent

```ts
interface OrderIntentV1 {
  schema: 'order-intent@1'
  intentId: string
  source: {
    type: 'discord' | 'alert' | 'agent' | 'manual'
    sourceId: string
    authorId?: string
  }
  connectionId: string
  instrument: {
    canonicalId: string
    symbol: string
    exchange: string
    expiry?: string
  }
  side: 'buy' | 'sell'
  quantity: number
  entry:
    | { type: 'market' }
    | { type: 'limit'; price: string }
    | { type: 'stop'; stopPrice: string }
    | { type: 'stop-limit'; stopPrice: string; limitPrice: string }
  protection: {
    stopLoss: { type: 'price' | 'ticks'; value: string }
    takeProfit?: { type: 'price' | 'ticks'; value: string }
  }
  timeInForce: 'day' | 'gtc'
  createdAt: string
  validUntil: string
  contentChecksum: string
}
```

Rules:

- Futures quantity is a positive integer.
- Prices are decimal strings, never binary floating-point.
- Contract expiry must be resolved before claim.
- Stop loss is required for automated entry.
- Modifying any bound field creates a new intent and checksum.
- Discord identity uses immutable author ID, not display name.

### Risk decision

```ts
interface RiskDecisionV1 {
  schema: 'risk-decision@1'
  decisionId: string
  intentId: string
  accountSnapshotId: string
  riskPolicyVersion: string
  result: 'allow' | 'deny'
  reasons: string[]
  evaluatedAt: string
  validUntil: string
}
```

The decision must include realized P&L, open risk, active contracts, trailing
threshold/drawdown policy, session cutoff, working orders, and the proposed
order's worst-case risk.

### Execution authorization

```ts
interface ExecutionAuthorizationV1 {
  schema: 'execution-authorization@1'
  authorizationId: string
  connectionId: string
  mode: 'per-order' | 'standing-mandate'
  intentId?: string
  actionDigest?: string
  scope: {
    symbols: string[]
    maxContracts: number
    allowedSides: Array<'buy' | 'sell'>
    allowedOrderTypes: Array<'market' | 'limit' | 'stop' | 'stop-limit'>
    sessionStart: string
    sessionEnd: string
    maxDailyLoss: string
    maxOpenRisk: string
  }
  issuedBy: string
  issuedAt: string
  expiresAt: string
}
```

A standing mandate permits autonomous orders only inside its explicit envelope.
It cannot authorize a different account, symbol, quantity, session, or risk
ceiling. Consequential mandates expire and must be intentionally renewed.

### External authorization basis

```ts
interface ExternalAuthorizationBasisV1 {
  schema: 'external-authorization-basis@1'
  authorizationBasisId: string
  firmSlug: string
  accountRef: string
  kind:
    | 'platform-policy'
    | 'prior-written-consent'
    | 'owner-authorization'
    | 'operator-attestation'
  evidenceRef?: string
  recordedBy: string
  effectiveAt: string
  expiresAt?: string
  notes?: string
}
```

This records why automation is externally permitted. It never bypasses account
identity, risk, certification, or runtime authorization.

### Execution command

```ts
interface ExecutionCommandV1 {
  schema: 'execution-command@1'
  commandId: string
  intentId: string
  claimId: string
  connectionId: string
  adapterId: string
  adapterVersion: string
  actionDigest: string
  idempotencyKey: string
  issuedAt: string
}
```

Only the gateway can issue this command. Adapter inputs are resolved from the
checksum-bound intent and trusted connection record, not copied from agent text.

### Normalized broker truth

The gateway persists these append-only events:

- `order-event@1`
- `fill-event@1`
- `position-snapshot@1`
- `account-risk-snapshot@1`
- `reconciliation-result@1`
- `execution-receipt@1`

Every record carries:

- `traceId`, `correlationId`, and `causationId`;
- connection, adapter, and provider IDs;
- provider event time and local receive time;
- normalized and raw status references;
- source checksum and schema version.

### Execution receipt

```ts
interface ExecutionReceiptV1 {
  schema: 'execution-receipt@1'
  receiptId: string
  traceId: string
  intentId: string
  connectionId: string
  transport: 'api' | 'browser'
  adapter: { id: string; version: string }
  providerOrderIds: string[]
  result:
    | 'rejected'
    | 'working'
    | 'partially-filled'
    | 'filled-protected'
    | 'closed'
    | 'submit-unknown'
    | 'reconcile-halted'
  filledQuantity: number
  averageFillPrice?: string
  protectionVerified: boolean
  evidenceRefs: string[]
  completedAt: string
  contentChecksum: string
}
```

For browser execution, evidence includes selector-bundle version, DOM
fingerprint, verified account label, pre-submit screenshot, post-submit
screenshot, and visible/provider order ID when available. Screenshots must
redact sensitive account details.

### Invalid example

This intent is rejected before claim:

```json
{
  "schema": "order-intent@1",
  "connectionId": "apex-main",
  "instrument": { "symbol": "ES" },
  "side": "buy",
  "quantity": 0.5,
  "entry": { "type": "market" },
  "protection": {}
}
```

Reasons: unresolved futures contract, non-integer quantity, missing stop loss,
missing provenance, missing expiry, and no checksum.

## Commands and Events

The public execution client exposes bounded commands only:

- `execution.connection.test`
- `execution.account.snapshot`
- `execution.intent.submit`
- `execution.order.cancel`
- `execution.order.modify`
- `execution.position.close`
- `execution.account.flatten`
- `execution.killSwitch.enable`
- `execution.killSwitch.disable`
- `execution.reconcile`

There is no `browser.click`, `runScript`, `callBroker`, or raw HTTP command in an
agent's tool set.

### Idempotency

- `intentId` identifies the immutable user/agent proposal.
- `claimId` is acquired atomically by one gateway worker.
- `actionDigest` binds account, contract, side, quantity, entry, protection,
  authorization, and adapter.
- `idempotencyKey` is unique per exact submit attempt and persisted before I/O.
- A command in `submitting`, `submit_unknown`, or later states is never retried
  until reconciliation proves the safe next action.
- Cancel, modify, protection, and close commands receive their own action
  digests and idempotency keys.

## Errors

| Code | Retryable | Meaning | Safe behavior |
|---|---:|---|---|
| `AUTH_REQUIRED` | No | Session/token expired | Pause; request login |
| `ACCOUNT_MISMATCH` | No | Visible/provider account differs | Suspend connection |
| `ENVIRONMENT_MISMATCH` | No | Configured provider environment differs | Stop before submission |
| `CAPABILITY_UNAVAILABLE` | No | Adapter cannot prove operation | Reject intent |
| `CERTIFICATION_REQUIRED` | No | Operation/environment not certified | Reject intent |
| `STALE_RISK_DECISION` | Yes, from start | Risk snapshot expired | Re-evaluate risk |
| `AUTHORIZATION_MISMATCH` | No | Approval does not bind action | Reject intent |
| `SESSION_CUTOFF` | No | Firm/account trading window closed | Reject or flatten per policy |
| `SELECTOR_DRIFT` | No | Browser contract changed | Stop before click; suspend adapter |
| `SUBMIT_UNKNOWN` | No | Submission may have occurred | Reconcile; never blind retry |
| `ORDER_REJECTED` | No | Provider rejected order | Persist reason; do not place exits |
| `PROTECTION_FAILED` | No | Required stop not verified | Flatten, then kill switch |
| `RECONCILIATION_DIVERGENCE` | No | Local and provider truth differ | Halt connection |

User-facing messages state what is known, what is uncertain, and whether any
position may exist. They never reduce `submit_unknown` to “failed.”

## Time and Market Semantics

- All persisted timestamps use UTC ISO 8601.
- UI renders exchange time and local time explicitly.
- Exchange calendar and account-specific cutoff are policy inputs.
- Provider event time and local receive time are both preserved.
- Out-of-order and duplicate provider events are expected and deduplicated by
  provider ID/version plus content hash.
- A marketable order intent has a short `validUntil`; an expired intent cannot
  be revived.
- Contract rollover is resolved by the market-data/instrument service before
  execution and frozen in the checksum.
- Tick size, multiplier, currency, and price precision come from a verified
  instrument record.
- Account state must be fresh enough for the policy; disconnected or stale
  account truth blocks new entries.
- Firm rules are versioned per program. Apex platform-specific trailing
  drawdown behavior is not inferred from account balance alone.

## State Model

### Connection

```text
unconfigured
  -> auth-required
  -> connecting
  -> ready
  -> degraded
  -> suspended
  -> revoked
```

Only `ready` accepts new commands. `degraded` may continue reconciliation and
safe exits but cannot open risk.

### Intent/execution

```text
created
  -> risk-denied
  -> awaiting-authorization
  -> approved
  -> claimed
  -> submitting
  -> acknowledged
  -> partially-filled
  -> filled
  -> protecting
  -> protected
  -> closing
  -> closed
```

Exceptional states:

```text
submit-unknown
protection-unknown
reconcile-halted
rejected
canceled
expired
error
```

State is durable. On restart, the gateway resumes from the last persisted
transition and reconciles all non-terminal records before accepting new risk.

## API Adapter Contract

Each API adapter implements:

```ts
interface ExecutionAdapter {
  describe(): AdapterDescriptor
  connect(connection: TrustedConnection): Promise<ConnectionHealth>
  probeCapabilities(): Promise<ExecutionCapabilitiesV1>
  snapshotAccount(): Promise<NormalizedAccountSnapshot>
  submit(command: ExecutionCommandV1): Promise<SubmitAcknowledgment>
  cancel(command: CancelCommand): Promise<CommandAcknowledgment>
  modify(command: ModifyCommand): Promise<CommandAcknowledgment>
  flatten(command: FlattenCommand): Promise<CommandAcknowledgment>
  reconcile(query: ReconciliationQuery): Promise<ReconciliationResult>
  subscribe(emit: (event: NormalizedBrokerEvent) => void): Unsubscribe
}
```

Rules:

- Secrets are injected by the trusted runtime and never returned.
- Use provider-supported client tags/idempotency fields where available.
- Prefer native bracket/OCO orders after proving their exact behavior.
- Treat REST success as acknowledgment, not fill.
- Correlate order events, execution reports/trades, positions, and account
  snapshots.
- Mark Tradovate automated submissions with `isAutomated: true`.
- Rithmic production stays disabled until dev-kit access and conformance are
  recorded.
- API timeouts after send become `submit_unknown`.

## Browser Adapter Contract

A browser adapter is platform-specific and versioned:

```ts
interface BrowserExecutionAdapter {
  descriptor: {
    adapterId: string
    adapterVersion: string
    allowedOrigins: string[]
    selectorBundleVersion: string
  }
  verifySession(): Promise<BrowserSessionIdentity>
  readAccountState(): Promise<NormalizedAccountSnapshot>
  prepare(command: ExecutionCommandV1): Promise<VisibleOrderDraft>
  verifyDraft(draft: VisibleOrderDraft): Promise<ActionDigest>
  submitOnce(): Promise<BrowserSubmitEvidence>
  reconcile(query: ReconciliationQuery): Promise<ReconciliationResult>
}
```

### Required browser behavior

1. Open the dedicated persisted partition in a visible local BrowserWindow.
2. Verify allowed origin, authenticated identity, selected account, and
   environment.
3. Acquire an exclusive lock for that connection/account.
4. Read current positions, working orders, buying power/risk fields, and market
   session state.
5. Populate only the fields from the approved intent.
6. Re-read the visible account, symbol, contract, side, quantity, order type,
   prices, time in force, and protection.
7. Recompute and compare the action digest.
8. Submit exactly once.
9. Capture visible confirmation and provider order ID if exposed.
10. Reconcile through the platform's orders/portfolio surface.

### Selector and interaction rules

- Prefer accessibility roles, labels, visible text, and stable test IDs.
- Use Electron/CDP auto-wait conditions, not arbitrary sleeps.
- Version fallback selectors and require paper evidence for each bundle.
- A changed or ambiguous selector stops before submission.
- Coordinates or computer vision may assist diagnosis, but cannot submit in a
  consequential environment unless separately certified for that exact
  surface.
- MFA, OTP, CAPTCHA, consent, and security challenges pause for the operator.
- A click followed by missing confirmation is `submit_unknown`, not retryable.
- The user can take over the visible browser, but doing so invalidates the
  active preparation and forces a fresh preflight.

### WealthCharts first adapter

The initial adapter uses:

- Trading DOM/order panel for account, symbol, quantity, order type, Buy/Sell,
  and native simple bracket fields.
- Broker Portfolio for positions, active/completed/canceled orders, fill price,
  and cancel controls.
- Platform-provided flatten only after its cancel/protection semantics are
  proven.
- No use of **Reverse** as a generic close command.

Browser entry is allowed only when the same selector bundle has passed the
paper lifecycle tests described below.

## Protection Rules

- Automated entry requires a stop-loss plan.
- Native bracket/OCO is preferred when certified.
- If a provider cannot atomically attach protection:
  1. submit entry;
  2. wait for confirmed fill quantity;
  3. place/resize the protective stop;
  4. add target only when OCO or reduce-only semantics are proven.
- If required protection cannot be verified within the configured deadline,
  flatten immediately and enable the connection kill switch.
- Partial fills protect only confirmed filled quantity.
- Partial closes resize or retire exits deterministically; overlapping exits may
  never reverse the position.
- A close flow retires working exits before a separate flatten unless a native
  flatten command is certified to do both.
- “Flat” means provider positions are zero and no working order can reopen or
  reverse the position.

## Risk and Authorization

### Required per-account policy

- Allowed instruments and contract expiries.
- Maximum order and open-position contracts.
- Maximum risk per trade and open risk.
- Daily realized-loss and total-loss limit.
- Trailing drawdown calculation and threshold.
- Maximum working orders.
- Allowed order types and time in force.
- Trading session and mandatory flat time.
- News/event lockouts if enabled.
- Consecutive-loss/cooldown policy if enabled.
- Whether targets are permitted or stop-only protection is required.

Risk truth comes from the selected account, not from market-data UI state.

### Approval modes

1. `per-order`: a human approves the exact action digest.
2. `standing-mandate`: the operator pre-authorizes a bounded envelope for a
   limited time.
3. `manual-handoff`: Trade God prepares the order and opens the platform, but
   the user performs the final submission.

The user may choose mode per connection. The confluence verifier is independent
and may be enabled or disabled; it is not an execution safety gate.

### Kill switch

There are three independent controls:

- global: no new entries anywhere;
- connection: no new entries for one account;
- source: reject new intents from Discord, alert, or agent source.

Enabling a kill switch does not automatically flatten. **Flatten** is a separate
explicit emergency command so the operator can stop new risk without creating
an unintended market order.

## Agent Behavior

Agents may:

- create or refine an order intent;
- request account/execution status through typed tools;
- request submission, cancellation, modification, close, or flatten inside
  their granted scope;
- explain a rejection or uncertain state using receipts.

Agents must:

- abstain when contract, account, environment, or position truth is ambiguous;
- surface `submit_unknown` and `protection_unknown` immediately;
- cite the evidence/checksum used for an intent;
- treat broker reconciliation as authoritative.

Agents may not:

- receive raw secrets, cookies, OTPs, or account numbers;
- invoke a generic browser or shell tool to place an order;
- bypass risk, authorization, adapter certification, or kill switches;
- retry uncertain execution;
- modify quantity or risk after authorization;
- turn the optional confluence verifier into implicit sizing authority.

## UI States

### Settings -> Trading Connections

Each connection shows:

- firm, platform, transport, environment, and masked account;
- `API` or `Browser` route badge;
- authentication/session health;
- read, paper, and consequential certification;
- current capabilities;
- risk policy and approval mode;
- external authorization basis and expiry;
- consequential enablement expiry;
- test, reauthenticate, revoke, suspend, and kill-switch controls.

### Futures Hub

The execution panel shows:

- selected account and environment with unmistakable
  rehearsal/consequential treatment;
- gateway and adapter health;
- pending intents and approvals;
- working orders, fills, position, protection, and realized/open P&L;
- last reconciliation age;
- uncertain/halted state at the highest visual priority;
- new-entry kill switch and separate flatten button;
- link to the full receipt/evidence.

The browser window remains visible during consequential browser execution and
exposes **Pause automation / Take control**.

Accessibility requirements:

- all controls keyboard reachable;
- status never conveyed by color alone;
- destructive controls name account, action, and consequence;
- final confirmation receives focus and remains screen-reader legible.

## Security and Safety

- API secrets stay in the secure credential store.
- Browser cookies stay in the dedicated Electron partition.
- No secret appears in prompts, logs, screenshots, receipts, or artifacts.
- Allowed origins are an explicit adapter allowlist.
- Navigating outside the allowlist suspends execution control.
- Trading sessions are local and visible for consequential browser execution.
- Account and environment are checked immediately before every external action.
- External authorization is recorded per connection and can expire.
- Consequential activation requires adapter certification, bounded risk policy,
  explicit operator enablement, and an expiry.
- Agent permissions are capability-scoped, not credential-scoped.
- Revocation deletes the credential/session reference and suspends the
  connection.
- Security challenges are never bypassed.

## Observability and Receipts

Every lifecycle gets one trace containing:

- intent, risk decision, authorization, claim, route decision, command;
- adapter/provider versions and health;
- acknowledgments, provider events, normalized state transitions;
- protection checks and reconciliation results;
- browser selector/DOM evidence where applicable;
- final receipt checksum.

Metrics:

- intents allowed/denied/expired;
- submit acknowledgment latency and fill latency;
- `submit_unknown` count;
- reconciliation divergence count;
- protection time and protection failures;
- adapter/session availability;
- selector drift;
- duplicate submission prevented;
- rehearsal/consequential orders by connection and source.

Logs must answer:

1. Who or what proposed the order?
2. What exact action was authorized?
3. Which route and version executed it?
4. What did the provider acknowledge and fill?
5. Was the position protected and later closed?
6. What remains uncertain?

## Adapter Certification

Certification is per adapter version, provider environment, and operation:

1. `read-certified`
2. `paper-entry-certified`
3. `paper-lifecycle-certified`
4. `consequential-entry-certified`
5. `consequential-lifecycle-certified`

Installing an adapter grants no execution authority.

### Required paper scenarios

- correct and wrong account;
- correct and wrong environment;
- expired authentication/session;
- stale and mismatched authorization;
- duplicate submit attempt;
- provider rejection inside a successful HTTP response;
- network loss before and after send;
- browser click with missing confirmation;
- selector drift and ambiguous controls;
- full, partial, and no fill;
- bracket/OCO success and protection failure;
- cancel, modify, partial close, and flatten failure;
- app restart with an in-flight order;
- local/provider reconciliation divergence;
- daily loss and trailing drawdown threshold;
- session cutoff and contract rollover.

### Certification gate

An adapter must complete:

- all forced-failure scenarios with the expected safe state;
- 50 consecutive paper entry-to-close lifecycles with zero duplicate orders,
  zero unprotected surviving positions, and zero unresolved divergence;
- a restart/recovery run with an in-flight order;
- a written evidence record tied to adapter and selector/API versions.

Consequential certification begins with one connection, one allowed symbol, one
contract, short expiry, and a standing mandate or per-order approval chosen by
the operator. Any uncertainty suspends consequential entry.

## Evaluation Plan

Fixtures:

- provider payloads for acknowledged, rejected, working, partial, filled,
  canceled, and duplicate events;
- account/program risk snapshots;
- deterministic browser DOM fixtures for every selector bundle;
- restart journals with each non-terminal state;
- credential/session expiry and challenge fixtures.

Core properties:

- at most one external entry for one claimed intent;
- no new entry while broker/account truth is stale;
- no consequential action without matching certification and authorization;
- no blind retry after possible submission;
- no surviving unprotected position after protection deadline;
- no close path leaves an order that can reopen/reverse the position;
- API and browser routes produce the same normalized lifecycle.

## Acceptance Criteria

- [ ] All execution callers use `packages/trading-client`.
- [ ] Provider-independent contracts live in `packages/trading-contracts`.
- [ ] One durable gateway state machine owns execution truth.
- [ ] Agents cannot access credentials or generic consequential browser
      controls.
- [ ] API and browser adapters implement the same normalized contract.
- [ ] Each connection verifies exact firm, platform, account, and environment.
- [ ] `auto` prefers a healthy certified API and never switches after submit.
- [ ] Acknowledgment, fill, position, and protection are distinct states.
- [ ] Every external mutation is checksum-bound and idempotent.
- [ ] `submit_unknown` blocks retry until reconciliation.
- [ ] Standing mandates are bounded and expire.
- [ ] Risk policy is account/program-specific.
- [ ] Browser sessions are isolated from social/general browsing.
- [ ] Browser selector drift stops before consequential submission.
- [ ] Protection failure flattens and enables the kill switch.
- [ ] Restart recovery reconciles every non-terminal lifecycle.
- [ ] The adapter certification matrix and evidence are visible in Settings.
- [ ] Consequential activation is impossible before paper lifecycle
      certification.
- [ ] The first Tradovate API and WealthCharts browser adapters pass the paper
      gate before any consequential canary.

## Verification Commands

These commands become required as implementation lands:

| Command/action | Proves | Expected result |
|---|---|---|
| `bun run typecheck:all` | Contract and client compatibility | Clean |
| `bun test packages/trading-contracts` | Schema validation and examples | Pass |
| `bun test packages/trading-client` | Single boundary and error mapping | Pass |
| `bun test apps/electron/src/main/trading` | IPC, permissions, restart, redaction | Pass |
| Gateway adapter contract suite | API/browser behavioral parity | Pass |
| Deterministic browser fixture suite | Selector and draft verification | Pass |
| 50-run paper lifecycle soak | Duplicate/protection/reconcile behavior | Zero critical failures |
| Manual visible browser smoke | Login, account verification, take-over | Pass |

## Rollout and Reversal

Feature flags:

- `TRADING_CONNECTIONS_ENABLED`
- `EXECUTION_PAPER_ENABLED`
- `EXECUTION_CONSEQUENTIAL_ENABLED`
- `EXECUTION_LIVE_MARKET_ENABLED`
- per-adapter enablement
- per-connection consequential enablement with expiry

Rollout:

1. Read-only connections and account truth.
2. Fake adapter and deterministic state-machine tests.
3. Tradovate demo/paper API.
4. WealthCharts paper browser.
5. Paper certification and soak.
6. One bounded consequential canary.
7. Additional adapters through the same gate.

Reversal:

- disable global new-entry flag;
- suspend the adapter or connection;
- preserve reconciliation and safe-exit capabilities;
- never delete in-flight state or receipts during rollback.

## Risks and Edge Cases

1. Duplicate or ambiguous submission: highest consequence; solve with durable
   pre-I/O idempotency plus reconciliation.
2. Unprotected fill: flatten and halt if stop cannot be verified.
3. Wrong account/environment: visible/API preflight on every command.
4. Browser selector drift: versioned locators, DOM fingerprint, no
   consequential coordinate fallback.
5. Partial fills and closes: protection quantity follows confirmed position.
6. Provider event gaps/out-of-order delivery: periodic snapshots reconcile the
   event stream.
7. Program-rule drift: version and re-verify account risk policy.
8. Session expiry/MFA: pause for user; never bypass.
9. App crash/restart: reconcile before new risk.
10. Manual intervention during automation: invalidate prepared draft and
    restart preflight.

## Open Questions

- Owner: operator — provide/store the written Apex authorization evidence
  reference before enabling Apex automated entry.
- Owner: engineering — confirm whether Apex-issued Tradovate credentials permit
  the official API subscription/key flow.
- Owner: engineering — request Rithmic dev kit and confirm commercial terms
  before scheduling its adapter.
- Owner: engineering — inspect WealthCharts live DOM accessibility and stable
  selectors in a paper session.
- Owner: product — choose initial consequential mandate limits, allowed symbol,
  session, and expiration after paper certification.
- Owner: engineering — decide whether the execution gateway initially runs
  inside Electron main or as `sidecars/execution-gateway`; contracts do not
  change either way.

## Implementation Plan

1. **Contracts and fake gateway**
   - Add connection, intent, risk, authorization, event, receipt, and error
     schemas.
   - Implement durable claim/idempotency/state-machine tests with a fake
     adapter.

2. **Trading Connections**
   - Extend Connected Accounts with trading-specific connection records.
   - Reuse the credential vault and browser-pane infrastructure.
   - Add per-account session isolation, status, revoke, and redaction tests.

3. **Read-only truth**
   - Implement adapter discovery, authentication, account selection,
     capabilities, positions, orders, and account-risk snapshots.
   - Surface health in Settings and Futures Hub.

4. **Tradovate paper API**
   - Implement OAuth/key flow, automated-order flag, user synchronization,
     orders, fills, positions, native protection, and reconciliation.

5. **WealthCharts paper browser**
   - Build the named DOM/Portfolio adapter.
   - Add deterministic DOM fixtures, visible-account checks, action digest,
     screenshots, one-click submission, and ambiguous-submit recovery.

6. **DiscoTrader convergence**
   - Convert Discord tickets into `order-intent@1`.
   - Port the single-claim lifecycle, realized-P&L gate, protective lifecycle,
     immutable author identity, and incident recovery.
   - Remove independent execution authority after parity is proven.

7. **Certification harness**
   - Run the forced-failure matrix and 50-lifecycle paper soak.
   - Persist certification evidence by adapter version.

8. **Bounded consequential canary**
   - Enable one connection/symbol/contract with an expiring mandate.
   - Review every receipt before increasing scope.

9. **Additional adapters**
   - ProjectX API from the DiscoTrader donor.
   - Rithmic after dev kit/conformance.
   - IBKR execution independently of its market-data connection.

## Evidence Log

| Date | Evidence | Result | Remaining gap |
|---|---|---|---|
| 2026-07-30 | Current Trade God architecture and browser runtime inspected | Existing client, credential, session, and execution boundaries are reusable | Execution contracts/runtime not implemented |
| 2026-07-30 | Apex platform documentation reviewed | Rithmic, Tradovate, WealthCharts require distinct adapters | Credential/API eligibility must be confirmed |
| 2026-07-30 | Tradovate API documentation reviewed | API-first adapter is technically viable | Paper credential and bracket behavior proof |
| 2026-07-30 | Rithmic API documentation reviewed | Direct API is viable after dev kit/conformance | Commercial access and conformance |
| 2026-07-30 | WealthCharts DOM and Broker Portfolio reviewed | Named browser adapter has observable entry/reconciliation surfaces | Live DOM selector inspection |
| 2026-07-30 | ProjectX API/realtime documentation reviewed | Existing DiscoTrader adapter ideas fit the gateway | Live integration remains unproven |
| 2026-07-30 | IBKR official API documentation reviewed | Later API adapter is feasible | Current work remains market-data only |

## Primary Sources

- [Apex: Choosing the Right Platform](https://apextraderfunding.com/help-center/platform-set-up-guides/choosing-the-right-platform/)
- [Apex User Agreement](https://sim.apextraderfunding.com/legal/user-agreement)
- [Apex: Intraday Trailing Drawdown Explained](https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-explained/)
- [Tradovate API](https://api.tradovate.com/)
- [Rithmic APIs](https://www.rithmic.com/apis)
- [WealthCharts Trading DOM](https://www.wealthcharts.com/kb/category/brokers-and-trading/trading-DOM/)
- [WealthCharts Broker Portfolio](https://www.wealthcharts.com/kb/category/brokers-and-trading/Broker-Portfolio/)
- [ProjectX API](https://www.projectx.com/api)
- [ProjectX Realtime API](https://gateway.docs.projectx.com/docs/realtime/)
- [IBKR TWS API](https://www.interactivebrokers.com/docs/tws-api/doc/introduction)
- [IBKR Web API](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)

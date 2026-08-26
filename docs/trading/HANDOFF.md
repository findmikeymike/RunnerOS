---
status: active
owner: team
last_verified: 2026-08-26
source_of_truth: false
---

# Trade God Handoff

## 2026-08-26 Automatic Options Entry Timeout Handoff

- A single-instance background supervisor checks frozen automatic-entry
  windows every five seconds and once during startup recovery.
- It never reprices. It cancels only the exact unfilled entry remainder; a
  confirmed fill remains open and moves into normal position custody.
- Cancellation-unknown reuses one immutable request and stays halted until
  provider reconciliation. Failures are isolated to the exact account.

## 2026-08-26 Exact Discord Options Follow-up Handoff

- The existing signed management webhook now jointly resolves futures,
  Mirror, and options families; cross-family ambiguity produces zero mutation.
- Automatic options entries accept only exact full or whole-contract partial
  exits. The app cancels the unfilled entry remainder before closing owned long
  contracts and resumes the same durable request after a crash.
- Edited, stale, future-dated, ambiguous, unsupported stop, non-integral, and
  uncertain-cancel instructions are blocked. Manual options orders are outside
  Discord follow-up resolution.
- This is locally verified custody logic, not real IBKR/Webull lifecycle proof.

## 2026-08-26 Options Signed Intake and Source Setup Handoff

- The existing authenticated DiscoTrader receiver now accepts immutable
  single-leg options entry evidence; there is no second webhook or execution
  authority.
- Entry resolves an exact Discord server/channel/thread/trader route to one
  exact paper/sandbox account. The final price/debit decision includes the
  provider preview fee, then the app durably stores the reservation, frozen
  plan, and receipt before one idempotent gateway delivery.
- Startup recovery requires Trade God desktop single-instance authority.
  Account removal is refused while any non-archived Discord source still
  points to it.
- Options Desk exposes a simple Add Discord Source flow with advanced price
  limits folded away. New sources are drafts; no real broker automation is
  unlocked by saving one.

## 2026-08-26 Options Autopilot Authority Handoff

- Automatic options entry has its own certification contract; the current
  manual paper safety test cannot unlock it.
- Eligibility requires 50 clean paper lifecycles, exact entry/management/crash
  containment, certified expiration close and do-not-exercise behavior, and
  final flat/zero-order proof.
- A short-lived authority binds the exact route revision, policy, account,
  credential generation, adapter, base applied safety test, and autopilot
  certification. Activation/revocation is serialized for the whole route
  lineage.
- No runtime or UI path can create this evidence yet, so automatic entry remains
  unavailable by construction.

## 2026-08-26 Options Automatic Routing Foundation Handoff

- The durable route model binds one exact Discord guild/channel/thread/trader
  identity to one exact options account and one immutable policy revision.
- Route configuration is inert: routes can only be draft, paused, or archived.
  A separate expiring authority requires exact
  `options-paper-autopilot-certified` evidence before automatic entry can exist.
- Duplicate live source assignments are refused before persistence. An archived
  source may be deliberately assigned to a new route lineage.
- This is local configuration proof only. It is not wired to Discord intake or
  provider orders yet.

## 2026-08-26 Options Position and Expiration Custody Handoff

- Options Desk now shows exact working entries and open long positions, with
  explicit `Cancel entry` and `Close position` controls.
- Close requires an operator minimum acceptable credit and a second explicit
  confirmation. It closes only the complete exact owned position in this UI
  slice; it never infers a partial exit.
- Startup audits every management receipt before normal order recovery. A crash
  between a broker result, the position ledger, and debit release is repaired
  rather than skipped or resent.
- The expiration planner freezes broker deadlines and do-not-exercise policy,
  but unattended expiration action remains disabled until exact provider
  behavior is retained and certified. The operator must close manually before
  the displayed broker cutoff.
- Local verification is clean. No real IBKR/Webull cancel, close, expiration,
  exercise, or do-not-exercise lifecycle has been run in this worktree.

## 2026-08-26 Options Manual Paper Order Handoff

- Options Desk now supports one explicitly reviewed IBKR paper order after the
  exact account's safety test is passed, applied, and granted short-lived manual
  permission.
- The operator chooses the tested contract and a maximum premium, then reviews
  the live quote, limit, fees, and maximum debit before a second confirmation.
- The runtime freezes the review for 30 seconds, reserves debit durably, submits
  one DAY marketable-limit order for one contract, and reconciles uncertain
  outcomes without a duplicate send.
- Startup recovery is per account and visible in the UI. Account or credential
  changes are blocked while an order or reservation remains unresolved.
- This is locally verified code, not live broker proof. No real IBKR order has
  been placed in this worktree, and Webull submission remains disabled.

## 2026-08-12 Trading UI Handoff

- Trade God routes no longer show the unrelated `All Sessions` navigator.
- The sidebar now prioritizes Overview, Trades, Signals, DiscoTrader, and
  Accounts; advanced operational surfaces live under Tools.
- Trades is backed by the read-only durable execution ledger IPC, not mock UI.
- DiscoTrader uses one progressive setup rail and one next action. Accounts and
  exact Discord routing are primary; Mirror Groups and diagnostics are folded.
- The running development app was visually checked at the real restored window
  size. Overview and DiscoTrader hierarchy, density, empty states, and safety
  labels were verified after the responsive pass.

## 2026-08-10 Safety Audit Handoff

Start with `audits/discord-signal-system-readiness-2026-08-10.md`.

- Verdict: not ready for automated provider execution.
- Runtime truth: Trade God explicitly attaches one Tradovate paper adapter, but
  certification, account enablement, mandate, and halt gates keep it inert.
- The account UI can run a trusted read-only provider verification. Its
  append-only proof confirms exact account/environment/tradability and safe
  position/order counts, but grants no certification or execution authority.
- Passed options provider certification is now still one step short of manual
  paper authority. The operator must explicitly apply the exact current retained
  guided safety test for that account, apply the result, then grant short-lived
  manual permission. A separate manual order ticket is still the next slice.
- Trusted UI actions can apply retained certification evidence and explicitly
  enable a paper account, but both keep persistent halts active. The final
  release is a checksum-bound review that re-proves all accounts flat under
  provider locks, rechecks mandate/expiry, and cancels every old queued ticket.
  Any account, credential, certification, enablement, or mandate replacement
  re-latches the reviewed boundary.
- Live isolated workspace now contains both signed DiscoTrader receivers.
- Trade Desk is read-only and cannot call donor execution/management tools.
- Exact Discord routing is mandatory; no default/single-account fallback exists.
- Multiple targets require immutable `targetLegs` with exact quantities rather
  than truncation or an inferred split. Mirror children preserve the source
  ratio only when every leg remains a positive whole-contract quantity.
- Packaged Trade God identity is forced before main-process import, independent
  of Artist OS shell variables.
- Provider-account admission and provider mutations are durably serialized
  across instruments and through normal/restart reconciliation.
- Gateway-owned futures economics independently recompute loss; understated
  tickets, stale contracts, and root symbols fail closed.
- The previously copied Artist OS vault was moved into a recoverable Trade
  God-only quarantine. Fresh Trade God login/secrets are required.
- Time-bounded paper arming and execution coordination are implemented locally;
  one paper-only Tradovate adapter is attached but inert on a clean install.
  No production certification runner has produced the required 50 clean
  lifecycles, and the official Tradovate API does not document a reduce-only
  partial-close primitive. That remains an external demo-evidence blocker; do
  not weaken the lifecycle gate or label an opposite market order safe.
  Coalesced token renewal, provider backoff, trusted read-only account
  verification, and an exact-account Tradovate user-sync hint feed are
  implemented. Events only invalidate freshness and wake authoritative REST;
  gaps halt entry, and REST refuses freshness when any position/order is not
  Trade God-owned. Halt generations prevent a concurrent activation from
  clearing a newer feed gap before its durable write completes. The full local
  closure is 383 tests across 52 files with 1,345 expectations, repository
  typecheck, and all three Electron production builds. Next build gate:
  exact-account lifecycle certification.

## Mission

Build a local-first desktop trading intelligence system where deterministic analytics produce traceable evidence, specialist agents interpret it, a head agent coordinates context and disagreement, and all trading actions pass through explicit policy and execution boundaries.

## Exact Working Location

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/trade-god-foundation`
- Branch: `codex/trade-god-foundation`
- Frozen base: `origin/main` `e7e96be3`
- Discord follow-up receiver head: `163891cc`
- Other RunnerOS worktrees: intentionally untouched

## Read First

1. `docs/trading/CURRENT.md`
2. `docs/trading/specs/execution/multi-account-mirror-groups.md`
3. `docs/trading/specs/foundation/phase-0-contract-kernel.md`
4. `docs/trading/specs/market-data/phase-1-nautilus-market-data-spine.md`
5. `docs/trading/development/VERIFICATION.md`
6. `docs/trading/architecture/OVERVIEW.md`

## Current Truth

Trade God is now a separate desktop product rather than a Runner workspace
profile. Its packaged identity is `com.findmikeymike.tradegod`; runtime state,
credentials, workspace registry, browser partitions, logs, and deep links are
rooted under `~/.trade-god` and `tradegod://`. Future migration copies no
credential vault. The old byte-identical Trade God vault copy was quarantined
without changing Artist OS under `~/.craft-agent`; Trade God must re-enroll its
own credentials.
New workspace flows stay under `~/.trade-god/workspaces`. Auto-update is
disabled until a dedicated Trade God release feed exists, preventing RunnerOS
or Artist OS packages from crossing the product boundary. The live DiscoTrader
management webhook is configured for Trade God's isolated port `9201`.
Startup refuses external or remote Runner workspaces and filesystem symlink
escapes before the main runtime loads. Workspace creation accepts a name, not a
renderer-selected filesystem path. Product logout, privileged audits, config
validation, agent prompts, and bundled help no longer address `~/.craft-agent`.
Migration remains a deliberate one-time operation (`bun run
trade-god:migrate-data`), not an automatic read from Artist OS on every clean
Trade God install. It is already complete on this machine.

The Phase 0 walking skeleton is implemented for development and packaged-sidecar resolution. A project-owned ES fixture travels through a standalone Order Flow sidecar, validated contracts, a typed client, Electron supervision, narrow IPC/preload methods, and a visible Trade God workbench. The build now emits a self-contained sidecar bundle and packaged mode selects RunnerOS's bundled Bun.

This is not yet a live trading system. It has no live quote stream or certified real-provider order path. The real visual Electron user path has been smoked for the command center and GPT Order Flow specialist, but a fully built packaged installer has not been proven.

The Unified Broker Entry Gateway foundation is implemented locally. Provider-neutral contracts, durable single-claim state, reconciliation, kill switches, checksum-bound management commands, exact adapter certification, and protected-fill recovery are covered by automated tests. Tradovate demo/API and WealthCharts browser foundations implement the same normalized adapter boundary, but neither is paper-certified. DiscordTrader tickets now become immutable gateway intents rather than retaining a second execution authority.

Multi-account Mirror Groups now have Stage 0/1 implementation. The UI creates
paper-only, append-only group revisions with two to five exact accounts,
per-member source/fixed sizing caps, and an estimated price-distance exposure limit.
Routes migrate losslessly to an account-or-group target union and reassignment
requires confirmation. One immutable Discord source event binds to one frozen
target/revision, instrument/economic snapshot, and trusted receive time before
materialization. Both durable indexes carry full recovery evidence, so a crash
or replay cannot follow later route, group, clock, or economics changes. Group
tickets persist deterministic child previews only;
`order_mutation_allowed` is always false and the displayed price-distance risk
is explicitly an estimate, not certified risk. Stage 2 adds a dormant
fake-provider harness: child account admission, aggregate planning-risk
reservations, atomic all-child ownership, fresh provider/mandate revalidation,
reservation-bound grants, bounded fan-out, and truthful crash/partial recovery.
Its grants are explicitly `fake-provider-test-only`; a normal gateway rejects
them and the desktop runtime does not instantiate the coordinator. Real-provider
Mirror authority and legacy source-binding backfill remain pending. The dormant
management foundation now resolves standalone and Mirror families together,
persists exact per-child actions/request IDs, recovers deferred/restarted work,
and requires fresh checksum-bound provider-flat proof for every child before
ownership or aggregate capacity releases. Provider-flat evidence is journaled
before ownership lease deletion, and a missing aggregate reservation is treated
as corruption. It deliberately blocks compound
partial-close then stop movement until an adapter can certify the resized stop
payload. No runtime mirror child can submit.

Discord entry and follow-up management both enter through Trade God's isolated HMAC-authenticated 9201 trigger server. The `discotrader` path validates the complete immutable ticket and registers it through the single gateway intent source; it binds only to an explicitly configured exact Discord-source route, with no default or single-account fallback. The `discotrader-management` path resolves a checksum-bound message only by immutable author plus reply/thread/channel/symbol evidence to exactly one protected gateway trade. Its command identity includes the immutable Discord message and action index, so retries are idempotent without collapsing two separate identical reductions. Startup recovery runs before new delivery. DiscoTrader persists both kinds of signed envelope in a SQLite outbox before network delivery, queues management authority before acknowledging Chrome, retries Runner outages, and emits thread identity only from an exact cross-channel reply or explicit mapping. The prior running observe-only smoke proved the management receiver; the new entry route, outbox retry, and thread mapping are automated-test proven but not yet runtime-smoked. The runtime intentionally has zero provider adapters until paper certification.

Phase 1 has an isolated Python 3.12.9/NautilusTrader 1.230.0 adapter and provider-independent event, quality, batch, candle, series, and agent-snapshot contracts. Python emits the exact TypeScript golden/checksum; typed client/Electron supervision validates it; the replay engine produces current price and candle history under a no-lookahead watermark. `agent-market-snapshot@2` now binds explicit provider sequence, continuity, freshness, and session-window admission into its checksum. One canonical batch produces both the checksum-verified `order-flow-artifact@2` and the addressed snapshot reference consumed by `order-flow-specialist@0.1.0`. The specialist refuses reconnecting, gapped, stale, unavailable, invalid, or out-of-window evidence before invoking the model. The GPT path has been user-smoked in Electron.

IBKR through standalone IB Gateway is the selected first economical provider path. The official notarized Apple Silicon IB Gateway 10.45 app is installed, and a loopback-only health handshake is typed through the Python sidecar, contracts, client, Electron IPC, and preload. It is deliberately health-only and discards account IDs. The Gateway is not yet authenticated or listening on paper port `4002`, so no live provider or quote proof is claimed.

Futures Overview now receives a deterministic project-owned synthetic ES session as validated `market-candle-series@1` through local IPC/preload. It supports 1m/5m/15m/1h and ETH/RTH preview densities and is visibly labeled synthetic. NQ/YM/RTY remain empty rather than receiving invented prices.

The Futures sidebar now includes a dedicated DiscoTrader Control Center. It
uses the existing workspace source/credential APIs to configure the local
`http://127.0.0.1:8788/mcp` bridge, proves reachability by loading its tool
catalog, and explicitly installs/activates the audited `trade-desk` worker in
the current workspace. The global definition is never silently seeded, a
conflicting existing definition is not activated, and the worker remains
approval-gated. See `docs/trading/integrations/DISCOTRADER-CONTROL-CENTER.md`.

## Immediate Assignment

Enroll fresh Trade God credentials, confirm Apex/Tradovate API eligibility, and
obtain a demo credential bound to one exact account. Trade God now explicitly
attaches one paper-only Tradovate adapter with structured encrypted-vault
credentials, CAS token rotation, exact descriptor binding, and adapter-change
halt quarantine. It remains inert behind lifecycle certification, explicit
account enablement, a current mandate, and persistent halt controls. Run the new
read-only `Verify account` action, confirm the exact account event feed is
subscribed, then prove partial-close protection resizing and the 50-lifecycle
paper soak before enabling the account.
Before a multi-target smoke, update DiscoTrader to emit
`targetLegs: [{ legId, quantity, target }]`; the legacy `targets` array remains
evidence but cannot authorize a guessed allocation.

## Known Expected Artifact

- Total volume: `28`
- Buy volume: `17`
- Sell volume: `11`
- Delta: `6`
- POC: `5592.25`

The UI also exposes quality, trace ID, fixture checksum, content hash, and producer identity.

## Verification Truth

- Provider read-verification slice: 49 focused tests pass across contracts,
  append-only evidence, Tradovate read runtime, connection lifecycle,
  IPC/preload, UI helpers, channel parity, and runtime. Repository typecheck and
  Electron production builds pass. Credential replacement/removal revoke before
  mutation and cannot erase retained proof history. This is account-read proof,
  not lifecycle certification or execution activation.
- Mirror management foundation: 111 focused contract, gateway, Mirror,
  Discord-management, and Electron runtime tests pass with 402 expectations.
- Startup-only, app-instance-bound recovery repairs crashed execution and
  aggregate-risk locks without permitting live stale-lock takeover.
  Repository typecheck and Electron main/preload/renderer builds pass. This is
  local/fake-provider evidence only; compound partial-close then stop movement
  and real-provider Mirror authority remain disabled.
- Mirror Groups Stage 2: 246 focused trading/trigger/Electron tests passed
  across 31 files with 796 expectations. Repository typecheck, Electron
  main/preload/renderer production builds, and diff check passed. Rival review
  found no remaining High/Medium blocker in the dormant fake-provider scope.
  This does not prove runtime activation or real-provider fan-out.
- Mirror Groups Stage 0/1: 287 focused tests passed across 41 contract,
  execution, trigger, Electron trading, route, IPC/preload, renderer-helper,
  and channel parity files with 992 expectations. Repository typecheck and Electron
  main/preload/renderer production builds passed. This proves configuration,
  route migration, immutable source binding, deterministic preview, and zero
  execution authority—not provider fan-out or group management.
- Provider lifecycle closure: 318 focused/system tests passed across 50 files;
  repository typecheck, all three Electron production builds, and diff check
  passed. Rival repros for blind enumeration and post-stop token distribution
  are closed. Account-halt release requires fresh exact-connection truth in main.
- Automatic paper mandate closure: 244 tests passed across 42 trading/Electron
  files; typecheck, all three Electron production builds, and diff check passed.
  Rival tests prove revoke/replace races cannot cross into execute.
- 2026-08-10 safety closure: 356 relevant tests passed across 50 files; full
  typecheck, Electron main/preload/renderer builds, and diff check passed.
- Unified gateway closure: 175 tests passed, 0 failed across 31 trading/Electron files with 582 expectations.
- Repository-wide `bun run typecheck:all` passed.
- Electron main, preload, and renderer production builds passed.
- Discord entry/follow-up closure: 210 focused tests pass across 33 contract, execution, trigger-server, and Electron trading files with 712 expectations; repository-wide typecheck and Electron main/preload/renderer builds pass.
- Donor sender: 283 tests pass, including durable entry/management outbox retry, unsigned-ticket refusal, already-delivered replay suppression, and conservative thread-parent resolution. Donor typecheck/build pass.
- Running Electron smoke: one compound message became two parsed actions, one HMAC-signed push, and one durable blocked receipt with no candidate intent and no gateway mutation. Exact signed replay returned HTTP 409.
- Real Tradovate paper lifecycle, WealthCharts paper lifecycle, 50-run provider soak, and consequential canary: not run.
- Paced replay focused closure: 93 passed, 0 failed across 14 TypeScript files; Python market-data suite: 21 passed, 0 failed.
- Real Electron smoke: not run.
- Packaged sidecar bundle and resolution: implemented and integration-tested; actual packaged installer not built/smoked.
- Crash policy: failed work is not replayed; the sidecar restarts only on the next explicit request.
- Active cancellation: proven through typed client, handler, and real stdio; workbench control compiles but is not visually smoked.
- Run receipts: atomic validated JSON receipts persist request, trace, artifact identity/hash, timing, and outcome under `<userData>/trade-god/run-receipts/`.
- Audit chain: the supervisor owns the trace before work starts; structured main logs, request, artifact, and receipt share it.
- Receipt-focused verification: 23 passed, 0 failed. Latest complete suite remains 62 passed; the attempted combined rerun hung in the tool layer and was stopped.
- Full monorepo typecheck: blocked by a pre-existing campaign-calendar failure at `packages/shared/src/campaign-calendar/index.ts:632`.
- Standalone package typechecks: unverified after prior tool-layer hangs.
- Phase 1 fixture adapter: 1 test passed after an observed failing test; Python `3.12.9`, NautilusTrader `1.230.0`, Darwin ARM64.
- Phase 1 canonical contracts: 20 tests passed and standalone typecheck passed after adversarial findings were reproduced and fixed.
- Phase 1 Python canonical adapter: 5 tests passed; Python and TypeScript full-batch goldens/checksums agree exactly.
- Phase 1 completed replay quality matrix: 9 tests passed with typed malformed and all-rejected failure paths.
- Phase 1 market-data RPC: 7 tests passed; complete Python suite: 16 tests passed. A real spawned process proved strict JSONL parsing, dependency-aware health, and shutdown.
- Typed client/Electron supervision: 39 tests passed, 79 expectations; Electron main build passed. Real Python development supervision is proven. Packaged Python assets and installed-app runtime remain unproven.
- Replay/candles: 41 tests passed, 95 expectations; contract and market-state typechecks and Electron main build passed. No-lookahead, retry dedupe, invalid/live rejection, checksum validation, exact OHLC/volume/delta, history, and developing state are proven on bounded replay.
- Agent market context: 46 tests passed, 126 expectations; typechecks and Electron main build passed. Fresh/stale/no-data, limits/truncation, quality aggregation, exact batch/checksum mapping, content integrity, and analysis-only authority are proven. The scripted Order Flow specialist now consumes this path; authenticated-provider consumption is still unverified.
- Canonical Order Flow: 64 tests passed, 137 expectations across ten focused files. Contract/market-state typechecks, Electron main build, packaged sidecar build/health, exact mixed-precision math, bounded framing/cache behavior, corrupt/live rejection, v2 provenance/receipts, and the real Python-child -> Order-Flow-child path passed.
- Specialist context delivery: full snapshots persist atomically under `<userData>/trade-god/agent-context/`; specialists receive `agent-context-reference@1`, not copied market payloads; queue and authorized resolution produce `agent-context-delivery-receipt@1`. Concurrency, tamper, wrong-consumer, and path traversal checks pass. This seam alone did not prove consumption; the scripted specialist path below now does.
- Order Flow specialist: one real canonical batch binds artifact, snapshot, delivery receipt, trace, instrument, and checksums. A hash-pinned doctrine and structured output contract reach the model. Runtime gates reject reconnecting, gapped, stale, unavailable, invalid, or out-of-window evidence before the model, then reject changed measurements/identity, false feed claims, invented evidence, excessive confidence, conservative execution-policy matches, malformed JSON, and provider failure.
- Market readiness: `market-feed-continuity@1` and `market-session-window@1` are enforced in `agent-market-snapshot@2`. Focused closure is 36 contract tests, 16 market-state tests, 27 Python market-data tests, and 32 Electron trading tests including 20 specialist cases, all passing. Session identity is joined across artifact and snapshot. This proves provider-neutral rules and replay/runtime admission, not a live vendor reconnect or a real CME holiday/rollover calendar.
- Evaluation: the scripted model passes a 6/6 deterministic rubric. The standalone headless harness previously lacked credentials, but the user later authenticated and visually smoked the GPT specialist path in Electron. No claim about production trading quality is made.
- Paced replay: `market.replay_batch`, `market.replay_next`, and `market.cancel` are typed through contracts, client, real Python stdio, and Electron supervision. Pulls serialize per replay for natural backpressure; deadlines/cancellation interrupt waits without crashing the process; active sessions are capped at 64; final batch identity/checksum must match every emitted event.
- Measured JSONL policy: the real Darwin ARM64/Python 3.12.9 child sustained 966–978 events/sec in two observation trials at the protocol's fastest 1 ms pace; this is not claimed as raw transport capacity. A 750-event completion was 713,568 bytes; 800 was 761,067 bytes; 10,000 was 9,608,099 bytes. Replay completion and direct load now reject estimated responses above 750,000 bytes with typed `STREAMING_TRANSPORT_REQUIRED`; Electron's hard frame ceiling remains 1,000,000 bytes. Replay-next timeouts are pace-aware, so valid intervals above the default 5-second control timeout remain supported.
- Windows and Linux runtime/package compatibility: locked wheels exist but remain unverified.
- IBKR onboarding scaffold: 94 focused tests passed across Python, contracts, client, and Electron; contract/client/Electron typechecks and Electron main/preload builds passed. Live paper login, port `4002`, entitlement, and first quote remain unverified.
- Synthetic chart fixture: 19 focused Electron tests passed across deterministic generation, schema validation, IPC/preload/runtime wiring, fixed-point chart mapping, source labeling, overview output, and channel parity. Electron typecheck plus main, preload, and renderer builds passed. Visual smoke remains pending.
- DiscoTrader Control Center: 15 focused renderer/catalog tests passed with 86
  expectations; repository-wide typecheck and Electron main/preload/renderer
  production builds passed. The user has not yet clicked the live source/worker
  setup path in the running app.

## Non-Negotiable Boundaries

- Agents and UI use the typed trading client, never providers, brokers, or sidecars directly.
- Contracts remain independent of Electron, providers, brokers, and LLMs.
- Deterministic calculations remain testable without an LLM.
- UI never owns market truth or execution state.
- Analytics engines remain independent sidecars, not code hidden inside agent folders.
- Every artifact carries provenance, versions, timestamps, trace identity, and quality state.
- Live execution stays impossible until risk, approval, idempotency, reconciliation, and kill-switch gates exist.

## Next Smallest Actions

1. Visually smoke synthetic ES across all timeframe/session controls and correct any sizing/layout issues.
2. Complete manual IB Gateway paper login/API setup and feed the first entitlement-valid canonical candles into the chart.
3. Inventory the user's agents and map each to a bounded Workers role plus `chart-annotation@1` output.
4. Add the authoritative exchange calendar/rollover adapter and dedicated live streaming transport.
5. Package and smoke the app.

## Do Not Do Yet

- Do not merge unrelated upstream changes.
- Do not bulk-import agents before their role, inputs, outputs, and authority are defined.
- Do not add brokers or live execution.
- Do not describe tests or builds as runtime verification.

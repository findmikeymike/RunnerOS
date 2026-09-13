# Delivery roadmap

The graph in plan.json is authoritative. No implementation node is accepted by this specification. One owner integrates shared files; later task packets must become executable before work starts.

| Phase | User-visible outcome | Tasks and sequencing | Exit proof |
|---|---|---|---|
| P1 — Prove contracts | No product change; resolve the two hardest integration risks cheaply | T-101 host dispatch/identity proof; T-102 audio event-turn proof | Reproducible local fixtures and frozen host/SDK contracts; independent review |
| P2 — One real working conversation | Ask one specialist for a draft and keep talking until the result arrives | T-201 native bridge and truthful status; T-202 same-pipeline audio scheduler; T-203 live vertical proof | Actual worker, saved output, unrelated spoken exchange, audible result and interruption; existing call regressions pass |
| P3 — Interactive and recoverable | Multiple tasks, questions, approvals, revisions, cancellation and reopen | T-301 interactions/permissions; T-302 persistence/recovery/caps; T-303 compact task UX | Adversarial ownership, cancellation races, restart reconciliation, multiple questions, accessibility and repeated-call evidence |
| P4 — Release candidate | Reliable candidate ready for user smoke test and authorized landing | T-401 integration/performance/packaging/rollback | Full tests, candidate identity, measured audio behavior and user acceptance; no automatic launch or main merge |

## Ownership and concurrency

T-101 and T-102 are sequential to keep one integrated contract owner. In P2 the bridge and SDK work may be delegated only after file ownership is explicit; the graph currently keeps them sequential because main/hook integration is shared. P3 stays sequential for the same reason. Do not run multiple implementers against SessionManager or the voice hook without a concrete split. Reviewer is a separate agent from the implementation owner; the lead records gate decisions.

## P1 bounded proofs

T-101 inspects one dispatch path and proves admission/retry/cancel using an isolated fake executor and real temporary receipt storage. It must enumerate failure cuts before launch, after receipt write, after child creation and before bridge commit. It does not run paid tools. Stop after this one adapter proof if the existing API cannot provide deterministic receipt correlation; record the required narrow extension rather than exploring unrelated runtimes.

T-102 proves one event-origin assistant turn through the existing web wrapper with generated fixture speech/PCM and deterministic playback controls. Verify arbitration, interruption and consumed-audio completion. Do not install a replacement engine. If WASM internals require a larger change than the web-wrapper plan, return a revised contract before P2. Fixture evidence does not satisfy the live P2 gate.

## P2 vertical smoke

In an authorized candidate app with existing configured providers and an active drafting specialist, place a call. Ask for a local draft with a uniquely identifiable title. Confirm task receipt and exact child in the same workspace. Ask an unrelated question before completion. Observe saved result and its delayed spoken announcement. Interrupt that announcement and ask about the result. Verify the right artifact opens and no second dispatch occurred. End call; confirm microphone, TTS and avatar loops stop. Repeat with bridge disabled and confirm old Command handoff works.

## P3 acceptance matrix

- Two pending worker questions, ambiguous “yes”, unrelated answer, explicit task focus, stale question and duplicate answer.
- Two windows contend for one speaking lease; duplicate and stale playback acknowledgements; lease expiry; reconnect after accepted launch response is lost.
- Two windows launch same key; different workspace forges task/child IDs; inactive specialist and escalated permission mode.
- Cancel before launch, during work, while awaiting approval, as output commits and after completion; late callbacks cannot lie about status.
- Hang up during work; reopen same workspace; switch workspace; close renderer; restart host at each admission write boundary.
- Existing approval denied, pending approval lost on restart, permission setting changed between proposal and acceptance.
- Queue overflow with progress storm, replay gap, duplicate terminal events, missing output, provider failure during announcement, no voice credentials.
- Keyboard-only task controls, reduced motion, avatar load failure, captions hidden by default and 20 call cycles.

## P4 release and rollback

Run `bun run test`, `bun run typecheck`, `bun run build` from the candidate root using required Node version and isolated declared dependencies. If Electron-specific checking is not covered by root typecheck, inspect app scripts and record the actual command before acceptance. Run `node scripts/check-voice-core-snapshot.mjs` after any SDK vendor change. Capture exit codes; skipped tests and mock-only voice results do not satisfy live criteria.

Do not relaunch until the user explicitly permits it. After permission, follow current HANDOFF1 development launch, preserve the user's config, and prove the running candidate's revision. Run paired latency samples and repeat interruption/handoff/reopen cases. Prepare user smoke instructions with exactly what changed.

Rollback: disable new admissions/delivery, preserve task records and expose running work through existing session/task controls, verify old voice/Command handoff, then revert only bridge changes if needed. Do not kill workers merely to hide a failed feature. Landing later follows Git facts: update from main, verify after integration, stage owned files, commit/merge/push only within actual authorization. This packet does not pre-authorize that release action.

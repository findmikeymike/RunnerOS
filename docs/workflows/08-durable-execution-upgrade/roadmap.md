# Workflow hardening roadmap

Revision r4. Graph/status authority: [plan.json](plan.json). Technical contract and acceptance IDs: [specification.md](specification.md).

## Dependency backbone

P-01 architecture proof → P-02 journal and durable agent turns → P-03 approvals, external effects and children → P-04 schedules/chains → P-05 migration, UI and operations → P-06 certification and controlled rollout.

This is dependency ordering, not a duration estimate. Each phase has an entry review and an exit review. Implementation authorization is checked at the first entry; it can cover multiple phases. Entry reviews thereafter are engineering checks, not automatic requests for new user permission.

One integration owner controls shared schemas, SessionManager wiring, flags and final landing. Work may proceed in parallel only after contracts are fixed and file ownership is disjoint. In particular, journal schema/transaction code is a single-owner resource. All workers preserve other agents' edits. A separate reviewer judges evidence; role labels alone do not constitute independent acceptance.

## Act I — Prove the recovery foundation

### P-01 — Prove the architecture (accepted isolated proof)

**Evidence:** T-01/T-02/T-03 and independent rival/fix exit review are recorded under evidence/. Production remains unchanged.

**Observable outcome:** a disposable workflow asks for approval, launches a child and receives one fake-provider result across real process deaths. The engine choice is justified by working evidence.

Entry: re-anchor current checkout, read the packet, confirm implementation scope and disposable tooling. No live user accounts required.

| Task | Owner | Outcome / handoff |
| --- | --- | --- |
| T-01 | Runtime owner | Map actual model-turn/tool/child boundaries, define adapter inventory and compatibility contract. |
| T-02 | Persistence owner | Prove candidate storage in actual desktop runtime; transaction, ownership and storage-failure contract. |
| T-03 | Runtime owner | Integrate thin recovery scenario, screen DBOS embedded prerequisites before any adapter experiment, record engine ADR and measured gaps. |

T-02 follows the T-01 boundary contract; T-03 consumes both. Exact packets live in `tasks/`. All prototype behavior is gated and uses isolated configuration.

Exit: independent reviewer sees actual subprocess kill/restart traces and packaged-runtime storage proof; no duplicated fake effect or child; same approved action resumes. D-01/D-02/D-03 resolved. A failure is evidence to change the candidate, not permission to paper over it with a mock.

Recovery: leave production runner untouched; discard only disposable fixture data. Update this plan if the selected engine changes.

### P-02 — Journal and durable agent turns (accepted internal read-only foundation)

**Observable outcome:** a supported read-only workflow can be interrupted inside an agent step, restart, and reuse completed model/tool results.

Entry: P-01 reviewed decision; expand T-04/T-05 against the selected binding and real SDK seam.

- **T-04, persistence owner:** resolve replay-payload encryption/secure references/key-loss/retention before schema acceptance; implement versioned schema, ownership epochs, transaction APIs, commands/events/outbox, artifact references and v2 projections. Own new `packages/shared/src/durable-execution/` (proposed) and run-storage adapter. Acceptance A-02/03/04/10/14/15.
- **T-05, runtime owner:** integrate durable model turns/tool batches and continuation with existing runner/session bridge. Inventory all bypasses; enforce versioned certification at admission and each dispatch, including dynamic tools and children. Never downgrade an admitted v2 run to legacy. Paid model calls require durable reservations before this phase enables them. Bind resolved inputs/defaults and output schemas. Acceptance A-01/03/04/05/07.

Integration: T-05 consumes T-04 contracts. Do not have separate workers independently design operation IDs or retry ownership. Runtime source files chosen in T-01 are owned by T-05.

Smoke: run a fixture returning two identical but distinct reads; kill after the first result; restart; only the second executes. UI can read projections without becoming execution authority.

Exit: independent fault evidence, typechecks and packaged main-process smoke. Still off for external-effect production workflows.

## Act II — Recover whole agent chains

### P-03 — Approvals, effects and child agents (control slice accepted; phase remains open)

**Observable outcome:** a workflow can wait for a decision or required child across restart, and can reconcile an uncertain effect without repeating it.

Entry: P-02 complete; expand adapter and approval integration packets.

- **T-06A, controls owner, accepted:** durable Pause/Resume/Cancel receipts and revision fences. Real SDK and packaged restart evidence in [T-06A controls](evidence/T-06A-controls.md). This prerequisite does not implement approvals, steering or effects.

- **T-06, runtime owner:** exact approval commands, durable waits, permission/account revalidation, cancellation and steering revisions. Own escalation integration and relevant SessionManager control paths. Acceptance A-08/11/15/16.
- **T-07, integration owner:** effect-policy registry, persistent retry/budget reservations, provider status reconciliation and nonreplayable fallback. Own adapter contracts and provider fixture coverage. Also prepare and execute one safe, private/test-mode real adapter proof (T-07-LIVE), after checking any missing action authorization; no paid/public operation is implied. Durable budget/attempt enforcement precedes paid dispatch; child identity precedes delegation regardless of table layout. Acceptance A-06/07/17.
- **T-08, runtime owner:** child admission, restored sessions, completion joins, inherited limits, detached lifecycle and validated output. Own agent-messaging integration. Acceptance A-09/10/11/17.

Sequence T-06 → T-07 → T-08 conservatively because they share operation dispatch. Parallel adapter test preparation is safe; shared runtime edits are not.

Smoke: kill while an approval is pending; restart; approve; kill after child completion before parent join; restart; finish once. Separately let fake provider accept then drop reply; inspect safe resolution.

Exit: all three paths pass real subprocess tests and the early safe adapter proof has recorded actual SDK/provider limits; cancellation/late outcome cannot revive or advance the run. Expand only adapters whose classification is supported by evidence.

### P-04 — Scheduling and multijob continuation (outlined)

**Observable outcome:** wake/restart admits one eligible overdue job and advances a completed chain once.

Entry: P-03 completion; pin D-04 against current scheduler fixtures.

- **T-09, scheduler owner:** occurrence identity, cursor/admission outbox, coalescing/grace mapping, snooze/timezone/DST/edit behavior and due timers. Own automation scheduler and queue integration. Acceptance A-02/12/18.
- **T-10, runtime owner:** unify ScheduledWorkRunner successor rounds with journal admission, preserve top-level lane, reconcile orphaned continuation and enforce budgets/deadlines. Acceptance A-09/10/11/17.

T-10 consumes T-09 admission contract. Shared ScheduledWorkRunner changes are integrated by one owner.

Smoke: close app before a scheduled fixture; restart after multiple due times; exactly one latest eligible daily occurrence starts. Kill between successor admission and callback acknowledgement; successor runs once.

Exit: repeated fresh-runtime wake tests, timing fixtures, output barrier and uncertainty regression pass. No automatic execution outside the user's existing schedule permissions.

## Act III — Make it operable and safely releasable

### P-05 — Compatibility, experience and operations (outlined)

**Observable outcome:** old and new jobs coexist; recovery is understandable; migration/backup failures cannot start unsafe work.

Entry: P-04 reviewed; expand packets against actual UI/configuration and the payload-security contract already resolved in P-01/P-02.

- **T-11, persistence owner:** legacy routing, version manifest, schema migration, rollout flags, compatible rollback and disabled-dispatch restore. Acceptance A-13/14/18.
- **T-12, frontend owner:** existing Work/Run recovery states and safe actions, event cursor reconnect, compact details, accessibility and duplicate-notification handling. Acceptance A-01/08/11/16/18. Depends on T-11 persisted engine mapping.
- **T-13, operations owner:** privacy scanning, retention/artifact pinning, backup/runbook, telemetry, load baselines and exact safe live-adapter certification preparation. Audit the earlier D-05 payload contract and D-06 safe adapter proof; prepare broader certification. Acceptance A-14/15/19; prepares A-20.

T-12 and T-13 can run concurrently after T-11 if their exact file sets are disjoint. Lead integrates and updates project-wide handoff docs with accurate implementation/verification scope.

Smoke: open historical legacy run and restored v2 run; disconnect/reconnect renderer; inspect unknown-effect state; restore backup into isolated config and verify dispatch remains disabled.

Exit: migration/rollback rehearsal, live UI acceptance, ready safe provider test plan and measured reference-load results. Existing account sign-in is not live-adapter certification.

### P-06 — Certification and rollout (outlined)

**Observable outcome:** a named release candidate proves recovery through real runtime/provider boundaries and supports controlled enabling without stranding old runs.

Entry: P-05 accepted, provider target/configuration and any missing action authorization available. Local fault work is independent of provider waiting.

- **T-14, verification owner:** retain continuous affected-PR crash checks and scheduled seeded campaigns established with the harness; full A-01–A-19 matrix, deterministic repetitions/random seeds, 24-hour soak, repository sharded/isolated suite and affected builds/typechecks. Produce redacted evidence tied to the actual binary/source. Own test harness/evidence; report production fixes to owning tasks and invalidate affected acceptance.
- **T-15, integration owner:** A-20 safe live-adapter proof and packaged UI restart journey, then prepare/execute authorized staged enabling. Requires T-14 and live setup. Start with allowlisted workflows/adapters, inspect telemetry and rollback drill, update documentation and known support limits.

Exit: independent reviewer maps every in-scope requirement to evidence. No skips counted as passes. Live-only blockers keep affected adapter disabled; unsupported tools retain conservative behavior. A release claim lists exactly which engine, workflows and adapters were exercised.

## Expansion rule for outlined tasks

Before each phase, create concrete task packets with verified files, actual validation commands, intended migrations and boundary ownership. Update `detail` to `executable` only after this is done. Do not execute an outlined task from a title. Re-run the graph checker after dependency changes. No invented effort estimates or calendar promises are part of r1.

# Team Mode reliability audit — 2026-09-12

Scope: shared-folder runner ownership, scheduled/workflow admission, migration privacy and recovery, and shared-record conflict handling. Baseline: `bac7c04a4`. Work branch: `codex/team-mode-reliability`.

## Confirmed and fixed

- Runner reassignment retries discarded pending handovers. Re-enabling an existing team with `makeRunner` bypassed handover entirely. Retargeting an unacknowledged A→B handover to C forgot A. Shared handover construction now retains the actual unacknowledged runner; migration uses it too and advances the runner epoch.
- Handover acknowledgements only named revision/epoch counters, which can collide across offline assignments. Heartbeats now name the observed runner destination, acknowledge the exact epoch, refresh when that identity changes, and ignore provider alternate copies. Machines participating in a new handover must run the updated code; old heartbeats cannot prove the destination they acknowledged.
- A failed migration removed a destination created by someone else after preflight. Cleanup now requires this migration's matching receipt and path identity.
- Files introduced or changed after preflight could publish credentials to shared staging. Migration freezes the candidate payload in private local staging, checks that snapshot, then publishes the checked bytes. This requires temporary local disk space for the payload, including media.
- Interrupted private-session promotion failed on already-copied identical files. Identical files now resume safely; different bytes remain untouched.
- Cleanup for one migration removed every migration stage for that workspace. Rollback, promotion, and failed preparation now remove only their own stage.
- An unreadable record was treated as an absent record and could be overwritten. Its bytes now remain intact and the attempted replacement enters the existing conflict mechanism.
- Syncthing conflict copies were missed by scanning and local privacy cleanup. Its documented conflict naming is now recognized and mapped to the canonical record.
- Community contact, job, consent, and delivery readers accepted alternate JSON copies as active records. They now require the canonical filename to match the embedded record ID; conflict copies remain evidence rather than active recipients or delivery results.

- A losing scheduled-work claim still launched execution because callers checked the returned order but ignored `updated: false`. Both agent/workflow and social claim consumers now require a successful claim.
- Scheduled agents, Pulse, and legacy workflow steps lost their captured runner fence across asynchronous preparation. Dispatch now rechecks that original token after preparation and immediately before starting the agent; queued automatic messages retain it through persistence and crash recovery. Manual messages do not acquire this automatic-work restriction.

- Late agent-task completion, failure, and session-start callbacks could modify a replacement attempt. They now match the originally claimed attempt, including recovered polling and continuation settlement.

- Durable workflows had an independent asynchronous admission path. Their original runner fence now survives frozen context, child work, execution, publication, and restart; the host checks it at preparation and dispatch boundaries rather than recapturing a new identity.

## Validation

- Final selected verification: 677 tests passed across 39 regular files and three separately executed isolated files, covering team metadata, migrations/startup recovery, shared records, community sending, scheduled work, legacy workflows, and all 25 durable workflow test files.
- The combined regular run initially reported 651 passed and two failed: the two real-Pi integration fixtures could not bind their loopback server under the sandbox. Both passed when rerun with the required loopback access. No provider account or live publication was used.
- `bun run typecheck:all` passed after the final code changes. `bun run check:dependency-containment` passed. `git diff --check` passed.
- New regression cases were demonstrated failing against pre-fix implementations for handover retry/retargeting, conflicting acknowledgement identity, migration cleanup ownership, per-migration stage cleanup, corrupt records, and provider copies. Additional execution tests exercise duplicate claim consumption, ownership changes during async preparation, and late callbacks against replacement attempts.
- This is focused regression verification, not a full-repository test run or two-device product acceptance.

## Existing protections retained

The reviewed RPC permission helpers reread current workspace permissions. Immutable shared-record operations and payload hashes already detect concurrent branches and preserve recoverable content. Existing Team Mode restrictions on automatic external actions remain unchanged. No approval dialog, application restart, provider action, or real user-data migration was introduced or performed by this audit.

## Research and practical limits

[Dropbox documents conflict copies](https://help.dropbox.com/organize/conflicted-copy) for simultaneous/offline edits. [Syncthing documents delayed scans, missed watcher events, and propagated conflict copies](https://docs.syncthing.net/users/syncing.html). These are replicated file transports, not a cross-machine compare-and-swap or lease authority. Consequently, a local file lock or heartbeat cannot prove exclusive ownership across disconnected replicas. The fixes above do not make that claim.

Real two-machine testing with a supported sync provider remains outstanding: delayed config/heartbeat arrival, offline edits, handover during a running turn, abrupt process termination, and reconnect conflict resolution. Tests here use disposable local fixtures and controlled races. End-to-end exactly-once external execution would require an authoritative coordinator and downstream idempotency/fencing; it cannot be inferred from passing local tests.

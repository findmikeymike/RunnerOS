# Team Mode Core Readiness

Status: core Team Mode foundation implemented; email transport and Git advanced mode are out of scope for this checkpoint.

## Supported Now

- Solo workspaces continue to work without team metadata.
- Shared-folder workspaces can store portable team metadata in `config.json` plus the `team/config.json` mirror.
- Each joined machine has a private identity under the local config directory and a shared heartbeat under `team/machines/`.
- Team Settings shows storage mode, runner state, owner/editor role, join state, sync health, conflict count, and machine heartbeat count.
- Existing workspaces can be moved into a shared folder with preflight checks, migration receipt, config-last copy, and moved-path tombstone.
- Team Mode refuses unsafe open states: in-progress migration folders, config-less workspace folders, active migration receipts, and moved tombstones.
- Shared records use immutable per-write operations plus removable payload capsules; JSON entity files are rebuildable projections. Concurrent branches are preserved and surfaced in Conflict Inbox, including branches detected by a third runner.
- Background automations are gated so only the active runner executes scheduler, file-watch, poll, webhook, and message triggers.
- Runner handoff uses a monotonic runner epoch and stays pending until the old runner observes the handoff. Stale timers no longer auto-activate a second runner.
- Missed scheduler ticks support `skip` and `run-once`; `run-once` emits a single catch-up tick after subscribers are attached.
- Non-runner webhook delivery returns/logs a skipped result instead of pretending the event ran.
- Shared-folder outbound webhooks and browser social publishing fail closed until the receiver/provider can enforce a stable idempotency key. Drafting and exact approval remain available.
- Owner transfer codes create an immutable replacement-machine request. The current Owner must approve it; this is not lost-Owner disaster recovery. Concurrent offline claims become contested and block sensitive execution.
- Live workspace moves quiesce sessions, watchers, automations, and scheduled runners; durable journals roll back before root switch and recover forward afterward.
- In-place initialization uses the same quiescence gate, moves legacy sessions to machine-private storage, removes private automation history/retry files, and refuses known credential-bearing files.
- Owner/Editor permissions are enforced for runner assignment, team settings, storage migration, and credential mutations when workspace context is available.
- Editor-created community broadcast jobs default to `needs-owner-approval`.

## Not Supported Yet

- Hosted accounts, roles, permissions, or live collaborative editing.
- Provider API storage through Google Drive, Dropbox, iCloud, or OneDrive APIs.
- Git-backed Team Mode. Git remains the planned advanced mode.
- Real batch email sending. Gmail/ESP transports start in the later email phase.
- Real approval execution for batch email sending. Draft jobs can require Owner approval now; actual send transport starts in the later email phase.
- Automatic conflict resolution. Conflicts are surfaced and preserved for manual handling.
- Partition-safe automatic external side effects without a provider idempotency contract or online claim service.
- Unattended force takeover when the old runner cannot acknowledge. This is intentionally blocked because folder sync cannot prove the old runner stopped.

## Required Smoke Before Product Rollout

1. Create or move a workspace into a real shared folder.
2. Open the same workspace from a second machine/profile.
3. Confirm Team Settings on machine B shows `needs join`, then join.
4. Confirm machine A remains runner and machine B is a non-runner.
5. Fire a scheduler tick on both machines: A runs, B skips.
6. Switch runner to B and confirm Team Settings stays pending until A observes the new revision and runner epoch.
7. Disconnect A before acknowledgement and confirm B remains blocked rather than taking over on a timer.
8. Create a provider conflicted-copy file and confirm Sync Health surfaces it without pressing Scan files.
9. Move workspace old path should show moved tombstone behavior, not allow stale writes.
10. Confirm no `.env`, credential cache, or private session folders were copied into the shared workspace.
11. Confirm Editor role cannot assign runner or save connected-account secrets.
12. Submit one Owner transfer request and approve it from the current Owner; submit two offline claims and confirm the workspace reports a contested transfer.
13. Confirm automatic browser publishing and outbound webhook actions remain blocked in shared-folder mode.

## Current Verification

- Fake-sync second-machine join preserves the existing runner and leaves B as non-runner.
- Sync Health surfaces open record conflicts and provider conflicted-copy files.
- Team migration tests cover preflight, rollback, in-progress open guard, and moved tombstones.
- Automation tests cover solo runner behavior, non-runner skips, runner pulse state, pending catch-up, skipped webhooks, and startup runner-active state.
- Fault tests cover pre-switch migration rollback, forward restart recovery, private-session promotion, runner fence changes immediately before execution, and provider-noise filtering.

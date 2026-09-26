# Scheduled Work lifecycle

Branch `codex/scheduled-work-lifecycle`, based on main `bd3dd7684`. No commit, merge, or app restart performed.

## Correctness

- Agent, workflow, and social dispatch require a successful persisted claim. A lost claim returning the latest order no longer counts as permission to execute.
- Scan transitions compare the order observed by the scan with the fresh locked order, preserving concurrent cancellation, rescheduling, execution changes and approval changes.
- Async session-id persistence and final settlements remain attached to the original run attempt. Old success/failure callbacks cannot alter a replacement run. A late session-start callback for obsolete work aborts that session; a workflow returned after cancellation/replacement is canceled by its own run id.
- Latest execution lookup no longer borrows a session/workflow id from an older attempt.
- Existing approval points, start grace, live execution timeout and continuation rules remain. No blanket restart deadline, new approval gate, or new order attention state was added.

## Passive visibility

- Planned time and actual start are shown in Scheduled Work details. Active Work adds a late-start label based on the relevant run, and overdue queued work stays queued rather than being diagnosed as failed.
- Read-only `scheduledWork:getRuntimeStatus` reports the actual scheduler lifecycle, licensing and team-runner availability. It does not create a scheduler, trigger a scan, request approval or mutate orders.
- Runtime health is shown per workspace and refreshed while Active Work is open. Unavailable/remote/other-runner states are informational. A last-delivered tick is evidence of a scheduler event, not proof that a specific order executed.
- `AutomationSystem.isSchedulerRunning()` fixes the previous summary assumption that every non-disposed automation system had a scheduler.

## Scope and integration

Main had separate unfinished durable workflow recovery edits during this work. They were not copied or modified. Integration will overlap ScheduledWorkRunner claim/persist/finish methods; preserve both this branch's status/attempt checks and the recovery work's durable occurrence identity. Process-local locks and single-instance assumptions remain; this is not a distributed lease implementation.

## Validation

Regression coverage uses temporary storage and fake external execution callbacks. It covers canceled agent/social/workflow dispatch, canceled review and approval transitions, reschedule and replacement-attempt races, ordinary execution, timing presentation, and read-only host/RPC status behavior. No real social publishing or provider action was used.

- Full repository test command: 9,730 passed, 0 failed, 10 skipped (9,345 discovery tests plus 385 isolated-process tests).
- All workspace typechecks passed; final server-core typecheck also passed after workflow cleanup wiring.
- Artist OS main and renderer builds passed. Renderer reports its existing large-chunk warning.
- Runner regression suite: 78 passed. Renderer timing/health tests: 29 passed. Actual host/RPC status tests: 5 passed.
- Independent final review found the workflow startup cancellation gap; it was fixed and re-reviewed with no remaining finding in the reviewed scope.
- `git diff --check` passed. Live Electron rendering has not been checked because no restart was authorized.

Inherited IPC inventory and SettingsGroupTabs test expectations were synchronized with main's existing durable-control channel and neutral selected-tab styling. The new runtime-status channel was added to workspace routing and the channel inventory.

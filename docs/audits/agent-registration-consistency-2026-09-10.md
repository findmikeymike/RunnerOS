# Agent registration consistency

Implemented on `codex/agent-registration-consistency`, based on main `bd3dd7684`.

## Changes

- A shared registration table owns bundled recovery, worker groups, defaults, and scope rules.
- Workers consumes the server's active list. Available definitions and display hints no longer imply activation, including after upsert.
- Server discovery, prompt catalogs, Signals routing, and delegation consume one active view: saved activation, readable definition, allowed scope.
- Artist OS startup no longer reapplies legacy worker/skill activation backfills. Existing manifests, including empty ones, retain their choices. Fresh HQ, campaign, and Lab creation defaults are unchanged.
- Explicit off markers survive reload and unrelated activation writes. Explicit reactivation clears that worker's marker.
- Required recovery includes Raw Video Editor, YouTube Research, Persona, and Community. Recovery and first seeding respect deletion tombstones.
- Lab excludes unrelated known built-ins without rewriting legacy manifests; custom workers retain their eligibility.
- Removed an obsolete bundled display rank for `gaygent-master`; retained the documented voice alias for existing custom installations.

## Boundaries

The separate Runner variant retains legacy activation migrations. Explicit workflow/Pulse launch behavior is unchanged; activation gates discovery and delegation rather than every possible scheduled launch. No saved user profile was migrated, no app was restarted, and no branch was merged.

## Validation

Targeted filesystem, real RPC, renderer hook, registry, and startup regression tests exercise activation/deactivation, recovery, tombstones, missing/corrupt definitions, Lab restrictions, and refused upsert activation. All fixtures use temporary storage. A startup architecture test checks every current activation/skill write remains fenced from Artist OS.

All workspace typechecks and both Artist OS builds passed. Full regression suite: 9,698 passed, 0 failed, 10 skipped, including isolated RPC tests (command exited 0). Live Electron behavior has not been exercised because no restart was authorized.

The base branch had stale IPC inventory and SettingsGroupTabs style expectations; these now match its existing durable-control channel and neutral selected-tab styling. The Website Agent startup regression now consumes the shared registry instead of evaluating the removed inline roster, and the Workers chrome regression checks authoritative activation instead of the removed hardcoded visibility list.

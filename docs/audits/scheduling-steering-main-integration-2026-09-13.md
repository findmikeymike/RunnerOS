# Scheduling and steering integration into Artist OS main

Source work: uncommitted changes in `codex/scheduled-work-lifecycle` and `codex/steering-reliability`. Integrated selectively after social outcomes `930928b83`; source worktrees remain unchanged and must not be merged wholesale again.

## Scheduling

Preserve current durable workflow admission identity and async recovery while adding snapshot checks before claiming or transitioning scanned work, and attempt checks before applying later callbacks. Obsolete admitted workflows are canceled through the durable host under the scheduler principal, not renderer authority. Retain social uncertainty and duplicate suppression from the previous integration.

Add passive scheduler availability and planned/actual timing in Active Work and scheduled details. Status reads do not start a scheduler or execute work. This is not a distributed lease implementation.

## Steering

Preserve each queued update's message ID, attachment references, original input origin, skill choices, and background fence. Keep the existing idle-backend refresh before replay. Persist pending updates before provider dispatch. Stop restores undelivered text, while successful provider injection clears only delivered IDs. Failed automatic replay restores text to the composer without a generic Retry action or a hidden queued duplicate. Existing text-only restoration requires files to be reattached and explicit skill selections to be reselected; the error explains this.

General mode and existing auth/plan continuation boundaries remain. Pi transport acceptance still is not proof of model consumption; crash replay is not an exactly-once consumption guarantee.

## Integration review and validation

Review specifically covers newer durable admission/cancellation, General mode, original background fences, and denied-tool steering delivery. Combined full suite: 57 test processes passed, zero failed. All package typechecks passed. General/scheduling parity: 167 targeted tests passed. Final failed-replay recovery is additionally covered by the focused host tests and server-core typecheck after that refinement. No app restart or live provider/social execution is part of this integration.

Other pre-existing release/runtime edits remain outside these commits.

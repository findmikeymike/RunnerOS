# Campaign cleanup preservation review

Reviewed on canonical `main` after updater commit `ce7c1e437`. The preservation fix was committed with user authorization as `7236722f4`.

## Confirmed defect and fix

Draft Output attachment processing could reverse an earlier decision to preserve the same file. A file explicitly saved in the campaign Vault, or included in an earlier published Output, could consequently be omitted from the HQ archive and then deleted with the campaign.

Draft attachments now validate without changing existing retention decisions. Saved assets, finished Outputs and the existing file policy keep their protection. Ordinary unsaved draft attachments remain disposable; missing attachments still block cleanup.

Two regression cases failed before the fix and pass afterward: a saved Vault file referenced by draft Outputs, and a published Output attachment also referenced by a later draft. Both verify preserved file contents in HQ.

## Evidence

- 62 tests passed across preservation, controller, removal recovery, startup ordering and pending-cleanup configuration.
- One separate disposable end-to-end deletion fixture passed, including binary media, cross-Vault reference repair, HQ/other-workspace sentinels, external originals, registration and recovery-journal cleanup.
- Shared-package typechecking passed; the complete repository suite was not repeated for this bounded fix.
- Logs: `/tmp/artist-os-campaign-fixed.log`, `/tmp/artist-os-campaign-acceptance.log`, `/tmp/artist-os-campaign-types.log`.
- Disk exhaustion initially prevented fixture creation; a later bounded run succeeded after available space increased. No unrelated disk cleanup was performed.

No real campaign, saved credentials or app profile was modified. No restart, push or live acceptance occurred. This does not certify all deletion paths.

## Next bounded review

Verify deletion against the durable workflow host, including an accepted run that is still executing or waiting for approval. The inspected campaign quiescence method checks the legacy runner and file-backed run list; durable runs use a separate host/journal and return before entering the legacy runner's active map. That integration requires its own reproduction and runtime-lifetime evidence before campaign deletion is release-certified.

## Durable-workflow follow-up

The manager regression reproduced deletion admission despite unfinished durable work and idle legacy state. Evidence: `/tmp/artist-os-durable-delete-red.log`.

The uncommitted follow-up now checks the durable journal before and after taking the campaign deletion lease. It includes every workspace run and child: running, paused, waiting for approval, and terminal runs whose backend is still draining. Missing recovery readiness or a journal read failure blocks deletion. A failed second check releases the lease through the existing recovery path.

Existing RPC fencing excludes pending manual admission/resume during deletion; scheduled scans are checked for in-flight work and the migration lock prevents new scans. Review found no additional production admission path outside these guards or an already-visible parent run.

Verification: 41 host/child/controller/transport tests and 10 isolated manager lifecycle tests passed. Coverage includes paused and approval-waiting runs after host reopen, workspace isolation, canceled child drain, unavailable recovery, late work, and failed second checks. Server-core typechecking passed. Logs: `/tmp/artist-os-deletion-guards.log`, `/tmp/artist-os-durable-delete-final.log`, `/tmp/artist-os-durable-delete-types.log`.

This is fixture and code evidence, not live app acceptance or a complete-suite rerun. No real campaign or saved app data was changed.

September 23 follow-up: reviewed the pending durable deletion guard and ran the entire repository suite with disposable profiles: 65/65 processes passed. Full repository typechecking and Artist OS main/preload/renderer builds passed. Live deletion remains untested; no real campaign was removed. See [release smoke evidence](release-smoke-2026-09-23.md).

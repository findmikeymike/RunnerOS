# Campaign cleanup preservation review

Reviewed on canonical `main` after updater commit `ce7c1e437`. The preservation fix is uncommitted.

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

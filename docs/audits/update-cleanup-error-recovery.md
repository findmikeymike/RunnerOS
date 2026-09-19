# Update error recovery must wait for shutdown cleanup

Reviewed on canonical `main` after `26b0c94cc` (MCP permission fix). This updater follow-up is uncommitted.

## Confirmed defect

`installUpdate()` marks an installation active before awaiting shutdown cleanup. An updater error during that wait previously invoked the failed-install recovery hook immediately. The real hook in `index.ts` calls `app.relaunch()` and `app.exit(0)`, potentially exiting while the durable journal and session writes are still draining. This is reachable on macOS because native update preparation continues after the wrapper's downloaded notification.

A disposable isolated regression reproduced premature recovery: recovery count increased before the pending cleanup promise resolved. The previous five tests passed; the new test failed. Evidence: `/tmp/artist-os-updater-red.log`.

## Fix

- Retain the installation lock while cleanup is pending and remember an updater error.
- After successful cleanup, recover from the error without handing off to the installer.
- If cleanup rejects, keep the process alive; an updater error leaves the update in error state, while an ordinary cleanup failure leaves the download retryable.
- Reject another install request while the first is active, including after a repeated downloaded notification.

## Verification and limits

- Seven isolated updater tests pass, covering both cleanup outcomes, duplicate requests, validated-download gating and existing handoff recovery.
- Eighteen adjacent shutdown-lifetime and release-preflight tests pass.
- Electron typechecking passes; the complete repository suite was not rerun for this bounded change.
- Independent read-only review found no blocking issue.
- Logs: `/tmp/artist-os-updater-green.log`, `/tmp/artist-os-release-checks.log`, `/tmp/artist-os-updater-types.log`.

The release script/artifact gate review found no concrete additional defect. Those gates check manifest versions, filenames, required ZIPs, sizes, hashes and nonempty blockmaps. They do not certify archive contents, embedded architecture/provenance, signatures, notarization or public hosting. Those remain explicit gates in the existing distribution checklist.

No app restart, real update, package build, publication, push or saved-profile modification was performed. These fixture checks do not certify a real upgrade preserving user data.

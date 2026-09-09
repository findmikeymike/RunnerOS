# T-06A verification and rival review

Revision r4 · 2026-09-09 · based on committed P-02 `34d2ba786`.

Implemented atomic host-only Pause/Resume/Cancel commands with saved immutable receipts, expected-version checks and control-revision dispatch fences. Pause is cooperative at journal dispatch boundaries. Already-issued results can be saved without reviving paused/cancelled work. Explicit Resume drains the old execution and claims afresh, reusing immutable results. Delayed old errors cannot erase newer intent; genuine old/new errors remain observable. Command receipts describe their original application, not current run state.

Schema 1 data migrates transactionally to schema 2 command storage and remains readable. Missing old controlRevision defaults to zero; the old adapter cannot dispatch or resume under the new pi-readonly-2 manifest. No prior live runs were migrated in this task. Public routing remains disabled.

## Fresh checks

- **60 tests passed, 267 assertions**, nine files, 10.92 seconds. Journal/control, host races, actual default backend, Pi IPC/startup/controller and process-kill recovery. Log `/tmp/artist-os-p03-final.log`.
- New real-SDK process cases: **3 passed, 33 assertions**. Pause after first native-read result blocks the second; SIGKILL/restart stays paused; explicit resume reuses the first result while only the unfinished second read runs. Cancel before model/result persistence retains late issued outcomes but allows no successors. The HTTP oracle outlives killed SDK workers.
- Packaged Electron control probe **passed**: Electron 44.2.0 / Node 24.20.0, packaged=true. Saved Pause survived SIGKILL; duplicate receipt remained stable; explicit Resume used owner epoch 2/control revision 2 and reused the saved model response. Log `/tmp/artist-os-p03-electron.log`. Copied runtime and injected disposable key, not real OS-keychain or complete Artist OS package certification.
- Pi bundle produced in `/tmp/artist-os-p03-pi-server.js` (3024 modules, 27.1 MB); existing app build untouched.
- Existing workflow/scheduler/Pi regression: **355 passed, 1121 assertions**, 19 files, 6.10 seconds (`/tmp/artist-os-p03-existing.log`). Total focused verification: **415 passed, 1388 assertions**. Shared/server-core/Pi TypeScript checks passed; a test-helper parameter annotation was corrected during typecheck. Plan graph and diff checks passed. This is not the complete release suite.

## Independent review

`rival_phase1` independently ran journal/control/host tests (39 passed, 137 assertions), then the expanded control/migration suite (8 passed, 32 assertions). No blocking defect remained. The reviewer requested an automated compatibility regression after independently proving old-schema behavior; that regression was added and passed. Runtime/storage failure propagation and rapid control races were explicitly inspected. Packaged evidence was inspected and the narrow T-06A slice accepted subject to final consolidation, which passed above.

P-03 remains open for exact approvals, ordered steering, effects, child joins and the safe real-provider proof. This evidence does not claim those paths, public UI behavior, full release-suite certification or rollback of already-issued effects. No app restart or paid/public provider operation occurred.

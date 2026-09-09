# Build state

Revision r3 · 2026-09-09 · **P-01 committed; P-02 internal read-only foundation accepted.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`. Started at `8ce9f5c11`; another agent's campaign-deletion commit `6c631f8ad` was preserved. User requested the P-01 commit and continuation: P-01 landed as `dfac3d512`. No push. P-02 changes are currently uncommitted.

User authorized amendment and first related task group, then rival review and fixes. Completed T-01 → T-02 → T-03; independent `/root/rival_phase1` accepted the narrow exit gate after four fixes and one additional Electron check. Primary owner wrote fixture code; `/root/phase1_boundary_map` mapped source and reran baseline.

P-01 decision: embedded SQLite for P-02. DBOS TypeScript excluded by documented Postgres prerequisite, not an executable comparison. At P-01 acceptance, model/child proof was synthetic and no production runner/SDK changes existed. P-02 integration is recorded below. No database migration, flag enabling, paid/live provider activity or app restart occurred.

Historical P-01 evidence:
- Existing baseline: 248 tests pass, 869 assertions.
- New proof: 22 tests pass, 2448 assertions, 300 repeated SIGKILL cases plus owner/lock checks.
- Independent reviewer storage rerun: 6 tests pass, 158 assertions.
- Packaged fixture: Electron44.2 / Node24.20 / SQLite3.53.4; retained state after SIGKILL, epoch2; lock contention 158.49ms and subsequent write succeeds.
- Server-core typecheck and plan graph pass. Full release suite, remote CI, real Artist OS package and providers are not certified.

Read [T-01 boundaries](evidence/T-01-boundaries.md), [storage proof](evidence/T-02-storage.md), [recovery proof](evidence/T-03-recovery.md), [engine ADR](evidence/engine-decision.md), [rival/fix record](evidence/rival-review.md).

P-02 T-04/T-05 completed: production encrypted journal, host runner and actual Pi model/tool barriers. Existing single-step literal workflows can use the internal read-only route; unsupported behavior fails admission. All four rival findings fixed and re-reviewed. New durability suites: **42 passed / 166 assertions**, including real default-backend execution, subprocess IPC and SIGKILL recovery. Packaged production-journal probe passed. See [P-02 verification](evidence/P-02-verification.md) and [rival/fix record](evidence/P-02-rival-fix.md).

Final existing workflow/scheduler/Pi regression: **355 passed / 1121 assertions**. Combined with new coverage: **397 passed / 1287 assertions**. Final shared/server-core/Pi typechecks, plan graph and diff checks passed. This is focused verification, not the complete release suite.

Keep public production admission disabled pending later migration/routing gates. The synthetic P-01 engine is not imported into product execution. Native OAuth/IAM, writable adapters, children, approvals, full release certification and real OS-keychain certification are outside P-02 acceptance. Exact credential rotation/runtime changes fail closed. P-02 remains uncommitted because the user's commit instruction applied to the preceding P-01 work. No app restart or push.

Next scoped work is P-03 entry review and task expansion for effects, approvals, cancellation/steering and child recovery; later tasks remain outlined. Do not enable production merely because this internal foundation passed.

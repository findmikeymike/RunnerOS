# Build state

Revision r2 · 2026-09-09 · **P-01 isolated architecture proof accepted.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`. Started at `8ce9f5c11`; another agent landed campaign-deletion work during this task, advancing main to `6c631f8ad35cd954641905b14e077bdd3fbf60e9`. Those changes were preserved. This task made no commit or push. The packet and fixture code remain uncommitted.

User authorized amendment and first related task group, then rival review and fixes. Completed T-01 → T-02 → T-03; independent `/root/rival_phase1` accepted the narrow exit gate after four fixes and one additional Electron check. Primary owner wrote fixture code; `/root/phase1_boundary_map` mapped source and reran baseline.

Decision: embedded SQLite for P-02. DBOS TypeScript excluded by documented Postgres prerequisite, not an executable comparison. Real Pi integration still needs awaited core events and prefetch control. Model/child proof is synthetic. No production runner/SDK change, database migration, flag enabling, paid/live provider activity or app restart.

Fresh evidence:
- Existing baseline: 248 tests pass, 869 assertions.
- New proof: 22 tests pass, 2448 assertions, 300 repeated SIGKILL cases plus owner/lock checks.
- Independent reviewer storage rerun: 6 tests pass, 158 assertions.
- Packaged fixture: Electron44.2 / Node24.20 / SQLite3.53.4; retained state after SIGKILL, epoch2; lock contention 158.49ms and subsequent write succeeds.
- Server-core typecheck and plan graph pass. Full release suite, remote CI, real Artist OS package and providers are not certified.

Read [T-01 boundaries](evidence/T-01-boundaries.md), [storage proof](evidence/T-02-storage.md), [recovery proof](evidence/T-03-recovery.md), [engine ADR](evidence/engine-decision.md), [rival/fix record](evidence/rival-review.md).

Next scoped work: P-02 entry review and expansion of T-04/T-05 into executable packets against current code. Keep production admission disabled until protected payload storage, actual model/tool barriers, manifest enforcement and associated evidence exist. Do not promote/import the synthetic fixture engine into product execution. Later tasks remain outlined.

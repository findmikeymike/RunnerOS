# Rival Review — P-01

Revision r2 · 2026-09-09. Separate read-only reviewer: `/root/rival_phase1`. Primary agent performed the user-authorized fixes.

## Scope

New durability fixtures and r2 packet only; unrelated campaign-deletion/SessionManager work excluded. Reviewer independently reproduced all findings.

## Confirmed findings and fixes

1. **High: approval undid Pause.** Same decision with a new command ID set running. Fixed: approval only resolves waiting-approval; first and repeated decisions preserve Pause. Regression proves no child work begins.
2. **High: restored backup initially allowed dispatch.** A separate disable call left a runnable window. Fixed: mark staging backup disabled before atomic publication. Immediate and reopened claims fail without a caller-side disable step.
3. **Medium: rollback masked SQLITE_FULL.** SQLite auto-rollback made the catch throw a different error. Fixed: best-effort rollback preserves original error; test now requires full-storage cause.
4. **Medium: admission test missed the transaction.** Old barrier ran before admit. Fixed: kill after run INSERT inside transaction; assert run/events/outbox all absent, 25 times.

## Independent re-review

Reviewer reran storage-process.test.ts: **6 passed, 158 assertions**, including 25 mid-transaction and 25 after-commit kills. Independent repros confirm first and fresh-command-ID repeated approvals preserve Pause. Inspected backup publication ordering. Verdict: **all four findings closed; no remaining blockers in these fixes**.

## Limits / verdict

Accept isolated prototype proof only. Reviewer did not rerun packaged Electron/full combined recovery suite; parent evidence is in T-02/T-03. Production integration, PID boot identity, concurrent child budgets, complete fault/release matrix and live providers remain unverified. No product app restart or commit.

## Final exit gate

Reviewer identified one missing required experiment during exit review: bounded lock contention in packaged Electron. Added a second SQLite connection, asserted a busy error within the bound, released the lock, and verified the write succeeds. Actual packaged result: **158.49ms, recoveredWrite=true**. Reviewer inspected the code and fresh log and explicitly accepted **P-01 isolated architecture proof**. All four defects and this verification gap are closed. P-02 planning is next; no product/provider certification is implied.

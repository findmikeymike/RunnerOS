# Social execution outcomes integrated into main

Source: uncommitted social outcome work in `codex/social-execution-outcomes` at `eee1fce12`.
Target: canonical main after Manager General consolidation `68a437dca`.

Transferred only the browser/provider execution boundary, shared uncertainty error, runner persistence handling, and their regression tests (seven files). The source worktree was left unchanged. Its older settings, package-export and test-fixture corrections were excluded; no other branch was merged.

- After a publish attempt, a missing or failed receipt becomes `execution-uncertain` rather than a safely repeatable failure.
- Failure to save a verified receipt also becomes uncertain.
- Postiz proof must match the new internal post ID; older matching captions/accounts are insufficient.
- Browser stale-success cleanup has a separate timeout budget.
- Existing approvals, route selection, and duplicate suppression stay in effect.

Validation on current main: 122 browser/provider/route/runner tests and 71 shared contract/RPC/input-supply tests pass. Includes fresh-runner scans without resubmission. All package typechecks pass.

No live publishing or app restart performed. Live platform DOM/provider acceptance remains unverified. Scheduling and steering integration are still separate pending slices. The original social branch retains its unfinished files for ownership/history; do not apply it wholesale again.

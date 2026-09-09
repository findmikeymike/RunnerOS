# State of Play: Signals findings

Date: 2026-09-08

## Scope

Third slice: supply real, validated Signals findings to the manager briefing and
its on-demand intelligence lookup. Recommendation ranking is unchanged.

- Reuse the Signals reader's final-publication, metadata, content-hash, safe-file
  and synthesis validation. Reading State of Play never runs reconciliation or
  requests provider work.
- Collect at most three findings from bounded recent report history, with both
  tracks represented when available. The brief keeps at most two Signals findings
  within its existing three intelligence items and 8,000-character budget.
- Keep report references, dates and coverage labels. Signals does not supply a
  confidence score, so the brief does not manufacture one.
- Shared Intel remains available. Full research stays in the report and can be
  retrieved using the existing Signals lookup tool.
- Refresh the affected manager briefs after terminal report metadata is saved,
  closing the gap between workflow completion and final publication.
- The manager's source links open Signals. No dashboard redesign is included.

## Verification

- Main discovery suite: 8,896 passed, zero failed. Ten skips: nine protected-skill
  cases replayed by the isolated Artist OS group; one optional installed CUA
  driver contract remains skipped.
- All 27 isolated groups: 374 passed, zero failed. Total: 9,270 passing test
  executions across the main and isolated runs.
- After the final reader-module extraction, reader/collector regressions were
  rerun: 45 passed. Server-core typecheck and the main build also passed again.
- Shared, server-core and Electron typechecks passed; Artist OS main and renderer
  builds passed. `git diff --check` passed.
- Independent review cleared the final change. Fixed observer-error isolation
  after successful publication and stale partial-report coverage contamination.
- No app restart, live Electron inspection, or paid/provider execution. Automated
  evidence does not certify live provider behavior.

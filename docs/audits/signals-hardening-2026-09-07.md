# Signals Review Hardening

Base: `main` at `94b80fcbd`. Worktree: `/tmp/artist-os-signals-hardening`.
Branch: `codex/signals-review-hardening`. No app restart or live provider calls.

## Changes

- Raw HTML no longer enters the shared Markdown renderer. Normal Markdown,
  math, plan file links, collapsible sections, and existing rich preview controls
  remain available. Signals readers and report Outputs additionally restrict
  local/app URLs and resource-backed preview fences.
- Handoff lookup errors and action errors are separate. Poll success cannot erase
  a failed action, and processing changes no longer reset an in-progress review.
- Failed report-idea lookups show a compact retry action; an empty successful
  response remains an ordinary empty state.
- Workspace events respect the Signals mutation guard, and starting work
  invalidates older refresh responses.
- Native YouTube tools resolve only from explicit host roots or verified dev
  launch layouts, not arbitrary cwd ancestors. Escaping symlinks are refused.
- Status reconciliation does not admit retries or collect paid provider data.
  Explicit workflow retry still recovers after repeated pre-admission crashes,
  through bounded, validated persisted retry lineage.
- Native installation, permissions, and malformed-output failures have distinct
  safe diagnostics without exposing subprocess output or credentials.
- Writes exceeding the existing 64 MiB UTF-8 journal limit fail before replacing
  history or writing new evidence sidecars. No report, receipt, or ledger pruning.

## Verification

- `bun run test`: 8,905 passed, one skipped, zero failures, including isolated suites.
  Initial sandboxed run was stopped after local socket/fixture permission failures;
  the successful full run had the required local test permissions.
- `bun run typecheck:all`: passed with the repository's workspace-specific
  dependency versions available in the isolated worktree.
- `bun run --cwd apps/electron build:main`: passed.
- `bun run --cwd apps/electron build:renderer`: passed; existing chunk-size warnings.
- `PLAYWRIGHT_CHANNEL=chrome bun run test:signals-ui`: 11 real React/Chromium checks
  covering ordinary chats, lookup failure/recovery, persistent action errors,
  processing changes, late responses, detach retry, idea retry, mutation events,
  and keyed workspace switching. The fixture uses no live app or provider.
- `bun test ./packages/ui/src/components/markdown/__tests__/safe-mode-rendering.isolated.ts`:
  17 passed, including full component rendering and both document-overlay branches.
- `git diff --check`: passed.
- Independent cross-reviews found no remaining meaningful issues in the changed
  backend or renderer paths. The backend reviewer additionally reran 66 focused
  tests (536 assertions); the UI reviewer reran the 11 browser checks.

For browser tests on another host, install the declared Playwright dependency and
its Chromium browser (`bunx playwright install chromium`), then run
`bun run test:signals-ui`. `PLAYWRIGHT_CHANNEL=chrome` uses an installed Chrome in
a separate temporary headless profile, never the artist's browsing profile.

## Deliberately Not Expanded

Multiprocess shared-workspace locking and indexed historical archival remain
separate architecture work. Deleting old records would damage idempotency,
coverage, and source receipts. The V1 size guard preserves existing data instead.
The original review's whole-history evidence-rehash claim and current-screen
workspace Busy deadlock claim were not supported by the actual implementation.

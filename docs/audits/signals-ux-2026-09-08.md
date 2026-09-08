# Signals UX Clarity

## Scope

Worktree: `/tmp/artist-os-signals-ux`, branch `codex/signals-ux-clarity`.
Base: main `25c636ba9`. No live app restart, provider runs, or landing performed.

The old page mixed legacy channel setup, new track controls, recurring scheduling,
one-off reviews, reports, and an unexplained saved-nuggets selector.

## User Journey

1. Industry and Your World remain separate research/report tracks.
2. Channels & schedule opens one shared editor with both tracks. Each track keeps
   its own draft, channels, weekly switch, limits, and explicit Save action.
3. Scan now runs saved sources immediately. Review videos creates a one-off report
   from up to ten video links without editing channels or weekly scheduling.
4. Reports are the default view. A report selector appears only with multiple reports.
   Saved insights is a separate destination for excerpts, using the existing data slug.
5. The empty view has a useful next action; full reader, briefing audio, idea handoff,
   source output, and excerpt saving remain wired through their existing paths.

## Safety And Review

- Existing schedule CAS, timing, permissions, snooze, workflow approval, and rollback
  logic remain in the existing save transaction. Save now returns the persisted
  revision so a second save in the open dialog uses the correct revision.
- Channel URLs and imported legacy rows resolve canonical IDs before being saved.
  Canonical duplicates fail explicitly; opening setup does not require a provider.
- Dirty edits survive track switches and require confirmation before discarding.
- Invalid legacy Industry settings block only Industry saving, never Your World.
- Failed legacy migration offers a provider-free pause of the exact existing matcher.
  Missing/replaced schedules and ambiguous matches fail; no automatic retry or rewrite.
- Industry can still run website research with zero YouTube channels. Only Your World
  requires a channel before scanning or enabling weekly work.
- Independent source review caught and fixed empty-Industry restrictions, a missing
  matcher falsely reporting pause success, and stale pause confirmation after re-enable.

## Verification

- Shared typecheck: `bun run typecheck` passed.
- Electron typecheck: `bun run tsc --noEmit` in `apps/electron` passed.
- Renderer build: `bun run electron:build:renderer` passed (existing chunk/deprecation warnings).
- Focused Signals/helper/chrome tests: 55 passed, 0 failed, 526 assertions.
- `PLAYWRIGHT_CHANNEL=chrome bun run test:signals-ui`: 13 checks passed.
- `PLAYWRIGHT_CHANNEL=chrome bun scripts/test-signals-setup-ui.ts`: 42 checks passed,
  covering real React controls and app styles at 1280x900 and 390x844.
- `git diff --check` passed.

The new browser suite uses the actual Signals panel, dialogs, hooks, and channel
validation. Electron/provider APIs are fixtures; ancillary audio, Markdown, full-reader,
and navigation surfaces are stubbed. It does not prove live provider collection or
Electron deployment. No real artist data, paid tools, or schedules were changed.

Screenshots inspected: `/tmp/signals-ux-page.png`, `/tmp/signals-ux-settings.png`,
and `/tmp/signals-ux-settings-mobile.png`. The settings have readable full-width name
and URL rows, no nested channel cards or priority badges, and visible footer actions.
No viewport overflow or runtime page errors were observed in the tested states.

## Landing

User authorized the scoped Signals commit. Landing remains separate. Catch up from current main,
rerun the required integration checks, and land only the scoped Signals files.
Do not include the other task's dirty chat/steering changes or restart its live app.

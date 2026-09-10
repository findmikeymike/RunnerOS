# P-03 live desktop smoke — 2026-09-09

Source: canonical Artist OS `main`, commit `f0c4955d3`, plus the safe-relaunch fix recorded with this evidence. User explicitly authorized app launch and smoke testing. Existing `~/.artist-os` profile; unpackaged canonical Electron development mode, not packaged release. Full `electron:build:artist-os` succeeded. Durable host enabled only for these launches using `CRAFT_DURABLE_READ_HOST=1`.

## Passed live

- Correct canonical renderer path and Artist OS window; Settings → App → Behavior shows Development access.
- HQ, Workers, workflow library, Recent runs, campaign Release Kit, Creative Lab and Signals render and navigate. No provider job, scan, publishing or content edit was started.
- Production Electron safeStorage successfully created/opened the durable host: actual process held SQLite/WAL handles under the existing profile; envelope/database permissions were 0600. No key or credential contents were printed.
- Through the existing authenticated renderer API, listWorkflowAttention returned count 0. A pause probe against a guaranteed nonexistent run returned durable-run-not-found, confirming actual durable service routing rather than an absent optional service. No run was created or mutated.
- Normal Cmd+Q completed cleanup and exited with code 0. Reopening succeeded with existing protected journal storage.
- Fixed app:relaunch was invoked through the real renderer API. Cleanup completed before native relaunch; the actual app returned to canonical HQ. Developer tools closed; app left open.

## Bug found and fixed

`app:relaunch` called app.exit directly, bypassing durable cleanup. It now waits for the shared shutdown cleanup, schedules restart only after success, restores retry state on failure and coalesces simultaneous requests. Two new regression tests plus three existing shutdown tests passed (5 tests / 14 assertions); Electron typecheck and main rebuild passed. The fix and this evidence are recorded together; verify git log for the commit.

## Not certified by this smoke

The visible workflow run list/get/detail pages still use legacy run.json. They do not expose genuine durable-only approval/recovery controls. Live durable approval, interruption recovery and active-child shutdown are therefore not claimed from UI navigation; automated subprocess evidence remains separate. P05 needs durable projections/list/get and route-aware detail/control wiring. No live remote-provider read/write proof or packaged-release licensing/safeStorage journey was performed.

Nonblocking observations: shell environment lookup timed out on one startup but the app recovered; development console showed the missing localhost:8097 devtools endpoint and a blocked embedded font under existing CSP. One reopen restored the prior Signals page before manual Overview navigation; final relaunch returned to HQ. These were not treated as durability passes or silently changed.

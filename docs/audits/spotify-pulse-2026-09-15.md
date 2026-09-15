# Spotify Pulse — September 15, 2026

## Implemented

Artist HQ manual Pulse and the fresh-snapshot automation path now use a deterministic desktop reader, rather than an LLM deciding every browser action. The reader uses the existing saved Spotify browser profile and verifies the exact Artist HQ artist URL before accepting each page.

- Read Home, save exact streams/listeners and reporting window, publish the widget immediately.
- Read Location and Songs once each; save up to five countries, cities, and songs for the same window; publish again.
- Wait for stable rendered counts, including Spotify's temporary zero counters; expand spanning city-table headers correctly.
- Bound page collection and total work, reject concurrent refreshes, respect cancellation, preserve published core when enrichment fails, and retain browser ownership while timed-out operations drain.
- Save unique snapshots without overwriting earlier captures. Preserve verified artist identity in normalized data.
- Refetch workspace context after publication even if an older request is still pending. Show countries and hide unavailable metric placeholders; preserve date-only labels across time zones.

No login, connected-service configuration, or existing user snapshot was replaced. Two zero-placeholder snapshots generated during this smoke test were retained in that test session's `data/rejected-placeholder-snapshots` folder, outside performance history.

## Live evidence

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`, existing `~/.artist-os` profile, durable read host enabled.

- `260915-ivory-dusk`: completed in **13.809 seconds**.
- `260915-polished-valley`: repeat refresh after a final rebuild/restart completed in **12.112 seconds**, with the same exact headline values and all fifteen breakdown rows. Existing data and login survived restart. Final log: `/tmp/artist-os-pulse-final-live.log`.
- Saved **179,642 streams**, **81,259 listeners**, **28-day window**.
- Saved five tracks, five cities, five countries. Visually checked the actual analysis panel, including Doin' Me (52,040), London (1,317), and United States (39,059).
- The already-mounted HQ widget changed automatically to 180K streams / 81K listeners; no route reload or manual context write.
- Log: `/tmp/artist-os-pulse-native-live3.log`.

Earlier live failures identified mixed Home reporting windows, animated zero placeholders, and city-header column spans; those cases now have focused regressions.

## Verification boundary

Full regression run: **59 test processes passed, zero failed** (`/tmp/artist-os-pulse-final-regression2.log`). Server/Electron typechecks and final Artist OS lint/build/asset validation passed. The final display-only cleanup was additionally typechecked, built, and visually smoke-tested.

Focused tests cover parsing, stable loading, publisher failure, cancellation, duplicate admission, immutable snapshots, and the real SessionManager publication path without model calls. Existing browser-manager and renderer context-refresh tests also cover the supporting fixes.

This is local feature verification, not an app-wide release certification. Weekly scheduling was left off; it shares the corrected fresh-snapshot execution path, but an actual scheduled tick was not enabled or waited for. Multiple-profile selection and signed-out recovery are tested failure paths, not additional live account smoke tests.

Live verification preceded the Spotify fixes commit; consult Git history for the commit.

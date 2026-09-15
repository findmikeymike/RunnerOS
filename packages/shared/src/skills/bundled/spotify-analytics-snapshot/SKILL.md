---
name: spotify-analytics-snapshot
description: Save Spotify Pulse core metrics immediately, then add matching-window top locations and tracks within one bounded refresh.
---

# Spotify Analytics Snapshot

Current Fresh Snapshot contract: **core first, useful breakdowns second**, within one shared **120-second budget**. This overrides older instructions to collect chart history or every metric.

1. From the injected Printing Press Social absolute Local path, resolve the saved Spotify profile using `node src/social.mjs catalog --json`. Attach `browser_tool profile spotify <id> --foreground`. Run `node src/social.mjs profile status spotify --profile <id> --live --json` once and verify matching account/artist using its documented check.
2. Request `node src/social.mjs snapshot spotify --profile <id> --json` once for the flat capture schema. Read exact streams, listeners, and displayed reporting window on **Spotify for Artists Home overview**.
3. Immediately **Write** the flat capture inside the exact absolute `dataFolderPath` from `<session_state>`. Normalize from the source Local path:

```bash
node src/social.mjs snapshot spotify --profile <id> \
  --capture-file <absolute-session-data-file> \
  --workspace <absolute-current-workspace-path> --json
```

Use the workspace path in session context, not an assumed environment variable. Omit `--out` for a unique append-only filename. The server publishes this core snapshot to `artist-spotify-snapshot` immediately; do not call `context_write`.

4. **After core save succeeds**, visit **Audience Location once** for up to five countries/cities and **Music Songs once** for up to five tracks. Verify each page's displayed reporting window matches the core window before combining. Do not change ranges, paginate, inspect charts, or hunt extra pages. Omit any breakdown with a mismatched or unavailable window.
5. Write a second full capture into another session data file, retaining the original core values and adding only matching-window `topCountries`, `topCities`, and `topTracks`. Normalize as a second new snapshot, then stop. Never overwrite the first snapshot. Briefly summarize saved metrics/breakdowns and any missing data.

## Capture contract

Follow the returned plan's schema. `streams` and `listeners` are top-level fields, never nested under `metrics`. Track rows belong to **`topTracks`**, not `tracks`. The selected profile supplies artist identity. Do not copy placeholder zero values: use observed numbers, null for missing metrics, empty arrays for uncollected breakdowns. Keep the original core values and reporting window in the enriched capture.

## Stop rules

- **An extra page fails once:** preserve the saved core snapshot, explain the missing breakdowns, and end.
- **One shared 120-second budget:** stop collection in time to save enrichment. If time expires, keep core and end. Do not start a new budget after the first save.
- Failed setup/core command: correct its error and retry once, then stop with the exact issue. Blank Home: foreground the attached browser and retry loading once. Never loop malformed tool calls.
- Missing login, wrong artist/account, or no observable core metric: stop with the exact issue. Do not fabricate a success. Verified identity and at least one core metric are required for a partial core save.
- Never collect followers, saves, daily/monthly histories, playlists, or source-of-streams during this refresh. Leave those optional fields null/empty. No estimates, network inspection, or undocumented APIs.
- Write only inside session `dataFolderPath`; no shell redirection or workspace capture writes. Browsing is read-only. Never modify permissions or past snapshots.

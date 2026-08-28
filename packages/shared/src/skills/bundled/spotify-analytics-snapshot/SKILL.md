---
name: spotify-analytics-snapshot
description: Weekly Spotify snapshot into Artist HQ context, captured from the artist's connected Spotify for Artists browser session. Private streams, listeners, followers, saves, top cities, and source-of-streams come from the logged-in browser — there is no Spotify API path.
---

# Spotify Analytics Snapshot

Use this skill on the weekly Spotify heartbeat, or when the user wants a fresh read of the artist's Spotify presence. All data comes from **Spotify for Artists** through the artist's connected, logged-in browser session, using RunnerOS browser tools. There is no API lane and no client credentials.

## Prerequisites

- The Spotify account is connected in Settings → Spotify (one saved account covers Spotify for Artists and the web player).
- Run `social` commands (`node src/social.mjs ...`) from the Printing Press Social source path.

## Workflow

1. Verify the session first — never guess numbers when it is missing or the account does not match:

```bash
node src/social.mjs profile status spotify --profile <id> --live --json
```

2. Get the browser plan and the exact fields to capture:

```bash
node src/social.mjs snapshot spotify --profile <id> --json
```

3. Run the returned `browserPlan` against the verified Spotify for Artists session with RunnerOS browser tools. Read only what is visible: streams, listeners, followers, saves, the reporting window, top cities/countries, top tracks, and source-of-streams. Save the observed values as JSON under `$CRAFT_WORKSPACE_PATH/data/spotify/captures/`.

4. Normalize and save the captured numbers:

```bash
node src/social.mjs snapshot spotify --profile <id> \
  --capture-file "$CRAFT_WORKSPACE_PATH/data/spotify/captures/<YYYY-MM-DD>.json" \
  --workspace "$CRAFT_WORKSPACE_PATH" --json
```

The default output is `data/spotify/snapshots/<YYYY-MM-DD>-s4a.json` inside the explicit workspace. Relative `--out` paths are also workspace-relative. Existing snapshots are immutable and finalization fails closed if the target already exists.

5. Write the returned `contextPayload` as the `artist-spotify-snapshot` context doc.
6. Run `delta-brief.ts` only when there are two comparable snapshots of the same data source.

## Output Contract

```json
{
  "version": 1,
  "dataSource": "spotify-for-artists-browser",
  "snapshotDate": "2026-07-08",
  "windowDays": 28,
  "artist": { "name": "...", "spotifyUrl": "...", "profile": "..." },
  "metrics": { "streams": 0, "listeners": 0, "followers": 0, "saves": 0 },
  "geo": { "topCities": [], "topCountries": [] },
  "tracks": [{ "name": "...", "streams": 0, "spotifyUrl": "..." }],
  "sources": {},
  "partial": false,
  "errors": [],
  "updatedAt": "ISO timestamp"
}
```

Any metric not visible on the page is `null`, and the snapshot is marked `partial: true` with the missing fields listed in `errors`. If the reporting window is unavailable, `windowDays` is also `null`. If the capture date is unavailable or invalid, finalization uses today's date only for safe file ownership and records that fallback in `errors`.

`delta-brief.ts` discovers legacy `<date>.json`, API `<date>-web-api.json`, and browser `<date>-s4a.json` snapshots. It compares only compatible data sources/reporting windows and treats missing rates, playlists, tracks, sources, or metrics as unavailable rather than zero.

## Failure Handling

- Session not connected / not logged in / wrong account → stop and point the user to Settings → Spotify. Do not fabricate.
- Spotify for Artists page did not load a value → capture it as `null`, mark `partial`.
- Login expired → stop, report, do not retry blindly.
- No prior snapshot → snapshot still writes; the brief reports "no prior snapshot, no delta."

## Never

- Never fabricate streams, listeners, followers, saves, cities, tracks, or source percentages.
- Never modify a past snapshot. Snapshot writes fail closed when the target already exists.
- Never bypass approvals — this skill is read-only.
- Never silently drop a tracked playlist feature; surface its disappearance as an anomaly.

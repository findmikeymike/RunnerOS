---
name: spotify-anomaly-watch
description: Daily check on existing Spotify snapshots. Flags real anomalies — sustained metric drops, playlist removals, region issues — without scraping anything new. Severe anomalies route to the artist-ceo inbox.
---

# Spotify Anomaly Watch

Use this skill on a daily heartbeat. It does **not** scrape Spotify — it reads existing snapshots and computes anomalies. Cheap, fast, runs every day even if no new snapshot landed.

## Inputs

- `data/spotify/snapshots/<date>.json`, `<date>-web-api.json`, or `<date>-s4a.json` — at least one snapshot. Two compatible snapshots from the same data source/reporting window are required for trend detection.

## Workflow

```sh
"${CRAFT_BUN:-bun}" "${CRAFT_GLOBAL_SKILLS_DIR:-$HOME/.agents/skills}/spotify-anomaly-watch/scripts/watch.ts" \
  --snapshots-dir data/spotify/snapshots \
  --alerts-dir data/spotify/alerts \
  --ceo-inbox data/spotify/artist-ceo-alerts.md
```

The script:

- Reads the latest snapshot plus up to 3 compatible priors. Missing optional metrics are skipped, not treated as zero.
- Computes deltas and flags:
  - **Stream drop** ≥30% sustained over 2 consecutive snapshots → severe.
  - **Listener drop** ≥30% sustained over 2 → severe.
  - **Save rate drop** ≥20% sustained over 2 → moderate.
  - **Skip rate spike** ≥20% sustained over 2 → moderate.
  - **Playlist removal** when a playlist with ≥100 listeners disappeared from two snapshots that both captured `playlistsDriving` → severe and worth investigating.
  - **Track disappearance** when a top-3 track is missing from the latest snapshot → moderate.
  - **Editorial dependency growth** when editorial-share grew >10pts in two snapshots → informational (not bad, but watch durability).
- Writes `data/spotify/alerts/<YYYY-MM-DD>.md` with all findings categorized by severity.
- For each **severe** finding, appends a timestamped block to the configured artist alert file.
- Returns a JSON summary on stdout.

## Severity Definitions

- **Severe** — needs CEO attention this cycle. Auto-escalated to artist-ceo inbox.
- **Moderate** — track but does not escalate.
- **Informational** — pattern shift worth noting, not a problem.

## Failure Handling

- 0 snapshots → exit cleanly with a "no data" message.
- 1 snapshot → write a baseline alert file noting "first snapshot, no priors to compare."
- Snapshots from a different data source/reporting window → retain the latest as a baseline instead of creating a false delta.
- Missing optional metrics, tracks, playlists, or source fields → skip those checks without emitting `NaN` or fabricating zeroes. Preserve any `partial` alert from the snapshot.
- Snapshot files malformed → skip the bad file, continue with remaining, surface the parse error in the alert.

## Idempotency

The script overwrites `alerts/<today>.md` on each run (so the latest run always reflects current data). The CEO inbox append is **not** automatically deduped — if you run twice in a day, the CEO sees two blocks. That's a feature: each block is timestamped and a re-run usually means new data landed.

## Never

- Never scrape. This skill works from existing snapshots.
- Never silence an anomaly. If a metric crashed, surface it.
- Never invent thresholds. Use the configured defaults above or explicit CLI overrides.

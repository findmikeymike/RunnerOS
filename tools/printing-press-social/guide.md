# Printing Press Social

This file lives in the bundled Printing Press Social CLI root. Use the directory
containing this guide as the working directory. Never search for another
RunnerOS checkout or substitute a different copy of this tool.

## Start here

```bash
node src/social.mjs catalog --json
node src/social.mjs doctor --json
```

The catalog is the non-secret source of truth for saved account sets and exact
`platform/profile` references. Browser work must attach the matching saved
session with `browser_tool profile <platform> <profile>` before navigation.

## Spotify for Artists

Spotify analytics are browser-only. There is no public API fallback.

```bash
node src/social.mjs profile status spotify --profile <profile> --live --json
node src/social.mjs snapshot spotify --profile <profile> --json
```

The live status and snapshot calls return guarded browser plans. Run them
against the exact saved Spotify browser profile, verify the visible account,
and record only values actually visible in Spotify for Artists. Use `null` for
unavailable metrics.

For routine Pulse, verify the artist and collect exact HOME overview streams,
listeners, and its displayed reporting window. Save and normalize this core capture
BEFORE secondary navigation. Within the remaining two-minute budget, visit one
Location page for up to five countries and five cities, then one Songs page for up
to five tracks. Include rows only when the displayed reporting window matches core.
Skip unavailable, mismatched, or rounded counts; no pagination, charts, history,
followers, saves, or source collection. If breakdowns are captured, save and normalize
a second full capture retaining all core values plus the new optional rows. Otherwise
keep the first snapshot; unavailable breakdowns do not make valid core partial.

Use the Write tool to save one JSON capture in the current session data folder
(under the workspace sessions directory). This also works in safe mode; do not use
shell redirection to write the capture. Then normalize it:

```bash
node src/social.mjs snapshot spotify --profile <profile> \
  --capture-file "<absolute-session-data-folder>/spotify-capture-<unique>.json" \
  --workspace "$CRAFT_WORKSPACE_PATH" --json
```

Write the returned `contextPayload` to Artist HQ context slug
`artist-spotify-snapshot`. Default snapshot filenames are unique, so repeated same-day refreshes work.
Snapshots are append-only; never overwrite a prior
capture or fabricate streams, listeners, followers, saves, cities, tracks, or
source percentages.

## Other supported platforms

Instagram, TikTok, X, and YouTube use the same catalog-first, exact-profile
rule. Dry-run any post, comment, DM, upload, or Spotify playlist action before
the guarded browser handoff. Never treat a delegated browser plan as completed
work.

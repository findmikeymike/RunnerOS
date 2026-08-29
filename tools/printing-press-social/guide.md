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

Save one capture inside the workspace, then normalize it:

```bash
node src/social.mjs snapshot spotify --profile <profile> \
  --capture-file "$CRAFT_WORKSPACE_PATH/data/spotify/captures/<date>.json" \
  --workspace "$CRAFT_WORKSPACE_PATH" --json
```

Write the returned `contextPayload` to Artist HQ context slug
`artist-spotify-snapshot`. Snapshots are append-only; never overwrite a prior
capture or fabricate streams, listeners, followers, saves, cities, tracks, or
source percentages.

## Other supported platforms

Instagram, TikTok, X, and YouTube use the same catalog-first, exact-profile
rule. Dry-run any post, comment, DM, upload, or Spotify playlist action before
the guarded browser handoff. Never treat a delegated browser plan as completed
work.

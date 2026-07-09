---
name: printing-press-spotify
description: Operate Spotify through a reused, logged-in browser session — capture Spotify for Artists analytics and create playlists on the Spotify web player. Use when the user wants a Spotify snapshot/analysis, a playlist built on their real account, or Spotify account setup. No Spotify API; everything runs through the RunnerOS browser session for the connected Spotify account.
---

# Printing Press Spotify

One Spotify login (stored like the other social accounts, with its own browser session) covers **both** surfaces:
- `open.spotify.com` — the web player, used to create playlists and add tracks.
- `artists.spotify.com` — Spotify for Artists, used to read private stats.

There is no Spotify API path. Every action runs through the account's verified browser session using RunnerOS browser tools.

## Setup

1. Connect a Spotify account in Settings → Social Accounts (platform: `spotify`). Set the handle to the artist name and the account URL to the public artist page (`https://open.spotify.com/artist/<id>`).
2. Log in once at Spotify for Artists in that session — the same session covers the web player.
3. Verify before any work: `node src/social.mjs profile status spotify --profile <id> --live --json`.

## Analyst snapshot (Spotify for Artists)

Two-step, because the browser reads the page and feeds numbers back:

```bash
# 1. Get the plan + the exact fields to capture:
node src/social.mjs snapshot spotify --profile <id> --json
# 2. Run the returned browserPlan against the verified session with RunnerOS browser tools,
#    save the observed capture JSON in the workspace, then normalize + save:
node src/social.mjs snapshot spotify --profile <id> \
  --capture-file "$CRAFT_WORKSPACE_PATH/data/spotify/captures/<date>.json" \
  --workspace "$CRAFT_WORKSPACE_PATH" --json
```

Rules:
- Only record numbers actually read from the page. Use `null` for anything not visible. Never estimate or fabricate streams, listeners, followers, saves, cities, or source percentages.
- Every metric carries its snapshot date and window.
- Missing or invalid dates/windows are marked partial; an unavailable window remains `null`.
- Default and relative outputs stay under the workspace. Existing snapshot files are never overwritten.
- After saving, write the returned `contextPayload` as the `artist-spotify-snapshot` context doc.

## Playlist create (Spotify web player)

```bash
# Plan first (always dry-run and show the track order for approval):
node src/social.mjs playlist spotify create --profile <id> --name "<mood/scene name>" \
  --tracks "spotify:track:...,spotify:track:..." --visibility public --dry-run --json
# Save the full dry-run JSON. After explicit approval of that exact action:
node src/social.mjs execute --action-file <dry-run-result.json> \
  --expected-action-id <act_...> --expected-action-digest <sha256:...> --confirm yes --json
```

Rules:
- Use only real `spotify:track:<id>` URIs or `open.spotify.com/track/...` links. Never invent track IDs.
- Name by mood/scene/vibe. Artist-bait names ("radio", "songs like …") are rejected.
- Direct live playlist commands are refused. The guarded execute handoff binds approval to the saved dry-run action id and current profile identity.
- A delegated result is a browser plan, not completion. The browser must confirm the visible account and exact approved payload before creating anything.
- After observing the resulting playlist URL, finalize the durable receipt with `social playlist spotify receipt` using the same action file/id/digest, the observed URL, and fresh non-secret verification evidence. Only a successful receipt counts as completion and enables safe deduplication.
- Featuring the playlist on the artist profile (Spotify for Artists) is a later step, not part of create.

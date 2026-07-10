---
name: spotify-playlist-curator
description: Deterministically build and validate Spotify adjacency playlist plans before guarded browser creation through Printing Press Social.
---

# Spotify Playlist Curator

Use this skill when the artist wants a Spotify playlist that creates tasteful adjacency: bigger comparable artists set the lane, and the artist's songs are placed naturally inside that emotional pocket.

Use the `playlist-builder` skill first for peer/anchor strategy, overlap evidence, track selection, packaging, honest expectations, and anti-artificial-streaming doctrine. This skill turns those choices into a validated, reproducible order.

## Core Rule

Plan first. Never create or modify a Spotify playlist until the user approves the exact playlist title, description, visibility, track order, and artist-track placements.

## Bounded discovery

When comparable tracks are missing, use Printing Press Social before planning:

```bash
node src/social.mjs playlist spotify discover --profile <profile> --theme "<theme>" --seed "<artist-or-track>" --mode growth --workspace "$CRAFT_WORKSPACE_PATH" --json
```

Follow the returned browser plan and feed one compact capture back with `--capture-file`. The command caps work at four seeds, three source pages per seed, 100 raw candidates, and a deterministic 25-track shortlist. Reuse its cache unless the user requests `--refresh`. Give the model only the shortlist, never the full raw pool.

## Inputs

- Comparable big artists and tracks in the same lane.
- The artist's own Spotify track IDs.
- A mood/scene title for the playlist.
- Target length, usually 25-30 tracks.
- Featured-artist ratio, usually 15-25%.

Expected JSON files:

```json
{
  "comparableTracks": [
    {
      "spotifyArtistId": "artist-id",
      "artistName": "Comparable Artist",
      "tracks": [
        { "id": "track-id", "name": "Track Name", "durationMs": 0, "popularity": 0 }
      ]
    }
  ]
}
```

```json
{
  "ourTracks": [
    { "id": "track-id", "name": "Our Song", "durationMs": 0, "preferredFeatureWeight": 1 }
  ]
}
```

## Build A Plan

```sh
"${CRAFT_BUN:-bun}" "$HOME/.agents/skills/spotify-playlist-curator/scripts/build-plan.ts" \
  --comparable-tracks data/spotify/comparable-tracks.json \
  --our-tracks data/spotify/our-tracks.json \
  --theme "Drive Home Slow" \
  --target-length 28 \
  --our-ratio 0.20 \
  --our-artist-name "Artist Name" \
  --out data/spotify/playlist-plans/drive-home-slow.json
```

The planner:

- Uses only provided Spotify track IDs.
- Spreads the artist's tracks through the playlist.
- Avoids same comparable artist back-to-back where possible.
- Keeps an anchor in slot 1 and the strongest artist track in slot 2.
- Uses BPM, energy, and key metadata for smoother transitions when supplied.
- Rejects malformed/duplicate Spotify track IDs and never repeats artist tracks.
- Writes JSON plus a readable Markdown review file.

## Apply Gate

After user approval:

```sh
"${CRAFT_BUN:-bun}" "$HOME/.agents/skills/spotify-playlist-curator/scripts/apply-plan.ts" \
  --plan data/spotify/playlist-plans/drive-home-slow.json \
  --apply \
  --confirm
```

This writes an apply checklist. Create the playlist through the bundled Printing Press Social Spotify browser action only after approval:

```sh
node src/social.mjs playlist spotify create --profile <profile> --name "<name>" --description "<description>" --tracks "<spotify-uri-list>" --visibility public|private --dry-run --json
```

Save the dry-run JSON. Run `social execute` with its exact action ID and approval digest. Browser completion is not final until `playlist spotify receipt` records the observed Spotify playlist URL with fresh matching-account evidence.

## Naming Discipline

Allowed:

- Mood: "Drive Home Slow", "Confession Hour"
- Scene: "Brooklyn Night Walk", "Bedroom Pop Afterparty"
- Vibe: "Sad and Soft", "Heart Open"

Avoid:

- "Songs Like [Big Artist]"
- "[Big Artist Song] Radio"
- Misleading titles that imply another artist owns or endorsed the playlist.

## Never

- Never invent Spotify IDs.
- Never imply Spotify editorial placement.
- Never promise streams, followers, algorithmic boosts, or playlisting outcomes.
- Never create, publish, or edit a playlist without explicit approval in the current conversation.
- Never hide that the artist's tracks are part of the curation.

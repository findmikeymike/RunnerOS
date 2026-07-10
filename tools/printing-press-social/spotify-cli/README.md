# Printing Press Spotify CLI

Standalone binary:

```bash
node src/cli.mjs snapshot spotify --profile artist01 --json
node src/cli.mjs playlist spotify discover --profile artist01 --theme "Late night alternative" --seed "Artist A" --workspace <path> --json
node src/cli.mjs playlist spotify create --profile artist01 --name "Late Night Drive" --tracks "spotify:track:..." --dry-run --json
```

Root workspace binary:

```bash
social snapshot spotify --profile artist01 --json
social playlist spotify discover --profile artist01 --theme "Late night alternative" --seed "Artist A" --workspace <path> --json
social playlist spotify create --profile artist01 --name "Late Night Drive" --tracks "spotify:track:..." --dry-run --json
```

Never run playlist creation live from the platform CLI. Save the dry-run JSON and use the root `social execute` guarded handoff with both its exact action id and approval digest after the user approves it. RunnerOS browser tools execute the plan. After observing the playlist URL, run `social playlist spotify receipt` with the same contract and fresh account-verification evidence; only that durable receipt marks completion and enables deduplication.

Discovery is intentionally bounded: at most 4 seeds, 3 source pages per seed, 100 compact candidates, and a 25-track deterministic shortlist. Repeating the same theme, mode, and seeds reuses the workspace cache unless `--refresh` is supplied.

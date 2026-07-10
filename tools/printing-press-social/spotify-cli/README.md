# Printing Press Spotify CLI

Standalone binary:

```bash
node src/cli.mjs snapshot spotify --profile artist01 --json
node src/cli.mjs playlist spotify create --profile artist01 --name "Late Night Drive" --tracks "spotify:track:..." --dry-run --json
```

Root workspace binary:

```bash
social snapshot spotify --profile artist01 --json
social playlist spotify create --profile artist01 --name "Late Night Drive" --tracks "spotify:track:..." --dry-run --json
```

Never run playlist creation live from the platform CLI. Save the dry-run JSON and use the root `social execute` guarded handoff with both its exact action id and approval digest after the user approves it. RunnerOS browser tools execute the plan. After observing the playlist URL, run `social playlist spotify receipt` with the same contract and fresh account-verification evidence; only that durable receipt marks completion and enables deduplication.

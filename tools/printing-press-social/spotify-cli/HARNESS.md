# Spotify CLI Harness

Part of the Printing Press Social harness. Spotify is a browser-only platform: the CLI plans and gates; RunnerOS browser tools execute against the account's verified, persistent browser session.

## Commands

```bash
social profile add spotify --profile <id> --handle "Artist Name" --account-url https://open.spotify.com/artist/<id> --json
social profile login spotify --profile <id> --json
social profile status spotify --profile <id> --live --json
social profile update spotify --profile <id> --account-url https://open.spotify.com/artist/<id> --json
social profile delete spotify --profile <id> --json

social snapshot spotify --profile <id> --json
social snapshot spotify --profile <id> --capture-json <json> --out <file> --json

social playlist spotify create --profile <id> --name "<name>" --tracks "<uri,uri>" --visibility public|private --dry-run --json
social playlist spotify create --profile <id> --name "<name>" --tracks "<uri,uri>" --confirm yes --json
```

## Model

- Default engine `runner-cdp`: live actions return a delegated result with a `browserPlan` (per-profile browser partition + mandatory account verification + ordered steps). RunnerOS browser tools open the session, verify the visible account, and run the steps.
- Writes default to `require-confirm`, are per-profile locked, and are de-duplicated when an `--idempotency-key` is supplied.
- Reads (`snapshot`) require a browser capture fed back via `--capture-json`; the CLI never fabricates numbers.

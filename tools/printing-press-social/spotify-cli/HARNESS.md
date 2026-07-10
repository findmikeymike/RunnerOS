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
social snapshot spotify --profile <id> --capture-file <capture.json> --out <snapshot.json> --json

social playlist spotify create --profile <id> --name "<name>" --tracks "<uri,uri>" --visibility public|private --dry-run --json
social execute --action-file <dry-run-result.json> --expected-action-id <act_...> --expected-action-digest <sha256:...> --confirm yes --json
social playlist spotify receipt --profile <id> --action-file <dry-run-result.json> --expected-action-id <act_...> --expected-action-digest <sha256:...> --playlist-url <url> --verification-result <verification.json> --json
```

## Model

- Default engine `runner-cdp`: guarded execute returns a delegated result with a `browserPlan` (per-profile browser partition + mandatory account verification + ordered steps). RunnerOS browser tools open the session, verify the visible account and exact approved payload, and run the steps.
- Direct live playlist commands are refused. A delegated plan is never recorded as completed. The guarded receipt command records success only after an observed playlist URL and matching verification evidence, then enables idempotent duplicate protection.
- Reads (`snapshot`) require a browser capture fed back via `--capture-file`; snapshot writes are workspace-scoped and refuse to overwrite existing files.

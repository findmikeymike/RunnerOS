# Signals / Monid live verification — September 16, 2026

Canonical checkout: `.worktrees/main/artist-os`, branch `main`, based on `2f0b27d70` (includes app-wide Monid connection fix `0725ce202`).

## Confirmed and repaired

- Settings cleared its connection result while loading and rendered that unknown state as disconnected. It now shows Checking connection, connected, confirmed disconnected, or retry-check states explicitly. Live UI showed Checking connection followed by connected after restart without another login.
- Signals assumed MCP tools named `inspect`, `run`, and `get_run`. The authenticated live server advertises `monid_inspect`, `monid_run`, and `monid_get_run`.
- Live `monid_run` accepts `input.body`, not a flat actor input.
- The current metadata actor uses `transcriptionAndSubtitle: NONE`; `downloadSubtitles` is absent. Its URL array uses the Apify `requestListSources` editor without an `items` schema. The adapter now supports that contract while retaining single-URL, count, and no-add-on checks.
- Errors now distinguish connection, tool/schema, allowance, and returned-data failures.
- Interactive channel resolution has a 45-second deadline before the generic 60-second RPC timeout. Cancellation preserves submitted run receipts; retries resume known runs without another paid submission.

## Live evidence / remaining blocker

The existing saved app-wide credential authenticated the real MCP connection. No new login was required for the corrected collector.

Saving Industry defaults submitted one Managers Playbook metadata request:

- Run: `01M2NRQKWZ19EY2D8NV7B9P3TR`
- Endpoint: `apify /streamers/youtube-scraper`
- Created: 2026-09-16 18:47:41.958 UTC
- Completed: 18:48:03.936 UTC (about 22 seconds)
- `monid_list_runs` reported COMPLETED, provider HTTP 200, one result, cost $0.0045.
- `monid_get_run` did not return the result through either the application collector or a separate authenticated MCP client; the latter returned MCP request timeout. A direct HTTP MCP probe received HTTP 200 but no completed result before its 20-second deadline.

This proves authenticated collection, not working end-to-end Signals. Result retrieval remains unverified/blocked. Do not present an empty scan as successful, reconnect repeatedly, or start replacement paid runs. Preserve the pending local receipt for recovery.

All five bundled Industry channels remain present and editable. Native channel configuration was not successfully saved; no new native Signals report was produced. The older cancelled workflow warning is historical, not evidence of a new scan.

## Verification

Focused transport/metadata/provider tests, including real advertised tool input schemas, pass. Service tests cover lookup cancellation, late completion, and saved-run retry without a second submission. Server-core typecheck passes. Electron main and renderer builds pass. Live Settings loading-to-connected behavior was observed. Full scan/report/Builder handoff acceptance remains open pending result retrieval.

Final live retry on the rebuilt app returned the descriptive channel-lookup timeout (not the generic RPC error). Exactly one local paid-attempt receipt remained, with the same run ID; no replacement submission was created. Full monorepo typecheck passed; final transport/metadata/provider suite: 49 pass, 324 assertions; isolated service suite: 68 pass, 537 assertions.

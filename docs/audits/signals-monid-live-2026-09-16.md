# Signals / Monid verification — September 16, 2026

Canonical checkout: `.worktrees/main/artist-os`, branch `main`, based on `5b3167c82`.

## Repairs

- Existing app-wide Monid login is reused across Settings and Signals. Connection checks no longer temporarily mean disconnected.
- Metadata submissions use the actual Monid MCP tool names and input schema. Saved run results use Monid’s read-only REST endpoint because the MCP result stream stalled after the underlying job completed.
- Retries preserve saved run IDs and paid-work receipts. Retrieval errors do not cause replacement submissions. The Signals page exposes retry for failed preparation.
- Channel discovery requests ten recent uploads, with two channels collected concurrently. Transcript text is cached and reused.
- Signal Analyst receives plain transcript text once and returns the report directly. No timestamp requirement, proof quotations, or intermediate agent analysis. The single synthesis step has a five-minute limit.
- Exact historical stock workflow definitions upgrade to the single-step version with a preserved original. Customized workflows and saved run snapshots stay intact.

## Live checks

- The existing credential worked after restart without reconnecting.
- All five Industry defaults are saved and editable: Managers Playbook, Viral VSN, No Labels Necessary, Neighborhood Art Supply, and Its21Master.
- Fresh five-channel discovery completed in roughly 85 seconds. Three recent videos were selected; all three cached transcripts were included.
- Plain transcript text reduced those three transcript payloads from roughly 334k to 166k characters. No transcript refetch was needed.
- An initial restart exposed a historical stock migration mismatch (older stock omitted a focus field). That old two-step run was cancelled through the UI; its history and collection receipts remain saved.
- The single synthesis step completed in about 155 seconds. Cached collection before it took about four seconds.
- Live finalization exposed two unnecessary restrictions: website page IDs were excluded despite being supplied to the analyst, and insight summaries required literal repetition in the report. Both are repaired; unknown sources remain rejected.
- Restart recovered the already-completed report without another collector or model call. Signals displayed it automatically; the full-report modal opened correctly. Metadata is ready with 12 findings, 5 ideas, and all 3 examined videos recorded.
- Coverage is honestly partial because several platform pages were unavailable and industry listings did not establish a complete date window. Those limitations do not block useful transcript intelligence.
- Saved run: `b781c6c1-89a5-4ca3-8d3c-edff92af71e3`; output: `63d419c1-5883-4399-8b34-60ec5703c50d`. App remains open on the report.
- This verifies the live Industry path. A separate live Your World scan and voice playback were not run.

## Automated verification

- Full monorepo typecheck passes.
- Main and renderer builds pass.
- Provider and Monid metadata/transcript tests passed.
- Final isolated Signals service suite: 78 pass. Final report-contract and migration suites: 20 pass.
- Retry helper and result-retrieval tests passed, including deadline and cancellation checks.
- Transcript CLI tests: 11 pass.

Prepared for commit and push after the verified live checks above.

## Signals presentation and Active Work follow-up

- Active Work now reconciles recovered success and cancellation from the same persisted workflow attempt. The four stale Signals attention entries cleared in the live app; historical runs remain intact.
- Fixed Tailwind source discovery for renderer features and removed duplicate responsive status text. Live Active Work rows render one readable state.
- Signals retains the orange banner and uses a contained briefing card, grouped Read/Listen actions, collapsed ideas, and one utility menu. Reports explicitly say Saved automatically; optional saved excerpts are called Bookmarks.
- Verified the new layout and options menu in the canonical app. No new research scan or audio generation was needed for these UI checks.
- Scheduler regression suite: 123 pass. Active Work renderer tests: 24 pass. Shared, server-core and Electron typechecks pass; main and renderer builds pass.

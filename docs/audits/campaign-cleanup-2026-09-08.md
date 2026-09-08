# Campaign cleanup

User flow: open a campaign, open **Campaigns → Delete current campaign…**, review retained files, then choose **Keep files & delete campaign**. Cancel and preview never delete campaign data. After successful deletion, affected windows return to HQ and the campaign leaves the menu.

## Retention policy

Kept in **HQ Vault → Past Releases → campaign name**:

- Imported campaign assets and Release Kit files, including copy, lyrics, and documents.
- Audio, video, artwork, creative project files, lyric drafts, and timed captions.
- Entire finished/approved/published output bundles, with supporting files and relative folder structure.
- Business, rights, credits, and saved documents outside the app's known working-data stores.
- A release record containing identity, asset provenance, and external references. It does not invent results or retain whole chat transcripts.

Saved global memories stay intact with their existing provenance. Campaign-specific conversation summaries are removed from current and archived agent session logs. Existing HQ file links into the campaign are repaired to preserved copies. External linked files remain at their original locations.

Removed: campaign chats, unsaved working drafts/planning content, tasks, local schedules, run history, caches, and other known runtime stores. Dependency/cache directories are disposable; deliberately saved references into them block deletion rather than silently lose a declared asset. The actual campaign folder is removed, not merely unregistered.

New archive copies start private from agent use (`usableByAgents: false`, rights unknown); archival does not grant new rights or approval. Prior HQ records retain their privacy/rights metadata.

## Safety and scope

- Local solo campaigns only; HQ, Lab, remote/shared/Git workspaces, unsafe overlapping roots, and unexamined legacy data are rejected.
- Saved-file inventory and hashes bind confirmation to the reviewed campaign. Changes require a new preview.
- Preserved copies are verified and the Vault manifest is durably saved before source deletion. Corrupt manifests, missing declared assets, unsafe links, or failed copies block deletion.
- App requests are briefly fenced during cleanup; unfinished requests (including timed-out handlers still executing) block admission. Campaign agents, workflows, research, scheduled work, and automation activity must be idle.
- Runtime disposal does not delete source files before the final inventory check. Local credentials/drafts and campaign history are cleaned separately; global memory is not erased.
- Outside-service posts, ads, emails, or events are not canceled. The confirmation explicitly says so.
- No live Artist OS campaign was deleted and no app was launched/restarted during development. Browser checks use fixture data; filesystem tests use temporary roots.

## Verification

- Full `bun run test`: **8,985 passed, 0 failed, 1 skipped**, including 20 isolated suites (21 processes total).
- `bun run typecheck:all`: passed all workspaces.
- Artist OS renderer production build and main bundle: passed. Build outputs were temporary and removed to recover disk space.
- `scripts/test-campaign-cleanup-ui.ts`: **8 headless Chrome checks passed**, covering the actual Campaigns menu, confirmation/cancel/busy/error states, narrow layout, and Past Releases retrieval/filtering. The unrelated creation screen and social-variant drawer are mocked in this standalone harness.
- Filesystem lifecycle test uses actual preservation and actual root/config removal in temporary directories; retained media bytes, other campaigns, and saved memory are checked.
- `git diff --check`: clean.

The first full run hit disk exhaustion (`ENOSPC`) and one unchanged video-sync test using random noise missed its drift threshold. The video test passed separately on both main and this branch. After removing only this task's build outputs and two clean, already-landed worktrees, the complete rerun above passed. No unrelated tests or thresholds were changed.

Committed as `81a2673df`, caught up with main, and landed/pushed through `27613e1ca`. The post-merge full suite passed **8,986 tests, 0 failures, 1 skipped**, across 21 processes. The earlier 8,985-test evidence above predates the Website Agent startup regression test. See [consolidation audit](artist-os-consolidation-2026-09-08.md) for final integrated build and verification status.

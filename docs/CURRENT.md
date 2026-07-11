---
status: active
owner: agent
last_verified: 2026-07-10
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-07-10
- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`
- Branch: `codex/creator-social-integration`
- Implementation head: current `codex/creator-social-integration` HEAD; use `git log -1 --oneline` for the exact commit.
- Remote: the local integration branch remains intentionally ahead and unpushed.
- Unrelated local work: preserve `docs/pitch/README.md` and `docs/pitch/packets/`.

## Recently Completed

- Recovered prior TryPost/Postiz work across RunnerOS worktrees and MikeyOS. RunnerOS retains its official TryPost MCP source; the provider-neutral media/account lessons were carried forward without importing MikeyOS's Supabase scheduler.
- Added a required Postiz agent and official hosted Postiz MCP source, with schema-first account/media validation, exact approval boundaries, provider receipt requirements, and an honest no-comments/DM boundary.
- Hardened TryPost's built-in agent around platform content types, media compatibility, drafts, exact approvals, and provider receipts; existing shipped prompts migrate conservatively.
- Clarified that app-level Postiz environment fields remain for bundled local/Squad workflows. The Postiz agent uses its encrypted source connection; self-hosted provider-agent users create a custom MCP source for their backend.
- Added TryPost Agent and Postiz Agent connection cards to Keys/Settings; each reports the real source credential status and opens the encrypted provider source connection.
- Added live MCP tool-list tests to managed provider cards, a no-key Settings registry coverage test, and corrected stale Spotify/Google setup guidance.
- Completed the shared progressive Scheduled Work composer across HQ and Campaign calendars.
- Replaced persistent Calendar side panels with contextual day menus and individually selectable work markers.
- Added typed `queue-work` actions to Automations, including optional hidden Calendar display for background agent/workflow runs.
- Added HNIC-only `schedule_work` for confirmed Calendar jobs and Automations.
- Hardened restart recovery, idempotency, workspace ownership, chain completion, and required-Output enforcement.
- Added guarded approved social execution with account/payload/media verification, per-profile serialization, and durable receipts.
- Added campaign release-date `Release day` Calendar highlights.
- Extended Social Publisher with bounded authorized comment/DM engagement and exact reply/thread targeting.
- Added the default weekly YouTube Intel Pulse: five preloaded channels, API-backed transcript packets, a required HQ report Output, deterministic categorized Shared Intel routing, and an easy dashboard toggle/manual run.
- Added Artist Voice reply examples to campaign worker context.
- Updated the system-map generator to include HQ scheduling, Automations, HNIC scheduling, live social execution, and release markers.
- Preserved active Outputs/Finals, Shared Intel, College Radio/Outreach, Spotify Playlist Creator, and paid-ads worker wiring documented in the generated map and root README.

## Current Boundaries

- TryPost and Postiz provider work is implemented but not live-account verified. TryPost uses `https://app.trypost.it/mcp/trypost`; Postiz Cloud uses `https://api.postiz.com/mcp`.
- Provider agents own drafts, schedules, and publishing on their connected services. Direct-browser Social Publisher remains the comment/DM and platform-native fallback path; Postiz MCP does not expose comment tools.
- HQ Calendar and Campaign Calendar are separate stores and pages.
- Scheduled publishing pauses at `needs-approval`; an approved exact action may then execute through the native guarded executor.
- A direct/scheduled inbox-reply mandate authorizes bounded matching inbound replies without per-item approval. It does not authorize cold DMs, posts/uploads, account changes, or sensitive replies.
- HNIC V1 schedules agent tasks and workflow runs. Complex review/social chains remain Campaign UI-owned.
- Hidden Calendar runs are limited to standalone agent/workflow Automations.
- YouTube supports comment replies, not general DMs; Shorts remain blocked pending media classification proof.
- YouTube Intelligence reuses the API key saved on YouTube Research. A weekly run fails visibly if transcripts, its report Output, or its structured `youtube-intel` nugget block are missing.
- Token control is enforced: only the newest upload per channel is eligible, processed video IDs persist in `artist-intel-state`, unchanged channels skip transcript ingestion, and no older fallback video is used.

## Verification State

Passed for the latest social-engagement and YouTube Intelligence slices:

```bash
cd tools/printing-press-social && npm test
# 64 pass, 0 fail

cd packages/shared && bun run tsc --noEmit
cd packages/shared && bun test src/skills/__tests__/starter-templates.test.ts
# 25 pass, 0 fail

cd apps/electron && bun run typecheck
cd apps/electron && bun test src/renderer/lib/campaign-worker-context.test.ts src/renderer/lib/artist-voice.test.ts
# 5 pass, 0 fail

cd packages/server-core && bun run typecheck
cd packages/server-core && bun test src/scheduled-work/ScheduledWorkRunner.test.ts
# 21 pass, 0 fail

cd tools/youtube-intelligence && npm test
# 8 pass, 0 fail

cd packages/shared && bun test src/shared-intel/youtube-intel.test.ts src/scheduled-work/index.test.ts src/automations/validation.test.ts src/sources/__tests__/storage.test.ts
# 136 pass, 0 fail

cd apps/electron && bun test src/renderer/lib/artist-intel.test.ts
# 7 pass, 0 fail
```

One known unrelated failure remains in the full shared storage suite: a stale HNIC prompt wording assertion expects `suggest an automation`. The focused Social Publisher storage test passes.

## Next Actions

1. Smoke HQ/Campaign Calendar creation and item-detail flows in the running app.
2. Smoke the Intel Pulse against all five preloaded channels in the packaged app.
3. Smoke HNIC Calendar scheduling and hidden background Automations.
4. Live-account smoke scheduled publishing and delegated inbox replies platform by platform.
5. Fix the stale HNIC storage assertion and run the complete shared suite.
6. Review the full local stack before pushing or merging.

## Notes For Next Agent

- Start with `../HANDOFF.md`, then spec 13, then the generated system map.
- Regenerate maps with `bun run docs:system-map`; never hand-edit generated map outputs.
- Preserve unrelated pitch docs and the stacked branch history.
- Treat real-account smoke as unfinished even though focused automated checks pass.

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
- Implementation head: `bfc184cd Enable delegated social engagement`
- Remote: local branch was ahead 38 commits before this docs refresh and remains intentionally unpushed.
- Unrelated local work: preserve `docs/pitch/README.md` and `docs/pitch/packets/`.

## Recently Completed

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

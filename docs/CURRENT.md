---
status: active
owner: agent
last_verified: 2026-08-04
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-08-04
- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`
- Branch: `codex/hq-home-compact-ui`
- Implementation head: `fa5c7d5b feat(campaign): connect release tasks to workers`
- Remote: 10 commits ahead of `origin/codex/creator-social-integration`; intentionally unpushed.
- Current goal: manual Electron smoke of HQ Home, Campaign Release Board routing, default workflows, and the daily social-reply automation.
- Overall state: integrated beta. Core product foundations are built; live-provider proof, packaging, Creative Lab, Team Mode, and Windows remain.

## Recently Completed

- Compacted Artist HQ Home into a focused operational dashboard backed by persisted State of Play, Spotify, YouTube Intel, Calendar, Finals, projects, workers, signals, and needs-attention data.
- Restored the stronger campaign-style HQ header, added optional banner upload, and aligned Spotify / Intel pulse cards with matching manual Run controls.
- Removed the stale Trading workspace registration from Artist OS while preserving the isolated Trade God store and legacy data backup.
- Cleaned the Campaign Release Board categories and tasks across Foundation, Visuals, Content, Release Setup, and Promotion.
- Added play controls for in-app campaign deliverables, routing each item to its narrow worker, workflow, or bounded tool with existing campaign context.
- Added needed / done / skipped board states and safe migration behavior for existing campaigns.
- Added Content Mastermind, Paid Campaign Builder, Industry Outreach, College Radio, and Merch Product Builder workflows with conservative approval boundaries.
- Made Social Publisher the campaign rollout front door for matching Finals through Artist OS, Postiz, or TryPost; launch announcements now live inside the rollout.
- Added the disabled-by-default Daily Social Comment Replies automation template for 4:00 PM America/Chicago across saved profile packs.
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

Passed for the latest Campaign Release Board and Social Publisher slice:

```bash
bun test apps/electron/src/renderer/lib/release-board.test.ts \
  apps/electron/src/renderer/lib/run-agent.test.ts \
  packages/shared/src/agent-definitions/storage.test.ts
# 105 pass, 0 fail

bun run typecheck:all
# passed

git diff --check
# passed
```

The development app launched successfully from this worktree, restored Artist HQ, and loaded three Artist OS workspaces with no Trading workspace.

## Next Actions

1. Smoke every Campaign Release Board play control and verify the correct worker/workflow, inherited context, immediate first message, and non-public boundary.
2. Smoke HQ Home banner, live cards, manual pulse runs, weekly toggles, detail links, and compact lower sections.
3. Smoke Content Mastermind, Paid Campaign, Industry Outreach, College Radio, and Merch Product Builder from their intended libraries.
4. Run the Daily Social Comment Replies five-step checklist in `docs/backlog/external-integration-live-verification.md`.
5. Continue live-account/provider smoke for Social Publisher, YouTube Intelligence, Spotify, Printify/Shopify, TryPost/Postiz, and paid ads.
6. Record verified workers in `docs/development/vetted.md` and fix failures before adding more surface area.
7. Review the full 10-commit local stack before any push or merge.

## Notes For Next Agent

- Start with `../HANDOFF.md`, then this file, then the generated system map.
- Regenerate maps with `bun run docs:system-map`; never hand-edit generated map outputs.
- Preserve the stacked branch history and keep Trade God isolated.
- Treat real-account smoke as unfinished even though focused automated checks pass.

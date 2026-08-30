---
status: active
owner: agent
last_verified: 2026-08-30
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-08-30
- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/active/artist-os-release-kit`
- Branch: `codex/artist-os-release-kit`
- Feature base: `5dcf37dc6 feat(chat): add Goal mode controls`
- Current goal: hand off the verified Release Kit V1 for review and commit.
- Overall state: core implementation, focused tests, full typecheck, Artist OS build, and isolated Electron page smoke passed. The explicit follow-ups below remain deferred.

## Recently Completed

- Defined and implemented the four-layer artist asset model: HQ Vault, Campaign Assets, Outputs, and campaign Release Kit.
- Added independent hashed Release Kit snapshots, owner-aware locking, full-hash drift verification, non-resurrecting legacy campaign Finals migration, RPC/API/MCP wiring, exact scheduled-work references, and a dedicated campaign page.
- Added trusted asset/Output/Release Kit tools plus one universal Artist OS prompt contract so HNIC and every specialist agent use the same locations, approval rules, and face-reference behavior.
- Routed campaign Output approval into Release Kit and kept old Finals pointers as migration/HQ compatibility only.

- Verified Claude Sonnet background completion after the parent turn, compact parent status, child-session opening, interruption, same-session resume, and renderer reload. Internal receipt/session plumbing and delegation protocol are now hidden from the normal transcript while remaining durably stored for runtime use.
- Closed two additional runtime gates: existing DeepSeek/Pi chat plus terminal-tool execution is verified, and Claude Sonnet recovered correctly after Explore mode blocked a Write without creating the requested file.
- Integrated Creative Lab as an explicit persisted Artist OS workspace purpose with isolated routing, scoped tools, user-controlled starter workers, canonical song/project persistence, honest live UI, and recoverable pending edits.
- Made Creative Lab a single Artist OS-owned space: one click creates and opens it under the Artist OS root, the add action disappears afterward, and storage rejects duplicate Labs. Product-aware UI paths no longer expose `.craft-agent` in Artist OS.
- Consolidated Artist OS workspace switching into the top header in the order HQ, Campaigns, add workspace, then a separated Creative Lab; moved the sidebar toggle to the lower-left and kept native macOS window controls visible across app overlays.
- Added bounded Prosody integration with packaged resources, first-use progress, explicit offline/runtime errors, and a still-usable Song Pad when rhyme tooling is unavailable.
- Preserved the original dirty Artist OS and Lab source worktrees; integration work is isolated to `codex/lab-integration-hardening`.

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

- Release Kit is campaign-only. HQ Vault remains the career library; HQ legacy Finals pointers are intentionally not redesigned in this slice.
- Release Kit approval is not approval to publish, send, spend, or change an external account.
- Release Board and Scheduled Work attachment selection still have legacy Final compatibility; direct Release Kit category alignment is a follow-up in spec 23.

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

Release Kit V1 passed on `codex/artist-os-release-kit`:

- 104 focused tests, 573 assertions, 0 failures across storage, trusted-source service rules, session tools, universal agent context, route parsing, RPC registration, and existing Vault/Asset behavior.
- `bun run typecheck:all` passed.
- `bun run electron:build:artist-os` passed for generated skills, main, preload, renderer, resources, and assets.
- `git diff --check` passed.
- An isolated Electron instance on port `6173` loaded a copied campaign and rendered `Release Kit` as its own campaign nav/page with Finals, Outputs, readiness categories, Folder, and Add Final entry points. The existing Artist OS instance and real profile were not modified.

Creative Lab automated integration gates passed on `codex/lab-integration-hardening`:

- 216 focused tests across Lab storage, migration, tools, routing, workspace isolation, Prosody selection, and IPC inventory.
- `bun run typecheck:all`.
- Main, preload, renderer, resources, and asset-copy builds.
- `bun run lint:ipc-sends`.
- `bun run test:product-isolation`.
- `git diff --check`.

Manual Electron and packaged/offline Prosody smoke remain pending; automated checks do not certify those runtime paths.

The optional full-repository run completed with 5,761 passes and 15 failures. Eight failures reproduce on the untouched Artist OS base; the other seven passed immediately when rerun in isolation and are test-order dependent. None touch the Lab integration paths.

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

1. Review and commit the Release Kit V1 slice.
2. Run manual source-flow smoke for upload, Campaign Asset, HQ Vault, Output, Primary replacement, removal, and legacy migration using disposable files.
3. Align Release Board readiness with Release Kit categories, then add Release Kit-aware Scheduled Work/social attachment selection.
4. Run the eight-step Creative Lab manual smoke in `docs/creator-command-center/18-lab-integration-hardening-spec.md`.
4. Smoke Content Mastermind, Paid Campaign, Industry Outreach, College Radio, and Merch Product Builder from their intended libraries.
5. Run the Daily Social Comment Replies five-step checklist in `docs/backlog/external-integration-live-verification.md`.
6. Continue live-account/provider smoke for Social Publisher, YouTube Intelligence, Spotify, Printify/Shopify, TryPost/Postiz, and paid ads.
7. Record verified workers in `docs/development/vetted.md` and fix failures before adding more surface area.
8. Review the integration branch before any push or merge into the Artist OS branch.

## Notes For Next Agent

- Start with `../HANDOFF.md`, then this file, then the generated system map and Lab hardening spec.
- Regenerate maps with `bun run docs:system-map`; never hand-edit generated map outputs.
- Preserve both original dirty worktrees and keep general Runner, ScriptOS, and Trade God isolated.
- Treat real-account smoke as unfinished even though focused automated checks pass.

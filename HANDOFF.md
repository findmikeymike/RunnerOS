---
status: active
owner: agent
last_verified: 2026-07-09
source_of_truth: true
---

# Handoff: Creator Command Center + Social Integration

Last updated: 2026-07-09 18:34 CDT

## Start Here

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`
- Branch: `codex/creator-social-integration`
- Role: active running app tree for Artist HQ, Campaigns, workers, social publishing, and scheduled campaign work.
- Remote: local branch is ahead of `origin/codex/creator-social-integration`; nothing in this local stack should be assumed published until pushed.
- Implementation head before this doc refresh: `06b9a3cd Complete scheduled campaign work orchestration`.

Read next:

1. `docs/CURRENT.md`
2. `docs/creator-command-center/README.md`
3. `docs/creator-command-center/13-scheduled-work-composer-execution-spec.md`
4. `docs/system-map/runner-system-map.md`

## What Is Now Landed

### Scheduled Campaign Work

- Campaign Calendar has a guided Scheduled Work composer for Event, Agent Task, Workflow Run, Social Publish, and Review / Approval.
- Inputs can reference Outputs, Finals, Primary Finals, and eligible Vault assets.
- Scheduling, cancellation, and review decisions use backend-owned RPC mutations that update Scheduled Work and Campaign Calendar together.
- Scheduled Work uses workspace-context locking, stable definition digests, idempotency keys, run history, and explicit attention reasons.
- Agent tasks remain running until their child session completes and any required Output contract is satisfied.
- Workflow work remains running until the workflow reaches a terminal state.
- Missed windows, missing outputs/assets, inactive agents/workflows, changed workflow definitions, and failed executions surface as `needs-attention` instead of silently rerunning.
- Review work records durable approve / changes-requested decisions.
- Social work remains approval-gated; due jobs do not silently publish.

Primary files:

- `apps/electron/src/renderer/components/calendar/ScheduledWorkComposer.tsx`
- `apps/electron/src/renderer/lib/scheduled-work-composer.ts`
- `apps/electron/src/renderer/components/app-shell/CampaignCalendarPage.tsx`
- `packages/shared/src/scheduled-work/index.ts`
- `packages/server-core/src/handlers/rpc/scheduled-work.ts`
- `packages/server-core/src/scheduled-work/ScheduledWorkRunner.ts`
- `packages/server-core/src/scheduled-work/workspace-context-lock.ts`

### College Radio + Outreach

- `college-radio-agent` is a default worker in both Artist HQ and Campaigns.
- The bundled personal directory includes station and tastemaker JSON/CSV plus a validated matcher.
- Directory rows are leads only; College Radio must verify current station/show/contact/submission evidence before placing a target in send-first.
- College Radio reads Artist HQ context, campaign-worker context, release assets, and current user direction.
- It publishes a durable `College Radio Outreach Packet` and hands verified email-method targets to `outreach-agent` through `message_agent`.
- Outreach owns Gmail drafts and sends. Exact current-turn approval and provider receipts remain mandatory.
- Forms, upload portals, and physical-only submissions stay in a manual queue.
- Resend is not yet exposed as an Outreach Agent delivery source; Gmail is the current agent-owned path.

Primary files:

- `packages/shared/src/agent-definitions/starter-templates.ts`
- `packages/shared/src/skills/bundled/college-radio-matcher/`
- `packages/shared/src/skills/bundled/college-radio-outreach/SKILL.md`
- `apps/electron/src/renderer/lib/worker-defaults.ts`

### Spotify Playlist Worker

- `spotify-playlist-creator` is no longer hidden from Workers.
- It is default-visible in Artist HQ and Campaigns.
- Startup activates the agent and `spotify-playlist-curator` skill bundle in local workspaces.
- `playlisting-power-up` remains a separate promotion-service handoff; do not confuse it with Spotify Playlist Creator.

## Current Runtime Truth

- The dev app is launched from this integration worktree with `bun run electron:dev`.
- Startup on 2026-07-09 seeded College Radio and activated College Radio plus Spotify Playlist Creator across three local workspaces.
- Worker visibility is generated from `apps/electron/src/renderer/lib/worker-defaults.ts` and summarized in `docs/system-map/runner-system-map.md`.
- Existing installed College Radio and Outreach definitions receive conservative startup migrations without overwriting unrelated user customization.

## Verification

Passed after the final implementation commits:

```bash
bun test packages/server-core/src/handlers/rpc/scheduled-work.test.ts \
  packages/server-core/src/scheduled-work/ScheduledWorkRunner.test.ts \
  apps/electron/src/renderer/lib/scheduled-work-composer.test.ts \
  apps/electron/src/shared/__tests__/ipc-channels.test.ts
# 36 pass, 0 fail

bun test apps/electron/src/renderer/lib/worker-defaults.test.ts \
  packages/shared/src/agent-definitions/storage.test.ts
# 79 pass, 0 fail

bun run typecheck:all
bun run docs:system-map
git diff --check
```

## Next Best Move

1. Smoke the Campaign Scheduled Work composer in the running app: create Event, Agent Task, Workflow Run, Review, and approval-blocked Social Publish records.
2. Confirm agent/workflow completion polling and required-Output failure states through the visible Calendar UI.
3. Smoke College Radio end to end: context intake -> verified targets -> Outreach Packet -> Outreach Gmail draft -> exact approval -> receipt.
4. Decide whether to add an approval-gated Resend delivery source after the Gmail path and durable outreach history are proven.
5. Push `codex/creator-social-integration` only after the full local commit stack is intentionally accepted.

## Known Gaps / Do Not Overclaim

- Scheduled Social Publish is intentionally held at approval; live post execution after approval still needs an explicit verified executor path.
- HQ Calendar does not yet expose the same executable Scheduled Work composer as Campaign Calendar.
- The new composer/runner has automated coverage but still needs the user’s real app smoke.
- College Radio station contacts and rules can age; live public verification remains mandatory.
- Resend exists behind Community email RPC but is not yet a general Outreach Agent source/tool.
- Team Mode and Creative Lab remain separate held branches; do not merge them without Michael’s direction.

## Safety Invariants

- External sends/posts require exact user approval and a provider receipt.
- Do not store passwords, cookies, tokens, or 2FA codes in context docs or agent packets.
- One social profile maps to one isolated browser session.
- Starting an agent session or workflow is not completion.
- Never silently rerun stale in-flight work with a persisted child session/run id.
- Preserve user-customized built-in agents unless a field still matches the exact old shipped value.

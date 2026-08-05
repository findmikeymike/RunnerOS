---
status: active
owner: agent
last_verified: 2026-08-04
source_of_truth: true
---

# Handoff: Creator Social Integration

## Start Here

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`
- Branch: `codex/hq-home-compact-ui`
- Current implementation head: `fa5c7d5b feat(campaign): connect release tasks to workers`
- Remote comparison: 10 commits ahead of `origin/codex/creator-social-integration`; this local stack is not pushed.
- Worktree was clean after `fa5c7d5b`. Trade God remains a separate worktree and isolated runtime under `~/.trade-god`; do not re-register it as an Artist OS workspace.

Read in this order:

1. `docs/CURRENT.md`
2. `docs/creator-command-center/13-scheduled-work-composer-execution-spec.md`
3. `docs/system-map/runner-system-map.md`
4. `packages/shared/src/scheduled-work/index.ts`
5. `packages/shared/src/skills/bundled/social-publishing/references/engagement-playbook.md`
6. `packages/shared/src/skills/bundled/youtube-intelligence/SKILL.md`

## Product State

### Artist HQ Home

- HQ Home is now a compact operational dashboard instead of a long status page.
- The restored campaign-style header supports an optional user banner image.
- State of Play, Spotify Pulse, Intel Pulse, Artist Kit / Finals, Calendar, needs-attention, projects, workers, and signals read persisted app data instead of fixture counts.
- Spotify and Intel use matching compact cards with manual Run controls; weekly schedules remain optional.
- Workers and signals are folded into a lower details area so the primary page stays focused.

### Campaign Release Board

- Campaign categories are Foundation, Visuals, Content, Release Setup, and Promotion.
- Redundant tasks were removed or consolidated. Existing campaigns receive newly introduced checklist items as skipped so historical completion totals do not silently regress.
- In-app deliverables expose a play control that launches the correct worker, workflow, or bounded tool with existing Artist HQ and campaign context.
- Content ideas launch `content-mastermind`; paid promotion launches `paid-campaign-builder`; College Radio launches `college-radio-campaign`; other deliverables route to their narrow worker.
- Starting a worker does not mark the item done. Workers are instructed to create a durable reviewable Output and cannot publish, send outreach, spend money, or take another public action from the board launch.
- Release-board status supports needed, done, and skipped / not-applicable states.

### Default Artist Workflows

- `content-mastermind`: Content Genius, Anticipation Director, and Scroll Stopper ideate independently; Content Director selects, strengthens, and fuses the strongest portfolio.
- `paid-campaign-builder`: Ads Strategist -> Ad Creative -> Ads Agent execution packet.
- `industry-outreach-pipeline`: Industry Hunter -> Outreach Agent approval-ready packet.
- `college-radio-campaign`: College Radio -> Outreach Agent; default in Campaign and addable to HQ.
- `merch-product-builder`: Print Agent creates one bounded private Printify draft path, mockups, conditional Shopify analysis, and an approval-gated final kit.

### Calendars And Scheduling

- Calendar is a first-class Plan navigation item above Agenda. HQ and Campaign calendars remain separate pages and stores.
- HQ Calendar owns global events and HQ agent/workflow work. Campaign Calendar owns campaign execution, reviews, social work, assets, receipts, and recovery.
- Clicking or right-clicking a day opens contextual `Add event` / `Add job` choices. The modal then progressively discloses only the selected job path.
- Supported typed work: Event, Agent Task, Workflow Run, Review / Approval, and Social Publish.
- Agent/workflow launch is not completion. The runner polls terminal child state and enforces required-Output contracts.
- Calendar cells expose individually clickable work markers. Campaign release dates automatically appear as a green `Release day` highlight.
- HQ can route campaign-owned review/social work into the primary campaign without duplicating ownership.

### Automations And HNIC

- Automations can create typed `queue-work` actions from schedule, file, webhook, URL, and inbound-message triggers.
- Automations and Calendar share the same Scheduled Work runner, completion rules, chains, recovery, approvals, and receipts.
- Standalone background agent/workflow automations may set `showOnCalendar: false`. Review, social, and chained work must remain visible.
- HNIC alone receives the `schedule_work` session tool. After user confirmation it can schedule an agent task or workflow on Calendar, or create a queue-work Automation.
- Stable idempotency keys are required when HNIC retries the same request.

### Scheduled Social Publishing

- Scheduled Social Publish prepares and stores an exact dry-run action tied to one profile, payload, asset, media fingerprint, browser partition, and action digest.
- Due work stops at `needs-approval`. Exact approval is bound near execution; edits invalidate it.
- The native Electron browser executor revalidates the approved tuple and visible account, submits once, serializes work per profile, and records a durable external receipt.
- Generic agent sessions cannot bypass this executor.

Primary files:

- `apps/electron/src/main/campaign-social-job-preparer.ts`
- `apps/electron/src/main/scheduled-social-browser-executor.ts`
- `packages/server-core/src/scheduled-work/ScheduledWorkRunner.ts`
- `tools/printing-press-social/src/social.mjs`

### Delegated Comments And Messages

- Social Publisher handles Instagram, TikTok, and X comments/DMs plus YouTube comments. YouTube has no general DM lane.
- A direct user instruction or active scheduled agent task to answer comments/messages is a bounded engagement mandate. It authorizes matching inbound replies without per-item approval.
- The mandate must resolve an exact profile, inbox types, and run/schedule boundary. Defaults are 20 public replies and 10 DM replies per run.
- Public replies carry an exact `--reply-to` target. DM replies may carry the exact existing `--thread-url`. Fallback execution is blocked when it could turn a reply into a top-level comment or new thread.
- Artist Voice `commentReplyExamples`, speaking style, vocabulary, and avoid rules are included in campaign worker context.
- Cold DMs, posts/uploads, account changes, block/report actions, and sensitive/business/legal/safety conversations are outside the mandate and must stop or escalate.
- Private thread contents stay out of global memory, shared Outputs, context docs, and public receipts.

Primary files:

- `packages/shared/src/skills/bundled/social-publishing/SKILL.md`
- `packages/shared/src/skills/bundled/social-publishing/references/engagement-playbook.md`
- `packages/shared/src/agent-definitions/starter-templates.ts`
- `apps/electron/src/renderer/lib/campaign-worker-context.ts`
- `sources/printing-press-social/guide.md`

### Social Rollout Front Door

- Social Publisher plans from matching Campaign Finals, resolving Final pointers through their Output manifests instead of guessing raw folders.
- It supports Artist OS native posting, Postiz, or TryPost. It checks live connection availability, asks once when both external providers are ready, and never claims provider work without a receipt.
- Launch announcements are part of the rollout schedule rather than a separate Release Board deliverable.
- Public posts, schedules, or provider writes still require exact approval; bounded inbound reply mandates retain their separate rules.

### Weekly YouTube Intelligence

- Artist HQ Intel Pulse ships with Managers Playbook, Viral VSN, No Labels Necessary, Neighborhood Art Supply, and Its21Master preloaded.
- The dashboard toggle creates or pauses a hidden Monday 10:00 weekly `queue-work` job; manual Run uses the identical tracked pipeline.
- `youtube-intelligence-agent` reuses the API key on YouTube Research, scans the configured lookback window, pulls transcripts, and must create one HQ report Output.
- Each run checks only the newest upload per channel. It skips transcript ingestion when that video ID already exists in targeted `artist-intel-state`; it never falls back to older uploads.
- The report must include a validated `youtube-intel` JSON fence. The server maps branding/content/rollout/audience/outreach/creative/operations nuggets to active specialist agents and writes targeted `shared-intel-*` context docs.
- Scheduled Work does not mark the run done until the report and postprocessing succeed. The Intel Pulse card links directly to the completed Output.
- A no-new-videos week completes with an empty report, updates no Shared Intel, and spends no transcript-synthesis tokens.
- Legacy prompt-based Intel Pulse automations upgrade to the tracked pipeline when re-enabled.

Primary files:

- `apps/electron/src/renderer/lib/artist-intel.ts`
- `packages/shared/src/skills/bundled/youtube-intelligence/SKILL.md`
- `tools/youtube-intelligence/bin/youtube-intelligence.mjs`
- `packages/shared/src/shared-intel/youtube-intel.ts`
- `packages/server-core/src/sessions/SessionManager.ts`

### Other Active Integration Surfaces

- Outputs become Finals through UI actions or the `promote_output_to_final` session tool. Finals are locked pointers to Output bundles, not copied assets.
- Shared Intel routes durable session context to selected agents at launch; HNIC retains the broad context override.
- College Radio is default-visible in Campaigns and addable to HQ, verifies directory leads live, creates durable Outreach packets, and hands verified email targets to Outreach Agent. Private Gmail drafts can be created automatically; sends remain exact-approval gated.
- Merch Product Builder can create one private unpublished Printify product and official mockups. Spending, ordering, syncing, publishing, deleting, and other consequential actions remain exact-approval gated.
- Spotify Playlist Creator is default-visible in HQ/Campaign and is distinct from the separate Playlisting Power Up service handoff.
- Paid ads remain a three-worker chain: Ad Creative -> Ad Strategy -> Ad Runner. Account-side mutations remain approval-gated.
- The generated system map is the fastest complete inventory of starter agents, skills, sources, launch surfaces, permission signals, Outputs/Finals, and Scheduled Work wiring.

## Architecture Map

- Composer/UI: `apps/electron/src/renderer/components/calendar/ScheduledWorkComposer.tsx`
- HQ entry: `apps/electron/src/renderer/components/app-shell/ArtistHQHome.tsx`
- Campaign entry: `apps/electron/src/renderer/components/app-shell/CampaignCalendarPage.tsx`
- Shared model: `packages/shared/src/scheduled-work/index.ts`
- Backend mutations: `packages/server-core/src/handlers/rpc/scheduled-work.ts`
- Runner: `packages/server-core/src/scheduled-work/ScheduledWorkRunner.ts`
- Automation queue: `packages/server-core/src/scheduled-work/AutomationWorkQueue.ts`
- HNIC adapter: `packages/server-core/src/scheduled-work/HnicScheduledWork.ts`
- HNIC tool: `packages/session-tools-core/src/handlers/schedule-work.ts`
- Generated map source: `scripts/generate-runner-system-map.mjs`

## Verification Truth

Passed on 2026-08-04 for the current Release Board and Social Publisher slice:

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

The app also launched successfully from this exact worktree and restored Artist HQ. Only the three Artist OS workspaces were loaded; the legacy Trading registration was removed without deleting Trade God data.

Useful commands:

```bash
bun run electron:dev
bun run typecheck:all
bun run docs:system-map
git status -sb
```

## Next Best Moves

1. Smoke every Campaign Release Board play control: correct target, inherited context, immediate first message, workflow input dialog, no accidental completion, and no public action.
2. Smoke HQ Home live cards: persisted counts, banner upload, Spotify / Intel manual Run, weekly toggles, Calendar / needs-attention / Finals links, projects, and the lower workers/signals details area.
3. Smoke the five new artist workflows from their intended HQ/Campaign libraries and confirm one durable final Output per run.
4. Run the five-step Daily Social Comment Replies checklist in `docs/backlog/external-integration-live-verification.md`.
5. Continue the live-provider queue in that same document: Social Publisher, YouTube Intelligence, Spotify, Printify/Shopify, TryPost/Postiz, and paid ads.
6. Record passes in `docs/development/vetted.md`; fix failures before expanding scope.
7. Update `docs/CURRENT.md` and this handoff after the smoke round, then commit the docs/results as a separate coherent slice.

## Known Gaps

- The current Release Board and compact HQ UI have automated coverage but still need the manual Electron smoke above.
- Real social accounts have not been smoke-tested for the new delegated engagement flow.
- Scheduled publishing has automated executor coverage but still needs per-platform live-account proof; selector drift must fail closed.
- YouTube Shorts remain blocked until media classification is proven before submit.
- HNIC V1 schedules agent tasks and workflow runs, not arbitrary social/review chains.
- Hidden Calendar runs support standalone agent/workflow work only.
- YouTube Intelligence has automated packet/routing coverage but still needs a live API/transcript smoke in the packaged app.
- Team Mode and Creative Lab remain separate held branches.
- Windows packaging, clean-machine installation, and packaged runtime proof remain release gates.

## Invariants

- Calendar shells are visibility; Scheduled Work orders own execution state.
- One executable order has one owning workspace.
- Starting is never completion.
- Scheduled publishing requires exact bound approval and a receipt.
- A bounded engagement mandate covers matching inbound replies only.
- Never store credentials, cookies, tokens, 2FA codes, or private DM bodies in context/memory/artifacts.
- Preserve user-customized built-in agents; startup migrations patch exact old shipped text only.
- Do not push, rebase, squash, or merge the stacked branch without Michael's direction.

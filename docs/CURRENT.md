---
status: active
owner: agent
last_verified: 2026-07-06
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-07-06
- Branch: `codex/app-action-layer`
- Current goal: implement and harden the App Action Layer so agents can safely operate app surfaces.
- Overall state: active Creator Command Center worktree with many feature docs; docs are now routed through this map instead of loose root files.

## Recently Completed

- Added HQ State of Play infrastructure: deterministic composer, generated `hq-state-of-play` context doc, and automatic refresh after workspace context, Shared Intel, Artist Vault, and Google Calendar context writes.
- Added machine-readable HQ route hints so the generated next move now carries target agent, action, prompt, confidence, context docs, and launch blocker state.
- Added a per-workspace proactive HQ mode toggle and validated Start Route action in Artist HQ Home.
- Hardened proactive HQ mode with per-workspace preference storage and tested route-readiness helpers.
- Hardened Shared Intel routing with route reasons, audit counts, tighter target scoring, duplicate/update tests, secret/junk rejection, and a 2600-character prompt cap.
- Live-smoked the real Electron app from this worktree. Fixed HQ nav active-state drift, Shared Intel slug overflow, stale over-route preservation on update, and explicit "only route this to..." targeting.
- Added `docs/creator-command-center/09-hq-state-of-play-proactive-routing.md` as the feature contract and future-agent map.
- Moved root audit reports into `docs/audits/2026-07-04/`.
- Moved standalone references into clearer folders:
  - `docs/development/cli.md`
  - `docs/backlog/future-external-triggers.md`
  - `docs/specs/hypermotion-agent.md`
- Removed local runtime clutter from this worktree: `.omc/`, `docs/creator-command-center/.omc/`, and `docs/.DS_Store`.
- Added generated system map docs under `docs/system-map/` plus `npm run docs:system-map`.
- Hardened HQ route readiness so generated route blockers now prevent `Start Route` launch instead of allowing a blocked proactive route through.
- Hardened Pi subprocess JSONL parsing so terminal notification prefixes on stdout do not drop valid mini-completion results after a chat turn.
- Hardened Artist Profile parsing so the starter markdown intake template opens as an editable Profile form instead of blocking with a missing-JSON warning.
- Hardened the Chat nav shortcut so it skips stale expired/error HNIC sessions instead of reopening an old `Session Expired` thread.
- Wired the HQ `Current Release` project card to open the primary campaign workspace instead of remaining text-only.
- Refreshed the startup migration test fixture to use a current bundled Pi/OpenRouter model ID after the old Grok fixture aged out of the catalog.
- Updated HyperMotion's Remotion dependency and transitive lockfile so the production audit is clean.
- Corrected the local smoke profile plan: real keys are entered through the app UI and persist in local RunnerOS credential storage; `smoke/local/` only holds ignored artist/campaign/service smoke context.
- Re-ran release-oriented automated gates after the hardening fix: focused Creator Command Center tests, shared/server-core/Electron typechecks, and full monorepo `typecheck:all`.
- Launched Electron dev from this worktree and verified the app initializes, connects the renderer, loads skills, refreshes Pi/OpenAI model lists, and sends a real live prompt without the prior immediate `Session Expired` failure.
- Added the App Action Layer: `list_app_actions`, `preview_app_action`, `execute_app_action`, and `get_app_action_receipt`.
- Added action receipts, idempotency pointers, grant checks, approval-required handling, unavailable-action reporting, and internal durable records for Kanban/Campaigns/Network/Fans.
- Wired real adapters for Outputs, Workflows, and Artist Vault imports; Vault imports refresh the Artist Vault context doc and are serialized by workspace mutex.
- Added `AgentMetadata.actionGrants`, create-agent validation, starter grants for HNIC/Orchestrator/Art Director, and startup grant migration for existing installed agents.
- Hardened the App Action Layer after rival review: invalid grants fail closed, failed attempts no longer poison retries, missing permission mode blocks writes, approval execution requires server-side verification, and Network/Fans upserts update existing records.
- Added `docs/creator-command-center/12-app-action-layer-build.md` as the feature implementation map.

## In Progress

- Creator Command Center / Artist HQ feature work continues on this branch.

## Next Actions

1. Keep new specs in the right feature folder or `docs/specs/`.
2. Regenerate `docs/system-map/` after changing starter agents, worker visibility, workflow templates, or launch routing.
3. Archive stale docs only when a newer source of truth is clear.
4. Re-run focused tests when code, not docs, changes.

## Blockers / External Dependencies

- No current auth blocker for the basic live chat path. Remaining external-service smokes still need connected provider accounts/keys.

## Verification State

- Verified Shared Intel hardening with router/RPC tests, shared typecheck, and server-core typecheck.
- Verified HQ State of Play with focused composer/refresh/Google Workspace/proactive helper tests, shared typecheck, server-core typecheck, Electron typecheck, and `git diff --check`.
- Verified live Share Intel click updates an existing context note and narrows targets to the matching available worker instead of creating duplicates or keeping stale over-routes.
- Verified git branch before cleanup.
- Verified moved paths with `rg` and updated stale references.
- Electron typecheck required for Artist HQ UI changes.
- Verified on 2026-07-06:
  - `/Users/michaelb.williams/.bun/bin/bun test packages/session-tools-core/src/handlers/app-actions.test.ts packages/session-tools-core/src/handlers/create-agent.test.ts packages/shared/src/agent-definitions/storage.test.ts packages/shared/src/agent/__tests__/session-self-management-bindings.test.ts` -> `86 pass`.
  - `/Users/michaelb.williams/.bun/bin/bun run --cwd packages/session-tools-core typecheck` passed.
  - `npm run docs:system-map` passed and regenerated `docs/system-map/`.
- Verified on 2026-07-05:
  - `bun test apps/electron/src/renderer/lib/artist-hq-proactive.test.ts packages/shared/src/hq-state/composer.test.ts packages/server-core/src/hq-state/refresh.test.ts packages/server-core/src/handlers/rpc/google-workspace.test.ts packages/shared/src/shared-intel/router.test.ts packages/server-core/src/handlers/rpc/shared-intel.test.ts apps/electron/src/renderer/lib/compose-agent-prompt.test.ts` -> `65 pass`.
  - `(cd packages/shared && ../../node_modules/.bin/tsc --noEmit)` passed.
  - `(cd packages/server-core && ../../node_modules/.bin/tsc --noEmit)` passed.
  - `bun run typecheck:electron` passed.
  - `bun run typecheck:all` passed.
  - `bun run docs:system-map` passed with no generated diff.
  - `bun run electron:dev` launched successfully; Runner server listened on `127.0.0.1:55268`, trigger server on `127.0.0.1:9101`, renderer connected, and model refresh fetched provider model lists.
  - Live prompt smoke passed through the visible Electron composer on session `260704-frosty-basalt`: user prompt `LIVE RELEASE SMOKE: reply with exactly: HNIC live smoke passed.` produced assistant response `HNIC live smoke passed.` Logs showed `agent.chat()` completed and no `Session Expired`.
  - `bun test packages/shared/src/agent/__tests__/pi-agent-error-handling.test.ts packages/shared/src/agent/__tests__/pi-query-llm.test.ts` -> `10 pass`.
  - `(cd packages/shared && ../../node_modules/.bin/tsc --noEmit)` passed after the Pi JSONL parser hardening.
  - Live visual smoke with Computer Use passed for: HQ home, Outputs, Agenda, Calendar, Network, Community, Vault, Workers, Automations, Workflows, Sessions sidebar expansion, Profile, Voice, Intel Docs, Branding, and Settings.
  - Live Profile re-check confirmed the markdown starter template now renders as a usable editable form with `Save Profile` enabled.
  - `bun test apps/electron/src/renderer/lib/artist-profile.test.ts apps/electron/src/renderer/lib/artist-hq-nav-state.test.ts apps/electron/src/renderer/lib/artist-hq-proactive.test.ts` -> `13 pass`.
  - `bun run typecheck:electron` passed after the Artist Profile parser hardening.
  - `bun test apps/electron/src/renderer/lib/artist-hq-nav-state.test.ts` -> `9 pass`.
  - `bun run typecheck:electron` passed after the Chat nav expired-session filter.
  - Live Chat nav re-check passed: starting from HQ, clicking `Chat` opened clean session `260605-fair-quartz` instead of stale expired session `260605-tall-chrome`.
  - `bun test apps/electron/src/renderer/lib/artist-workspace.test.ts` -> `5 pass`.
  - `bun run typecheck:electron` passed after the HQ project card route wiring.
  - Live HQ project card smoke passed: clicking `Current Release` from HQ opened workspace `Trading` at `route=campaign` with the campaign command center visible.
  - Live HQ route smoke passed with a temporary restored fixture: `Start Route` created a `branding-agent` session, sent `LIVE HQ ROUTE SMOKE: reply with exactly: HQ route smoke passed.`, and the assistant replied `HQ route smoke passed.` Original HQ State context was restored and the smoke session folder was removed.
  - `bun test packages/shared/src/config/__tests__/storage-startup-migration.test.ts` -> `12 pass`.
  - `bun run validate:dev` passed: `typecheck:all`, shared LLM connection/model/config tests, and doc-tool tests.
  - `bun run electron:build` passed: skills generated, main/preload/renderer/resources/assets built.
  - `(cd tools/hypermotion && npm audit --omit=dev)` -> `found 0 vulnerabilities`.
  - `bun run smoke:profile:check` verifies local smoke context/checklist files without touching or printing credentials.

## Remaining Release Smoke

- Remaining external-service smokes should use the local smoke profile so real keys and artist/campaign context stay outside tracked app data.

## Notes For Next Agent

- Do not treat every old audit as current truth. Use `docs/audits/README.md` and current code before acting on old findings.
- Feature-folder paths were mostly preserved intentionally to avoid breaking links.

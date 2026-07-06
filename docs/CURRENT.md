---
status: active
owner: agent
last_verified: 2026-07-06
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-07-06
- Branch: `codex/creator-command-center`
- Current goal: harden Setup Concierge, service-key setup, Settings, and release smoke paths toward release confidence.
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
- Added Setup Concierge as the app/setup specialist worker. HNIC routes app guidance, connection setup, service-key, and "how do I use this?" questions to `@setup-concierge`.
- Gave Setup Concierge the app-guide/source-setup skill bundle: `artist-os-guide` plus `source-recipe`.
- Added `save_secret` so approved setup sessions can save encrypted app/source credentials through RunnerOS instead of telling users to copy values into files.
- Hardened `save_secret`: only HNIC and Setup Concierge can save RunnerOS secrets; ordinary workers and manual sessions are blocked from directly writing credentials.
- Hardened global-source credential saves from agent setup so app/global keys refresh every workspace using that global source, matching the Settings credential path.
- Wired Industry Hunter to Zero: `zero` skill/source, LinkedIn/email enrichment prompt rules, existing-install migration, and campaign default worker visibility.
- Regenerated `docs/system-map/` so Industry Hunter now maps to `artist-industry-hunter`, `zero`, and campaign worker launch surfaces.
- Updated Setup Concierge guidance to default to app-level/global credentials so the same keys work across the whole app unless a user explicitly wants a workspace override.
- Re-ran release-oriented automated gates after the hardening fix: focused Creator Command Center tests, shared/server-core/Electron typechecks, and full monorepo `typecheck:all`.
- Launched Electron dev from this worktree and verified the app initializes, connects the renderer, loads skills, refreshes Pi/OpenAI model lists, and sends a real live prompt without the prior immediate `Session Expired` failure.
- Implemented Outputs -> Finals V1: users can promote Outputs into HQ/campaign Finals, mark optional Primary, remove exact Final pointers, and agents can call `promote_output_to_final`.
- Hardened Finals storage with a shared filesystem lock, corrupt-registry fail-closed behavior, campaign-id requirements, delete guards for Outputs still referenced by Finals, and direct session-tool tests.
- Updated user/spec/map docs for Finals behavior and agent tool awareness.

## In Progress

- Creator Command Center / Artist HQ feature work continues on this branch.

## Next Actions

1. Continue release hardening from Settings/Connections and real-key smoke paths.
2. Keep the user guide current as features stabilize; do the final user-guide polish near release.
3. Regenerate `docs/system-map/` after changing starter agents, worker visibility, workflow templates, or launch routing.
4. Re-run focused tests when code, not docs, changes.

## Blockers / External Dependencies

- No current auth blocker for the basic live chat path. Remaining external-service smokes still need connected provider accounts/keys.
- External-service smokes need real keys/accounts entered through the app. Do not hardcode user credentials into tracked app data.

## Verification State

- Verified Shared Intel hardening with router/RPC tests, shared typecheck, and server-core typecheck.
- Verified HQ State of Play with focused composer/refresh/Google Workspace/proactive helper tests, shared typecheck, server-core typecheck, Electron typecheck, and `git diff --check`.
- Verified live Share Intel click updates an existing context note and narrows targets to the matching available worker instead of creating duplicates or keeping stale over-routes.
- Verified git branch before cleanup.
- Verified moved paths with `rg` and updated stale references.
- Electron typecheck required for Artist HQ UI changes.
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
  - `bun test packages/server-core/src/sessions/memory-policy.test.ts packages/session-tools-core/src/handlers/save-secret.test.ts packages/session-tools-core/src/tool-defs-filtering.test.ts` -> `19 pass`.
  - `bun test packages/shared/src/agent/backend/claude/session-tool-parity.test.ts packages/shared/src/agent/backend/pi/session-tool-parity.test.ts packages/shared/src/agent-definitions/storage.test.ts apps/electron/src/shared/__tests__/ipc-channels.test.ts` -> `67 pass`.
  - `bun run typecheck:electron` passed after the Setup Concierge secret-save hardening.
  - `(cd packages/server-core && bun run tsc --noEmit)` passed after the Setup Concierge secret-save hardening.
- Verified on 2026-07-06:
  - `bun test packages/server-core/src/outputs/OutputService.test.ts apps/electron/src/renderer/components/outputs/__tests__/FinalsWidget.test.ts packages/session-tools-core/src/handlers/outputs.test.ts` -> `40 pass`.
  - `bun run typecheck:electron` passed.
  - `(cd packages/server-core && ../../node_modules/.bin/tsc --noEmit)` passed.
  - `bun run --cwd packages/session-mcp-server build` passed.
  - `git diff --check` passed.

## Remaining Release Smoke

- Remaining external-service smokes should use the local smoke profile so real keys and artist/campaign context stay outside tracked app data.

## Notes For Next Agent

- Do not treat every old audit as current truth. Use `docs/audits/README.md` and current code before acting on old findings.
- Feature-folder paths were mostly preserved intentionally to avoid breaking links.

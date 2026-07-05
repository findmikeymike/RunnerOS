---
status: active
owner: agent
last_verified: 2026-07-05
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-07-05
- Branch: `codex/work-products-output-architecture`
- Current goal: smoke and review Work Products / Output Architecture on top of current Creator Command Center.
- Overall state: feature branch is rebased on `origin/codex/creator-command-center`, clean, pushed to origin, and 2 commits ahead.

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
- Added Work Products / Output Architecture:
  - Output manifests now carry optional `context` and `approval`.
  - `create_output` accepts HQ/campaign context and approval state.
  - `outputs:updateApproval` updates decisions and refreshes widgets.
  - HQ and campaign homes show Work Products split into `Needs Approval` and `Recent Work`.
  - Generated `context/output-index` gives HNIC/agents compact Work Product awareness.
  - HQ State of Play can route pending Work Product approvals to manual review.
- Added local-only smoke profile system:
  - private data lives in `.local-smoke/`
  - demo templates live in `scripts/smoke/templates/demo/`
  - loader lives at `scripts/smoke/load-local-smoke-profile.ts`
  - setup doc lives at `docs/development/local-smoke-profile.md`

## In Progress

- Visual/live smoke of Work Products widgets is next.

## Next Actions

1. Keep new specs in the right feature folder or `docs/specs/`.
2. Load demo or private smoke profile into a disposable workspace and run the Electron UI smoke.
3. Verify HQ widget, campaign widget, approval drawer, manifest updates, `output-index`, and State of Play routing.
4. Regenerate `docs/system-map/` after changing starter agents, worker visibility, workflow templates, launch routing, or Work Product wiring.
5. Archive stale docs only when a newer source of truth is clear.

## Blockers / External Dependencies

- Chat model response path hit expired OAuth during smoke (`Session Expired`). Share Intel still validated because it reads the local transcript, but live model generation needs re-auth before release smoke is complete.
- Real service keys must stay in `.local-smoke/profile-real/services.env` or the app's local secret store. Do not commit private artist/campaign data.

## Verification State

- Verified Shared Intel hardening with router/RPC tests, shared typecheck, and server-core typecheck.
- Verified HQ State of Play with focused composer/refresh/Google Workspace/proactive helper tests, shared typecheck, server-core typecheck, Electron typecheck, and `git diff --check`.
- Verified live Share Intel click updates an existing context note and narrows targets to the matching available worker instead of creating duplicates or keeping stale over-routes.
- Verified git branch before cleanup.
- Verified moved paths with `rg` and updated stale references.
- Electron typecheck required for Artist HQ UI changes.
- Verified Work Products branch after rebase:
  - `/Users/michaelb.williams/.bun/bin/bun test packages/shared/src/outputs/storage.test.ts packages/session-tools-core/src/handlers/outputs.test.ts packages/server-core/src/outputs/OutputService.test.ts packages/shared/src/hq-state/composer.test.ts packages/shared/src/prompts/__tests__/system.test.ts packages/shared/src/agent-definitions/canvas-guidance.test.ts apps/electron/src/shared/__tests__/ipc-channels.test.ts` passed with `73 pass`.
  - `env PATH=/Users/michaelb.williams/.bun/bin:$PATH npm run typecheck:all -- --pretty false` passed.
  - `git diff --check origin/codex/creator-command-center...HEAD` passed.
  - Demo smoke loader wrote context docs, seeded 3 Outputs, and generated `context/output-index` in `/tmp/runneros-demo-smoke`.

## Notes For Next Agent

- Do not treat every old audit as current truth. Use `docs/audits/README.md` and current code before acting on old findings.
- Feature-folder paths were mostly preserved intentionally to avoid breaking links.
- For Work Products, use `docs/creator-command-center/10-work-products-output-architecture-spec.md` and `docs/development/local-smoke-profile.md` before adding new metadata or smoke fixtures.

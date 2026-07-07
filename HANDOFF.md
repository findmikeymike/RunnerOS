# Handoff: Creator Command Center

## Current Worktree

- Path: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/creator-command-center`
- Branch: `codex/creator-command-center`
- Product direction: RunnerOS / Artist OS local creator command center.
- Current push: release hardening, Settings/Connections polish, real-key smoke readiness, worker/source correctness.

## Read First

1. `docs/README.md` - docs routing map.
2. `docs/CURRENT.md` - current status, verification, next actions.
3. `docs/user/` - concise user-facing guide drafts.
4. `docs/system-map/` - generated map of workers, skills, sources, and launch surfaces.
5. `docs/development/local-smoke-profile.md` - local real-key smoke setup.

## Recent Work To Preserve

- Implemented Outputs -> Finals V1 hardening and UI polish.
- Finals are lightweight pointers in `context/finals/CONTEXT.md`; Output bundles remain canonical.
- Finals writes use a shared filesystem lock at `context/.locks/output-finals.lock`.
- Corrupt Finals registry updates fail closed; deleting an Output referenced by Finals is blocked.
- Output list/detail actions use `OutputFinalActionDialog`, not `window.prompt`.
- Campaign Finals now auto-use the active campaign workspace id; raw campaign id entry only appears as an orphan-output fallback.
- Added Setup Concierge as the app/setup specialist worker.
- HNIC routes app guidance, service setup, key, and "how do I use this?" questions to `@setup-concierge`.
- Setup Concierge carries `artist-os-guide` and `source-recipe`.
- Added `save_secret` for approved encrypted credential saves.
- Hardened secret writes so only HNIC and Setup Concierge can save RunnerOS secrets.
- Global source credentials saved by Setup Concierge now refresh every workspace using that source.
- Setup guidance now defaults to app/global keys for the whole app experience; workspace overrides are explicit exceptions.
- Settings UI has been heavily cleaned up in this workstream; preserve those UX choices unless user redirects.

## Current Dirty Files

Expected current edits:
- Outputs/Finals UI context fix:
  - `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
  - `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
  - `apps/electron/src/renderer/components/outputs/OutputFinalActionDialog.tsx`
  - `apps/electron/src/renderer/components/outputs/OutputsListPanel.tsx`
  - `apps/electron/src/renderer/lib/output-finals-actions.ts`
  - `apps/electron/src/renderer/lib/__tests__/output-finals-actions.test.ts`
  - `apps/electron/src/renderer/pages/OutputDetailPage.tsx`
- Docs updated for Outputs/Finals status, handoff, and system map.
- Unrelated existing docs edits may be present in `docs/backlog/`.

Do not revert unrelated user/agent work.

## Verified Commands

```bash
PATH="$HOME/.bun/bin:$PWD/node_modules/.bin:$PATH" bun test packages/server-core/src/sessions/memory-policy.test.ts packages/session-tools-core/src/handlers/save-secret.test.ts packages/session-tools-core/src/tool-defs-filtering.test.ts
PATH="$HOME/.bun/bin:$PWD/node_modules/.bin:$PATH" bun test packages/shared/src/agent/backend/claude/session-tool-parity.test.ts packages/shared/src/agent/backend/pi/session-tool-parity.test.ts packages/shared/src/agent-definitions/storage.test.ts apps/electron/src/shared/__tests__/ipc-channels.test.ts
PATH="$HOME/.bun/bin:$PWD/node_modules/.bin:$PATH" bun test apps/electron/src/renderer/lib/__tests__/output-finals-actions.test.ts apps/electron/src/renderer/components/outputs/__tests__/FinalsWidget.test.ts packages/session-tools-core/src/handlers/outputs.test.ts packages/server-core/src/outputs/OutputService.test.ts
PATH="$HOME/.bun/bin:$PWD/node_modules/.bin:$PATH" bun run typecheck:electron
cd packages/server-core && PATH="$HOME/.bun/bin:$PWD/../../node_modules/.bin:$PATH" bun run tsc --noEmit
git diff --check
```

## Next Best Actions

1. Regenerate/check `docs/system-map/` after any worker/starter-agent changes.
2. Continue Settings/Connections and real-key smoke hardening.
3. Keep `docs/user/` updated as features stabilize; do final user-guide polish near release.
4. Run live app smoke when user has entered real keys through the app.
5. For Finals next, build text-selection `Save as Output` / `Set as Final`; do not add complex asset-state machinery.

## Watchouts

- Do not store user keys in tracked files.
- Do not tell users to paste passwords, 2FA codes, cookies, or recovery codes.
- Browser-guided login is the right path for many dashboard-only services.
- Treat app/global credentials as the default so one key setup works across HQ and campaign workspaces.
- Required tools/sources should fail loudly before execution, not halfway through.

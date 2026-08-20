---
status: current
owner: agent
last_verified: 2026-08-20
source_of_truth: true
upstream_baseline: craft-agents-oss v0.11.4
---

# Craft Upstream Porting Ledger — Artist OS / Runner

## Purpose

This is the transfer document for applying the same proven Craft OSS reliability updates to another Runner-derived product. Port capabilities selectively; do not merge an upstream release wholesale. Each product must retain its own runtime identity, storage, credentials, ports, protocol, updater channel, and packaging identity.

Audit window: Craft OSS `v0.9.0` through `v0.11.4` (April 30–August 6, 2026). Artist OS implementation branch: `codex/artist-os-runtime-isolation`.

## Ported Capabilities and Exact Code

| Capability | Craft release | Artist OS / Runner code | Verification |
| --- | --- | --- | --- |
| Claude SDK packaging | v0.9.0, later packaging repairs | `apps/electron/electron-builder.common.yml`; `apps/electron/electron-builder.yml`; `apps/electron/electron-builder.artist-os.yml`; `apps/electron/scripts/build-dmg.sh`; `apps/electron/scripts/build-win.ps1`; `scripts/build/common.ts`; `packages/shared/src/agent/options.ts` | Electron build/package, packaged SDK version check, then live Claude session |
| Hoisted Bun dependency layout | v0.9.0 | `bunfig.toml`; `bun.lock` | Install and all builds |
| Safe transitive package correction | local adaptation required by current Bun graph | `patches/incr-regex-package@1.0.4.patch`; root `package.json` exact overrides | Install, typecheck, build; do not replace with blanket major overrides |
| Source probe reliability | v0.9.x selective port | `packages/session-tools-core/src/handlers/source-test.ts`; `packages/shared/src/mcp/validation.ts`; `packages/shared/src/sources/api-tools.ts`; tests beside those files | Port commits `345144f9f`, `c7c5f9d6a` |
| Large tool-response safeguards and context-scaled limits | v0.9.1 selective port | `packages/shared/src/utils/large-response.ts`; `packages/shared/src/agent/claude-sdk-error-mapper.ts`; Pi and Claude callers; tests in `packages/shared/src/utils/__tests__` | Port commit `3808f162d` |
| Source activation, prerequisites, refresh reliability | v0.9.x selective port | `packages/shared/src/agent/core/prerequisite-manager.ts`; `packages/shared/src/sources/token-refresh-manager.ts`; `packages/shared/src/prompts/system.ts`; `packages/pi-agent-server/src` | Port commit `8d7ea99ff` |
| Daily config backups, first snapshot per day, newest three retained | v0.10.4 | `packages/shared/src/config/storage.ts` | Config tests and startup smoke |
| Product-specific embedded server defaults | local isolation adaptation | `packages/shared/src/config/server-config.ts`; `packages/shared/src/config/__tests__/server-config.test.ts`; `packages/server/src/index.ts`; `packages/server-core/src/bootstrap/headless-start.ts` | Runner/Artist identity tests and two-server smoke |
| Stale lock validates executable identity, not PID alone | v0.11.3 | `packages/server-core/src/bootstrap/lock-identity.ts`; `packages/server-core/src/bootstrap/lock-identity.test.ts`; `packages/server-core/src/bootstrap/headless-start.ts` | Lock identity tests |
| Claude Agent SDK `0.3.220` | v0.11.3 | root `package.json`; `packages/core/package.json`; `packages/shared/package.json`; `bun.lock` | Typechecks passed; live Sonnet active-chat/cancel/resume smoke passed 2026-08-20 |
| Pi SDK `0.80.6` | v0.11.1 | root `package.json`; `packages/shared/package.json`; `packages/server-core/package.json`; `packages/pi-agent-server/package.json`; `bun.lock` | Typechecks and live DeepSeek chat/terminal-tool smoke passed 2026-08-20 |
| Pi prompt-cache stable/volatile split | v0.10.2 | `packages/shared/src/agent/core/prompt-builder.ts`; `packages/shared/src/agent/pi-agent.ts`; `packages/shared/src/agent/__tests__/prompt-builder-context-split.test.ts` | Unit tests |
| Retryable session transcript loading | v0.9.0 | `apps/electron/src/renderer/lib/session-load.ts`; `apps/electron/src/renderer/lib/__tests__/session-load.test.ts`; `apps/electron/src/renderer/pages/ChatPage.tsx`; `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | Unit tests plus manual Retry smoke |
| Background Claude agents survive turn boundaries | v0.11.0 | `packages/shared/src/agent/backend/claude/persistent-input.ts`; `packages/shared/src/agent/backend/claude/persistent-input.test.ts`; `packages/shared/src/agent/backend/claude/task-notification.ts`; `packages/shared/src/agent/claude-agent.ts`; `packages/shared/src/agent/backend/types.ts`; `packages/server-core/src/sessions/SessionManager.ts` | Stream/classifier tests passed; live Sonnet child completed after the parent turn ended on 2026-08-20 |
| Idle background completion wakes session and surfaces checked result | v0.11.0 | `packages/server-core/src/sessions/SessionManager.ts`; `packages/server-core/src/sessions/background-task-surface.test.ts`; hidden-message contract in `packages/shared/src/protocol/dto.ts` and `packages/core/src/types/message.ts`; transcript filtering in `packages/ui/src/components/chat/turn-utils.ts`; existing renderer task handling in `apps/electron/src/renderer/App.tsx`, `atoms/sessions.ts`, `components/app-shell/ActiveTasksBar.tsx` | Regression tests and live completion/open-child/reload smoke passed 2026-08-20 |
| Explore-mode blocked tools return control to model | v0.11.4 compatibility fix for SDK 0.3.220 | `packages/shared/src/agent/mode-manager.ts`; `packages/shared/src/agent/__tests__/mode-manager-block.test.ts` | Unit test and live Sonnet blocked-Write recovery smoke passed 2026-08-20 |
| Always-on, product-isolated updater log | v0.10.4 | `apps/electron/src/main/logger.ts`; `apps/electron/src/main/auto-update.ts` | Inspect active product's `logs/auto-update.log` |
| Installer handoff cleanup and failed-handoff relaunch | v0.11.3 | `apps/electron/src/main/auto-update.ts`; `apps/electron/src/main/index.ts` | Packaged update smoke required |

## Product-Isolation Adaptations That Must Not Be Copied Literally

Artist OS uses `RUNTIME_IDENTITY` and writes beneath `~/.artist-os`; another Runner fork must define its own identity instead of copying that root.

Primary code:

- `packages/shared/src/config/runtime-identity.ts`
- `packages/shared/src/config/storage.ts`
- `packages/shared/src/config/server-config.ts`
- `apps/electron/src/main/bootstrap.ts`
- `apps/electron/src/main/shell-env.ts`
- `apps/electron/src/renderer/lib/product-identity.ts`
- `scripts/check-product-isolation.ts`
- `scripts/migrate-runner-to-artist-os.ts`
- `tools/runtime-credential-isolation.test.ts`

For each new product, change and test: data root, app ID, product name, URL protocol, keychain namespace, browser partition, ports, locks, logs, updater feed/channel, mutable agent/skill/workflow roots, and every subprocess environment handoff. Never add automatic fallback to `~/.craft-agent` or another product's store.

## Historical Port Commits

Use these only as evidence and diff references; current files have moved and include later Artist OS work.

- `8d7ea99ff` — upstream source/runtime reliability.
- `345144f9f` — source-probe and HTTP MCP reliability.
- `3808f162d` — large-response safeguards.
- `c7c5f9d6a` — reliability gap fixes.
- `c045559c8` — Claude native SDK release packaging.

## Live Claude Proof — 2026-08-20

- Connection/model: Claude Max, Sonnet 4.6. No Opus or Fable credits used.
- Background lifecycle: a `critic` child returned `BG_CHILD_OK` after its parent turn had already completed; the parent updated to one compact finished card and opened the correct child session.
- Transcript UX: commits `fe1c635bf` and `1813a40ce` hide receipt/session plumbing and model-only delegation protocol while preserving durable storage and resume context.
- Active cancellation: a streaming response stopped through the shipped `Stop response` control and rendered `Response interrupted`.
- Same-session resume: the next message in that exact session completed with `RESUME_OK`.
- Reload: the assigned-task brief and completed output survived a renderer reload.
- Pi/DeepSeek: the existing `deepseek-v4-pro` session completed normal chat and used the terminal tool to return the isolated Artist OS workspace path.
- Explore recovery: Sonnet attempted one Write in Explore mode, received the expected block, returned `EXPLORE_BLOCK_RECOVERED`, and created no file.

## Evaluated but Not Ported

| Upstream capability | Release | Decision for Artist OS | Reconsider when |
| --- | --- | --- | --- |
| Lark / Feishu adapter | v0.9.0 | Deferred; adds a platform and credential surface without current Artist demand | Lark becomes a supported publishing/community channel |
| Telegram supergroup topics and access-control UI | v0.9.0–v0.9.1 | Deferred | Artist community workflows explicitly target Telegram forums |
| Group sessions by Unread | v0.9.0 | Deferred UI preference | Session volume makes current filters insufficient |
| Remote Electron `browser_tool` bridge | v0.10.0 | Not ported in this slice; valuable only for remote/headless workspaces and requires authorization review | Remote Artist OS workspaces ship |
| Per-connection Steer vs Queue setting | v0.9.1 | Deferred; current send/queue behavior is already product-tested | Users need connection-specific control |
| Custom endpoint vision toggle UI | v0.9.1 | Deferred | Custom multimodal endpoints become a supported primary path |
| Link-valued labels | v0.10.2 | Deferred product enhancement | Campaign/session labels need external CRM links |
| Restore last sent prompt on Stop / Up-arrow cancel | v0.10.2, v0.11.2 | Deferred UX enhancement; queued-message restoration already exists | Manual chat polish lane |
| Craft Projects panel | v0.11.0 | Do not port; overlaps Artist HQ and Campaign | Only reuse isolated implementation ideas, never the full model |
| Craft Kanban board / Tasks / Conductor / repair loop | v0.11.0–v0.11.2 | Do not port wholesale; overlaps Release Board, workers, and workflows and would duplicate orchestration | A specific missing capability survives a product-level design review |
| `create_task` and `archive_session` agent tools | v0.11.2–v0.11.3 | Deferred; tied to Craft task/session semantics | Artist OS defines equivalent safe user-facing actions |
| Workspace session transfer | v0.11.2 | Deferred; cross-product transfer is forbidden by isolation | Same-product workspace transfer is explicitly designed and audited |
| Full background-task registry, dismissible/floating chips, unknown-state timers, workflow fan-out counters | v0.11.0–v0.11.2 | Core survival and existing active-task UI were ported; newer status-polish layer was not | Live smoke shows users cannot understand task state |
| Local Network entitlement text | v0.11.0 | Deferred pending packaged entitlement review | LAN Ollama or LAN MCP is formally supported |
| Automation Test early-ack timeout fix | v0.11.0 | Not yet ported | Automation Test reproduces the 30-second false timeout |
| `archive_session`, filter-inheritance, local `%20` links, CJK capitalization, Windows path/Git Bash fixes | v0.11.3 | Not blindly ported; each needs current-code reproduction because this fork diverged | A targeted current-code test proves the bug exists |
| Newer model-catalog additions and migrations (Fable 5, Sonnet 5, GPT-5.6, Opus migrations) | v0.10.3–v0.11.4 | Not bulk-copied; provider availability and names must be verified against live APIs | Model/provider verification lane |
| macOS Intel support removal | v0.10.1 | Explicitly rejected as an inherited decision | Artist OS makes its own support policy |
| Broad mobile/compact UI and full i18n changes | v0.9.x–v0.11.x | Deferred product work | Dedicated responsive/localization phase |

## Safe Transfer Procedure for Another Runner Fork

1. Record the destination branch, commit, dirty files, runtime identity, and package manager version.
2. Fetch Craft tags and compare the exact destination files against `v0.11.4`; do not cherry-pick a full release.
3. Port one capability row at a time. Adapt every path/log/lock/updater change through the destination product's runtime identity.
4. Upgrade Claude and Pi versions together with the prompt-cache and `blockWithReason` compatibility changes.
5. Run the capability's focused tests, then full typecheck, Electron/WebUI builds, clean package, and packaged runtime execution.
6. Smoke active chat, cancel, resume, slash command, Explore-mode block recovery, Pi tools, background work across a second turn, idle completion, session-load Retry, and updater handoff.
7. Run the destination product-isolation canary. Prove it neither reads nor writes Runner or Artist OS mutable state.
8. Record remaining dependency advisories; never force a transitive major override inside authentication, updater, or messaging protocol stacks.

## Minimum Commands

```bash
git status --short
git branch --show-current
bun install
bun test <focused-test-files>
bun run typecheck:all
bun run electron:build
bun run webui:build
git diff --check
```

Packaging and isolation commands are product-specific; use that fork's named build/package scripts and containment gate rather than Artist OS commands verbatim.

## Required Live Smokes Still Open Here

- Claude active chat, cancel, resume, and slash command after SDK `0.3.220`.
- Pi chat, tool call, and cache-hit behavior after `0.80.6`.
- Background agent survives a later user turn and an idle completion wakes with the result.
- Session-load failure displays Retry and recovers.
- Packaged updater writes its dedicated log, hands off to the installer, and relaunches safely on simulated failure.
- Clean-machine, signing/notarization, Windows/Linux, browser-account, side-by-side, update, and uninstall isolation gates.

## Current Packaging Truth

The exact-current source passes focused tests, full TypeScript typecheck, Artist OS production build, and the product-isolation canary. A packaging verification pass generated macOS arm64 and x64 apps/DMGs/ZIPs with the correct `com.findmikeymike.artistos` identity, `artistos://` scheme, architecture, and bundled Claude SDK `0.3.220`.

Those installers are **not release-ready**: macOS reports zero valid code-signing identities, both generated apps fail strict signature verification, and notarization was skipped because notarization options were unavailable. Restore a valid Developer ID identity, rebuild, verify both app signatures, then notarize and staple before distribution.

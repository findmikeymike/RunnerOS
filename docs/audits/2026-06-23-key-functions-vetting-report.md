# RunnerOS Key Functions Vetting Report

Date: 2026-06-23
Branch: `codex/agent-adds`
Scope: source/tool permission boundaries, agent delegation, automations/workflows/pulses, Electron trust surfaces, and selected UI/runtime complex paths.

## Critical / High Findings

### 1. Critical: `source_test` can execute workspace-controlled local scripts in Safe mode

`source_test` is registered as Safe-mode allowed, but it can run local doctor scripts for `lottie` and `video-studio`.

Evidence:
- `packages/session-tools-core/src/tool-defs.ts:1181` marks `source_test` as `safeMode: 'allow'`.
- `packages/session-tools-core/src/handlers/source-test.ts:71` loads the source config by slug.
- `packages/shared/src/agent/claude-context.ts:293-296` prefers workspace source config before built-ins.
- `packages/session-tools-core/src/handlers/source-test.ts:870-881` calls `ctx.testLocalSource(source)` for local sources.
- `packages/shared/src/agent/claude-context.ts:221-239` runs `node bin/lottie.mjs doctor --json` or `node bin/video-studio.mjs doctor --json` from `source.local.path`.

Impact: a workspace can shadow a built-in `lottie` or `video-studio` source and make a Safe-mode validation tool execute repo-controlled code.

Fix direction: only run built-in doctor commands for verified built-in source configs and bundled paths. Otherwise treat local source doctor execution as Ask/Block.

### 2. High: Browser automation is allowed in Safe mode despite mutating commands

`browser_tool` is globally treated as safe/read-only, but its command surface includes mutation.

Evidence:
- `packages/session-tools-core/src/tool-defs.ts:1196` marks `browser_tool` as `safeMode: 'allow'`.
- `packages/shared/src/agent/mode-manager.ts:1796-1805` puts `browser_tool` in `ALWAYS_ALLOWED_TOOLS`.
- `packages/shared/src/agent/mode-manager.ts:1869-1873` also allows browser aliases.
- Browser docs expose `click`, `drag`, `fill`, `type`, `select`, `upload`, `set-clipboard`, `paste`, and `evaluate`.

Impact: Safe/Explore mode can still click, type, upload files, paste clipboard data, or execute page JS.

Fix direction: enforce command-level permissions. Allow read commands like `snapshot`, `find`, `screenshot`; require Ask/Auto for mutating commands.

### 3. High: Source-level permissions can globally widen write boundaries

Source permission config is additive and scoped for MCP patterns, but write paths are applied globally.

Evidence:
- `packages/shared/src/agent/permissions-config.ts:715-722` applies active source configs into the merged session config.
- `packages/shared/src/agent/permissions-config.ts:857-860` adds `allowedWritePaths` with global effect.
- `packages/shared/src/agent/mode-manager.ts:1984-1988` then allows writes matching those paths.

Impact: enabling a source can widen the whole session's file-write authority, not just that source's tools.

Fix direction: source-level write permissions should be disallowed, Ask-only, or explicitly scoped to source-owned directories.

### 4. High: Remote workspace clients disable TLS certificate validation

Remote WebSocket clients explicitly set `tlsRejectUnauthorized: false`.

Evidence:
- `apps/electron/src/preload/bootstrap.ts:117-128`
- `apps/electron/src/preload/bootstrap.ts:143-153`
- `apps/electron/src/main/handlers/workspace.ts:21-28`

Impact: remote workspace traffic can be intercepted by a bad certificate without failing closed.

Fix direction: default to normal TLS validation. Add an explicit dev-only insecure override with visible warnings.

### 5. High: `message_agent` defaults child permission to the parent, not the target agent's safer default

Delegated child sessions inherit the parent permission mode unless the caller passes a lower mode.

Evidence:
- `packages/shared/src/agent-messaging/validation.ts:68-89` defaults `permissionMode` to `parentPermissionMode`.
- `packages/server-core/src/agent-messaging/AgentMessageService.ts:181-187` creates the child session with `permissionMode: input.permissionMode`.

Impact: a parent running `allow-all` can spawn a specialist agent whose own metadata expects a safer mode, but the child runs with `allow-all`.

Fix direction: default to the target agent's configured permission mode capped by parent permission. Never silently raise above the target default.

### 6. High: `message_agent` can bypass target source/skill boundaries

Caller-provided `sourceSlugs` and `skillSlugs` replace the target agent bundle after only generic source usability checks.

Evidence:
- `packages/server-core/src/agent-messaging/AgentMessageService.ts:164-177` resolves target options, then replaces enabled sources/skills with caller input.
- `packages/server-core/src/sessions/SessionManager.ts:5092-5100` checks whether requested sources are usable, not whether they belong to the target agent.

Impact: the caller can give a delegated agent sources/skills outside that agent's intended bundle.

Fix direction: intersect requested sources/skills with the target agent's resolved bundle, or reject extras explicitly.

### 7. High: Hidden delegated/workflow/pulse sessions leak into session lists and can be targeted

Hidden sessions are created for delegated agents, workflows, and pulses, but normal session listing does not filter them.

Evidence:
- `packages/server-core/src/sessions/SessionManager.ts:3100-3112` returns all sessions for a workspace.
- `packages/server-core/src/handlers/rpc/sessions.ts:117-128` returns that list to the renderer.
- `packages/server-core/src/sessions/SessionManager.ts:4771-4778` exposes it to `list_sessions`.
- `packages/server-core/src/sessions/SessionManager.ts:5025-5067` allows sending to any same-workspace session.
- `packages/server-core/src/workflows/runner.ts:591-618` creates hidden workflow step sessions.
- `packages/server-core/src/sessions/SessionManager.ts:1897-1902` creates hidden pulse driver sessions.

Impact: internal child sessions can appear in public lists, be bound to external messaging, or receive injected messages.

Fix direction: hide hidden sessions by default everywhere; require parent/lineage checks or a capability token for targeted sends.

### 8. High: Generated output HTML can open in Browser Pane with broad permissions

Generated output URLs can be opened in Browser Pane, whose partition auto-allows sensitive permissions.

Evidence:
- `apps/electron/src/renderer/components/outputs/OutputWebPreview.tsx:50-72` opens target output URLs in Browser Pane.
- `apps/electron/src/main/browser-pane-manager.ts:2776-2810` allows permissions including notifications, geolocation, media, clipboard-read, and idle-detection.

Impact: untrusted generated output can request privileged browser capabilities inside the app.

Fix direction: deny sensitive permissions for generated output origins and require explicit user approval for anything beyond display.

### 9. High: Duplicating `WebhookReceive` automations can fail-close external inputs

Template creation uniquifies webhook slugs, but the duplicate handler does not.

Evidence:
- `packages/server-core/src/handlers/rpc/automations.ts:244-262` uniquifies slugs for template creation.
- `packages/server-core/src/handlers/rpc/automations.ts:277-284` duplicates a matcher without changing its slug.
- `packages/shared/src/automations/validation.ts:62-76` treats duplicate webhook slugs as an error.
- `packages/shared/src/automations/automation-system.ts:136-150` fail-closes external inputs when config validation fails.

Impact: duplicating a webhook automation can make inbound external triggers stop working until manually repaired.

Fix direction: reuse the same slug-unique logic in duplicate/edit paths and add a regression test.

### 10. High: Bound message automations can race and steal a channel binding

Multiple prompt automations can bind the same messaging channel in parallel.

Evidence:
- `packages/shared/src/automations/handlers/prompt-handler.ts:100-116` queues all matching bound prompts.
- `packages/server-core/src/sessions/SessionManager.ts:1802-1810` executes pending prompt automations with `Promise.allSettled`.
- `packages/server-core/src/sessions/SessionManager.ts:8820-8826` binds the channel when the session is created.
- `packages/messaging-gateway/src/binding-store.ts:86-94` evicts any existing binding for that channel.

Impact: if two automations match one inbound message, the final bound session is nondeterministic.

Fix direction: serialize per channel or reject multiple `bindMessagingChannel` actions for the same event.

## Medium Findings

### API debug logs can expose credentials or sensitive payloads

`packages/shared/src/sources/api-tools.ts:223-246` logs full URL, raw body preview, and headers. `packages/shared/src/utils/debug.ts:100-109` mirrors debug logs into Electron logs.

### `source_test` can mark auth-required API sources as connected

`packages/session-tools-core/src/handlers/source-test.ts:154-155` auto-enables connected sources. `packages/session-tools-core/src/handlers/source-test.ts:673-676` treats 401/403 as reachable success. Later use may still fail because `SessionManager` checks usability, but the saved source state can be misleading.

### Workflow single-run guard is not atomic

`packages/server-core/src/workflows/runner.ts:189-195` checks `activeByKey`, awaits preflight, then reserves at `220-222`. Rerun has the same pattern at `283-289` then `326-328`.

### Pulse ask/answer loop appears half-wired

`packages/server-core/src/pulses/PulseExecutor.ts:92-98` supports open questions/recent answers, but the `SessionManager` construction at `packages/server-core/src/sessions/SessionManager.ts:1882-1906` does not provide those deps.

## Tests Run

All targeted tests passed:

```bash
bun test packages/server-core/src/agent-messaging/AgentMessageService.test.ts packages/shared/src/agent-messaging/validation.test.ts packages/shared/src/agent-messaging/storage.test.ts packages/session-tools-core/src/handlers/message-agent.test.ts packages/session-tools-core/src/handlers/send-agent-message.test.ts
bun test packages/session-tools-core/src/handlers/source-test.test.ts packages/shared/src/agent/__tests__/send-agent-message-permissions.test.ts packages/shared/src/prompts/__tests__/system.test.ts
bun test apps/electron/src/renderer/components/outputs/__tests__/web-preview.test.ts packages/server-core/src/triggers/trigger-server.test.ts packages/shared/src/automations/handlers/prompt-handler.test.ts
```

Result: 109 passed, 0 failed.

## Not Live-Verified

- No full Electron UI run was performed.
- No real remote workspace TLS connection was tested.
- No live Browser Pane permission prompt was exercised.
- No exploit PoC was executed for the `source_test` local-script issue.

## Recommended Fix Order

1. Lock down `source_test` local doctor execution.
2. Split `browser_tool` permissions by command.
3. Stop source configs from globally widening write paths.
4. Re-enable TLS certificate validation for remote workspaces.
5. Fix `message_agent` permission/source/skill boundary checks.
6. Filter and protect hidden sessions.
7. Restrict Browser Pane permissions for generated output origins.
8. Fix webhook duplicate slug handling.
9. Serialize or reject competing bound message automations.

# Phase 1 — Final Holistic Integration Audit (Axis: INTEGRATION + WIRING)

**Reviewer:** code-review-swarm (integration auditor, 1 of 4)
**Date:** 2026-05-20
**Scope:** Phase 1 as a system — how the 8 features compose, not whether each unit works.
**Working tree:** `/Users/michaelb.williams/RunnerOS/.claude/worktrees/sad-clarke-10a760`

This audit reads code as-shipped. It does not run tests (parallel lanes own that).

---

## Axis 1 — End-to-end runtime paths

### Cron-fired automation walk

1. `SchedulerService.tick()` (`packages/shared/src/scheduler/scheduler-service.ts:110`)
   → calls `shouldRunNow(this.gateConfig)` at **line 121**. **R3 gate is live in the production tick.** Fail-open on sampler exception (line 125 — `decision = 'run'`).
   → emits `SchedulerTick` event via `automation-system.ts:401`.
2. EventBus → `PromptHandler.handleEvent()` (`packages/shared/src/automations/handlers/prompt-handler.ts:47`)
   → for each `prompt` action, runs `assemblePrompt({userPrompt: expandedPrompt})` and `scanForInjection(assembled)` at **lines 103–104**. **R2 is invoked on the cron path.**
   → pushes `PendingPrompt` with `subconsciousMode` + `onEscalation` (lines 147–148) to `onPromptsReady`.
3. Workflow path: `WorkflowRunner.executeStepAttempt()` (`packages/server-core/src/workflows/runner.ts:706`)
   → resolves `resolveAgentSessionOptions` then **R5 toolset override** at `applyTriggerToolsetOverride` (line 726).
   → resolves **R7 trigger permission_mode** at `resolveTriggerPermissionMode` (line 736) and writes `subconsciousMode` + `workflowRunId` onto `CreateSessionOptions` (lines 744–747).
   → creates session at line 753.
   → **R2 re-scan** of the assembled step prompt at lines 796–809 (independent of the prompt-handler scan).
4. Inside the session: `ClaudeAgent` (`packages/shared/src/agent/claude-agent.ts`)
   → `setSubconsciousMode` (line 501) sets instance state.
   → PreToolUse hook at line 1104 routes writes through `gateWriteAttempt` (line 1111) when `subconsciousMode !== 'default'`. **R7 fully wired.**
5. Spawned subagent: `createSpawnSessionTool` in `session-scoped-tools.ts:291–305` now passes `getDelegationConfig` (reads `loadStoredConfig().delegation`) and `getParentSourceSlugs` (reads `session.enabledSourceSlugs`). The 01-01-REVIEW B1 blocker is **fixed in shipped code**. Depth gate + intersection + AsyncLocalStorage approval scope all reach production.
6. ACP-targeted spawn: `spawn-session-tool.ts:150–175` checks `acpEndpoint` first; if set, delegates via `delegateToAcpEndpoint`. Local spawn isolation is bypassed entirely on the ACP path (see Axis 2).
7. Shell hook (R6) on PreToolUse: `ShellHookHandler` (`shell-hook-handler.ts`) is exported, but I see **no `new ShellHookHandler(...)` in `AutomationSystem.createHandlers()`** (`automation-system.ts:355–388` instantiates only PromptHandler, WebhookHandler, EventLogHandler). The same is true of `AcpSpawnHandler`. **R6 + R8 automation-action handlers are exported-but-not-wired.**
8. Config edit during run → `reactive-config.ts` is implemented, but **no production consumer imports it** (`rg "from.*reactive-config"` returns only the test). Confirms `01-04-FOLLOWUPS.md` deferral is still open.

### Gate invocation reality check

| Feature | Gate exists | Gate is on the production path | Notes |
|---|---|---|---|
| R1 isolation | ✅ `spawn-session-isolation.ts` | ✅ wired at `session-scoped-tools.ts:291` |
| R2 injection scan | ✅ `prompt-builder.ts` | ✅ wired at `prompt-handler.ts:103` + `runner.ts:796` | Two separate call sites, same module — good. |
| R3 scheduler gate | ✅ `gate.ts` | ✅ wired at `scheduler-service.ts:121` |
| R4 reactive-config | ✅ `reactive-config.ts` | ❌ **no production consumer** | Deferred per FOLLOWUPS, but worth flagging. |
| R5 toolset override | ✅ `trigger-inputs.ts` | ✅ wired at `runner.ts:726` |
| R6 shell hooks | ✅ `ShellHookHandler` | ❌ **not instantiated in AutomationSystem** |
| R7 subconscious | ✅ `gateWriteAttempt` | ✅ wired at `claude-agent.ts:1111` + `runner.ts:211` |
| R8 ACP adapter | ✅ ACP server + bridge | ⚠️ partial — `spawn-session-tool` ACP path is wired (`spawn-session-tool.ts:150`); `AcpSpawnHandler` automation path is **not instantiated** in `AutomationSystem`. |

---

## Axis 2 — Cross-feature interactions

### R1 (isolation) + R8 (ACP spawn) — `spawn-session-tool.ts`

**Composition is broken.** `spawn-session-tool.ts:146-175` returns *before* any isolation logic when `acpEndpoint` is set:

- `acpEndpoint` branch (line 150) runs before `getCurrentSpawnDepth` / `shouldRejectSpawn` (line 185).
- A subagent at `depth == max_spawn_depth` that supplies `acpEndpoint` **bypasses the depth gate entirely**. R1's fork-bomb guard does not apply to ACP delegation.
- `intersectSourceSlugs` is also skipped on the ACP path — a child could request sources the parent doesn't have, but since `delegateToAcpEndpoint` only forwards `prompt`/`cwd`/`endpoint`, source slugs are effectively unused; not a privilege escalation today, but the surface is unprotected if the ACP bridge ever forwards more.
- `createIsolatedApprovalCallback` + `approvalCallbackStorage.run` is skipped — the ACP-targeted subagent runs with whatever the parent's approval scope happens to be (effectively none).

`acpEndpoint` wins, `max_spawn_depth` is ignored. **High-severity composition gap.**

### R5 (per-job toolsets) + R7 (subconscious) — `runner.ts:599`+ region

Order in `executeStepAttempt`:
1. Line 715: `resolveAgentSessionOptions`
2. Line 719: `normalizeWorkflowPermissionMode` (Phase 0 normalize)
3. Line 726: `applyTriggerToolsetOverride` (R5)
4. Line 736: `resolveTriggerPermissionMode` (R7 hint)
5. Line 753: `createSession`

These don't conflict — R5 mutates `enabledSourceSlugs`, R7 mutates `subconsciousMode` + `workflowRunId`. They write different fields on the same options object. **Clean composition.** Order is R5-before-R7 but the order doesn't matter because the field sets are disjoint.

### R3 (scheduler gate) + R4 (reactive-config)

`SchedulerService` accepts `gateConfig` at construction (`automation-system.ts:401-410`) — but the constructor passes **no `gateConfig`**, so the scheduler uses `DEFAULT_GATE_CONFIG`. There is no `setGateConfig` invocation hooked to `subscribeConfigChanges`. This matches `01-04-FOLLOWUPS.md` item 2 (deferred). **No regression** — scheduler still works because the gate has sensible defaults — but R4's "hot-reload" promise is unrealized for the very service the SPEC R4 named first.

### R2 (injection scan) + R6 (shell hooks)

Per `shell-hook-handler.ts:28-29`: hook output of `{context: "..."}` is "expected to be prepended to the next prompt assembly." But **`ShellHookHandler` is not wired** (see Axis 1). If it were wired, the comment says the dispatcher injects context — but I find **no code that takes a `ShellHookOutcome.context` and feeds it through `assemblePrompt`**. The R2 scanner would not see hook-injected context today even if R6 were live, because there is no integration between `onHookResult` and `prompt-handler.ts`'s assembly step.

This is a latent integration bug: a malicious shell hook returning a `context` payload containing "ignore previous instructions" would bypass R2 once R6 ships. **Must address before R6 goes live.**

### R7 (subconscious) + R8 (ACP)

When a workflow has `permission_mode: "subconscious"` AND routes through ACP via `spawn_session(acpEndpoint=...)`:
- The workflow runner sets `subconsciousMode` on `CreateSessionOptions` (`runner.ts:744`).
- But the `spawn-session-tool` ACP branch (line 150) calls `delegateToAcpEndpoint(...)` with only `{endpoint, prompt, cwd, timeoutMs}` — `subconsciousMode` is dropped on the floor.
- `gateWriteAttempt` lives in `ClaudeAgent` (`claude-agent.ts:1111`), and the remote ACP agent is a *different process*. RunnerOS' escalation store is on the local machine.
- Result: writes on the remote agent are governed by **the remote agent's** policy, not RunnerOS's escalation flow. Escalation rows are never created. The user thinks their subconscious mode is in force; it is not, once you cross the ACP boundary.

**This is the most subtle and most dangerous composition gap.** Must document, fix, or block ACP delegation when subconscious mode is active.

---

## Axis 3 — Config / DSL consistency

- `permission_mode` / `enabled_source_slugs`: defined on `workflows/trigger-inputs.ts:101-103` with platform variants at 109-114. Single source-of-truth. Parser at `parseTriggerToolsetOverride` (line 135) used by both runner and prompt-handler. ✅
- `mode: "subconscious"` and the `"escalate-on-write"` alias: defined on `automations/types.ts:82` (DSL level) and normalized in `prompt-handler.ts:125-134`. Alias collapse logic is duplicated by `resolveSubconsciousAlias` in `subconscious-mode.ts` — two normalizers for the same input. **Minor drift risk** — would prefer one canonical normalizer used by both call sites.
- `shell-hook` action type: defined as `ShellHookAction` in `shell-hook-handler.ts:47`. **Not added to the `AutomationAction` union** (the handler comment at line 178 admits this and uses a duck-type filter). Means an `automations.json` author can write `"type": "shell-hook"` but the central schema validator won't recognize it — typos are caught only by the handler's heuristic at line 190.
- `acp-spawn` action type: defined in `acp-spawn-handler.ts:25`. **Also not in the central union.** Triggered by a *synthetic* `'automation:acp-spawn'` event (line 55), with **no code in `automation-system.ts` that emits that event**. The action type is unreachable from the DSL today.
- `acpEndpoint` option on `spawn_session`: lives on the tool schema (Zod `args` in `spawn-session-tool.ts`) — but the Zod schema at lines 118-144 does **not declare `acpEndpoint`** as a parameter. `options.acpEndpoint` is read from the constructor options, not from the tool call. **Means: a model cannot opt in via the tool call; the host must pre-bind `acpEndpoint` per session.** That may be intentional, but it's inconsistent with the SPEC R8 language "spawn_session gains an `acpEndpoint` option."

---

## Axis 4 — Persistence consistency

- R1: `delegation` in `StoredConfig` (`config/storage.ts`). JSON file. ✅
- R6: `~/.runneros/shell-hooks-allowlist.json` (`allowlist-store.ts:30-32`). ✅
- R7: SQLite at `CONFIG_DIR/escalations.db` (`escalation-store.ts:315-316`). Singleton process-wide.
- R8: SQLite at caller-provided `dbPath` (`session.ts:85`). **No default path resolver** exposed — the host must supply one. I find no production caller wiring an ACP DB path. If two callers spin up `SessionManager(dbPath)` with the same path, they get separate `new Database(...)` connections; bun:sqlite supports this but it's not coordinated.

**R7 and R8 use separate `.db` files** (`escalations.db` vs caller-chosen). Coexistence is fine. No migration story for either DB — both are created from `CREATE TABLE IF NOT EXISTS`. Schemas are unrelated, no collision risk.

**Gap:** ACP session DB has no default-path discoverer. The 01-08 review says SQLite restore works in tests; in production, **nothing constructs the ACP `SessionManager` at all** (no caller found). Restore behavior in production is moot until that wiring exists.

---

## Axis 5 — Logging consistency

Every Phase 1 feature logs through `createLogger(name)` from `utils/debug.ts`:
- `'prompt-handler'`, `'shell-hook-handler'`, `'acp-spawn-handler'`, `'escalation-store'`, `'subconscious-mode'`, `'shell-hook-allowlist'`, `'shell-hook-runner'`, `'shell-hook-consent'`.

Block/refuse messages have varied prefixes:
- `[PromptHandler] prompt blocked by injection scanner` (prompt-handler.ts:110)
- `[workflow-runner] prompt blocked by injection scanner` (runner.ts:802)
- `[ShellHookHandler] hook blocked event=...` (shell-hook-handler.ts:216)
- `[SchedulerService] Gate decision: ... -> ...` (scheduler-service.ts:130) — info-level, not "blocked" terminology
- `[spawn-session-isolation] Subagent auto-denied` (spawn-session-isolation.ts:191)

A user grepping their log for "blocked" will find R2 and R6, but not R1 (uses "denied") or R3 (uses "Gate decision"). **Acceptable but inconsistent** — not a blocker; suggest adopting a `blocked-by:R{n}` substring convention for Phase 2.

Field naming: most messages embed `event=`, `matcher=`, `automation=`, `pattern=`, `reason=` as key=value pairs. Consistent enough to grep. `runner.ts:802` uses `runId=` and `stepId=`. ✅

---

## Axis 6 — Notification consistency

Three notification surfaces:
1. **R7 escalations**: `setEscalationNotifier(fn)` (`subconscious-mode.ts:81`) — bridged into `WorkflowRunner` via `setEscalationNotifier` at `runner.ts:211`, emitted as `{type: 'escalation.created'}` on the runner event bus.
2. **R6 shell-hook consent**: `consent.ts` exposes a TTY prompt (`shell-hook-handler.ts:223`); non-TTY rejection logged but no notification surface.
3. **R8 ACP permission requests**: ACP `events.ts` uses `editApprovalStorage` + `safeScheduleAcross`. Surfaces over the ACP wire as `session/request_permission`.

**Three independent surfaces.** None of them share a "PendingApproval" abstraction. The Phase 2 UI will have to subscribe to three different mechanisms (the workflow runner event bus, the shell-hook consent prompt callback, and the ACP permission request stream) and unify them at the UI layer.

`setEscalationNotifier` is a singleton (`subconscious-mode.ts:81` — module-level mutable `notifySink`). **Last-writer-wins**: if any other consumer also calls `setEscalationNotifier`, the previous notifier is silently replaced. `WorkflowRunner` constructor at `runner.ts:211` calls it unconditionally — every new `WorkflowRunner` instance overwrites the prior sink. Per-process this is fine (only one runner instance), but worth documenting.

---

## ✅ Integrations that compose cleanly

- **R5 + R7 in `runner.ts:706+`** — disjoint field writes on `CreateSessionOptions`, order-insensitive.
- **R2 scan on cron + workflow paths** — same `assemblePrompt`/`scanForInjection` pair invoked from two call sites; behavior is consistent.
- **R1 production wiring** — the 01-01-REVIEW B1 blocker is resolved in shipped code. `getDelegationConfig` and `getParentSourceSlugs` are real.
- **R3 scheduler gate** — `shouldRunNow` is on the live tick path with fail-open and pause-poll semantics.
- **R7 escalation → runner event bus** — bridged via `setEscalationNotifier` (`runner.ts:211`) so UI observers can see paused runs without coupling to agent internals.
- **Persistence files coexist** — distinct on-disk locations, no migration collisions.

## 🔴 Integration blockers — must fix before phase ships

1. **R8 + R1 composition: ACP path bypasses depth gate, source-slug intersection, and isolated approval scope.** `spawn-session-tool.ts:150` returns before `shouldRejectSpawn`. A subagent at `max_spawn_depth` can spawn unbounded remote agents. *Fix:* hoist the isolation checks above the `acpEndpoint` branch (or duplicate the gate inside it).
2. **R7 + R8 composition: `subconsciousMode` is dropped on ACP delegation.** Writes on the remote agent never create escalations, but the user thinks their permission mode is in force. *Fix:* either forward `subconsciousMode` over the ACP wire (and have the remote honor it), or refuse `acpEndpoint` when `subconsciousMode !== 'default'`. The latter is safer for Phase 1.
3. **R6 handler not instantiated.** `ShellHookHandler` is exported but `AutomationSystem.createHandlers()` (`automation-system.ts:356-388`) only constructs Prompt/Webhook/EventLog handlers. **R6 is dead code in production.** Same for `AcpSpawnHandler` (R8 automation-action path). *Fix:* add `new ShellHookHandler(...)` and `new AcpSpawnHandler(...)` to `createHandlers`, plus emit `automation:acp-spawn` from the matcher dispatcher for `type: "acp-spawn"` actions.
4. **R6 + R2: shell-hook `context` injection is undefined.** Handler docstring promises "dispatcher prepends `context` to next prompt assembly," but no code does that. Once R6 ships, hook-injected context will bypass R2's scanner. *Fix:* require that any `context` output be routed through `assemblePrompt` + `scanForInjection` before reaching an agent.

## 🟡 Concerns — ship the phase, fix soon

- **R4 deferral is real and unfinished.** `getConfigCached`/`subscribeConfigChanges` ship as a primitive with zero production consumers. The follow-up ticket (`01-04-FOLLOWUPS.md` item 2) is the actual integration. Not a regression — scheduler uses defaults — but the R4 SPEC acceptance "synthetic consumer integration test demonstrates ≤10s freshness" passes only via the test consumer.
- **Schema fragmentation for new action types.** `shell-hook` and `acp-spawn` are duck-typed at the handler boundary, not in the central `AutomationAction` union. Adds parse/validation drift risk. *Fix:* extend `AutomationAction` union and the JSON schema.
- **`acpEndpoint` is host-bound, not tool-arg.** Zod schema for `spawn_session` doesn't declare `acpEndpoint`. Models cannot opt in per-call; only the host can pre-bind. SPEC R8 language reads like a tool argument. Document the design or expose it on the schema.
- **Duplicate `subconscious` alias normalizers.** `prompt-handler.ts:125-134` and `subconscious-permissions.ts:normalizeSubconsciousMode` do the same job. Risk of drift.
- **`setEscalationNotifier` is a process-wide singleton.** Last-writer-wins. Fine today; will bite if Phase 2 introduces a second observer.
- **Inconsistent block-log vocabulary.** "blocked"/"denied"/"Gate decision" — fine to grep but a `blocked-by:` convention would help operations.
- **No default path resolver for ACP session DB.** Production callers must supply a path; no callers found.

## 🔵 Architectural notes for Phase 2

- **Unify approval/notification surfaces.** R6 consent, R7 escalation, R8 ACP `session/request_permission`, and the existing in-session approval flow are four independent channels. Phase 2's permission modal needs a single `PendingApproval` abstraction with a discriminated source field. Build that now or carry technical debt forward.
- **Cross-process policy propagation.** R7+R8 reveals that subconscious mode (and any future policy) doesn't survive the ACP boundary. Decide explicitly: are policies host-side only (refuse to delegate when policy is non-default) or wire-forwarded (extend ACP)? Phase 2's product surface should make this choice visible.
- **`AutomationAction` union must absorb new types.** `shell-hook` and `acp-spawn` should be first-class union variants by Phase 2, not handler-side duck types.
- **Reactive-config should subsume `automations.json` and any other long-running file.** The factory pattern sketched in `01-04-FOLLOWUPS.md` item 3 is the right move — but only if a second consumer materializes, otherwise YAGNI.
- **Tool registry / source-slug ambiguity (01-01-REVIEW B2/B3).** Phase 2 should resolve whether the subagent isolation blocklist is enforced at the tool-name layer (SDK pre-tool-use) or the source-slug layer. Today the blocklist function (`stripBlockedTools`) exists but is not called against the live tool registry; only `spawn_session` is gated in practice (via the depth counter). Document and decide.

---

## Verdict per axis

| Axis | Verdict |
|---|---|
| 1. End-to-end runtime paths | 🟡 **PARTIAL** — R6 and R8 (automation handler path) are not on the live event bus. |
| 2. Cross-feature interactions | 🔴 **BLOCKER** — R1+R8 and R7+R8 compositions fail open. R6+R2 latent. |
| 3. Config / DSL consistency | 🟡 **CONCERN** — duck-typed action variants, duplicate alias normalizers. |
| 4. Persistence consistency | ✅ **OK** — coexistence fine; ACP DB needs a default path resolver. |
| 5. Logging consistency | ✅ **OK with minor drift** — vocabulary varies, structure consistent. |
| 6. Notification consistency | 🟡 **CONCERN** — three independent surfaces, singleton notifier. |

**Overall phase status:** ⚠️ **DO NOT SHIP** until the four 🔴 blockers above are resolved or explicitly deferred with kill-switch defaults (e.g., refuse `acpEndpoint` when `subconsciousMode != "default"`).

The individual features are well-built. The *system* has cross-feature gaps that the per-feature reviews could not see because each review was scoped to one diff.

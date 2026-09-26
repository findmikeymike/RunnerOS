# Phase 1: Orchestration Backbone — Specification

**Created:** 2026-05-19
**Ambiguity score:** 0.18 (gate: ≤ 0.20)
**Requirements:** 8 locked
**Source:** [UPGRADES.md](../../../UPGRADES.md) lines 91–344
**Mode:** Auto-generated from upstream design doc (no Socratic interview run — UPGRADES.md is already high-precision)

## Goal

Ship eight orchestration-backbone upgrades to RunnerOS (`packages/shared/src/{agent,automations,scheduler,config,workflows,protocol}/`) that close subagent/spawn safety gaps, add polyglot extension points, make schedulers system-aware, and turn RunnerOS into a cross-vendor agent orchestration plane via ACP.

## Background

RunnerOS already has a four-layer orchestration cake (automations + workflows + spawn_session + scheduler) that out-classes Hermes and OpenHuman. But:

- `packages/shared/src/agent/spawn-session-tool.ts` is fire-and-forget — no per-subagent blocklist, no isolated approval callback. A subagent can recursively `spawn_session` (fork bomb) and inherits the parent's stdin-bound approval callback (deadlock).
- `packages/shared/src/automations/handlers/` only ships TS handlers (`prompt-handler.ts`, `webhook-handler.ts`, `event-log-handler.ts`). No shell-hook handler → users cannot drop in Python/bash hooks compatible with the Claude Code wire protocol.
- `packages/shared/src/scheduler/` (`scheduler-service.ts` + `index.ts`) dispatches on cadence with no awareness of battery state or CPU load.
- `packages/shared/src/config/storage.ts` is read-once-at-startup — long-running services need a restart to pick up edits.
- `packages/shared/src/agent/` has no prompt-assembly + injection scan stage; skill content loaded at run time bypasses any create-time check.
- `packages/shared/src/workflows/trigger-inputs.ts` does not yet expose `enabled_source_slugs` or `permission_mode` per run.
- `packages/shared/src/protocol/` exists but holds RunnerOS's internal RPC (channels/dto/events/routing) — no ACP server, no ACP bridge from `spawn-session-tool` to external agents.
- No escalation store exists — write attempts under a read-only permission mode hard-fail instead of pausing for user approval.

This phase closes those gaps. Phase 2 (product surface) and Phase 3 (voice) are explicitly downstream.

## Requirements

1. **Subagent isolation hardening** (Upgrade 2, Hermes-port, MIT-safe)
   - Current: `packages/shared/src/agent/spawn-session-tool.ts` lets a subagent invoke any tool the parent has, including recursive `spawn_session`. Approval callbacks are inherited via thread-local and deadlock against a parent TUI owning stdin. No spawn-depth limit exists.
   - Target: New `packages/shared/src/agent/spawn-session-isolation.ts` exports (a) `SPAWN_SESSION_BLOCKED_TOOLS` frozen set blocking the 5 Hermes tools (recursive `spawn_session`, user-clarify, memory writes, cross-platform messaging, code execution); (b) `createIsolatedApprovalCallback()` installing a per-worker callback via `AsyncLocalStorage` that defaults to deny unless `subagent_auto_approve: true` is set on the spawn config; (c) a **spawn-depth counter** with `max_spawn_depth` config (clamped to [1, 3], default 1) — a subagent at max depth cannot spawn further. Subagent requested toolsets are intersected with parent toolsets.
   - Acceptance: Test asserts a subagent attempting `spawn_session` returns a refusal payload (not an exception); test asserts approval callback running on the subagent thread does NOT block on parent stdin; opt-in `subagent_auto_approve: true` bypasses the deny default and is logged; test asserts spawn at `depth == max_spawn_depth` is rejected; test asserts a child subagent's toolset is the intersection with its parent's.

2. **Prompt-injection scanning** (Upgrade 7, Hermes-port pattern)
   - Current: No prompt-assembly stage exists. Skills/contexts are concatenated inline at run time without a scan.
   - Target: New `packages/shared/src/agent/prompt-builder.ts` exports `assemblePrompt({userPrompt, loadedSkills, contextFiles, ...})` and `scanForInjection(assembled): {blocked: boolean; reason?: string}`. Scanner runs on the **fully-assembled** prompt at every run (not just at job-create time). Regex pack covers "ignore previous instructions", role-hijack markers, and base64-encoded shell payloads.
   - Acceptance: Unit test loads a skill containing each pattern and asserts `blocked: true` with a non-empty reason; clean prompt asserts `blocked: false`; cron/scheduled trigger calls the scanner before dispatching to the agent.

3. **Scheduler gate — battery/CPU throttling** (Upgrade 4, OpenHuman concept, re-implemented)
   - Current: `packages/shared/src/scheduler/scheduler-service.ts` dispatches on cadence with zero system-pressure checks.
   - Target: New `packages/shared/src/scheduler/system-pressure.ts` (`getBatteryState()`, `getCpuLoadPct()` via `systeminformation` npm pkg) and `packages/shared/src/scheduler/gate.ts` (`shouldRunNow(): "run" | "throttle" | "pause"`). Defaults: battery_floor 0.8, cpu_busy 70%, cpu_severe 95%, throttle_backoff 30 000 ms, paused_poll 60 000 ms. Per-workflow override via workspace config.
   - Acceptance: Mocked battery at 0.7 on battery power returns `"pause"`; mocked CPU at 80% returns `"throttle"`; mocked CPU at 96% returns `"pause"`; AC-power + 50% CPU returns `"run"`; scheduler-service calls `shouldRunNow()` before each dispatch.

4. **Hot-reload config** (Upgrade 6, OpenHuman concept, re-implemented)
   - Current: `packages/shared/src/config/storage.ts` reads once at service startup; `scheduler-service.ts`, `automations/poll-service.ts`, and `automations/file-watch-service.ts` all hold a stale snapshot.
   - Target: New `packages/shared/src/config/reactive-config.ts` exports `getConfigCached(ttlMs = 10_000)` and `subscribeConfigChanges(cb)`. Long-running services migrate to `getConfigCached` at tick boundaries.
   - Acceptance: Test modifies a config key on disk; `getConfigCached` returns the old value within TTL, returns the new value after TTL; `subscribeConfigChanges` callback fires within ≤ 1 s of file change; an integration test with a synthetic consumer (mock service) reads the new value within ≤ 10 s of edit without restart. Migration of existing services (scheduler-service, poll-service, file-watch-service) to consume `getConfigCached` is **deferred** — those services do not currently consume `StoredConfig` (they consume `AutomationMatcher[]` from `automations.json` via a separate refresh pipeline). Follow-up ticket: hoist `gateConfig` into `StoredConfig.scheduler` so the scheduler can subscribe to its own config field via reactive-config.

5. **Per-job toolset overrides on workflows** (Upgrade 8, Hermes precedence pattern)
   - Current: `packages/shared/src/workflows/trigger-inputs.ts` does not expose `enabled_source_slugs` or `permission_mode` as first-class fields. Cron-fired workflows inherit the full default toolset.
   - Target: Extend `trigger-inputs.ts` schema with `enabled_source_slugs?: string[]` and `permission_mode?: "default" | "subconscious" | "yolo"`. Precedence at runtime: per-job override > per-platform "cron" config > full default. Automations firing workflows pass overrides through.
   - Acceptance: Workflow run with `enabled_source_slugs: ["github"]` rejects calls to other source slugs at run time; absent override falls through to default toolset; precedence chain documented in `trigger-inputs.test.ts`.

6. **Polyglot shell hooks** (Upgrade 3, Hermes-port, MIT-safe)
   - Current: All `automations/handlers/` are TypeScript. No way to drop in a Python/bash hook compatible with the Claude Code wire protocol.
   - Target: New `packages/shared/src/automations/hooks/` with `shell-hook-runner.ts` (subprocess.spawn, JSON stdin/stdout), `allowlist-store.ts` (`~/.runneros/shell-hooks-allowlist.json`), `consent.ts` (first-use approval gate), `types.ts` (`HookEvent`, `HookResponse`). New `shell-hook` action handler registered with the automations handler registry. Uses `shlex.split` equivalent (no shell=true). Supports both `{decision, reason}` (Claude Code canonical) and `{action, message}` (Hermes canonical) response shapes plus `{context}` injection.
   - Acceptance: First registration of an unknown command triggers a consent prompt; second registration of the same command is silent; non-TTY caller without `accept_hooks: true` is rejected; hook returning `{"decision":"block"}` halts the tool call and surfaces `reason` to the agent; hook returning `{"context":"..."}` injects context.

7. **"Subconscious" job mode** (Upgrade 5, OpenHuman concept, re-implemented)
   - Current: `permissions-config.ts` supports binary allow/deny. Write attempts under a read-only mode hard-fail the workflow.
   - Target: Add `escalate-on-write` mode to `permissions-config.ts`. New `packages/shared/src/agent/escalation-store.ts` with `createEscalation()`, `listPendingEscalations()`, `approveEscalation()`, `rejectEscalation()`. `prompt-handler.ts` handles the new outcome shape (`UnapprovedWrite { recommendation, duration_ms }`). Automation DSL accepts `"mode": "subconscious"` and `"onEscalation": "notify-and-queue"`.
   - Acceptance: Workflow with `mode: subconscious` running a write tool pauses execution, writes an escalation record, and emits a notification (does NOT hard-fail); `approveEscalation()` resumes the workflow and replays the write; `rejectEscalation()` resumes with a tool-denied result.

8. **ACP adapter — cross-vendor agent protocol** (Upgrade 1, Hermes-port, MIT-safe)
   - Current: `packages/shared/src/protocol/` holds RunnerOS internal RPC only. `spawn_session` always creates another RunnerOS session — workflows cannot delegate to Zed/Cursor/Claude Desktop.
   - Target: New `packages/shared/src/protocol/acp/` with `server.ts` (**stdio JSON-RPC** — matches Hermes upstream; WebSocket deferred to a follow-up), `session.ts` (ACP session ↔ RunnerOS session bridge, persisted to SQLite alongside existing session storage), `events.ts` (uses `AsyncLocalStorage` for edit-approval ContextVar equivalent and a `safeScheduleAcross` helper to bridge worker-thread agent → main-loop ACP server), `tools.ts`, `permissions.ts` (60 s default approval timeout; sensitive paths `.env`, `.ssh`, `id_rsa` always prompt), `index.ts`. `spawn-session-tool.ts` gains an `acpEndpoint` option; automations gain an `acp-spawn` handler type. Conforms to the Agent-Client-Protocol spec used by Zed.
   - Acceptance: An ACP client test harness can open a session against the RunnerOS ACP stdio server and receive tool-call + permission notifications; a workflow node with `acpEndpoint` set delegates execution to the remote agent and returns its result; absent `acpEndpoint`, behavior is identical to today; an in-flight session survives a server restart via SQLite restore. WebSocket transport explicitly out of scope for this phase.

## Boundaries

**In scope:**
- Eight files/modules listed in Requirements 1–8 with the named source paths under `packages/shared/src/`
- Migrations of `scheduler-service.ts`, `automations/poll-service.ts`, `automations/file-watch-service.ts` to consume `reactive-config`
- Wiring `prompt-builder.scanForInjection` into the run-time dispatch path for cron + workflow triggers
- New automation DSL fields: `shell-hook` handler, `mode: subconscious`, `onEscalation`, `enabled_source_slugs`, `permission_mode`, `acp-spawn` handler, `acpEndpoint` option on spawn-session
- Unit + integration test coverage for each requirement's acceptance criteria
- `~/.runneros/` data directory used for new on-disk artifacts (allowlist, escalation store)

**Out of scope:**
- Legal scrub (rename `~/.craft-agent/` → `~/.runneros/`, `craftagents://` scheme, `CRAFT_SERVER_*` env, Craft UI strings, NOTICE / CHANGES_FROM_UPSTREAM / THIRD_PARTY_NOTICES) — UPGRADES.md treats this as a **pre-requisite** to Phase 1 ship, tracked separately, not a coding requirement.
- Phase 2 product surface (connector card UI, permission modal, MCP/skill browser, OAuth broker, memory tree, cost accounting, hint-based model routing, operational CLI) — separate phase.
- Phase 3 voice runtime — gated on Mikey consult.
- Phase 4 voice-unlocked product categories — gated on Phase 3.
- CraftBot OmniParser addendum — own track, can run parallel post-Phase 1.
- Copying any code from OpenHuman (GPL-3.0) — Upgrades 4, 5, 6 are concept-only re-implementations.
- Cost accounting per workflow, workflow versioning, distributed execution — listed as open questions in UPGRADES.md, not Phase 1 deliverables.

## Constraints

- **License hygiene:** Hermes ports (Upgrades 1, 2, 3, 7, 8) are MIT — credit Hermes in `THIRD_PARTY_NOTICES.md`. OpenHuman patterns (Upgrades 4, 5, 6) are concept-only; **do not** copy GPL-3.0 source code — re-implement from spec.
- **Cross-platform:** `systeminformation` npm pkg for system pressure must work on macOS, Linux, Windows (Electron app supports all three).
- **Wire-protocol compatibility:** Shell-hook JSON wire protocol must accept Claude Code canonical (`{decision, reason}`) and Hermes canonical (`{action, message}`) response shapes, plus `{context}` injection.
- **Shell-hook safety:** Never use `shell: true`. Use `shlex.split` equivalent or array-form `spawn`. Document that users wrap pipes/redirection in their own script.
- **First-use consent:** Shell hooks must not auto-trust commands. Allowlist gates first execution.
- **Backwards compat:** New fields on `trigger-inputs.ts` are optional; existing workflows without them keep current behavior. ACP is opt-in via `acpEndpoint`; default `spawn_session` continues to spawn local RunnerOS sessions.
- **Test runner:** Bun test. Each requirement ships with unit tests in its package's `__tests__/`.
- **Type discipline:** All new code passes `bun run typecheck:all` and `bun run lint`.

## Acceptance Criteria

- [ ] `SPAWN_SESSION_BLOCKED_TOOLS` set blocks recursive spawn + memory + clarify + cross-platform messaging + code execution; subagent test proves refusal payload, not exception.
- [ ] Per-subagent approval callback runs on the worker thread without touching parent stdin; `subagent_auto_approve: true` opt-in works and is logged.
- [ ] Spawn-depth counter: spawn at `depth == max_spawn_depth` rejected; `max_spawn_depth` clamped to [1, 3] with default 1; child toolset = intersection with parent toolset.
- [ ] `assemblePrompt` + `scanForInjection` integrated into cron + workflow dispatch path; regex pack catches "ignore previous instructions", role-hijack, base64 shell.
- [ ] Scheduler gate returns `pause` < 0.8 battery on battery, `throttle` > 70% CPU, `pause` > 95% CPU, `run` otherwise; scheduler-service calls gate before every dispatch.
- [ ] `getConfigCached(10_000)` returns cached then refreshed value; synthetic consumer integration test demonstrates ≤ 10s freshness (migration of scheduler-service/poll-service/file-watch-service deferred — see `01-04-FOLLOWUPS.md`).
- [ ] `enabled_source_slugs` + `permission_mode` on `trigger-inputs.ts` enforced at run time; precedence: per-job > per-platform > default.
- [ ] `shell-hook` handler registered; first-use consent gate works; non-TTY without `accept_hooks: true` rejected; `block` decision halts tool call; `context` injection works.
- [ ] `mode: subconscious` pauses on write attempt, creates escalation record, emits notification; `approveEscalation` resumes and replays write; `rejectEscalation` resumes with denied result.
- [ ] ACP server (stdio JSON-RPC only — WebSocket out of scope) accepts a simulated Zed client; `spawn_session` with `acpEndpoint` delegates to remote; absent `acpEndpoint` behavior unchanged; in-flight ACP session survives server restart via SQLite restore.
- [ ] `bun run typecheck:all` clean.
- [ ] `bun run lint` clean.
- [ ] `bun test` green across new test files for all eight requirements.
- [ ] `THIRD_PARTY_NOTICES.md` updated to credit Hermes for ports of Upgrades 1/2/3/7/8.

## Constraints — sequencing (informational; planner-owned)

UPGRADES.md suggests this order (low-risk → high-leverage):

1. Pre-req: legal scrub (out of scope for this phase)
2. **Week 1:** R1 (subagent isolation) + R2 (prompt-injection scan)
3. **Week 2:** R3 (scheduler gate) + R4 (hot-reload config)
4. **Week 3–4:** R6 (shell hooks)
5. **Month 2:** R5 (per-job overrides) + R7 (subconscious mode)
6. **Month 2–3:** R8 (ACP adapter — biggest scope, biggest leverage)

This is a suggested rollout, not a locked sequence — planner may parallelize where dependencies allow.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                                  |
|--------------------|-------|------|--------|------------------------------------------------------------------------|
| Goal Clarity       | 0.88  | 0.75 | ✓      | 8 named files/modules, each with target behavior                       |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | Explicit out-of-scope: Phases 2/3/4, legal scrub, OmniParser, OpenHuman copying |
| Constraint Clarity | 0.75  | 0.65 | ✓      | License hygiene, cross-platform, wire-protocol, no-shell-true all locked |
| Acceptance Criteria| 0.78  | 0.70 | ✓      | 12 pass/fail checkboxes; each requirement has a falsifiable acceptance |
| **Ambiguity**      | 0.18  | ≤0.20| ✓      | Gate passed without interview — source doc was already high-precision  |

## Interview Log

| Round | Perspective | Question summary                              | Decision locked                                                                 |
|-------|-------------|-----------------------------------------------|--------------------------------------------------------------------------------|
| auto  | Researcher  | What exists today vs UPGRADES.md target?      | Confirmed: `protocol/` exists (RPC, not ACP), `automations/handlers/` is TS-only, `scheduler/` has no pressure check, no escalation store, no hot-reload, no prompt-builder, no spawn isolation, no shell-hooks dir. All eight gaps real. |
| auto  | Simplifier  | Irreducible core of Phase 1?                  | All 8 upgrades — UPGRADES.md treats them as one phase (orchestration backbone). Cutting any breaks the "what to ship first" rollout in §Suggested rollout order. |
| auto  | Boundary    | What's NOT Phase 1?                           | Legal scrub (pre-req, tracked separately), Phases 2–4, OmniParser addendum, OpenHuman *source* code (concept-only re-implementation), cost accounting, workflow versioning, distributed exec. |
| auto  | Failure     | Worst case if requirements wrong?             | GPL contamination from copying OpenHuman → constraint locked. Shell-hook injection from `shell: true` or auto-trust → constraint locked. Subagent deadlock if approval callback not isolated → R1 acceptance criterion covers. |

**Note:** This SPEC was generated in auto mode from a single high-precision source doc ([UPGRADES.md](../../../UPGRADES.md) lines 91–344). If you want to run the full Socratic interview, delete this file and run `/gsd-spec-phase 1` interactively.

---

*Phase: 01-orchestration-backbone*
*Spec created: 2026-05-19*
*Next step: `/gsd-discuss-phase 1` — implementation decisions (which Hermes APIs to mirror, ACP transport choice, escalation UI surface, etc.)*

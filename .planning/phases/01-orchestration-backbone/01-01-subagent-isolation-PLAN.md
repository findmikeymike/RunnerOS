---
phase: 01-orchestration-backbone
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - packages/shared/src/agent/spawn-session-isolation.ts
  - packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts
  - packages/shared/src/agent/spawn-session-tool.ts
  - packages/shared/src/config/storage.ts
  - THIRD_PARTY_NOTICES.md
autonomous: true
requirements: [R1]
must_haves:
  truths:
    - "Subagent invocation of spawn_session returns a refusal payload (not an exception)"
    - "Subagent invocation of memory, clarify, send_message, execute_code returns refusal"
    - "Approval callback on subagent thread does not block on parent stdin"
    - "subagent_auto_approve: true opt-in bypasses deny default and is logged"
    - "Spawn at depth == max_spawn_depth is rejected"
    - "max_spawn_depth is clamped to [1, 3] with default 1"
    - "Child subagent toolset == intersection of requested toolset with parent toolset"
  artifacts:
    - path: "packages/shared/src/agent/spawn-session-isolation.ts"
      provides: "SPAWN_SESSION_BLOCKED_TOOLS, createIsolatedApprovalCallback, depth-gate, toolset intersection"
      exports: ["SPAWN_SESSION_BLOCKED_TOOLS", "createIsolatedApprovalCallback", "getMaxSpawnDepth", "intersectToolsets", "stripBlockedTools"]
    - path: "packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts"
      provides: "Acceptance tests mirroring Hermes test_delegate.py"
  key_links:
    - from: "packages/shared/src/agent/spawn-session-tool.ts"
      to: "packages/shared/src/agent/spawn-session-isolation.ts"
      via: "import + AsyncLocalStorage.run() wrap of subagent execution"
      pattern: "spawn-session-isolation"
---

<objective>
Port Hermes (MIT) subagent isolation pattern from `delegate_tool.py` into RunnerOS to close the four gaps in `spawn-session-tool.ts`: no blocklist, no per-worker approval callback, no spawn-depth gate, no toolset intersection.

Purpose: Eliminate (a) subagent fork bombs via recursive `spawn_session`, (b) parent-stdin deadlocks via inherited approval callbacks, (c) shared-state corruption via subagent memory writes, (d) toolset privilege escalation in nested subagents.

Output: `spawn-session-isolation.ts` module + test file + wiring in `spawn-session-tool.ts` + config schema additions + THIRD_PARTY_NOTICES credit to Hermes.

License: Hermes is MIT — safe to port. Add attribution to THIRD_PARTY_NOTICES.md.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-orchestration-backbone/01-SPEC.md
@.planning/research/02-subagent-isolation.md
@packages/shared/src/agent/spawn-session-tool.ts
@packages/shared/src/config/storage.ts

<interfaces>
Hermes reference (from research note `02-subagent-isolation.md`):
- DELEGATE_BLOCKED_TOOLS = frozenset(["delegate_task", "clarify", "memory", "send_message", "execute_code"])
- RunnerOS equivalents: ["spawn_session", "clarify", "memory", "send_message", "execute_code"]
- MAX_DEPTH=1, _MIN_SPAWN_DEPTH=1, _MAX_SPAWN_DEPTH_CAP=3
- Approval callbacks: auto-deny returns "deny"; auto-approve returns "once" (both log warnings)
- TypeScript: AsyncLocalStorage<ApprovalCallback> replaces threading.local
- Child toolset = intersect(requested_toolsets, parent_toolsets); empty intersection => empty set
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — write failing tests for isolation module</name>
  <files>packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts</files>
  <behavior>
    - Test: SPAWN_SESSION_BLOCKED_TOOLS contains exactly {spawn_session, clarify, memory, send_message, execute_code}
    - Test: stripBlockedTools(["spawn_session","read_file","memory"]) returns ["read_file"]
    - Test: intersectToolsets(parent=["a","b","c"], requested=["b","c","d"]) returns ["b","c"]
    - Test: intersectToolsets(parent=["a"], requested=["b"]) returns [] (empty intersection)
    - Test: getMaxSpawnDepth() returns 1 by default
    - Test: getMaxSpawnDepth() clamps -5 to 1 and 99 to 3 (and logs warning)
    - Test: createIsolatedApprovalCallback with subagent_auto_approve=false returns "deny" and logs warning
    - Test: createIsolatedApprovalCallback with subagent_auto_approve=true returns "once" and logs warning
    - Test: callback runs inside AsyncLocalStorage.run scope — context is isolated from caller (set value in outer, run inner, assert inner sees subagent callback only)
    - Test: spawn at depth==max rejected with refusal payload (not thrown)
    - Test: subagent attempting spawn_session returns refusal payload (not exception)
  </behavior>
  <action>Create test file using `bun test` conventions (import from "bun:test"). Mock config via dependency injection — pass config object directly to factories rather than reading storage. Use `mock.module` only for the logger. Each test under a `describe()` block per concern. Run `bun test packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts` — MUST fail (module does not exist yet).</action>
  <verify>
    <automated>bun test packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts 2>&1 | grep -q "fail\|cannot find module"</automated>
  </verify>
  <done>Test file exists; running it produces failures (module not yet implemented); RED state confirmed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement spawn-session-isolation.ts</name>
  <files>packages/shared/src/agent/spawn-session-isolation.ts, packages/shared/src/config/storage.ts</files>
  <action>
    Create `packages/shared/src/agent/spawn-session-isolation.ts`:
    1. Export `SPAWN_SESSION_BLOCKED_TOOLS = Object.freeze(new Set(["spawn_session","clarify","memory","send_message","execute_code"]))` (RunnerOS uses `spawn_session` not `delegate_task` — that's the rename per SPEC §R1).
    2. Export `stripBlockedTools(toolset: string[]): string[]` — filter out members of SPAWN_SESSION_BLOCKED_TOOLS.
    3. Export `intersectToolsets(parent: string[], requested: string[]): string[]` — return requested.filter(t => parent.includes(t)). Empty intersection => [].
    4. Export `getMaxSpawnDepth(config: { delegation?: { max_spawn_depth?: number } }): number` — read `config.delegation.max_spawn_depth`, default 1, clamp to [1,3], log warning on clamp.
    5. Export `ApprovalDecision = "deny" | "once"`.
    6. Export `ApprovalCallback = (args: { command: string; description: string }) => ApprovalDecision`.
    7. Export `subagentAutoDeny: ApprovalCallback` — logs warning, returns "deny".
    8. Export `subagentAutoApprove: ApprovalCallback` — logs warning, returns "once".
    9. Export `createIsolatedApprovalCallback(config: { delegation?: { subagent_auto_approve?: boolean } }): ApprovalCallback` — returns subagentAutoApprove if true else subagentAutoDeny.
    10. Export `approvalCallbackStorage = new AsyncLocalStorage<ApprovalCallback>()` from `node:async_hooks`.
    11. Export `runWithSubagentApproval<T>(cb: ApprovalCallback, fn: () => Promise<T>): Promise<T>` — wraps `approvalCallbackStorage.run(cb, fn)`.
    12. Export `buildSubagentRefusalPayload(toolName: string): { error: string; refusal: true }` — returns `{ error: \`Subagent cannot invoke blocked tool: \${toolName}\`, refusal: true }`.

    Add to `packages/shared/src/config/storage.ts` config schema (extend whatever interface/type tree governs settings — keep additive, don't break existing readers):
    - `delegation?: { subagent_auto_approve?: boolean; max_spawn_depth?: number }`
    - Defaults: subagent_auto_approve=false, max_spawn_depth=1.

    Hermes port — credit MIT upstream in module header comment: `// Ported from Hermes delegate_tool.py (MIT). See research/02-subagent-isolation.md.`

    Run `bun test packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts` — MUST pass.
  </action>
  <verify>
    <automated>bun test packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts && bun run typecheck:all</automated>
  </verify>
  <done>All RED tests now pass; typecheck clean; module compiles.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire isolation into spawn-session-tool.ts + license credit</name>
  <files>packages/shared/src/agent/spawn-session-tool.ts, THIRD_PARTY_NOTICES.md, packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts</files>
  <behavior>
    - Integration test: calling spawn-session-tool with parent context at depth=0 and max=1 spawns successfully
    - Integration test: calling spawn-session-tool from a context already at depth=1 with max=1 returns refusal payload
    - Integration test: subagent's effective toolset == intersectToolsets(parent.toolset, requested.toolset)
    - Integration test: blocked tools are stripped from the subagent's toolset
  </behavior>
  <action>
    1. Read current `packages/shared/src/agent/spawn-session-tool.ts`. Identify the spawn entry point.
    2. At spawn entry:
       a. Read current depth from AsyncLocalStorage (new `spawnDepthStorage = new AsyncLocalStorage<number>()` exported alongside approvalCallbackStorage — or co-locate in spawn-session-isolation.ts). Default depth 0.
       b. Read config; call `getMaxSpawnDepth(config)`. If `currentDepth >= maxDepth`, return `buildSubagentRefusalPayload("spawn_session")` — do NOT throw.
       c. Compute child toolset: `stripBlockedTools(intersectToolsets(parent.toolset, requested.toolset))`.
       d. Build child approval callback: `createIsolatedApprovalCallback(config)`.
       e. Wrap subagent execution in `approvalCallbackStorage.run(childCb, () => spawnDepthStorage.run(currentDepth + 1, () => actualSpawn(...)))`.
    3. Add integration tests to the existing test file (extend the suite from Task 1) covering the four behaviors above. Mock `actualSpawn` so the tests don't need a real LLM.
    4. Update `THIRD_PARTY_NOTICES.md` — append a section:
       ```
       ## Hermes (MIT)
       Portions of packages/shared/src/agent/spawn-session-isolation.ts and the prompt-injection scanner, shell-hook runner, per-job toolset precedence, and ACP adapter are ported from the Hermes project (https://github.com/[hermes-repo]), licensed under MIT. See .planning/research/ for port notes.
       ```
       (Use a placeholder URL if not known — wave 2-5 plans will reuse this credit; do not duplicate the section.)
    5. Run full suite: `bun test packages/shared/src/agent/` and `bun run typecheck:all` and `bun run lint`.
  </action>
  <verify>
    <automated>bun test packages/shared/src/agent/ && bun run typecheck:all && bun run lint</automated>
  </verify>
  <done>spawn-session-tool wraps subagent runs in isolation storage; depth + toolset + approval enforced; all tests green; THIRD_PARTY_NOTICES credits Hermes.</done>
</task>

</tasks>

<verification>
- `bun test packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts` green
- `bun run typecheck:all` clean
- `bun run lint` clean
- THIRD_PARTY_NOTICES.md contains Hermes (MIT) section
</verification>

<success_criteria>
All 7 must_have truths verifiable via the test suite. Subagent at depth limit cannot recurse. Subagent calling blocked tool gets refusal payload. Approval callback isolated per worker via AsyncLocalStorage.
</success_criteria>

<output>
After completion, create `.planning/phases/01-orchestration-backbone/01-01-SUMMARY.md`.
</output>

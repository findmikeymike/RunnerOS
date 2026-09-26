# 01-01 Subagent Isolation — Cold Code Review

**Reviewer stance:** 30-year senior dev, adversarial. Rival wrote this. Production gate.
**Date:** 2026-05-20
**Files audited:**
- `packages/shared/src/agent/spawn-session-isolation.ts` (new, 197 LOC)
- `packages/shared/src/agent/spawn-session-tool.ts` (modified)
- `packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts` (new, 399 LOC, 39 tests)
- `packages/shared/src/config/storage.ts` (added `delegation` block)
- `THIRD_PARTY_NOTICES.md` (new)

---

## What's actually correct

- **Module-level structure is clean.** Four orthogonal mechanisms cleanly separated (blocklist / depth / approval / intersection). Pure functions where possible. Header comment cites Hermes upstream + license at the file level — license hygiene is fine.
- **`THIRD_PARTY_NOTICES.md`** is accurate, names the upstream module (`tools/delegate_tool.py`), and points to research notes. The MIT credit is in place.
- **AsyncLocalStorage usage is broadly correct.** `approvalCallbackStorage.run(cb, fn)` + `spawnDepthStorage.run(currentDepth + 1, fn)` is the right pattern; the inner function returns a promise that the storage will keep scoped across awaits because Node's async_hooks tracks promise continuations. Tests at lines 142–172 prove the inner scope is isolated from the outer.
- **`intersectToolsets` order semantics** are correct (preserves `requested` order) and tested.
- **`getMaxSpawnDepth` clamping** is correct, including `Number.isFinite` guard, floor, and the `NaN`/string/`null` path. Tests cover -5, 0, 99, 2.7, and undefined.
- **`shouldRejectSpawn` boundary** (`>=`, not `>`) matches Hermes behavior: depth 1 with max 1 is the floor, cannot spawn further.
- **Refusal returned, not thrown.** `refusalResponse` returns `{ isError: true, content: [...] }` rather than throwing, matching the SPEC AC verbatim.
- **Frozen blocklist.** `Object.freeze(new Set(...))` plus `ReadonlySet<string>` type — both runtime and compile-time immutability. Tested.
- **`buildSubagentRefusalPayload`** returns a plain object containing the tool name; tested.
- **Defensive copy of `args`** at `spawn-session-tool.ts:135` — `{ ...args }` so the caller's object isn't mutated. Good hygiene.
- **Config schema** in `storage.ts:98-104` is additive, optional, and documented inline with a pointer to the isolation module. Backwards-compat preserved.

---

## 🔴 Blockers (must fix before merge)

### B1. Production call site never passes `getDelegationConfig` or `getParentToolset`. The entire feature is dead in main path.

**Evidence:** `packages/shared/src/agent/session-scoped-tools.ts:280-288`:
```ts
createSpawnSessionTool({
  sessionId,
  getSpawnSessionFn: () => {
    const callbacks = getSessionScopedToolCallbacks(sessionId);
    return callbacks?.spawnSessionFn;
  },
});
```

No `getDelegationConfig`. No `getParentToolset`. Both options are typed `?:` and the tool falls through with `?? {}` at `spawn-session-tool.ts:125`. Result in production:

- `max_spawn_depth` is **always 1** regardless of user config in `config.json`.
- `subagent_auto_approve` is **always false** regardless of user config.
- Toolset intersection is **never enforced** — parent toolset is `undefined`, the code skips intersection (line 141: `parentToolset ? intersectToolsets(...) : [...requested]`), so the only thing that runs is `stripBlockedTools` against `enabledSourceSlugs`. See B2 for why that's also wrong.

The DI plumbing exists in the function signature but no caller wires it. Tests pass because tests inject the config. Production silently runs unconfigured. **This means SPEC AC "max_spawn_depth clamped to [1,3]" is technically met by the default but the *config knob is non-functional from a user's perspective*.** The "subagent_auto_approve: true opt-in works" AC is **not met** through any reachable user path.

**Fix:** wire `getDelegationConfig: () => getConfig()` (or equivalent storage read) and `getParentToolset: () => ...` from the session/source registry at the call site in `session-scoped-tools.ts`. Add an integration test that goes through this path, not just the unit-test injection.

---

### B2. Blocklist names don't match anything RunnerOS actually emits — the blocklist is a no-op against real tool calls.

**Evidence:** `SPAWN_SESSION_BLOCKED_TOOLS = {spawn_session, clarify, memory, send_message, execute_code}`. These are the *Hermes* tool names. Searched the repo:

```
grep -rn "'clarify'|'memory'|'send_message'|'execute_code'" packages/shared/src/ --include="*.ts"
→ zero matches outside the isolation module itself and its tests
```

The actual RunnerOS tool names emitted at registration are different (e.g., `browser_tool`, `session`, the canonical-registry names from `getSessionToolDefs`, and `spawn_session`). The blocklist symbolic strings never match anything in the live tool stream. Only `spawn_session` matches — and that one is already gated by the depth counter, which the comment at line 37 calls "belt-and-braces."

**This means four of the five Hermes-mapped tools are blocked in name only.** A subagent that wanted to invoke a memory-write or cross-platform messaging primitive in RunnerOS would not be stopped by this list because those primitives are named differently here. The SPEC AC "subagent invocation of memory, clarify, send_message, execute_code returns refusal" is **not met against real RunnerOS tools** — it's met against synthetic names.

**Fix:** Either (a) audit the actual RunnerOS tool registry and remap names to RunnerOS equivalents (memory write tool, user-clarification tool if any, send-message handler used by automations, code-execution tools like bash/exec), or (b) remove the four phantom entries and document that the blocklist is currently a single-entry belt-and-braces guard for `spawn_session`. Pretending the other four block anything is misleading. The plan's research note already flagged "RunnerOS equivalents" but the executor copied the Hermes strings verbatim.

---

### B3. Toolset intersection applied to the wrong field — `enabledSourceSlugs` is **source slugs**, not tools.

**Evidence:** `base-agent.ts:139` types `enabledSourceSlugs?: string[]` and the field semantically refers to *sources* (GitHub, Gmail, MCP servers, local APIs). The isolation module's `intersectToolsets` and `stripBlockedTools` both treat this list as a tool-name list. They are not the same namespace:

- A source slug like `"github"` enables a whole MCP server with N tools inside it.
- A tool name like `"spawn_session"` is a specific function the agent calls.

Running `stripBlockedTools(["github", "gmail"])` is a no-op for the wrong reason — none of those will ever be a tool name. Conversely, if a parent had `enabledSourceSlugs: ["github"]` and the child requested `["github", "gmail"]`, the intersection clamps to `["github"]` correctly — that part works. But the blocklist strip is operating on the wrong vocabulary entirely.

The SPEC R1 says "child toolset = intersection of requested toolset with parent toolset" — but RunnerOS does not have a flat "toolset" concept exposed on the spawn tool. The closest thing is the source-slug list (coarse-grained, server-level) plus the implicit SDK tool list (fine-grained, function-level). The executor mapped "toolset" → source slugs, and the blocklist semantics broke at that join.

**Fix:** Two separable problems. (a) Decide whether the intersection should run on source slugs (coarse, current behavior, useful) or on the actual SDK tool list (fine, requires reading the parent agent's effective tool set from the session registry). Document the decision. (b) Stop applying the blocklist to source slugs — apply it where tools are actually registered (the canonical tool registry in `getSessionToolDefs`, or in the SDK pre-tool-use hook at `agent/core/pre-tool-use.ts`). The current code conflates these two concerns into one filter call.

---

## 🟡 Concerns (fix before phase complete)

### C1. Depth counter races on concurrent sibling spawns are not a real bug, but the comment claims protection it doesn't provide.

`spawnDepthStorage.run(currentDepth + 1, ...)` correctly scopes per-async-context, so if a parent at depth 0 spawns N children in parallel via `Promise.all`, each child runs in its own AsyncLocalStorage scope with depth 1. There is no race — AsyncLocalStorage uses async-context isolation, not a shared counter. **Fine in code.**

What's missing: there is **no fan-out cap**. A depth-1 parent can spawn 1,000 depth-1 siblings simultaneously. The depth gate stops vertical fork bombs, not horizontal ones. Hermes upstream has the same gap, so this isn't a regression — but if you're claiming "fork-bomb protection" in the header comment (line 15), be honest that it's *vertical-only*. A subagent that calls `Promise.all([...Array(10_000)].map(() => spawn_session(...)))` is unbounded.

**Fix:** Either add a per-parent concurrent-spawn cap (cheap: a counter in AsyncLocalStorage decremented in a `finally`) or weaken the comment to "vertical fork-bomb protection."

### C2. `runWithSubagentApproval` accepts only `Promise<T>`, but the wrapping site discards the return type.

`spawn-session-tool.ts:153-157`:
```ts
const result = await runWithSubagentApproval(childApprovalCb, () =>
  spawnDepthStorage.run(currentDepth + 1, () => spawnFn(childArgs)),
);
```

This works, but `spawnDepthStorage.run` is synchronous and returns `Promise<...>` only because `spawnFn` returns a promise. If `spawnFn` ever throws *synchronously* (before producing a promise), `AsyncLocalStorage.run` will propagate that throw out of `runWithSubagentApproval` *without* the storage cleanup the surrounding `try/catch` expects. Low probability but worth a defensive `Promise.resolve().then(() => spawnFn(childArgs))` or an explicit `async` wrapper.

### C3. `console.warn` for audit logging is not an audit log.

Lines 86-95, 124-129, 133-137 all `console.warn` for security-relevant events (subagent denied, subagent approved with bypass, depth clamp). In an Electron app these go to stderr and are not durable. The SPEC AC says "subagent_auto_approve: true opt-in works and is logged" — `console.warn` satisfies the literal letter but not the spirit. If a user enables auto-approve and a subagent runs `rm -rf`, there is no persistent record beyond whatever was in the terminal.

**Fix:** Route through the same logging facility used elsewhere in `packages/shared` (whatever audit-log pathway exists for permission decisions), or document explicitly that audit logging is deferred to a follow-up.

### C4. Integration test "installs isolated approval callback" only verifies the callback is reachable inside `spawnFn`, not that the real subagent honor-runs it.

`spawn-session-isolation.test.ts:384-398`:
```ts
const fakeSpawn = mock(async () => {
  const cb = approvalCallbackStorage.getStore();
  innerCallbackDecision = cb?.({ command: 'x', description: 'y' });
  ...
});
```

The fake `spawnFn` is the thing checking the callback. The real `spawnSessionFn` (whatever the session registry returns) is what would actually consult the callback during tool execution. Nothing in this test proves the real spawn path reads `approvalCallbackStorage` at the right moment. This is the classic "mock-shaped hole" — the test verifies the wrapper installs the value, not that the wrapped code observes it.

**Fix:** Add a test that drives a real (or near-real) `spawnSessionFn` and shows it consulting the storage at the tool-permission decision point. At minimum, document which call site in the spawn pipeline is expected to read `approvalCallbackStorage` — I don't see any caller of `approvalCallbackStorage.getStore()` outside this module and its tests.

### C5. `getCurrentSpawnDepth` is exported but never imported by external callers — depth read happens via `spawnDepthStorage.getStore()` directly in `spawn-session-tool.ts:126`.

Either dead code or an unfinished abstraction. Minor.

### C6. `intersectToolsets(parent, requested)` with empty `parent` short-circuits to `[]` (line 58). That means a parent with no toolset declared yields a child with zero tools. In RunnerOS, "no `enabledSourceSlugs`" usually means "default toolset" — empty is not the same as "unknown / use defaults." Combined with B3 this is a footgun: if `getParentToolset` returns `[]` instead of `undefined`, the child gets nothing.

**Fix:** Distinguish "empty allowlist (deny all)" from "no allowlist declared (use defaults)" at the call site contract. Current code conflates them.

### C7. The "39 tests" headline number is generous — many are 2-3 line assertions on pure functions. The genuine integration assertions are the four wiring tests at lines 308-398, and one of those (C4) has a mock-shaped hole. Test count != coverage of behavior.

---

## 🔵 Nice-to-have

- N1. `ApprovalDecision = 'deny' | 'once'` — Hermes also has `'always'`. Add it or document why it was dropped.
- N2. `SPAWN_SESSION_BLOCKED_TOOLS` could be `Readonly<Set<string>>` (it is) but also exported as `as const` for compile-time literal types in callers.
- N3. The refusal payload is JSON-stringified with `null, 2` pretty-print in `spawn-session-tool.ts:46`. Subagents will parse this — pretty-print isn't useful and slightly larger. Single-line.
- N4. `SubagentRefusalPayload` has `refusal: true` as a literal. Good. The `error` field is human-readable; if subagents need to programmatically branch, an `errorCode` enum would be more robust.
- N5. License header is on the isolation module but not on the spawn-session-tool.ts isolation section. A two-line block comment at line 122 ("Isolation hardening — ported from Hermes") would help future readers.
- N6. Plan task 3 said "Mock `actualSpawn` so the tests don't need a real LLM." Done — but the test for the depth-limit-blocking-spawn case (line 325) doesn't assert that `fakeSpawn` was *not* called inside the depth scope. It checks `toHaveBeenCalledTimes(0)` against the outer mock, which is correct, but a comment would clarify.

---

## Acceptance criteria checklist (SPEC R1 + plan must_haves)

| AC | Status | Notes |
|---|---|---|
| Subagent invocation of `spawn_session` returns refusal payload | ✅ in test path | Only because depth=1 default; production wiring confirmed via tests |
| Subagent invocation of `memory, clarify, send_message, execute_code` returns refusal | 🔴 **NOT MET** | Names don't match real RunnerOS tools. See B2. |
| Approval callback on subagent thread doesn't block on parent stdin | 🟡 partial | Storage isolation is correct; no real subagent consumer of the callback is shown in code. See C4. |
| `subagent_auto_approve: true` bypasses default and is logged | 🔴 **NOT REACHABLE** from user config — no production wiring. See B1. `console.warn` log only. See C3. |
| Spawn at depth == max_spawn_depth rejected | ✅ | Tested. |
| `max_spawn_depth` clamped to [1,3] with default 1 | ✅ | Tested. Config knob non-functional in production — see B1. |
| Child toolset = intersection with parent | 🟡 | Math correct; mapped to wrong field. See B3. |
| THIRD_PARTY_NOTICES credits Hermes | ✅ | Done. |
| `bun run typecheck:all` clean | not run | Should re-verify after fixes. |
| `bun run lint` clean | not run | Should re-verify. |
| `bun test` green | not run | Tests look correct against the (flawed) implementation. |

---

## Final verdict: **FIX-AND-RESHIP**

The module itself is well-written, well-tested at the unit level, and the AsyncLocalStorage design is correct. License hygiene is clean. But it is **not currently doing what the SPEC says it does in production**:

- B1 (no production wiring) means user-facing config knobs do nothing.
- B2 (phantom blocklist) means 4/5 named blocked tools are unreachable strings.
- B3 (wrong field for intersection) means the privilege-escalation guard operates on source slugs rather than tools, and the blocklist runs against the wrong namespace.

These are not nits — they undermine three of the five SPEC AC bullets. Tests pass because tests inject the right shape; production runs with defaults and silent no-ops.

Fix B1, B2, B3, then this is a SHIP. Estimated effort: 0.5–1 day, mostly the call-site wiring and a sober re-audit of which RunnerOS primitives correspond to each Hermes blocklist entry. Concerns C1–C7 can land in the same PR or follow-up — they don't block, but C3 (audit logging) and C4 (mock-shaped hole) should not be left unattended past the phase end.

Do not ship this thinking it provides the guarantees the SPEC promises. It currently provides about 40% of them; the other 60% is paint.

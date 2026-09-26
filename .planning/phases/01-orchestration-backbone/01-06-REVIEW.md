# 01-06 Per-Job Toolsets — Code Review

**Reviewer:** cold senior-dev audit pass (rival-wrote-this stance)
**Scope:** Hermes-ported per-run `enabled_source_slugs` precedence chain + `permission_mode` plumbing.
**Files audited:**
- `packages/shared/src/workflows/trigger-inputs.ts`
- `packages/shared/src/workflows/trigger-inputs.test.ts`
- `packages/shared/src/workflows/index.ts`
- `packages/server-core/src/workflows/runner.ts`
- `packages/server-core/src/workflows/runner.test.ts`
- `THIRD_PARTY_NOTICES.md`

**Verdict:** **APPROVE with two follow-ups.** Implementation is tight, semantics are correct, attribution is clean. The two follow-ups are scope/clarity items, not correctness bugs.

---

## 1. Precedence Correctness — PASS

Resolver implements per-job > per-platform > default as a **strict winner chain**, not a merge.

`trigger-inputs.ts:189-202`:
```ts
if (perJobOverride && perJobOverride.enabled_source_slugs !== undefined) {
  return dedupe(perJobOverride.enabled_source_slugs);
}
const platformLayer = perPlatformConfig?.[platformKey];
if (platformLayer && platformLayer.enabled_source_slugs !== undefined) {
  return dedupe(platformLayer.enabled_source_slugs);
}
return defaultToolset === undefined ? undefined : dedupe(defaultToolset);
```

Per-job is the winner — returned immediately, never merged with platform or default. Matches Hermes `cron/scheduler.py:60-88` semantics. Test `'per-job override wins over platform + default'` (line 103) explicitly covers the three-way collision case and asserts `['github']`, not a merge.

## 2. `undefined` vs `[]` Semantic — PASS

The distinction is enforced **and** unambiguous in code, comments, and tests.

- **Code:** Tier-1 check is `enabled_source_slugs !== undefined` (line 189). `[]` passes that gate and is returned via `dedupe([])` → `[]`. Nowhere does `[]` get normalised to `undefined`.
- **Parser:** `parseTriggerToolsetOverride` only assigns `out.enabled_source_slugs` when the key is present AND `Array.isArray(v)`. `[]` is a valid array — preserved. Empty arrays are never stripped (line 137-138).
- **`dedupe([])` → `[]`** by construction (empty input, empty output). Verified.
- **Tests:** `'preserves empty array (deny-all sentinel) — distinct from undefined'` (line 76) and `'empty array on per-job override → deny-all, NOT default fallback'` (line 132) lock the semantic. The second test asserts both `.toEqual([])` and `.not.toBeUndefined()`.

No bug path found.

## 3. Runtime Enforcement — PASS (with note)

Override is applied at `runner.ts:668` (`applyTriggerToolsetOverride`) inside `executeStepAttempt`, **before** `createSession`. The resulting `enabledSourceSlugs` is passed into `CreateSessionOptions`.

Critical question: does the SDK actually gate tool calls on this, or is it informational? Answer: **it gates them, structurally.**

`SessionManager.ts:2072` and the agent-init path (`SessionManager.ts:3433`, `reloadSessionSources` at ~2570) all filter sources by `enabledSourceSlugs.includes(s.config.slug)` BEFORE building MCP and API servers. Sources outside the allow-list never get their servers attached to the session. There is no "stored but not enforced" path — a source not in `enabledSourceSlugs` cannot dispatch a tool because its MCP server doesn't exist in the session at all.

**Note:** This is not a per-tool-call gate but a per-session-boot gate. That matches Hermes (the enabled-toolsets list is consumed at agent init, not on every tool call) and is the right design — but the `isSourceAllowed`/`buildToolNotEnabledDenial` helpers (see §12) suggest a *call-time* gate was anticipated. Today, the call-time gate is dead code on the production path. Not a defect; flag for §12.

MCP-server-name vs source-slug harmonisation: the filter is by `s.config.slug` consistently; MCP server identity is downstream of slug. No mismatch.

## 4. Deny-All Actually Denies — PASS

`runner.test.ts:1250` (`'per-job override of empty array denies all sources...'`) starts a real `WorkflowRunner`, supplies `enabled_source_slugs: []`, and asserts the resulting `createSession` options carry `enabledSourceSlugs: []` (not the agent default of `['researcher-source']`). Combined with §3 — empty list at session-build means zero MCP/API servers attached — deny-all is structural.

The shared-package unit test `'workflow with empty deny-all override rejects every tool call'` (line 269) further verifies the dispatcher-level helper rejects every slug when the resolved list is `[]`.

## 5. Graceful Degradation — PASS

Two distinct degradations covered:

- **Non-existent platform key:** `resolveEnabledToolsets` reads `perPlatformConfig?.[platformKey]` with optional chaining; missing key → falls through to default. Test at line 160 (`'non-existent per-platform key falls through to default'`) verifies.
- **Malformed override on the wire:** `applyTriggerToolsetOverride` (runner.ts:208) wraps `parseTriggerToolsetOverride` in try/catch, logs a warning, and returns the unmodified agent options. Test `'malformed override does not crash the run'` (runner.test.ts:1323) feeds `enabled_source_slugs: 'github'` (string, not array) and asserts the run completes succeeded with agent defaults intact.

Matches Hermes `cron/scheduler.py:87` graceful-degradation pattern.

## 6. `permission_mode` Plumb-Through — PASS WITH CAVEAT

Schema, parser, resolver, and `TRIGGER_PERMISSION_MODES` export are all present and correctly typed. Tests cover precedence (`resolvePermissionMode` describe block, line 193).

**Caveat — Follow-up #1:** `resolvePermissionMode` is exported from `@craft-agent/shared/workflows` (index.ts:72) but is **not consumed** by `WorkflowRunner`. The runner reads `permission_mode` off the trigger inputs implicitly via `parseTriggerToolsetOverride`, but never calls `resolvePermissionMode`, and never propagates a resolved mode into `agentOptions.permissionMode` or anywhere else. This is consistent with the executor's note that runtime semantics are deferred to plan 01-07, BUT it means plan 01-07 must consciously wire it up — the resolver exists in a vacuum right now and nothing downstream reads the per-run hint. Not a bug for this plan; flag for 01-07 to remember.

The value is "carried" only in the sense that it's available on `snapshot.trigger.inputs.permission_mode` for a future reader. Plan 01-07 should not silently assume the runner is forwarding it.

## 7. Trim/Dedupe — PASS

`dedupe()` at trigger-inputs.ts:273:
- preserves insertion order (uses `Set` for membership, array for order)
- trims whitespace via `String.trim()`
- drops empty strings post-trim
- **case-sensitive** (no `.toLowerCase()`)

Input `['github', 'github', ' gmail ']` → `['github', 'gmail']`. ✅
Input `['GitHub', 'github']` → `['GitHub', 'github']` (kept distinct).

Case sensitivity is the right call — source slugs are case-sensitive identifiers throughout the codebase (see slug filter at SessionManager:2073, exact `.includes` match). Test at line 176 covers dedupe + trim + empty-string drop.

## 8. Server-Core Tests — PASS

The 5 new tests (runner.test.ts:1231-1343) exercise the **real** `WorkflowRunner.start()` → `executeStepAttempt` → `applyTriggerToolsetOverride` → `createSession` path. They assert on `h.sessions.get('sess-1')!.options.enabledSourceSlugs`, i.e. what was actually passed into the mocked `createSession`. Enforcement is not mocked away — the resolver and runner code under test runs unmodified. Only the SessionManager itself is replaced by the harness (necessary; you can't boot a real Claude agent in a unit test).

The integration test in `trigger-inputs.test.ts:237` (`'integration: per-job override end-to-end'`) covers the dispatcher-helper path with the simulated tool dispatch. Together these are sufficient coverage for the in-process gate.

## 9. Backwards Compatibility — PASS

- `parseTriggerToolsetOverride({ topic: 'markets', limit: 3 })` returns `{}` (test line 82). A workflow with no new fields produces an empty override; `applyTriggerToolsetOverride` early-returns when `perJobOverride.enabled_source_slugs === undefined && !platformHasSlugs` (runner.ts:229), leaving `agentOptions` byte-identical.
- `runner.test.ts:1269` (`'no per-job override leaves agent default enabledSourceSlugs intact (backward compat)'`) verifies the agent default `['researcher-source']` survives unchanged.
- `WorkflowRunSnapshot` shape is not modified. Existing on-disk run.json files do not gain or lose required fields. Compat clean.

## 10. Plan Deviations — DEFENSIBLE, but verify

The plan said "prompt-handler.ts: forward enabled_source_slugs / permission_mode untouched." Executor skipped it because automations don't invoke `WorkflowRunner` directly.

Verified: `grep` for `WorkflowRunner|getWorkflowRunner|runner.start` in `packages/shared/src/automations/` returns no production hits. `PromptHandler` is the automations event-bus prompt handler — it sends prompts to sessions, not workflows. The only `WorkflowRunner` consumer is `SessionManager` (instantiates it at line 2336) and RPC handler `workflow-runs.ts` (routes RPC `runWorkflow` calls). Both pass `triggerInputs` as a flat `Record<string, unknown>` straight through — the new fields ride along for free.

**Follow-up #2 (low):** When scheduled triggers ship (plan 01-08 / cron path), there will be a *second* caller of `WorkflowRunner.start()`. That caller must also forward `enabled_source_slugs` / `permission_mode` from the cron job's trigger spec into `triggerInputs`. The current code passes the test today only because the manual-trigger RPC is the sole entry point. Flag for the scheduler plan.

## 11. License Attribution — PASS

- **File header** (`trigger-inputs.ts:1-35`) cites Hermes `cron/scheduler.py:60-88` (`_resolve_cron_enabled_toolsets`) and `cron/jobs.py:523, 662` with the upstream snapshot path `.planning/research/upstream/hermes/`. Matches what the user told me to verify.
- **`THIRD_PARTY_NOTICES.md` row** present at line 28 with the same upstream file + line citations and a forward pointer to `runner.ts`/`applyTriggerToolsetOverride`. Format matches the existing Hermes rows (subagent-isolation, shell-hooks). Mentions `permission_mode` plumbing explicitly.
- **Inline citation** at `runner.ts:188-202` and `runner.ts:662-667` ties the runner code to the upstream files.

Apache-2.0 + Hermes MIT compatibility is preserved.

## 12. `isSourceAllowed` + `buildToolNotEnabledDenial` — FOLLOW-UP

Both helpers are exported from `@craft-agent/shared/workflows` (index.ts:67-68). Both are tested (trigger-inputs.test.ts:212, 228).

**Production usage: zero.** Grep across `packages/`, `apps/` shows the only callers are the test file and the index re-export. They're a typed denial primitive for a *call-time* gate that does not exist on the current path (see §3 — enforcement is at session-build, not call-time).

**Why this is okay (today):** the spec wave referenced them ("Workflow run with enabled_source_slugs: ['github'] rejects calls to other source slugs at runtime with a clean tool-denied error"). The structural gate satisfies the spec — the source's MCP server is never attached, so the tool literally doesn't exist for the agent to call. No denial needed.

**Why this should be cleaned up:** Exported public API surface with no callers is a maintenance hazard. Two acceptable resolutions:

1. **(preferred)** Use them as a defence-in-depth gate at tool dispatch. The most natural site is `spawn-session-tool.ts` (already does slug intersection at line 162) or a session-tool-call middleware. Even with structural enforcement, a call-time gate gives a *clean error* if a stale tool reference survives a session restart with a shrunken allow-list.
2. **(acceptable)** Demote both to non-exported helpers (or scope to the test file) until plan 01-07/01-08 actually consumes them. Don't ship public API on speculation.

Either is fine. Shipping them as exported-but-unused is the worst of both worlds.

---

## Minor / Nit

- **`runner.ts:996-1004`** defines `private emit(event)` which is dead — `emitEvent` (above it) is the live one. Drop `emit` or fold its try/catch into `emitEvent`. Pre-existing, not from this plan, but visible while reading the file.
- **`platformKey` default mismatch.** `resolveEnabledToolsets` defaults `platformKey = 'cron'` (line 186). `applyTriggerToolsetOverride` passes `'workflow'` explicitly (runner.ts:238). Both `cron` and `workflow` layers are checked for `platformHasSlugs` (line 226-228). Functionally correct, but the default in the shared module disagrees with what the only production caller passes — a future caller that forgets to pass `platformKey` will silently read the wrong layer. Either make the default explicit (no default) or document the asymmetry in the resolver JSDoc.
- **Header doc** (trigger-inputs.ts:11-14) lists "Per-platform (e.g. cron.enabled_source_slugs)" but the runner consults `workflow.enabled_source_slugs` first for workflow runs. Update the header example to mention both keys or clarify "depending on `platformKey`".

---

## Verdict

**Approve.** Correctness is solid: precedence is a strict chain, deny-all is preserved end-to-end, graceful degradation matches Hermes, backwards compat is structural, tests exercise the real runner path, attribution is clean.

Two follow-ups, neither blocking:
1. Plan 01-07 must wire `resolvePermissionMode` into the runner — it's plumbed to the trigger but not yet read.
2. `isSourceAllowed` / `buildToolNotEnabledDenial` are exported but unused on the production path; either consume them (defence-in-depth at tool dispatch) or stop exporting them.

Nits as listed (header doc, `platformKey` default, dead `emit`).

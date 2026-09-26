# 01-07 Subconscious Mode — Cold Review

**Reviewer:** code-review-swarm (adversarial, rival-authored assumption)
**Date:** 2026-05-20
**Plan:** [01-07-subconscious-mode-PLAN.md](./01-07-subconscious-mode-PLAN.md)
**SPEC requirement:** [R7](./01-SPEC.md#requirements) (Subconscious job mode, OpenHuman concept, GPL-3.0 re-implementation)
**Predecessor follow-up:** [01-06-REVIEW.md §Follow-up #1](./01-06-REVIEW.md) — `resolvePermissionMode` exported but unused. **This plan owns the wire-up.**

**Verdict:** **CONDITIONAL PASS** — the store + gate are well-built and license-clean, but the runtime is unwired end-to-end. The agent layer (`gateWriteAttempt`) is implemented and tested in isolation, the runner resolves the hint and stashes `__subconsciousMode` on agentOptions, but **nothing downstream of the runner consumes that hint** and **no notifier is registered to a real UI/event-bus surface**. The feature is invisible in production today. Acceptance criterion ("workflow with `mode: subconscious` running a write tool pauses execution") is **not yet provable at the runner→agent boundary** — only at the unit-test boundary inside `gateWriteAttempt`.

Treat this as: SPEC R7's *core machinery* shipped, *integration* is half-done. 01-08 (ACP) and the as-yet-unnamed UI surface plan need to finish the wiring.

---

## 1. License Hygiene — PASS

- `escalation-store.ts` and `subconscious-permissions.ts` and `subconscious-mode.ts` carry explicit header comments: "Concept-only re-implementation from OpenHuman (GPL-3.0) — NO source code copied. Behavior derived from prose specification in `.planning/research/04-openhuman-concepts.md`."
- `grep -rn "from.*upstream/openhuman" packages/` returns zero matches. The OpenHuman upstream snapshot is in `.planning/research/upstream/openhuman/` (read-only, not imported).
- Naming taxonomy is RunnerOS-native: `gateWriteAttempt`, `WriteAttemptOutcome`, `escalation`, `pending|approved|rejected`. No OpenHuman-isms (`UnapprovedWrite` is the spec name but it survives only as a code comment in `subconscious-mode.ts`; the runtime type is `WriteAttemptOutcome { kind: "escalated" | ... }`).
- Decision-order in `evaluateWriteAttempt` is straight-line, no OpenHuman-quirk fingerprints (`yolo`-short-circuit-first → `isWriteTool` → mode dispatch).
- `THIRD_PARTY_NOTICES.md` § "Conceptual References (not vendored)" already lists `escalation-store.ts` under OpenHuman GPL-3.0 with the "concept inspired by … NO GPL source code copied" caveat. Row is present but **still tagged `(R7, planned)`** — the parenthetical "planned" should be removed now that the store has landed. Minor doc-hygiene nit.

**Defense:** "Concept re-implemented from prose in `.planning/research/04-openhuman-concepts.md`; no compilation unit imports anything under `.planning/research/upstream/openhuman/`; pattern taxonomy and naming are RunnerOS-native." Solid.

**Follow-up:** Drop `(R7, planned)` parenthetical in THIRD_PARTY_NOTICES.md.

---

## 2. SQLite Path Correctness — PASS, with one footgun

- Path: `${CONFIG_DIR}/escalations.db` via `getDefaultEscalationStorePath()`. `CONFIG_DIR` honors `CRAFT_CONFIG_DIR` env override. Sibling to existing on-disk artifacts. Correct.
- First-run safety: `mkdirSync(parent, { recursive: true })` if `:memory:` is not the path. `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`. Idempotent. No migration framework needed at this scope.
- Durability: WAL journal mode set. Survives Electron restart. Test `EscalationStore — durability across instance restart` explicitly reopens at the same path and confirms rows persist with status preserved.
- **Footgun:** `getEscalationStore(path?)` is a singleton-per-process for the default path, but a **fresh instance per call when a path is passed**. That's correct for tests, but it means if any production code path ever passes an explicit `path` (e.g. a future per-workspace DB), it gets a new `Database` handle every call — file-locking storm. Fix is trivial (memoize by path), but flag.
- Migrations: not present. Acceptable for v1 since `CREATE TABLE IF NOT EXISTS` handles greenfield; flag a future migration story if columns get added (e.g. `status='expired'` — see §9).
- No `bun:sqlite` version pin: relies on whatever bun ships. OK because the API surface used (`prepare`, `run`, `all`, `exec`, WAL pragma) is stable.

---

## 3. Concurrency — PASS for the store, UNKNOWN for downstream

- `bun:sqlite` serializes writes through the SQLite engine. `WAL` mode allows readers concurrent with a writer. `create()` and `resolve()` are each single `INSERT`/`UPDATE` statements — atomic.
- `resolve()` reads-then-writes (`get(id)` then `UPDATE WHERE id = ?`) **without a transaction wrapper**. Two concurrent `approveEscalation(sameId)` racers would both pass the `current.status !== 'pending'` check, both issue the `UPDATE`, and both `notify()` listeners. The second `notify()` carries a stale "approved" status of a row that's already approved. Listeners would resolve the pending deferred twice — harmless because `pending.delete(e.id)` + `pending.get(e.id)` guard, but the second `slot.resolve()` is a no-op anyway. **Acceptable but worth a `BEGIN IMMEDIATE` wrap** to make the read-modify-write atomic and let one racer throw the "current status is 'approved'" guard.
- Multi-process safety: a second Electron process opening the same DB file gets its own WAL session. Approvals from the other process would NOT trigger the in-memory `subscribe()` listeners in this process — the subscription model is in-process only. **Today RunnerOS is single-process Electron-main**, so this is fine, but document it. If anyone ever moves the escalation queue handler to a worker thread, the deferred map won't see external resolutions.
- Test coverage: "multiple pending concurrent" exists, but the test simulates serial create+resolve, not true concurrent racers. No `Promise.all` racer test.

**Follow-up:** Wrap `resolve()` in a `BEGIN IMMEDIATE; … COMMIT;` transaction. Add a Promise.all racer test for `approveEscalation(sameId)` calling twice.

---

## 4. Resume Semantics Correctness — PASS, with three caveats

### 4a. Agent state during pause
`gateWriteAttempt()` returns a `Promise<WriteAttemptOutcome>`. The agent's tool dispatcher must `await` it; the agent loop is frozen at that turn. **However:** the gate is only called from `gateWriteAttempt` — there is no wired call site in any production code path today (see §5). So the question "is the agent frozen or churning" can't be answered from the integration — only from the unit-test contract, which is correct.

### 4b. 24-hour pause / memory leak
The pause holds:
- A row in SQLite (durable, ~1 KB).
- A `pending` map entry in module-level memory: `{ resolve, reject }`. Two function refs. Sub-KB.
- An `await` on an unresolved Promise — the V8 microtask queue holds a continuation frame for the awaiting coroutine.

For one escalation that's negligible. For 1000 escalations sitting open for a week, ~1 MB heap. **Acceptable.** The real failure mode is the **session**, not the gate: if the agent SDK closes the parent session because a tool call exceeded a timeout, the awaiting continuation will be garbage-collected mid-await and `pending` will leak a stale `{ resolve, reject }` forever. The store also has no `_resetDefaultEscalationStore`-style cleanup for stale `pending` entries.

**Follow-up:** add a stale-entry sweep — e.g. on `gateWriteAttempt` entry, scan `pending` for orphaned-promise entries older than N hours, `reject()` them with a "stale escalation, restart workflow" error.

### 4c. Replay with original args vs current-time args
`gateWriteAttempt` captures `execute: () => Promise<unknown>` at call site. On approve, `await execute()` runs the same closure — which closes over the **original** tool args. So a `send_message("hi")` paused at 09:00 and approved at 12:00 replays with the original "hi", not a re-rendered template at 12:00. **Correct.** The escalation row's `tool_call_json` also captures the original args verbatim for audit.

Caveat: if `execute` is a thunk that itself reads mutable state (e.g. "send the *current* contents of file X"), the replay sees post-pause state. But that's a property of how the caller constructs `execute`, not a gate bug. Code in `subconscious-mode.ts` is right to make `execute` an opaque closure.

### 4d. Rejected → synthetic "denied" tool result
`{ kind: 'denied', reason: 'User rejected escalation <id> for tool "<name>".', escalationId, durationMs }`. The agent's downstream is responsible for surfacing this as a tool-result message. **No caller exists today** to translate this back into an LLM-visible tool error — flagged again as the integration gap. Unit test asserts `outcome.kind === 'denied'` and that `execute` is not called. Correct at the contract level.

---

## 5. `resolvePermissionMode` Wiring — **PARTIAL** (BLOCKER if you read R7 strictly)

This is the most important finding. 01-06 review explicitly said:

> Plan 01-07 must wire `resolvePermissionMode` into the runner — it's plumbed to the trigger but not yet read.

Status now:

- `WorkflowRunner.resolveTriggerPermissionMode()` (runner.ts:266) **does call `resolvePermissionMode`**. ✓
- It stashes the result on a private `__subconsciousMode` field of `agentOptions` (runner.ts:709–715) when non-default. ✓
- **No consumer reads `__subconsciousMode` anywhere.** ✗

Verified by grep: `grep -rn "__subconsciousMode" packages/ --include="*.ts"` returns three hits, all in `runner.ts` — the write site, the cast, and a comment. No bootstrap layer, no session-creation handler, no agent backend, no tool dispatcher reads it. The hint dies on the agentOptions struct.

Likewise, `gateWriteAttempt` is exported from `@craft-agent/shared/agent` but **never called outside its own test file**. The runner does not call it. The session/tool dispatcher does not call it. PromptHandler plumbs `subconsciousMode` onto `PendingPrompt` but no consumer of `PendingPrompt` reads that field either (grep `\.subconsciousMode` on non-test code returns zero hits outside the producer).

**Net:** the *machinery* exists end-to-end as type-clean modules. The *call site* that actually pauses a run on a write attempt does not exist. R7 acceptance ("Workflow with `mode: subconscious` running a write tool pauses execution") is **not provable end-to-end**.

This is the inverse of 01-06's gap. 01-06 exported a resolver no one consumed; 01-07 consumed the resolver but stashed the result in a private field no consumer reads. The chain still has a missing link — it just moved one hop downstream.

**Recommendation:** Either (a) demote `__subconsciousMode` to a non-shipped TODO marker and explicitly defer the wire-up to a named follow-up plan, OR (b) wire it now: the bootstrap layer (where `CreateSessionOptions` becomes a live session) should read `__subconsciousMode`, register a `setEscalationNotifier(...)` callback against the app's event bus, and inject `gateWriteAttempt` as the agent backend's pre-tool-dispatch hook. Without (b), R7 ships as a library, not a feature.

---

## 6. "Subconscious" Mode Semantics — PASS, with two write-classifier risks

- Write tools identified by `WRITE_TOOL_NAMES` (frozen `Set`) + `WRITE_TOOL_PREFIXES` (`mcp__`) + Bash command regex (`BASH_WRITE_VERBS`).
- **New-tool default behavior:** an unknown tool name that doesn't match any classifier and doesn't start with `mcp__` falls through to `isWriteTool() = false`, which means `evaluateWriteAttempt` returns `'allow'` in subconscious mode. **UNSAFE DEFAULT.** A new `delete_user_account` tool shipped tomorrow without classifier-list maintenance silently bypasses the gate.
  - Counter-argument: the existing Safe-Mode allow-list in `mode-types.ts` ALSO uses a hardcoded blocklist, so this is consistent with the package's posture. Still — the SPEC R7 wording is "writes pause" — a missing classifier breaks that contract silently.
  - **Recommendation:** flip the default. Maintain an explicit `READ_TOOL_NAMES` allow-list (Read, Glob, Grep, etc.) and a `READ_TOOL_PREFIXES` list (`get_`, `list_`, `read_`, `search_`). Unknown tools → `isWriteTool = true` → escalate. Safe-by-default. The Bash-verb heuristic is OK to keep, but the *fall-through default* should be "escalate" not "allow".
- `mcp__` prefix is treated as write conservatively. Good.
- **Inconsistency:** `WRITE_TOOL_NAMES` includes `'save_memory'`, `'update_memory'`, `'forget_memory'`, `'update_user_preferences'` (RunnerOS session-scoped writes), but NOT `Edit`-equivalent platform tools the codebase exposes today. Cross-check against `session-scoped-tools.ts` and `agent/index.ts` should be a chore on every new tool added.

**Follow-up (blocker for production-safe ship):** flip to allow-list-of-reads semantics. Until then, R7's safety guarantee is only as good as the maintenance discipline of `WRITE_TOOL_NAMES`.

---

## 7. Recommendation Extraction — PASS

- `RECOMMENDED ACTION:` marker regex implemented (`extractRecommendation` in `subconscious-permissions.ts:177`). Matches the OpenHuman convention noted in `.planning/research/04-openhuman-concepts.md` §Upgrade 5. The marker is opt-in: prompts that don't use it fall back to `${toolName}(${JSON args truncated to 240 chars})`.
- Marker is case-insensitive (`/is` flag), tolerates whitespace.
- Fallback truncates at 240 chars with `...` ellipsis — sensible for a notification card.
- JSON serialization wrapped in try/catch — handles unserializable args gracefully (`<unserializable>` fallback).
- Test coverage: marker present, marker absent → both branches exercised in `subconscious-mode.test.ts`.

**Documented:** the marker contract is explicit in code comments and header. Good.

---

## 8. Notification Path — **FAIL (no-op stub)**

- `notifySink: NotifyEscalation = () => {}` is the default (subconscious-mode.ts:77).
- `setEscalationNotifier(fn)` exists but **nothing in the production codebase calls it**. Grep confirms: only the test file calls `setEscalationNotifier`. The Electron main process never wires a real sink.
- Comment at subconscious-mode.ts:71 acknowledges the layering reason: "we avoid hard-coupling to `automations/event-bus` here because `agent/` is layered below `automations/`". Correct decision architecturally, but the bootstrap plan that hooks it up doesn't exist or hasn't been called out.
- **Effect:** an escalation is created, persisted, awaits resolution — but no UI, no log, no event bus, no IPC ever sees it. The user will not know a run is paused. The run will sit forever (modulo §4b's memory leak / orphan).

**Recommendation:** bootstrap layer (likely `apps/electron/main/...`) must call `setEscalationNotifier(...)` at startup to bridge into the existing automations event-bus or IPC channel. Until then, R7 is invisible.

**Follow-up:** named ticket "Wire setEscalationNotifier in app bootstrap → automations event bus + Electron IPC".

---

## 9. Status Field Transitions — PASS, with one gap

- States: `'pending' | 'approved' | 'rejected'`. SQLite `CHECK(status IN ('pending','approved','rejected'))` enforces at the DB layer. TS enum matches.
- **No `'expired'` state.** Plan 01-07 PLAN.md §interfaces says "Time-bounded: pending escalations beyond N hours surface as 'stale' but don't auto-resolve." That's not implemented. No TTL field on the row, no sweep, no `expired` status, no surfacing. SPEC R7 doesn't require it but the plan said it'd surface as "stale" — partial deliverable.
- `resolve()` rejects non-pending transitions with a clear error message. Good.
- No `pending → pending` no-op self-transition (would be silly anyway).

**Recommendation:** add a `getStaleEscalations(opts: { olderThanMs: number })` listing helper (no auto-resolve, just visibility) to satisfy the plan's "surface as stale" promise. Trivial: `SELECT * FROM escalations WHERE status = 'pending' AND created_at < ?`. Bonus: a manual `expireEscalation(id, reason)` admin op for the case where the user wants to abandon an old paused run without rejecting it.

---

## 10. `approveEscalation`/`rejectEscalation` Idempotency — PASS

- `resolve()` (escalation-store.ts:248) explicitly throws `"Cannot ${next} escalation ${id}: current status is "${current.status}".` on non-pending. Test asserts this (`escalation-store.test.ts:112`).
- Throwing is the right choice over silent no-op: the UI / RPC caller learns the row already resolved (e.g. concurrent operator action) instead of false-positive UX.
- The throw is per-row. There's no transaction wrap (see §3) so a tight race could double-execute the `UPDATE` before either reads the post-state — fix with `BEGIN IMMEDIATE`.

---

## 11. Test Coverage Gaps — PARTIAL

**escalation-store.test.ts:** 11 tests (matches the task description). Coverage map:
- create → uuid + status + roundtrip → ✓
- listPending → only-pending, ordering, workflowRunId filter → ✓
- approve/reject → state transition, resolvedAt, result roundtrip → ✓
- non-pending throw → ✓
- unknown id throw → ✓
- multiple pending → ✓ (serial, not concurrent)
- close+reopen durability → ✓
- subscribe → ✓

**subconscious-mode.test.ts:** 16 tests. Coverage map:
- evaluateWriteAttempt × {default, yolo, subconscious} → ✓
- isWriteTool × {names, Bash verbs, mcp__ prefix} → ✓
- normalizeSubconsciousMode + alias → ✓
- extractRecommendation × {marker, fallback} → ✓
- gateWriteAttempt pause/resume × {approve, reject, read no-op, yolo no-op, concurrent} → ✓

**runner.test.ts:** 5 R7 tests (lines 1346–1450ish). Coverage:
- per-job `permission_mode: 'subconscious'` stashes hint → ✓
- per-job `permission_mode: 'yolo'` stashes hint → ✓
- no override → hint unset → ✓
- per-platform applies in absence of per-job → ✓
- per-job wins over per-platform → ✓

**Gaps (SPEC R7 acceptance criteria not covered end-to-end):**
- ❌ "Workflow with `mode: subconscious` running a write tool **pauses execution**" — only proved at unit-test of `gateWriteAttempt`, NOT at the runner→agent integration. The runner tests assert the hint is stashed; they do NOT assert a paused run, a created escalation row, or a notification fired in the runner's actual execution path. This is the §5 wiring gap surfaced as a missing test.
- ❌ "**`approveEscalation` resumes** the workflow and replays the write" — unit-tested at gate level; not tested at runner→agent boundary. Same root cause.
- ❌ "**`rejectEscalation` resumes** with a tool-denied result" — same.
- ❌ SQLite persistence test in isolation passes, but no test runs a workflow → escalation → restart → resume across a process boundary. Acceptable to defer if explicitly called out, not currently called out.
- ⚠️ No Promise.all racer test for approve/approve on same id (see §3).
- ⚠️ No test for stale-pending entries (because the feature isn't implemented; see §9).

---

## 12. Plan Deviations — MIXED

| Plan-listed file | Modified? | Notes |
|---|---|---|
| `escalation-store.ts` | ✅ created | Solid. |
| `__tests__/escalation-store.test.ts` | ✅ created | 11 tests, complete. |
| `permissions-config.ts` | ❌ **NOT MODIFIED** | `git diff` empty. The "added 'subconscious' mode" the user mentions actually lives in a **new file** `subconscious-permissions.ts`, parallel to `permissions-config.ts`. The plan §Task 2 explicitly said "Extend `packages/shared/src/agent/permissions-config.ts`: Add `'escalate-on-write'` value". That did not happen — instead the executor created a sibling module with its own type union (`SubconsciousMode = TriggerPermissionMode`). |
| `prompt-handler.ts` | ✅ modified | Adds DSL alias normalization, plumbs `subconsciousMode` + `onEscalation` onto `PendingPrompt`. ⚠️ But no consumer reads those fields. |
| `runner.ts` | ✅ modified | Calls `resolvePermissionMode`, stashes `__subconsciousMode`. ⚠️ Field is unread. |
| `__tests__/subconscious-mode.test.ts` | ✅ created | 16 tests. |
| `automations/types.ts` | ✅ modified | Adds `onEscalation`, `subconsciousMode` to PromptAction + PendingPrompt. Type-clean. |
| `THIRD_PARTY_NOTICES.md` | ✅ updated | Row R7 present; minor "(planned)" tag should drop. |

**Deviation A:** `permissions-config.ts` was NOT extended. Executor chose to keep the workspace-level `safe|ask|allow-all` mode (defined in `mode-types.ts`) separate from the trigger-level `default|subconscious|yolo` mode. **Architecturally defensible** — the file-header comment in `subconscious-permissions.ts` explains exactly why: workspace permission-mode and trigger permission-mode are different axes. But the plan said "Extend permissions-config.ts" verbatim. The deviation is reasonable in hindsight; flag for plan-tracking. The plan's `must_haves.truths` line "permissions-config.ts supports 'escalate-on-write' mode" is **technically not satisfied** by the literal file path; it's satisfied by the parallel `subconscious-permissions.ts`. Document the rename in the SUMMARY.

**Deviation B (scope creep, acceptable):** new file `subconscious-mode.ts` (the coordinator) was not listed in the plan's `files_modified` but is the actual glue layer. Sensible factoring — without it, the gate logic would have to live in `prompt-handler.ts`, which is already busy.

**Deviation C (scope cut, NOT acceptable):** the `01-07-SUMMARY.md` callout in `<output>` of the plan was supposed to be created. It does not exist in `.planning/phases/01-orchestration-backbone/`. Flag.

---

## 13. Additional Findings

### 13a. `applyTriggerToolsetOverride` double-parse (minor)
`runner.ts:applyTriggerToolsetOverride` and `resolveTriggerPermissionMode` each call `parseTriggerToolsetOverride(snapshot.trigger.inputs)` separately. On a workflow step that exercises both branches, the trigger inputs get parsed twice. Cost is microseconds, but the structural smell suggests they should share a parsed-override cache memoized per snapshot. Minor.

### 13b. Cast to `Partial<CreateSessionOptions> & { __subconsciousMode?: string }` is a type-system end-run
`runner.ts:714`. The `__` prefix hints at "internal/private" but TypeScript doesn't enforce it. Any future reader of `agentOptions` doesn't know the field exists unless they grep. **Recommendation:** thread `subconsciousMode?: 'default' | 'subconscious' | 'yolo'` as a first-class optional field on `CreateSessionOptions` (or a sibling `RunHints` struct). Type-safe, discoverable, and the bootstrap layer can read it without a string-keyed cast.

### 13c. Defensive `console.warn` in runner
runner.ts uses `console.warn(...)` for the malformed-override path. The repo convention (from CLAUDE.md and other files) is `createLogger('runner')`. Inconsistent. Should match the rest of the package.

### 13d. `_resetSubconsciousModeForTests` is exported
subconscious-mode.ts:110. Convention: `_`-prefix exports are test-only. Not a problem in itself, but it's exported on the public barrel via `agent/index.ts`. Easy footgun for a future caller to grab it from production code. **Recommendation:** move to a `test-utils.ts` and import directly from the test, or guard with `if (process.env.NODE_ENV === 'test')`.

### 13e. `notifySink` reset to no-op in `_resetSubconsciousModeForTests`
Calling the test-reset helper wipes the production-bootstrapped notifier. If the bootstrap ever sets the sink and a test then runs in the same process (unlikely with bun:test isolation, but possible), the test silently clears the production binding. Minor.

### 13f. PromptHandler `onEscalation` field is plumbed but `notify-and-queue` semantics are undefined
The DSL value `"notify-and-queue"` lands on `PendingPrompt.onEscalation`, but no consumer reads it. The plan said "the prompt-handler's automation config schema gets this optional field; when set, also emit a notification event (in addition to the escalation:created event)". Not implemented — there is no escalation:created event emission in the prompt-handler today either.

---

## Verdict Summary

**Strengths:**
- Store is well-engineered: WAL, durable, indexed, frozen sets, defensive JSON marshalling, clean factory + singleton + test injection.
- License hygiene rigorous and well-documented in every header.
- Write-tool classifier covers the realistic threat surface (Bash verbs, mcp__ prefix, named writes).
- Recommendation extraction handles both marker + fallback paths.
- 27 tests across two files, all green per the task description.

**Critical gaps (must address before claiming R7 ships):**
1. **§5 wiring:** `__subconsciousMode` is unread. `gateWriteAttempt` is uncalled in production code. The runner→agent boundary doesn't actually pause on writes. Either wire it or explicitly defer with a named follow-up plan and remove the R7 acceptance checkbox claim.
2. **§8 notification:** `setEscalationNotifier` is never called in production. Escalations are invisible. Bootstrap-layer wire-up required.
3. **§6 classifier default:** unknown tools default to `'allow'` under subconscious mode. Flip to read-allow-list-default for safe-by-default semantics.

**Minor blockers:**
4. **§12 Deviation A:** plan said extend `permissions-config.ts`, executor created `subconscious-permissions.ts`. Document the rename in a SUMMARY (and create one — §12 Deviation C).
5. **§3 atomicity:** wrap `resolve()` in `BEGIN IMMEDIATE`.
6. **§13b type discipline:** promote `__subconsciousMode` to a first-class optional field.

**Nice-to-haves:**
7. **§9:** `getStaleEscalations` + optional `expireEscalation` admin op.
8. **§4b:** stale-pending sweep on entry to `gateWriteAttempt`.
9. **§1:** drop `(planned)` tag from THIRD_PARTY_NOTICES.md R7 row.
10. **§11:** runner→agent integration tests for the actual pause/resume path (currently only unit-tested inside the gate).

**Verdict:** **CONDITIONAL PASS — ship the machinery, do NOT close R7's acceptance checkbox until wire-up + notifier + default-flip land.** Open a follow-up plan `01-07b-subconscious-wire-up.md` (or roll it into 01-08 ACP plan since ACP and subconscious mode both need the same bootstrap surface). Once wired, the test gap at §11 becomes runnable.

---

*Review generated 2026-05-20. Reviewer assumed adversarial stance per CLAUDE.md "code-reviewer" agent contract. Findings are evidence-based: every claim above is verifiable with grep against the working tree at commit `625127c` plus the staged + untracked delta listed in `git status`.*

---
phase: 01-orchestration-backbone
plan: 07
type: tdd
wave: 4
depends_on: [06]
files_modified:
  - packages/shared/src/agent/escalation-store.ts
  - packages/shared/src/agent/__tests__/escalation-store.test.ts
  - packages/shared/src/agent/permissions-config.ts
  - packages/shared/src/automations/handlers/prompt-handler.ts
  - packages/shared/src/agent/__tests__/subconscious-mode.test.ts
autonomous: true
requirements: [R7]
must_haves:
  truths:
    - "permissions-config.ts supports 'escalate-on-write' mode"
    - "escalation-store exposes createEscalation, listPendingEscalations, approveEscalation, rejectEscalation"
    - "Escalations persisted in SQLite at ~/.runneros/escalations.db (or alongside existing session storage)"
    - "Workflow with mode:subconscious running a write tool pauses execution (does NOT hard-fail)"
    - "Pause creates an escalation record and emits a notification event"
    - "approveEscalation() resumes workflow and replays the write with full permissions"
    - "rejectEscalation() resumes workflow with a tool-denied result"
    - "prompt-handler accepts mode:'subconscious' and onEscalation:'notify-and-queue' from automation DSL"
    - "UnapprovedWrite outcome shape: { recommendation: string; duration_ms: number }"
  artifacts:
    - path: "packages/shared/src/agent/escalation-store.ts"
      provides: "CRUD on escalations table"
      exports: ["createEscalation", "listPendingEscalations", "approveEscalation", "rejectEscalation", "Escalation"]
    - path: "packages/shared/src/agent/permissions-config.ts"
      provides: "Extended permission-mode enum"
      exports: ["PermissionMode", "evaluateWriteAttempt"]
  key_links:
    - from: "packages/shared/src/automations/handlers/prompt-handler.ts"
      to: "packages/shared/src/agent/escalation-store.ts"
      via: "createEscalation when write attempted under subconscious mode"
      pattern: "createEscalation"
---

<objective>
Implement OpenHuman-concept "subconscious" job mode (re-implemented from spec, NO GPL code copy). Replace binary allow/deny with a third state — `escalate-on-write` — that pauses the workflow on a write attempt, writes an escalation record, fires a notification, and waits for `approveEscalation` or `rejectEscalation` to resume.

Purpose: Lets long-running agents propose write actions without auto-executing or hard-failing. User approves later in the UI/CLI; on approve, the write replays. The OpenHuman pattern (`UnapprovedWrite` outcome) is the reference.

License: OpenHuman GPL — concept-only re-implementation. NO code copy.

Depends on plan 06 because `permission_mode: "subconscious"` is plumbed through trigger-inputs there; this plan adds the runtime semantics.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-orchestration-backbone/01-SPEC.md
@.planning/research/04-openhuman-concepts.md
@packages/shared/src/agent/permissions-config.ts
@packages/shared/src/automations/handlers/prompt-handler.ts
@.planning/phases/01-orchestration-backbone/01-06-SUMMARY.md

<interfaces>
Per SPEC §R7 + research/04 §Upgrade 5:

PermissionMode = "default" | "yolo" | "escalate-on-write" (alias of "subconscious" in user-facing DSL)

Escalation record:
```ts
interface Escalation {
  id: string;            // uuid
  workflowRunId: string; // pause anchor
  taskId?: string;
  recommendation: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  resolvedAt?: number;
  toolCall: { name: string; args: unknown }; // captured for replay
}
```

UnapprovedWrite outcome:
```ts
type WriteAttemptOutcome =
  | { kind: "executed"; result: unknown }
  | { kind: "denied"; reason: string }
  | { kind: "escalated"; escalationId: string; recommendation: string; duration_ms: number };
```

Storage: SQLite. Locate existing session-storage path (likely Drizzle or better-sqlite3) and reuse the DB file or sibling table. If no SQLite in stack yet, prefer `bun:sqlite` (built in to Bun).

Workflow-run pause: use a simple awaitable promise registered by run id. approveEscalation resolves it with {approved:true}; rejectEscalation resolves with {approved:false}. Time-bounded: pending escalations beyond N hours surface as "stale" but don't auto-resolve.

Replay-on-approve: per OpenHuman pattern, the write is re-executed with full permissions; do NOT attempt to resume mid-step. The agent step that triggered the escalation is replayed.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — escalation-store + permissions-config tests</name>
  <files>packages/shared/src/agent/__tests__/escalation-store.test.ts, packages/shared/src/agent/__tests__/subconscious-mode.test.ts</files>
  <behavior>
    escalation-store:
    - createEscalation returns id, persists row with status=pending
    - listPendingEscalations returns only pending rows, sorted by createdAt asc
    - approveEscalation(id) sets status=approved, resolvedAt, returns the row
    - rejectEscalation(id) sets status=rejected
    - approve/reject on non-pending escalation throws
    - Store is durable: instance close + reopen returns same rows

    permissions-config:
    - evaluateWriteAttempt(mode="default", ...) → "allow" or "deny" as today
    - evaluateWriteAttempt(mode="yolo", ...) → "allow" always
    - evaluateWriteAttempt(mode="escalate-on-write", ...) → "escalate"
    - mode aliases: "subconscious" === "escalate-on-write"

    subconscious-mode integration:
    - Workflow with permission_mode=subconscious attempting write → escalation row created, notification event emitted, run pauses (returns escalated outcome)
    - approveEscalation(id) → write replays with full permissions, run completes with {kind:"executed"}
    - rejectEscalation(id) → run resumes with {kind:"denied"}
  </behavior>
  <action>Create both test files. Use `bun:sqlite` in-memory or temp file for isolation. Mock the write-tool dispatch for replay assertions. Run — must fail.</action>
  <verify>
    <automated>bun test packages/shared/src/agent/__tests__/escalation-store.test.ts packages/shared/src/agent/__tests__/subconscious-mode.test.ts 2>&1 | grep -q "fail\|cannot find"</automated>
  </verify>
  <done>RED.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — escalation-store + permissions-config extension</name>
  <files>packages/shared/src/agent/escalation-store.ts, packages/shared/src/agent/permissions-config.ts</files>
  <action>
    1. Create `packages/shared/src/agent/escalation-store.ts`:
       - Use `bun:sqlite` (Database from "bun:sqlite") with file at `~/.runneros/escalations.db`. Provide a factory function `getEscalationStore(path?: string)` for test injection.
       - Schema:
         ```sql
         CREATE TABLE IF NOT EXISTS escalations (
           id TEXT PRIMARY KEY,
           workflow_run_id TEXT NOT NULL,
           task_id TEXT,
           recommendation TEXT NOT NULL,
           status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
           created_at INTEGER NOT NULL,
           resolved_at INTEGER,
           tool_call_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_status_created ON escalations(status, created_at);
         ```
       - Export the four CRUD functions and the Escalation type.
       - Use `crypto.randomUUID()` for ids.

    2. Extend `packages/shared/src/agent/permissions-config.ts`:
       - Read existing module; understand current `PermissionMode` enum/type.
       - Add `"escalate-on-write"` value.
       - Add user-facing alias: in any parser/loader, treat `"subconscious"` as `"escalate-on-write"`.
       - Export `evaluateWriteAttempt(mode, toolName, args): "allow" | "deny" | "escalate"`.

    3. Header comments:
       - escalation-store.ts: "Re-implemented from behavioral spec in research/04-openhuman-concepts.md §Upgrade 5. Concept inspired by OpenHuman (GPL-3.0); NO source code copied."
       - permissions-config.ts: same.

    4. Run unit tests — pass.
  </action>
  <verify>
    <automated>bun test packages/shared/src/agent/__tests__/escalation-store.test.ts && bun run typecheck:all</automated>
  </verify>
  <done>Store + permission extension green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Integrate subconscious mode into prompt-handler</name>
  <files>packages/shared/src/automations/handlers/prompt-handler.ts, packages/shared/src/agent/__tests__/subconscious-mode.test.ts</files>
  <behavior>
    - When a workflow runs with permission_mode=subconscious and the agent attempts a write tool, prompt-handler calls evaluateWriteAttempt → "escalate"
    - On escalate: createEscalation(...), emit "escalation:created" event via existing event bus, return WriteAttemptOutcome { kind:"escalated", escalationId, recommendation, duration_ms }
    - Run pauses by awaiting a Promise registered in a module-level map keyed by escalationId
    - approveEscalation resolves the promise; prompt-handler then calls the write tool with full permissions and returns {kind:"executed"}
    - rejectEscalation resolves the promise with denial; prompt-handler returns {kind:"denied"}
    - onEscalation:"notify-and-queue" DSL field triggers a notification event (use existing notification subsystem if present; otherwise emit an event the UI can subscribe to)
  </behavior>
  <action>
    1. Read `packages/shared/src/automations/handlers/prompt-handler.ts`. Locate the agent invocation + tool-dispatch wrapping.
    2. Build the escalation pathway:
       - On write attempt: call `evaluateWriteAttempt(mode, toolName, args)`
       - If "escalate":
         a. Generate recommendation string (use the tool call's arguments or a planner-supplied recommendation if available; otherwise format as `${toolName}(${JSON.stringify(args)})`).
         b. `createEscalation({ workflowRunId, recommendation, toolCall: { name, args } })`
         c. Emit event `escalation:created` with the escalation row
         d. `await pendingEscalations.get(id).promise` — block until resolved
         e. On approve → re-invoke the tool with full permissions; return executed result
         f. On reject → return tool-denied result
    3. Module-level pending map: `Map<string, { resolve: (approved: boolean) => void }>`. `approveEscalation` and `rejectEscalation` look up the entry, resolve, then clean up.
    4. Wire `onEscalation: "notify-and-queue"` DSL: the prompt-handler's automation config schema gets this optional field; when set, also emit a notification event (in addition to the escalation:created event).
    5. Add the integration test assertions to subconscious-mode.test.ts.
    6. Run full validation: `bun test && bun run typecheck:all && bun run lint`.
  </action>
  <verify>
    <automated>bun test packages/shared/src/agent/ packages/shared/src/automations/ && bun run typecheck:all && bun run lint</automated>
  </verify>
  <done>Subconscious mode end-to-end: write attempt → escalation → notify → user approves via approveEscalation → write replays → run completes.</done>
</task>

</tasks>

<verification>
- Escalation store CRUD + durability
- Permission mode dispatch table correct
- Pause/resume via approve/reject works
- "subconscious" DSL alias resolves correctly
</verification>

<success_criteria>
A workflow with `mode: subconscious` proposing a `git push` does NOT hard-fail. Escalation row exists with `status=pending`. After `approveEscalation(id)`, the push runs and the workflow completes successfully.
</success_criteria>

<output>
After completion, create `.planning/phases/01-orchestration-backbone/01-07-SUMMARY.md`.
</output>

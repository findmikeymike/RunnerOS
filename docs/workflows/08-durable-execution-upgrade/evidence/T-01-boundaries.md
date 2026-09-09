# T-01 — execution boundary inventory

Recorded 2026-09-09. Canonical checkout `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, verified branch `main`, HEAD `8ce9f5c11782caa3c46713df8a9b7150513c95eb`. This record maps source and proposes contracts; it does not certify production recovery or close R-04.

## Proven current behavior

| Boundary | Current source and owner | Durable limitation / required v2 seam |
| --- | --- | --- |
| Workflow admission / recovery | `packages/server-core/src/workflows/runner.ts:433` `recoverInterruptedRuns`, `:456` `rerunFromStep`; host construction `sessions/SessionManager.ts:6499` | Startup marks running snapshots interrupted. Explicit rerun creates another run and copies earlier successful steps; no per-operation resume. |
| Agent step launch | `runner.ts:870` `executeStepAttempt`; creates session, records session ID, then awaits `sendMessageWithOptionalTimeout` | Receipt/snapshot precedes model work, but no committed model-turn continuation. Each step retry can create a fresh session. |
| Complete model response | `packages/pi-agent-server/src/index.ts:1100` `handleSessionEvent` receives assistant `message_end`; `:1292` subscribes via `AgentSession.subscribe` | Existing callback forwards events; does not await a journal acknowledgement. Full response must commit before any resulting operation can execute. |
| Tool preparation | `pi-agent-server/src/index.ts:715` `wrapSingleTool`, `:803` `buildProxyTools`; `packages/shared/src/agent/pi-agent.ts:1144` `handlePreToolUseRequest` | Existing permission checks and argument transforms are useful. Journal identity/approval digest must bind final executable normalized arguments and current target account. |
| Local tool dispatch | `wrapSingleTool` calls `originalExecute` after approval; large-response processing may call `runMiniCompletion` afterward | This path executes in the Pi subprocess, bypassing the parent proxy dispatcher. Must have its own awaited dispatch/result journal handshake or be denied for v2. |
| Proxy dispatch | `PiAgent.handleToolExecuteRequest` at `pi-agent.ts:1358`, `routeToolCall` at `:1404` | Parent routes session tools / MCP pool and sends response directly. Add durable operation identity to IPC, dispatch claim before call, validated committed result before response. Current random request ID is only process-local correlation. |
| Tool result / next turn | `pi-agent-server` SDK executes tool, emits `tool_execution_end`, emits tool result message, then `turn_end`; loop may start next model call | All results and next continuation must commit before releasing next-turn gate. UI `tool_result` is insufficient evidence. `SessionManager.ts:15335` calls `persistSession`; `:6759` queues debounced persistence and catches queue errors. |
| Approval wait | `packages/shared/src/agent/subconscious-mode.ts:233` awaits Promise held in `pending`; `escalation-store.ts` persists decision rows | A row survives; the waiting closure does not. Persist exact operation/wait and consume a matching decision transactionally with dispatch claim, bridging escalation DB explicitly. |
| Child admission / join | `packages/server-core/src/agent-messaging/AgentMessageService.ts:143` `messageAgent`, receipt persistence `:220`, create child `:288`, send `:350`; `SessionManager.ts:10253` constructs service | Existing receipts and permission/depth constraints are not atomic child admission. Persist stable child slot, edge, constraints and launch operation first; joins consume committed validated child result once. |
| Detached child | `SessionManager.ts:8998` `onSpawnSession`; `:9079` fire-and-forget send | Must explicitly journal detached lifecycle and cancellation policy. Returning session ID is launch evidence, not completion. |
| Scheduled admission | `scheduled-work/ScheduledWorkRunner.ts` `scanWorkspace`, `claimRunning`, `startWorkflow` at `:815`, `persistRunningWorkflowRunId` at `:968` | Workflow start and order-to-run association are separate writes. Future occurrence-to-run admission must be unique and transactional; retain existing fences, catch-up window and attention handling. |
| Step output completion | `runner.ts:979` gets assistant text, `validateCompletion` checks required output assets and tool evidence, then stores parsed step output; `run-storage.ts:213` `writeRun` uses temp+rename | Preserve completion validation. File rename and UI receipt are not a journal transaction; add verified artifact references plus repairable projection/outbox delivery. |
| Cancellation | `runner.ts` `cancel` persists cancellation then aborts current session; `PiAgent.forceAbort` rejects pending IPC work | v2 must fence successors before signalling cancellation. Abort cannot prove that an external effect did not happen. |

All paths above were inspected at current HEAD plus existing unrelated SessionManager change (`isWorkspaceRootRetired`). Relevant SessionManager diff SHA-256 at inspection: `d5059686418869e5c44097b3e850315d2d94db48ef25ad72dc7e506e7a8f1873`. Other agents' campaign-cleanup, RPC and renderer changes were left intact. No production file was edited by this mapping task.

## Selected route: Pi core awaited events, initially synthetic

The pinned dependency is `@earendil-works/pi-agent-core` **0.84.3**, alongside `pi-coding-agent` / `pi-ai` 0.84.3 in `packages/pi-agent-server/package.json`.

Installed SDK source establishes a viable lower-level seam:

- `node_modules/@earendil-works/pi-agent-core/dist/agent.js:417`: `processEvents` awaits every `Agent.subscribe` listener in registration order.
- `.../pi-agent-core/dist/agent-loop.js:240`: complete assistant `message_end` is awaited before returning the response. The loop at `:106` then calls `executeToolCalls`; `:131` awaits `turn_end` before advancing.
- `.../pi-coding-agent/dist/core/agent-session.js:296`: `AgentSession._emit` invokes listener callbacks without awaiting their results. Merely making existing `handleSessionEvent` async would not establish a barrier.

Proposed production integration therefore subscribes to `piSession.agent` with an awaited callback, commits complete assistant response + ordered call slots + continuation, and waits for an acknowledged result commit before the next turn. Subscription order alone is insufficient: the existing AgentSession observer can fire side effects first. Disable or journal all speculative dispatch.

**Concrete bypass:** `pi-agent-server/src/index.ts:1125` prefetches two or more `call_llm` requests from `message_end`, ahead of ordinary proxy execution/approval wrappers. The prefetch cache then returns them from `buildProxyTools`. This must be disabled for v2 until it uses the same admission, budget and result protocol.

Other explicitly unsupported initial paths: Claude/Codex backends; unrestricted shell/browser/native coding tools; arbitrary MCP tools without certified adapters; `call_llm` ephemeral sessions and large-response mini-model calls; source activation abort/retry (`pi-agent.ts:2008`); dynamic capability expansion (`SessionManager.ts:10204` onward); existing nested spawned/delegated sessions without durable child admission. Registry eligibility must be checked at every dispatch, including newly enabled tools and children. An active v2 run cannot fall back to the legacy engine.

SDK retries also require an owner: `AgentSession` auto-retry logic in `agent-session.js` around `:2238`, `handlePrompt` compact-and-retry at `pi-agent-server/src/index.ts:1307`, and `handleQueryLlm` model fallback around `:1033`. Disable/mediate these for a supported route or expose all attempts to persisted budget/retry policy. A synthetic fake provider proves none of these integrations.

**R-04 status:** source boundary located; production IPC acknowledgement, restore semantics, exact replay context and production-route crash tests remain required. P-01 evidence must distinguish a disposable serialized-state proof from instrumenting Artist OS itself.

## Proposed serialized contracts (not exported production APIs)

```ts
type EffectPolicy = 'pure' | 'read' | 'transactional-local'
  | 'idempotent-external' | 'reconcilable-external' | 'nonreplayable-external';
interface DurableAdapter<Input, Result> {
  manifest: {
    adapterId: string; version: string; inputSchema: string; resultSchema: string;
    effectPolicy: EffectPolicy; supportedRoutes: string[]; certificationEvidence: string[];
    capabilityDigest: string; accountScope: string;
    providerContract?: { idempotencyTtlMs?: number; reconciliationDeadlineMs: number };
  };
  normalize(raw: unknown): Input; // deterministic; reject invalid input
  validateResult(raw: unknown): Result;
  authorize(input: Input, current: AuthorizationContext): Promise<AuthorizationDecision>;
  execute(input: Input, context: DispatchContext): Promise<Result>;
  reconcile(input: Input, context: ReconcileContext): Promise<
    { state: 'succeeded'; result: Result } | { state: 'definitely-not-executed' }
    | { state: 'unknown'; reason: string }
  >;
}
interface ContinuationV1 {
  schemaVersion: 1; runtimeVersion: string; adapterManifestDigest: string;
  runId: string; stepInstanceId: string; childSlot?: string;
  turnOrdinal: number; revision: number; phase: 'model' | 'tools' | 'join' | 'done';
  modelRoute: { provider: string; model: string; version: string };
  modelContextRef: string; committedAssistantRef?: string;
  orderedCalls: Array<{ callSlot: number; sdkCallId: string; operationId: string;
    adapterId: string; adapterVersion: string; normalizedInputRef: string; inputDigest: string }>;
  committedResults: Array<{ operationId: string; resultRef: string; resultDigest: string }>;
  wait?: { kind: 'approval' | 'child' | 'timer' | 'provider'; entityId: string };
  authorizationRevision: number; cancellationRevision: number; rootBudgetId: string;
}
```

The supporting context types are conceptual obligations, not implemented interfaces: authorization carries workspace, principal, current account/policy and inherited ceiling; dispatch carries stable operation ID, idempotency key, persisted attempt, owner epoch, bounded reservation and abort signal; reconciliation carries the original identity and observed provider receipt. Coordinator owns identity allocation and checks manifests; an adapter may not invent a new identity on retry.

Allocate identity from durable `(run, step instance, child slot, turn ordinal, call slot, operation version)` uniqueness, not argument hashes or completion order. Identical calls in distinct slots remain distinct. Store immutable original request and normalized payload references; approval and digest bind executable payload. Transaction completion commits result, budget observation, continuation revision and outbox event together. Unknown paid outcomes retain reservations. No hard spending claim without an enforceable maximum.

References must resolve to validated persisted artifacts; a missing context/result fails closed. No credentials in records. Protected transcript/tool-result retention and deletion semantics are required before production persistence. These fields do not prescribe a prompt-format rewrite.

## Disposable fixture / fault protocol

A controller creates temporary app and provider ledgers. An app worker and fake provider run in separate processes; provider owns durable operation/effect records independently of app restarts. There are no credentials or real network accounts.

Fixture: one synthetic model turn emits an exact approval-requiring fake effect and a required child slot; child performs two stable read operations. Provider can accept the effect, persist receipt, then drop the response. On restart app uses original IDs, consumes approval once, reuses committed reads/results, and reconciles possible effects before dispatch. Parent cannot finish before committed child result. Required crash hooks: before/after model commit, approval commit, dispatch-intent commit, provider acceptance, result commit, child admission, child completion, parent join and successor admission. Worker checkpoints must be outside transactions except dedicated rollback tests; the controller kills a process, not an in-memory Promise.

The parent implementation owns `packages/server-core/src/workflows/__tests__/durability/` and T-02/T-03 evidence. This task owns only this file. The implemented fixture may intentionally cover fewer hooks; only observed tests can close individual proof cases. Production R-04 remains open unless real route barriers and restoration are exercised.

SQLite candidate already exists: `packages/shared/src/agent/escalation-store.ts:43` resolves Bun `Database` or Node `DatabaseSync` dynamically. No new database package is necessary for the initial proof. Bun tests alone do not certify packaged Electron binding, sidecar packaging, WAL permissions, offline startup, power-loss or restore behavior; a later authorized packaged-runtime gate is required.

Python DBOS remains separate: `tools/squad/vendor/squad/scripts/run_creative_production_durable.py:155` dynamically imports DBOS after `require_dbos_ready`; `creative/production/durable_runner.py:95` checks package/environment readiness. Those optional production-script call sites are not the TypeScript WorkflowRunner. No DBOS service or dependencies were installed for T-01.

## Fresh baseline verification

Executed from canonical checkout on 2026-09-09:

```sh
PANGOCAIRO_BACKEND=fontconfig bun test \
  --path-ignore-patterns='**/release-artist-os/**' \
  --path-ignore-patterns='**/dist/**' \
  packages/server-core/src/workflows/runner.test.ts \
  packages/shared/src/workflows/storage.test.ts \
  packages/shared/src/automations/scheduler-catch-up.test.ts \
  packages/shared/src/automations/scheduler-state.test.ts \
  packages/shared/src/automations/automation-system.test.ts \
  packages/server-core/src/scheduled-work/ScheduledWorkRunner.test.ts
```

Fresh result: **248 passed, 0 failed, 869 expect calls, 6 files, 5.27 seconds**. Raw local log: `/tmp/artist-os-t01-baseline.log`. The count happens to equal the prior baseline; this was a new execution. These tests verify existing behavior only. No app launch/restart, network provider call, broad suite, packaged runtime or production durability certification occurred in this task.

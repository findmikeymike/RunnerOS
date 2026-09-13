# Proposed integration contracts

Everything named “proposed” below is new; source-map entries describe existing interfaces. Freeze any changed decisions in r2 before implementation consumers diverge.

## C1 — Ownership and trust boundaries

Renderer owns call UI and local playback observations. Voice focus main service owns conversational model/history and validates Electron owner association. A proposed server-core VoiceTaskBridge owns task admission, lookup, reconciliation and reply/cancel correlation. SessionManager and AgentMessageService own actual specialist sessions, effective permissions and execution. Voice Core owns audio and visemes. The bridge cannot bypass any existing tool approval.

Each voice session binds to one authenticated/authorized workspace and host-created manager parent session. User-controlled text cannot select an arbitrary parent/child session or file path. Child IDs, workspace roots and specialist configuration are resolved in the host. Only one active speaking attachment per workspace may hold a host-issued delivery lease. A second window can view task state but cannot announce it until it explicitly acquires the lease; lease transfer invalidates the old generation and cancels its queued speech. Every RPC revalidates current workspace access and task ownership; hiding a child session is not authorization. A workspace switch invalidates the subscription generation. Execution may continue in its original workspace but never speaks into the new one.

## C2 — Identities and durable records

Proposed v1 VoiceTaskRecord (bridge metadata, not a replacement execution engine):

```ts
type VoiceTaskRecord = {
  schemaVersion: 1
  taskId: string                 // host UUID, stable across follow-ups
  workspaceId: string
  managerParentSessionId: string // real SessionManager session
  origin: { voiceSessionId: string; callId: string; turnId: string }
  admissionKey: string           // host bound to turn + tool invocation
  requestDigest: string          // canonical validated scope, excludes credentials
  targetAgentSlug: string
  title: string
  contextRefs: { kind: 'hq'|'campaign'|'release-kit'|'essentials'; id: string; revision?: string }[]
  attempts: { attemptId: string; receiptId?: string; childSessionId?: string;
              relation: 'initial'|'revision'|'retry'; parentAttemptId?: string }[]
  activeAttemptId: string
  state: 'admitting'|'running'|'waiting_for_user'|'waiting_for_approval'|
         'cancelling'|'succeeded'|'failed'|'cancelled'|'timed_out'|'interrupted'
  revision: number
  pendingInteraction?: { id: string; kind: 'question'|'approval';
                        childSessionId: string; attemptId: string; expiresAt?: string }
  createdAt: string
  updatedAt: string
}
```

Use existing workspace storage conventions. Proposed location: `<workspaceRoot>/voice-tasks/<taskId>.json`; use atomic replacement under a host per-task/admission-key mutex. Admission index, attempts and notification delivery metadata must be crash-reconcilable, not several uncoordinated writes treated as a transaction. T-101 must select a deterministic reservation/receipt correlation extension: persist the admission key in the execution receipt before launch, so recovery can locate an existing child after a crash between launch and bridge update. An in-memory Set is insufficient. This narrow backward-compatible receipt extension is preferred over a new database.

Guarantee one admitted job per key under concurrent retries within the owning host. There is no exactly-once execution promise after arbitrary crashes. A reserved key with uncertain execution is quarantined as interrupted; do not spawn again until the previous attempt is reconciled. Before launch, the host persists an intent reservation and returns a stable intentId. The renderer uses that ID for launch; a lost reservation reply is recovered by the same persisted clientRequestId scoped to the durable manager parent. Intent lookup survives call/binding changes and returns pending/admitted/unknown status. New call IDs are attachment metadata, never a reason to mint a new intent for a retry. Snapshot exposes unresolved intents so reconnect can reconcile before offering Retry. The clientRequestId is not authorization; host verifies workspace, parent and digest on every lookup. A repeated key with different digest returns conflict. A revision gets a new attempt/key linked to the same task. Initial records have no receipt yet; never interpret admitting as running.

Bridge records inherit workspace deletion. Do not store raw audio or duplicate full worker transcripts. Keep task records while their worker receipts are retained; terminal notification replay history is capped at 7 days, then delivery cursors may be compacted while task/results remain. Deleted receipt/artifact becomes unavailable, not successful content. On first enablement only explicitly linked tasks are included; do not import every historical receipt. Unknown schema versions are read-only/unsupported and fall back safely; migration must not mutate unrelated receipt files.

## C3 — Proposed host API

Expose a narrow preload/RPC surface matching existing routing conventions. No new localhost listener.

| Operation | Input | Result / enforcement |
|---|---|---|
| bind | voiceSessionId, callId | Server resolves workspace + owner, creates/reuses authorized durable manager parent, returns capabilities and attachment generation. Warmup may bind; must not launch jobs. |
| reserveIntent / lookupIntent | authorized binding, stable clientRequestId, validated request digest and scope / intentId | Persist or recover intentId against durable parent; reply loss and a new call do not create new work. |
| launch | call binding, intentId, turnId, invocationId, target slug, task, context refs, expected output | Validated request; admission key generated/bound by host. Returns `{taskId, attemptId, receiptId, state, revision}` only after durable correlation. Missing configuration yields structured failure. |
| snapshot | binding, task cursor | Authorized task states, pending interactions, available artifact refs and stream cursor; bounded paging. |
| subscribe | binding, cursor | Ordered bridge events plus replay/gap signal. Unsubscribe on detach. |
| reply | taskId, attemptId, questionId, expectedRevision, replyId, text | Exact pending question and authorized owner; idempotent reply receipt. Never treat answer as permission grant. |
| revise | taskId, expectedRevision, requestId, instruction | Explicit user instruction linked to existing output. If busy, support existing steering only where proven; otherwise queue visibly until a safe boundary. |
| cancel | taskId, attemptId, requestId | Returns cancelling/terminal; invokes existing cancellation and reconciles actual terminal outcome. |
| open | taskId, artifactRef | Resolves validated output or visible Command/session destination; no renderer-supplied raw path. |
| claimDelivery | binding, eventId, taskId, attemptId | Host returns deliveryId and exclusive workspace lease generation/expiry; rejects competing speaking attachment. |
| acknowledgeDelivery | deliveryId, lease generation, outcome: delivered/interrupted/failed, correlated playback end | Owner-bound, idempotent durable acknowledgement; stale leases cannot consume pending events. Duplicate same outcome is harmless, conflicting outcome is rejected. |
| detach | binding, generation | Removes call delivery lease, retains admitted work and task records. |

Error codes: invalid_request, forbidden, stale_binding, stale_revision, duplicate_conflict, unavailable_specialist, capacity, persistence_failed, unknown_outcome, unsupported_capability, not_found, interaction_expired. Safe error message + retriable boolean + taskId when known; do not expose secrets or raw internal stack traces. Only transport-level reads/replays auto-retry. Mutations retry with the same key, never on a fresh generated key after timeout.

Proposed limits: 2 active voice-origin tasks per workspace, 1 active attempt per task, no hidden waiting admission queue. At capacity, ask which to finish/cancel or offer Command. Enforce limits across windows in the host; worker nested delegation remains subject to existing depth and permission limits. Validate inputs against existing task/context/output bounds, not larger model-provided strings. Default worker attempt timeout remains existing 300s, max 1800s only within existing policy; waiting time is visible and timeout cannot silently become success. No new unlimited token/tool budget.

## C4 — Execution and interaction lifecycle

Use AgentMessageService.messageAgent with background:true and a real manager parent context. It currently runs a single delegated message turn. Bridge must not pretend an arbitrary follow-up extends the original resolved Promise. T-101 freezes a host-owned interaction protocol: an ordinary worker question marks the attempt waiting; answering dispatches a correlated continuation in the exact child through SessionManager and tracks a new completion boundary. Keep attempts/receipts truthful when the initial message ended. Preserve output from each completed revision.

Host derives waiting_for_approval from the child's actual pending permission request. On restart these in-memory permission requests are expired; require the worker to reissue, never replay an old approval. V1 voice-origin work uses a restrictive effective permission mode: intersect parent/specialist permissions with the voice task grant. Draft/read scope cannot expand through standing allow-all policy. Sensitive actions require a current task/action-scoped UI approval unless an existing explicit grant is demonstrably bound to that exact action and scope; a broad standing permission is insufficient. Enforce this in the actual worker permission decision path, not only in the voice prompt or by observing prompts that might never occur. If the host cannot enforce the cap, reject voice dispatch for that action and use the existing Command path. Voice may surface the existing approval UI; respondToPermission remains the authority and must use the specific session/request with no implicit alwaysAllow upgrade. Credential/auth prompts stay in their existing secure UI.

| From | Trigger | To / rule |
|---|---|---|
| admitting | durable receipt + child admitted | running |
| admitting | failure before execution known | failed; unknown launch outcome instead becomes interrupted |
| running | correlated question / permission request | waiting_for_user / waiting_for_approval |
| waiting_* | valid answer/approval and resumed execution | running; stale/denied request remains truthful or fails per worker outcome |
| running/waiting_* | explicit targeted cancel | cancelling |
| cancelling | executor confirms aborted and receipt settled | cancelled |
| cancelling | output committed before abort | succeeded with “finished before cancellation”; do not erase output |
| any nonterminal | process lost, child state cannot prove active execution | interrupted |
| running | validated successful terminal attempt with no pending question | succeeded |
| running/waiting_* | actual failure/timeout | failed/timed_out |
| terminal | explicit revision or reviewed retry | new active attempt; old attempt remains terminal |

Late callbacks carry attemptId and generation. They can update their historical attempt but cannot overwrite a newer attempt or turn cancelled into succeeded by resolving sendMessage. Current receipt cancellation classification needs explicit tests/repair. Call state (preparing/ready/listening/thinking/speaking/ended/error) remains separate; multiple task states do not drive the avatar mouth.

## C5 — Event stream and reconciliation

Proposed event envelope:

```ts
type VoiceTaskEvent = {
  version: 1; eventId: string; workspaceId: string; taskId: string
  attemptId: string; revision: number; streamSequence: number; occurredAt: string
  kind: 'admitted'|'progress'|'question'|'approval'|'completed'|'failed'|
        'cancel_requested'|'cancelled'|'interrupted'|'artifact_available'
  payload: unknown // discriminated validated schema, bounded safe summaries
}
```

Host serializes revisions; consumers discard duplicate eventId and obsolete task revisions. Subscribe must avoid the snapshot/subscription gap: capture snapshot+cursor then replay later events, or subscribe-buffer before snapshot. Bounded replay exhaustion returns resync_required and a new snapshot, not fabricated missing transitions. A terminal record is authoritative when low-priority progress has been dropped. Do not infer execution status from prose notifications alone.

Persist pending important notifications and delivery attempts; a live queue is a projection. On reconnect reconstruct unresolved approvals/questions and terminal outcomes from task records. Events from previous call generations are not permitted to speak automatically. On a new Call, summarize still-relevant pending results once; do not read a backlog of progress.

## C6 — Conversational delivery and audio arbitration

One foreground speech owner at a time. A proposed scheduler combines: active user capture/VAD state, pending user turn, assistant response generation, TTS queued audio and actual playback drain. Silence/RMS=0 alone is not idle; words contain pauses. agentSpeechComplete is a candidate signal, not sufficient proof until its consumed-audio semantics are verified in T-102.

Queue priority: pending user answer/turn first; then approval or worker question; then failure/completion; progress last. Questions never interrupt the user. Coalesce progress per task, max 1 spoken progress update per 30 seconds globally; suppress uninformative updates. Bound in-memory queue to 20 entries. On overflow discard/coalesce progress, retain important state durably and surface a grouped task indicator; never discard an approval obligation. Proposed quiet window: 700ms after verified foreground idle, cancelled immediately by new user speech. Tune only from measured trials.

When a result arrives during an ordinary response, finish that response, then reevaluate relevance. Let a relevant result inform the next user-requested turn instead of forcing a separate announcement. Announcements target 1–2 short sentences, at most 40 words. No model run per progress event. Worker text is untrusted data, not system instructions; structured summaries are sanitized and bound to observed receipt/artifact state before conversational rendering. Summarization failure uses a factual template with no invented details.

SDK requirement: a first-class assistant/system-event turn with explicit origin, turn ID and cancellation generation that uses existing LLM/TTS/PCM/viseme facilities without recording a fake user message. Current completeUserTranscript aborts the response pipeline; pushAssistantText alone is not proof of complete TTS lifecycle integration. Add the minimum upstream web-wrapper capability after T-102 demonstrates the path; update the vendored snapshot manifest and source patch through existing provenance tooling. Keep old callers compatible and capability-gate missing support.

Delivery states: queued → generating → playing → delivered, or interrupted/failed/deferred. A notification is delivered only after its correlated audible playback completes. Barge-in interrupts that delivery attempt, immediately cancels its generation/audio and clears visemes. Keep only the actually heard portion as conversational context when supported; otherwise mark the announcement interrupted, preserve the result as unseen and do not claim the user heard it. Retry at a later quiet turn at most once per call; then leave it visibly pending. Delivery lease has a 15-second renewable expiry while active; heartbeat stops on detach. On expiry, cancellation or owner loss, unfinished delivery returns pending; a new attachment must reconcile before replay. The trusted renderer reports actual playback completion through acknowledgeDelivery; host checks current lease, event/attempt correlation and outcome transition. Persist deliveryId, generation, started/completed timestamps and outcome. A stale acknowledgement is diagnostic only and cannot mark a newer delivery heard. Process crash between playback and persisted acknowledgement may cause a repeat: do not claim exactly-once audible delivery.

Separate factual task context from spoken transcript. A completion can be known before it is heard, but history must not pretend it was spoken. Explicitly focused task/result and currently presented question provide reference resolution for “that”; confidence/ambiguity must be resolved before mutations. Expire spoken question focus on task change, new presented question, explicit dismissal or 2 minutes; underlying worker wait can persist longer.

## C7 — UX, observability and compatibility

Task chip shows count plus meaningful state; details drawer lists task title, specialist, status, pending question, output link and targeted Cancel. Approval uses existing components. Keyboard focus returns to invoking control; use polite live regions for status, never announce every progress event. Reduced motion disables decorative transitions while essential mouth sync and accessible status remain available under current settings. Closed/failed avatar rendering never blocks voice/task controls.

Telemetry: call/turn/task/attempt/event IDs, enqueue time, idle eligibility time, generation start, first consumed audio, playback end, dispatch receipt latency, cancel request/confirmation, resync and errors. Exclude raw audio, credentials, full prompts and sensitive artifacts. Reuse existing diagnostic opt-in and retention; do not enable verbose logging globally.

Proposed acceptance targets (not measurements): bridge dispatch overhead p95 ≤100ms excluding provider/worker startup; no more than 100ms p95 regression in normal end-of-user-speech → first-audible-response compared with same-device baseline; completion announcement first audio within 2s p95 of becoming eligible with warmed providers; barge-in audible/viseme cessation no worse than baseline +50ms. Record at least 30 paired conversational turns and 10 result deliveries, hardware/provider/model/build identity and raw timing samples. Small samples are a pilot, not a statistical SLA.

Feature capability defaults off. Disabling stops new admissions and spoken subscriptions, not existing admitted tasks; those stay accessible via task/session UI. Unsupported provider structured-output/tool capability gets conversation plus explicit Command handoff, never prose-parsed execution. No provider switch just to make a demo pass. Repeated open/close test: 20 cycles with one persistent task, no duplicate listener, stale audio, leaked graphics loop or accumulating task subscription; compare diagnostic counts and memory after settling. Packaging must include no new voice model or runtime dependency for the bridge.

## P1 host contract refinement — r2, 2026-09-12

T-101 freezes these extension seams; no production implementation is claimed.

- Resolve manager options through `SessionManager.resolveAgentSessionOptions(workspaceId, 'concierge', {referenceMode:'strict'})`, then `createSession(workspaceId, options): Promise<Session>` and `flushSession(id)`. Persist the manager binding under the workspace; verify manager identity/workspace before reuse. Never use a focus ID as a parent. Renderer RPC access must validate current authorized workspace AND task/parent/child association; existing target-session team permission alone is insufficient.
- Extract existing `messageAgentFn` service construction (SessionManager:10230) into a shared host dispatch factory. Preserve active specialist, strict context, source/skill, depth and permission intersections.
- Add optional host-only `voiceTask:{taskId,attemptId,intentId,admissionKey,requestDigest}` to AgentMessageReceipt and child launch metadata. Persist in receipt before child creation, and child at creation. Recovery searches both to close the child-created/receipt-not-updated gap. Old receipts remain readable and untouched. No migration imports historical jobs. Disabling the bridge preserves these optional fields and pending records.
- Reserve and lookup by durable manager parent plus stable clientRequestId; compare canonical digest. Serialize workspace admissions, capacity and task mutations. Quarantine admitting/running/continuation uncertainty on lost host; identity recovery never proves execution resumed.
- Extend SessionManager with generation-correlated terminal outcomes from `onProcessingStopped`; `sendMessage(...):Promise<void>` currently catches backend failures/aborts and resolves. AgentMessageService must consume explicit committed/error/interrupted outcome instead of assuming resolved means succeeded. `cancelProcessing(id,silent):Promise<void>` requests termination only.
- Add immutable voice task grant to actual worker pre-tool checks BEFORE trusted tools, safe/ask mode and remembered-command shortcuts. Propagate through nested delegation and all supported backends; unsupported/unmediated operations reject dispatch. Host-classified bounded local draft/read can run; sensitive actions require exact task/attempt/action/scope UI grant. Never upgrade alwaysAllow. `respondToPermission` must validate exact pending request/session before mutation.
- Structured worker question envelope carries task/attempt/execution/question IDs; passive prose is not a question protocol. Answer admission persists replyId and answer digest before dispatch to the same child using inputOrigin agent; changed payload conflicts. A continuation has a new execution generation and completion boundary. User cancel targets stable attempt identity, then aborts current execution; late questions cannot reopen cancelling. Callback generation and user command identity are distinct.

Production implementation must add durable continuation receipts and correlated text delivery; P1's fake executor proves ordering, not those integrations. See evidence/T-101.md. r2 refines C1–C5; C6 remains pending T-102.

## P1 SDK contract refinement — r2, 2026-09-12

Proposed authoritative wrapper API: `externalAssistantTurn({origin:'worker-result',turnId,text}): {status:'deferred'|'unsupported'} | {status:'accepted',delivery:{turnId,generation,done:Promise<'delivered'|'interrupted'|'failed'>,cancel()}}`. App scheduler supplies host deliveryId/lease and acknowledges only matching completed handle. Keep capability absent/off until production port is accepted.

A turn claims generation synchronously only after foreground idle; idle includes no user speech, pending generation, playback, drain or flush. The app waits700ms and resets immediately on user activity. Wrapper rejects busy without aborting normal speech. Start partial assistant text through existing runtime worker, synthesize via existing chunker/PCM/viseme queues, then flush. Detect empty accepted audio and fail without wedging ownership.

Only the exact AudioGraph pending flush acknowledgement after consumed output can finalize this event. Bind to response generation and playback epoch; stale IDs/generations do not deliver. `agentSpeechComplete` alone is uncorrelated and insufficient. Commit final assistant text/history AFTER that acknowledgement, then resolve delivered. Barge-in/stop/detach/failure clears PCM/visemes and leaves event history uncommitted; current WASM cannot truncate partial assistant history, so mark interrupted/unseen. No fake user transcript, opener or second TTS path. Actual matching WASM supports this sequence unchanged.

Production port must include timeout/observer/reentrancy handling and durable delivery leases. P1 prototype establishes the core sequence, not release readiness. Authoritative files: upstream voice-core-rs/wrappers/web/src/VoiceCoreWeb.ts and relevant types/contract tests; compile to vendor, record cumulative source patch and hashes with existing snapshot checker. Preserve matched WASM; do not copy arbitrary upstream HEAD.

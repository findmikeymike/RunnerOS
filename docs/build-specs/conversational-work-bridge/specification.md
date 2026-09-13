# Product specification

## Authority and baseline

This r1 proposal answers the user's request for a detailed integration spec following the Bodhi/Cicero/Logica comparison. [sources.json](sources.json) records inspected source hashes and scope. User intent governs the requested outcome; repository code establishes existing behavior, not permission to change it. External projects are design references, not dependencies or proven performance benchmarks.

The current focused voice prompt explicitly forbids execution and confirms only an unsent Command draft. This proposal changes that product boundary only when the bridge capability is enabled and host admission succeeds. Disabled, unsupported or failed admission must retain honest conversation and the existing explicit Command handoff.

## Product experience

Mikey remains calm, candid and brief. He does not narrate every tool call. The avatar stays central in the FaceTime-style modal. Captions remain hidden by default. Add one small task indicator with an optional details drawer, not a full project manager inside the call.

### J1 — Start work and keep talking

1. User presses Call; existing warmup, microphone boundary and varied profile-aware opener are preserved.
2. User asks, “Have the scriptwriter draft a teaser for this release.” Mikey resolves the active specialist and agreed scope. If “this release” is ambiguous, he asks before dispatch.
3. Host admits the task, creates the durable bridge identity and specialist receipt. Only then may Mikey say “They're working on that.” If still reserving, he may say “Let me start that,” without claiming execution.
4. The call stays open and accepts unrelated speech while the worker runs. Voice model settings do not overwrite the specialist's settings.
5. Verified completion creates a task card and a short queued announcement. Mikey waits for a safe conversational gap: “Your teaser draft is ready. Want me to pull it up?”
6. Opening the result uses the actual artifact/session destination. User chooses whether to keep talking or leave the modal. A failed or missing artifact is not described as a saved draft.

### J2 — Clarify and revise

A worker asks which track to use. The task becomes waiting_for_user and its question appears in the drawer. At a quiet moment Mikey identifies the task and asks the question. A reply is sent only when it unambiguously answers that question. If two workers ask questions, “yes” resolves neither without focus. Unrelated conversation remains ordinary conversation. “Make that draft shorter” uses the last explicitly referenced task/result and creates a correlated follow-up attempt; the previous output remains available.

### J3 — Permission-sensitive work

Starting a draft is not authorization to publish it. Existing worker approval policy remains authoritative. Mikey can explain a pending approval; the existing approval surface shows exact action/scope. V1 requires a current task/action-scoped approval there for external effects, credentials, persistent permissions, spend or destructive work. Existing broad allow-all settings do not waive this voice-origin restriction; an existing grant can be honored only if it is explicitly bound to this exact action and scope. The host enforces the stricter cap or refuses dispatch. A generic spoken “yes” never grants those permissions. Ordinary creative clarification can use voice.

### J4 — Interrupt, close and recover

Speaking over Mikey stops his speech and mouth movement; the background task continues. “Cancel the teaser task” targets that task; an ambiguous “stop” immediately silences speech but asks which task, if any, should be cancelled. Hanging up detaches voice and leaves admitted work running while the app's execution host remains alive. A small visible note says work continues in Tasks. On app restart, lost execution is shown as interrupted/needs review, not silently relaunched. On the next user-started call, offer one concise pending-results recap; never start the microphone automatically.

### J5 — Failure and overload

Unavailable specialist, permission denial, provider timeout, full queue, or failed receipt persistence yields a specific short error and a retry/details action. An admission timeout is an unknown outcome until reconciled by idempotency key; retry must not create another job. Progress noise is coalesced. A completed task can be visible immediately while its spoken announcement waits. Call failure does not imply task failure.

## Requirements and observable acceptance

All items below are proposed v1 in-scope requirements unless explicitly deferred. Each R-ID maps to tasks and verification in plan.json. P0 blocks release; P1 is required polish before broad enablement.

| ID | Priority | Obligation / acceptance |
|---|---|---|
| R-01 | P0 | Preserve prewarm without microphone, Call-only capture, user-first opener suppression, independent voice settings, context distinctions and existing explicit Command handoff; regression fixtures and live smoke prove each. |
| R-02 | P0 | Admit work through existing active specialists and permission policy; identical launch retries return one identity/child, with no “started” claim before receipt-backed admission. |
| R-03 | P0 | Keep live conversation available during work; a real unrelated spoken exchange succeeds before the real worker completes. |
| R-04 | P0 | Announcements use the existing TTS/audio/phoneme path, never overlap user speech or another assistant turn, and stop on interruption; no second audio pipeline. |
| R-05 | P0 | Expose truthful receipt-backed status and validated output links; duplicate/out-of-order events cannot regress terminal state or announce success twice. |
| R-06 | P0 | Route clarification and follow-up to exact task/child/question/attempt; unrelated speech, stale questions and ambiguous references cannot steer the wrong worker. |
| R-07 | P0 | Preserve existing approvals and effective permissions; cross-workspace, forged child IDs and generic spoken assent cannot execute sensitive actions. |
| R-08 | P0 | Separate speech cancellation, task cancellation and hangup; acknowledge cancelled only on confirmed termination, reject late completions from superseded attempts. |
| R-09 | P0 | Persist bridge identities and reconcile reconnect/restart without duplicate execution; classify abandoned work as interrupted and require explicit reviewed retry. |
| R-10 | P1 | Keep avatar-first UI, default-hidden captions and reduced-motion behavior; keyboard-accessible task details, status, error and approval affordances work. |
| R-11 | P0 | Bound concurrent work, queued notifications, prompt context and retries; overflow is visible, never silent task loss or automatic spend escalation. |
| R-12 | P0 | Isolate owner/window/workspace and clean subscriptions/timers across repeated calls; closed calls cannot speak and old events cannot enter a new workspace. |
| R-13 | P0 | Record timing and outcome evidence without raw audio/secrets; meet proposed performance budgets or return to review with measured tradeoffs. |
| R-14 | P0 | Ship disabled by default until acceptance; capability/version negotiation, clean install build, rollback and real call smoke must pass before enablement. |

## Architectural decisions

| ID | Decision | Rationale / status |
|---|---|---|
| D-01 | Native Artist OS adapter over AgentMessageService; no new Bodhi/Cicero/Logica runtime dependency | Proposed. Existing specialists, context and permissions are the valuable integration surface. |
| D-02 | Voice focus session plus separate durable manager parent session | Proposed. Focus session is ephemeral and not a normal SessionManager session; the host must create/link a real parent, never pass the focus ID as a parent by coincidence. T-101 freezes exact ownership. |
| D-03 | Durable bridge metadata, existing receipts as execution evidence | Proposed. Receipt files exist; detached promises are not restart-durable. No claim of durable execution. |
| D-04 | Extend SDK with a first-class external assistant turn if needed | Required proof in T-102. completeUserTranscript currently aborts response generation and represents user input; do not use fake user utterances for worker results. |
| D-05 | Voice handles ordinary creative answers; sensitive approvals stay on existing UI | Proposed v1 boundary; preserves inspectable scope and existing security policy. |
| D-06 | Initial one real local draft specialist path, then interactive/multiple-task support | Proposed. The release still requires all P0 obligations; early proof does not certify the complete feature. |

## Third-party references

[Bodhi](https://github.com/randombet/bodhi_realtime_agent) illustrates parallel background subagents and interactive questions while a voice session stays live. Borrow the separation of conversation from task execution and queued notifications. Its Gemini/OpenAI live architecture is not a drop-in replacement for our current Voice Core integration.

[Cicero](https://github.com/5uck1ess/cicero) illustrates a thin conversational front desk and notifications from longer-running agent work. Borrow explicit result/context delivery. Our internal session events should replace an extra external polling/CLI layer.

[Logica Voice](https://github.com/Rovemark/logica-voice) is a voice-engine comparison point. Replacing STT/TTS does not itself solve task ownership, approval routing or durable recovery. These are source-level observations, not benchmark results or complete security audits. No repository is installed by this packet.

## Exclusions and deferrals

- R-15 (excluded): replacement STT/TTS, new realtime cloud provider, avatar rebuild, phone/multi-party calling. These do not solve the missing bridge.
- R-16 (deferred): automatic process-crash job resumption and exactly-once external side effects. Existing detached worker execution cannot promise either; v1 explicitly reconciles and seeks reviewed retry.
- R-17 (deferred): approving sensitive tool execution solely through speech, or autonomous task creation from background results. Both expand authority beyond the first product contract.
- R-18 (excluded): remote service deployment and new paid generation. Existing configured providers suffice for the proposed proof; access remains to be verified live.

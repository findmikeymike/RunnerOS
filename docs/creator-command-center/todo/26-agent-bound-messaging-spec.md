---
status: proposed
owner: agent
last_verified: 2026-08-31
source_of_truth: true
related: ../22-chat-native-goal-mode-spec.md, ../24-session-task-list-spec.md, ../25-release-kit-asset-use-social-scheduling-spec.md
---

# Agent-Bound Messaging

## Briefing For The Implementing Agent

Read this section first. It is the whole change in one page.

### The one-line change

Today a phone chat is bound to a **session id**. After this change it is bound to an **agent role**, and the gateway resolves that role to a live session on every message.

### Why it matters more than it sounds

Capability in Artist OS is gated by agent slug, not by prompt:

```ts
SCHEDULE_WORK_AGENT_SLUGS      = new Set([CONCIERGE_SLUG])                       // SessionManager.ts:481
SECRET_WRITE_AGENT_SLUGS       = new Set([CONCIERGE_SLUG, SETUP_CONCIERGE_SLUG]) // :480
DIRECT_USER_MEMORY_AGENT_SLUGS = new Set([CONCIERGE_SLUG, ORCHESTRATOR_SLUG])    // :479
```

The gateway creates sessions with `createSession(workspaceId, { name })` (`commands.ts:153`) — no `spawnedFromAgent`. A slug-less session **cannot call `schedule_work` at all**; the tool is never registered for it.

So "schedule that post for Friday" silently fails from the phone and works from the desktop. That is the defect. It is not a prompt problem and cannot be fixed by prompting.

### The good news: this is wiring, not building

Everything needed already exists and is simply never called from the gateway:

| Piece | Where | Status |
| --- | --- | --- |
| `resolveAgentSessionOptions(workspaceId, agentSlug)` | `SessionManager.ts:2771` | Exists. Returns skills, sources, persona, context docs. Refreshes HQ/campaign state for HNIC. |
| `CreateSessionOptions.spawnedFromAgent` | `protocol/dto.ts:154` | Exists. |
| Precedent for both together | `AgentMessageService.ts:209` | Working. Copy this pattern. |
| Event fan-out to bound chats | `gateway.ts:384` | Working. |
| Delegation + completion wake | Spec 24, shipped | Working. |

Slices 1 and 2 deliver the entire core value and touch two files plus a store.

### What you are changing

1. `ChannelBinding.sessionId` → `target: ChannelBindingTarget` + `activeSessionId?`.
   **`target` is identity and durable. `activeSessionId` is a cache and may change at any time.** That distinction is the design.
2. A new `resolveBindingSession()` that reuses a valid cached session or creates an agent-backed one.
3. Pairing carries an agent slug; the Connect flow gains a picker.
4. `/bind` takes an agent slug, not a session id. `/new` is removed.
5. `authorizedSenderIds` defaults to the paired sender and is enforced.

### What you must not change

- **Do not touch the approval boundary.** `requiresAppApproval()` forces `approvalChannel: 'app'` for both platforms (`types.ts:217`). Tool approvals stay in the desktop app.
- **Do not add `permissionMode` to the gateway.** It currently contains zero references. Keep it that way.
- **Do not "fix" the plan tokens.** A prior review called them replayable. That was wrong — `gateway.ts:488-497` verifies six facts including the originating channel id. Leave it alone.

### Three ways to get this wrong

1. **Falling back to a slug-less session** when `resolveAgentSessionOptions` throws. That silently recreates the exact bug this spec exists to fix. Fail loudly instead.
2. **Building a legacy migration path.** There are no existing users. A binding without a valid `target` is corrupt, not legacy — drop it with a log line rather than inventing a dual-path resolver to preserve it.
3. **Letting a messaging session run in `allow-all`.** An unattended phone plus an unattended permission mode removes every human checkpoint at once. Downgrade to `ask` and record it.

### Prerequisite

The "specialist finishes hours later and messages you" behavior depends on spec 24's wake protocol (Slices 0 and 6), which has shipped. Do not ship agent-bound messaging as a headline capability if that work is ever reverted.

### Start here

Slice 1 (binding model, pure store change with tests) → Slice 2 (resolution). Everything after is incremental. Slice 5 (authorization) should not lag far behind, because binding chats to HNIC raises the cost of today's channel-only trust model.

---

## Decision

A WhatsApp or Telegram chat binds to an **agent role**, not to a session id.

The gateway resolves that role to a live session on every inbound message, creating an agent-backed session when none exists. The user texts "HNIC" or "the *Midnight* campaign lead" and keeps texting the same counterpart for months, across app restarts and session archival.

## Purpose

The messaging feature was inherited from the upstream Craft Agent fork and works, but it binds a chat to one `sessionId` fixed at pairing time. For a general-purpose agent harness that is reasonable. For Artist OS it is the wrong abstraction, because **capability in this product is gated by agent slug**:

```ts
SCHEDULE_WORK_AGENT_SLUGS   = new Set([CONCIERGE_SLUG])                        // SessionManager.ts:481
SECRET_WRITE_AGENT_SLUGS    = new Set([CONCIERGE_SLUG, SETUP_CONCIERGE_SLUG])  // :480
DIRECT_USER_MEMORY_AGENT_SLUGS = new Set([CONCIERGE_SLUG, ORCHESTRATOR_SLUG])  // :479
```

Cross-campaign Release Kit management is likewise HNIC-only (`resolveReleaseKitTarget`).

The phone path creates sessions through `commands.ts:153`:

```ts
const session = await this.sessionManager.createSession(this.workspaceId, { name })
```

No `spawnedFromAgent`. No skills, sources, or persona. The resulting session is **structurally incapable** of scheduling work, writing credentials, updating user memory, or reaching another campaign — not because a model declined, but because those tools are never registered for a slug-less session.

So "schedule that post for Friday" fails from the phone and succeeds from the desktop, with no visible reason. The user's mental model ("text my chief of staff") and the implementation ("text session `a3f9c2`") do not match.

## User Promise

The user connects Telegram or WhatsApp, chooses **who** they are texting — HNIC, or a specific campaign's lead — and from then on that chat is that agent.

The agent has its full ability: it can schedule work, delegate to specialists, read the Release Kit, and answer with real authority. When it hands work to a specialist, the specialist's completion comes back to the same chat.

Approvals for consequential actions still happen in the desktop app. Nothing about texting widens what an agent may do.

## Non-Goals

- No new messaging platform, adapter, or transport.
- No change to the approval boundary. Tool approvals remain desktop-only for both platforms.
- No multi-agent chat. One chat is one agent; delegation happens agent-to-agent, invisibly.
- No agent switching by the model. Only a human command rebinds a chat.
- No new orchestration. `message_agent` and the wake protocol from spec 24 already carry delegation and return.
- No change to campaign onboarding ("intake"), which is a separate feature.

## Current State

Verified at `last_verified`.

### What exists and works

- **Binding store.** `{platform, channelId} → ChannelBinding` with one binding per channel; a session may hold several bindings (`binding-store.ts:92`).
- **Pairing.** Desktop mints a 6-digit code, 5-minute TTL, 10/min per workspace, 5 attempts/min per sender, single-use (`pairing.ts:62-81`).
- **Response rendering.** Three modes — streaming, progress bubble (default), final-only — with platform chunking and file fallback for long content.
- **Event fan-out.** Session events reach every bound chat (`gateway.ts:384-394`), so async progress already flows to the phone.
- **Approval boundary.** `requiresAppApproval()` forces `approvalChannel: 'app'` for **both** WhatsApp and Telegram (`types.ts:217`), and `normalizeBindingConfig` re-applies it, so a stored config cannot override it. The inline Allow/Deny permission branch at `renderer.ts:466` is unreachable for both platforms.
- **Plan-token security.** Tokens are 48-bit (`randomBytes(6).toString('base64url')`), 30-minute TTL, and the callback verifies six facts before acting: binding exists, binding id, session id, recorded binding id, platform, and channel id (`gateway.ts:488-497`). A leaked token replayed from another chat is rejected and logged as `plan_binding_mismatch`.

An earlier review of this feature reported the plan tokens as replayable and the Telegram permission buttons as live. Both claims are false; the guards above were verified directly. This section exists so those claims are not re-raised.

### What is missing

1. **No agent identity on phone-created sessions** — `commands.ts:153` passes only `name`.
2. **`ChannelBinding` has no agent field** — `{ id, workspaceId, sessionId, platform, channelId, channelName?, authorizedSenderIds?, enabled, createdAt, config }` (`types.ts:245`).
3. **`/bind <session-id>` performs no ownership check**, and `/bind` with no argument lists recent sessions with their ids — so enumeration and hijack are the same command.
4. **`authorizedSenderIds` defaults to empty**, meaning all senders on a channel are accepted (`binding-store.ts:124`).
5. **Transport failures are silent** — a WhatsApp worker crash or Telegram drop is not surfaced to the user.

### What already exists to build on

`SessionManager.resolveAgentSessionOptions(workspaceId, agentSlug)` (`SessionManager.ts:2771`) returns a `Partial<CreateSessionOptions>` carrying the agent's skills, sources, persona, launch receipt, and context docs. It refreshes HQ or campaign state context for HNIC. It is already the path used by agent-messaging (`AgentMessageService.ts:209`), the workflow runner, and the Goal driver.

`CreateSessionOptions` already accepts `spawnedFromAgent`, `agentSkillSlugs`, `enabledSourceSlugs`, and `customSystemPrompt`.

**The capability to create a proper agent session from the gateway therefore already exists and is simply never called.** This specification is mostly wiring.

## Core Laws

```text
A chat binds to an agent, never to a session id.
The gateway resolves role to session; the user never sees a session id.
Only a human may bind or rebind a chat.
Texting never widens what an agent may do.
Approval for consequential action happens in the app.
```

## Data Model

```ts
export type ChannelBindingTarget =
  | { kind: 'agent'; agentSlug: string; workspaceId: string }

export interface ChannelBinding {
  id: string
  workspaceId: string
  platform: PlatformType
  channelId: string
  channelName?: string

  /** Who this chat talks to. */
  target: ChannelBindingTarget

  /** Session currently serving `target`. Cache, never identity. */
  activeSessionId?: string

  /** Senders permitted on this channel. Defaults to the paired sender. */
  authorizedSenderIds: string[]

  enabled: boolean
  createdAt: number
  config: BindingConfig
}
```

`sessionId` is replaced by `target` plus `activeSessionId`. The distinction is the whole design: **`target` is identity and is durable; `activeSessionId` is a cache and may change at any time** without the user noticing or caring.

`authorizedSenderIds` becomes required and non-empty.

There is no legacy `{ kind: 'session' }` variant. The product has no existing
users, so bindings are agent-targeted from the first release. A stored binding
carrying a bare `sessionId` and no `target` is treated as corrupt and dropped
with a log line, not migrated.

## Session Resolution

On every inbound message the gateway resolves the binding's target to a live session:

1. If `activeSessionId` is set, load it. **Reuse it only if** it still exists, is not archived or deleted, belongs to `workspaceId`, and its `spawnedFromAgent.agentSlug` equals `target.agentSlug`. A mismatch means the session was rebound or repurposed; discard the cache.
2. Otherwise create one:

```ts
const base = await sessionManager.resolveAgentSessionOptions(workspaceId, agentSlug)
const session = await sessionManager.createSession(workspaceId, {
  ...base,
  name: `${agentName} · ${platformLabel}`,
  spawnedFromAgent: { agentSlug, agentName, timestamp: Date.now() },
  labels: [...(base.labels ?? []), MESSAGING_SESSION_LABEL],
})
```

3. Persist the new `activeSessionId` on the binding **before** dispatching the message, so a crash mid-turn does not orphan the session.

Resolution is serialized per binding. Two messages arriving together must not create two sessions; the second waits and reuses the first.

### Continuity

A messaging session is long-lived by design — the same thread for months. It relies on the host's existing context compaction, exactly as a desktop session does.

The user may start a fresh thread with `/reset`, which clears `activeSessionId` and archives the prior session. `target` is untouched: the counterpart is the same agent, the conversation is new.

## Permission And Approval Boundary

Unchanged from today, and stated explicitly because binding to a *more capable* agent raises the stakes.

- A messaging turn inherits the session's permission mode. The gateway neither sets nor widens it — it contains no `permissionMode` reference and must not gain one.
- Tool approvals remain `approvalChannel: 'app'` for both platforms. `requiresAppApproval()` must continue to cover WhatsApp and Telegram.
- **A chat bound to an agent must not resolve to a session in `allow-all`.** Resolution creates sessions in the workspace default; if that default is `allow-all`, downgrade to `ask` for messaging sessions and record the downgrade. An unattended phone plus an unattended permission mode is the one combination that removes every human checkpoint.
- Plans may still be accepted from Telegram. Accepting a plan is not accepting the actions in it — each consequential tool still stops at the desktop gate. This holds **only** while the previous bullet holds.

## Authorization

The gateway currently authenticates the *channel*, not the *person*. With bindings pointed at HNIC — which can schedule work and write credentials — that is no longer acceptable.

- **`authorizedSenderIds` defaults to the paired sender** and must be non-empty. Messages from other senders on the same channel are ignored with a single explanatory reply, then silently, and are logged.
- **`/bind` no longer accepts a session id.** It accepts an agent slug or nothing. Listing sessions by id is removed, which eliminates the enumeration-plus-hijack pair.
- **Rebinding requires a fresh pairing code** issued from the desktop. Knowing an agent slug is not authorization; slugs are guessable and public.
- **`/new` is removed.** Its job — reach an agent — is what pairing now does.
- **Team Mode:** binding to an agent requires workspace membership, and binding to a campaign lead requires access to that campaign. Where a permission already exists for the desktop equivalent, reuse it rather than inventing a messaging-specific one.

## Commands

| Command | Behavior |
| --- | --- |
| `/pair <code>` | Redeem a desktop-issued code. Binds this chat to the agent chosen in the app. |
| `/who` | Show the bound agent, workspace, and approval mode. Replaces `/status`. |
| `/agents` | List agents this sender may bind to. Names and slugs only, never session ids. |
| `/bind <agent-slug>` | Rebind to another permitted agent. Requires a valid pairing within TTL. |
| `/reset` | Archive the current thread and start fresh with the same agent. |
| `/stop` | Abort the current run. Unchanged. |
| `/unbind` | Disconnect this chat. Unchanged. |
| `/help` | Unchanged. |

Removed: `/new`, and `/bind <session-id>`.

## Agent Discovery And Routing

Once a chat reaches a capable agent, that agent routes onward. Most of this
already exists and must not be rebuilt.

### What exists and works

| Mechanism | Where | What it gives |
| --- | --- | --- |
| `list_agents` tool | `session-tools-core/src/handlers/list-agents.ts`, host at `SessionManager.ts:9077` | Live read of the library **at call time**. Returns slug, name, description, tags, skills, sources, `sourceReadiness` (`ready`/`degraded`/`blocked`), inputs/outputs, trusted tools, and `active` per workspace. Filterable by `activeOnly`, `tags`, `search`. |
| Injected agent catalog | `run-agent.ts:151-169` | Compact snapshot in the system prompt at session start: slug, name, description, inputs, outputs, tags. Lets the manager route without a tool call. |
| Delegation doctrine | `prompts/system.ts:487-506` | Capability-fit rule, readiness refresh before account-dependent work, one bounded handoff per specialist, parent owns the final answer. |
| `message_agent` | `AgentMessageService.ts` | Bounded handoff returning a result or a durable receipt; refuses when a required source is unavailable (`:213`). |

A newly created worker is discoverable **immediately** through `list_agents`,
because that tool reads from disk on every call.

### Gap 1: a live session does not learn about a new worker

The injected catalog is a start-of-session snapshot. A manager session open for
hours will not mention a worker created after it started unless it happens to
call `list_agents`.

When an agent is activated in a workspace, the host appends one line of hidden
context to that workspace's live sessions:

```text
New worker available: Radio Outreach (radio-outreach) — pitches college radio
stations and hands verified email work to Outreach Agent.
```

Rules: hidden context only, never a visible message; one line per activation;
appended to sessions whose injected catalog is now stale; no turn is started by
this. It is a cache refresh, not a notification.

### Gap 2: routing quality is only as good as the description

Routing is driven by `description` plus `tags`, both free text. A vague
description produces vague routing, and this is the single highest-leverage
reliability lever in the system.

Add optional structured routing fields to agent metadata:

```ts
interface AgentRoutingHints {
  /** Concrete jobs this agent is the right owner for. */
  bestFor?: string[]
  /** Jobs it is plausibly but wrongly routed for, with the better owner named. */
  notFor?: string[]
  /** Slugs it habitually hands off to at a real boundary. */
  handsOffTo?: string[]
}
```

- Optional and additive. An agent without them behaves exactly as today.
- Included in both `list_agents` output and the injected catalog when present.
- The agent-creator skill requires **Best for** and **Not for** when creating a
  worker, instead of accepting one prose paragraph.
- `handsOffTo` is a routing hint only. It grants no authority and does not
  pre-authorize a delegation.

### Gap 3: two safety rules are asked for but never enforced

`prompts/system.ts:504` instructs "never delegate to your own slug or create a
delegation loop," and `list_agents` marks inactive workers `active: false`.
Neither is enforced host-side — verified against `AgentMessageService`.

The spawn-depth gate (`spawn-session-isolation.ts:140`, default 1) stops
infinite recursion but does not reject A→A, and nothing rejects a target that is
not active in the workspace.

Add two host guards in `AgentMessageService.messageAgent`:

- **Self-delegation.** Reject when the target slug equals the calling session's
  `spawnedFromAgent.agentSlug`. The message names the loop.
- **Inactive target.** Reject when the target is not active in the workspace,
  and say how to activate it. Do not silently activate it.

Both are prompt rules today. Binding an external chat to HNIC raises the cost of
a bad route enough that they should be enforced by code.

## Delegation And Return

No new machinery. The existing pieces compose once the chat reaches a capable agent:

1. User texts HNIC: "get the tour merch onto Shopify."
2. HNIC calls `message_agent` with `background: true` for the merch specialist.
3. Spec 24's task list marks that item `delegated`, host-owned, with the receipt id.
4. The child settles; the terminal receipt clears the background boundary and wakes HNIC (spec 24, Slice 0 and 6).
5. HNIC's continuation round reports the outcome, and event fan-out delivers it to the bound chat.

The user gets an unprompted "merch is live, here's the link" hours later, in the same thread. That behavior is a consequence of binding to a delegating agent — no messaging-side feature required.

**Prerequisite:** this loop depends on spec 24's wake protocol. Without it, a background delegation from the phone would go silent. Agent-bound messaging should not ship as a headline capability before that lands.

## Transport Failure Visibility

Silent failure is the worst outcome for a remote user, who cannot see the app.

- Worker crash, auth expiry, or connection loss surfaces in the desktop messaging pane with a plain-language cause.
- On reconnect, if any inbound message was dropped, the gateway sends one message to affected chats: connection was lost, messages between these times may not have arrived.
- Outbound send failure after retries marks the turn as undelivered in the desktop transcript, so the user is not left believing the agent replied.

## UI

In the existing Messaging settings pane, each platform's **Connect** flow gains one required step: choose the agent.

- Default and first option: **HNIC**.
- Then any campaign lead the user has access to, and any other permitted agent.
- After connecting, the row reads `Telegram · HNIC · Connected` with a Change action that mints a new pairing code.
- Session ids never appear in messaging UI.

## Migration

None. The product has no existing users, so there is no legacy binding shape to
preserve and no upgrade path to build.

A stored binding without a valid `target` is dropped on load with a log line.
Legacy `/bind <session-id>` is refused with a message explaining that chats bind
to agents now, rather than silently doing something else.

This removes the `{ kind: 'session' }` variant, the "Upgrade to agent" desktop
action, and the dual-path resolution branch an earlier draft required.

## Failure And Edge Cases

| Condition | Behavior |
| --- | --- |
| Bound agent deleted or deactivated | Binding disabled; user told which agent is gone and how to rebind |
| Cached session archived or deleted | Create a fresh session for the same agent; tell the user the thread restarted |
| `resolveAgentSessionOptions` throws | Do not fall back to a slug-less session — reply with the failure and leave the binding intact |
| Two messages arrive together | Serialized per binding; one session created, second message queues |
| Campaign workspace deleted | Binding disabled, not silently redirected to HQ |
| Sender not in `authorizedSenderIds` | Ignored with one explanatory reply, then silent; logged |
| Workspace default is `allow-all` | Messaging session created as `ask`; downgrade recorded |

The `resolveAgentSessionOptions` failure row matters most: falling back to a plain session would silently reproduce exactly the bug this specification exists to fix.

## Observability

Log per resolution: binding id, platform, target kind, agent slug, whether the session was reused or created, resolved session id, and permission mode with any downgrade. Log rejected senders and refused legacy binds with reasons.

Never log message bodies, pairing codes, plan tokens, or credentials.

## Implementation Slices

**Slice 1 — Binding model.** Add `target` and `activeSessionId`, make `authorizedSenderIds` required, drop malformed records on load. Pure store change with tests; no behavior change yet.

**Slice 2 — Session resolution.** `resolveBindingSession()` calling `resolveAgentSessionOptions` + `createSession`, with reuse validation, per-binding serialization, and persistence before dispatch.

**Slice 3 — Pairing picks an agent.** Desktop pairing carries an agent slug; the Connect flow gains the picker; the settings row shows the bound agent.

**Slice 4 — Commands.** `/who`, `/agents`, `/bind <agent-slug>`, `/reset`. Remove `/new` and session-id binding. Refuse legacy forms with an explanation.

**Slice 4a — Delegation guards.** Host-side rejection of self-delegation and inactive targets in `AgentMessageService.messageAgent`. Independent of the gateway; ships before an external chat is bound to HNIC.

**Slice 4b — Discovery freshness.** Hidden-context catalog refresh on agent activation, plus optional `AgentRoutingHints` surfaced through `list_agents` and the injected catalog.

**Slice 5 — Authorization.** Default `authorizedSenderIds` to the paired sender; enforce on inbound; add membership and campaign-access checks; require a fresh pairing code to rebind.

**Slice 6 — Permission-mode guard.** Downgrade `allow-all` to `ask` for messaging sessions and record it.

**Slice 7 — Failure visibility.** Desktop surfacing, reconnect gap notice, undelivered marking.

Slices 1 and 2 deliver the core value. Slices 4a and 4b are independent of the binding work and can land in any order. Slice 5 should not lag far behind, since binding to HNIC raises the cost of the current channel-only trust model.

## Acceptance Tests

### Resolution

- an inbound message on an agent-bound chat with no `activeSessionId` creates a session whose `spawnedFromAgent.agentSlug` is the target
- that session carries the agent's skills, sources, and persona from `resolveAgentSessionOptions`
- a second message reuses the same session
- a cached session that is archived, deleted, cross-workspace, or whose slug no longer matches is discarded and replaced
- two simultaneous messages create exactly one session
- `activeSessionId` is persisted before the message is dispatched
- `resolveAgentSessionOptions` throwing does **not** create a slug-less session

### Capability

- a session created from an HNIC-bound chat can call `schedule_work`; a slug-less session cannot — the regression test for the defect this spec fixes
- a campaign-lead binding cannot reach another campaign's Release Kit; an HNIC binding can

### Approval

- both platforms remain `approvalChannel: 'app'` after this change
- a workspace defaulting to `allow-all` yields an `ask` messaging session, with the downgrade recorded
- plan-token binding verification still rejects a token replayed from another chat

### Authorization

- a sender absent from `authorizedSenderIds` is ignored, with one reply then silence
- `/bind <session-id>` is refused with an explanation
- `/bind <agent-slug>` without a valid recent pairing is refused
- a non-member cannot bind to a workspace agent

### Discovery and delegation guards

- a worker created after a session started is returned by that session's `list_agents`
- activating a worker appends one hidden catalog line to live sessions in that workspace and starts no turn
- `message_agent` targeting the caller's own slug is rejected host-side
- `message_agent` targeting a worker not active in the workspace is rejected with an activation hint
- an agent without routing hints behaves exactly as before

### Migration

- a stored binding with no valid `target` is dropped on load with a log line
- `/bind <session-id>` is refused with an explanation, never silently reinterpreted

### Delegation

- a background `message_agent` from a messaging session delivers its completion to the bound chat
- a transport drop and reconnect produces exactly one gap notice

## Deferred

- Voice notes and inbound media
- Multiple agents in one chat, or @-addressing a specialist
- Approving consequential actions from the phone in any form
- Per-chat notification preferences (quiet hours, digest)
- Platforms beyond WhatsApp and Telegram

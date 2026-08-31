---
status: proposed
owner: agent
last_verified: 2026-08-31
source_of_truth: true
related: ./22-chat-native-goal-mode-spec.md, ./24-session-task-list-spec.md, ./25-release-kit-asset-use-social-scheduling-spec.md
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
2. **Silently re-pointing legacy bindings at HNIC** during migration. The user chose that session. Keep legacy bindings working untouched until a human upgrades them.
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
  | { kind: 'session'; sessionId: string }   // legacy, migration only

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

## Session Resolution

On every inbound message the gateway resolves the binding's target to a live session:

1. If `target.kind === 'session'` (legacy), use `sessionId` unchanged. No agent resolution.
2. If `activeSessionId` is set, load it. **Reuse it only if** it still exists, is not archived or deleted, belongs to `workspaceId`, and its `spawnedFromAgent.agentSlug` equals `target.agentSlug`. A mismatch means the session was rebound or repurposed; discard the cache.
3. Otherwise create one:

```ts
const base = await sessionManager.resolveAgentSessionOptions(workspaceId, agentSlug)
const session = await sessionManager.createSession(workspaceId, {
  ...base,
  name: `${agentName} · ${platformLabel}`,
  spawnedFromAgent: { agentSlug, agentName, timestamp: Date.now() },
  labels: [...(base.labels ?? []), MESSAGING_SESSION_LABEL],
})
```

4. Persist the new `activeSessionId` on the binding **before** dispatching the message, so a crash mid-turn does not orphan the session.

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

Existing bindings carry `sessionId` and no `target`.

- On load, a legacy binding is rewritten to `{ kind: 'session', sessionId }` and keeps working exactly as today. **No behavior change, no silent re-pointing at HNIC** — the user chose that session and may still be using it.
- The desktop pane shows legacy bindings with an "Upgrade to agent" action that mints a pairing code and rebinds.
- Legacy `/bind <session-id>` is refused with a message explaining the change, rather than silently doing something else.
- Remove the legacy target only when no bindings use it.

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

**Slice 1 — Binding model.** Add `target` and `activeSessionId`, make `authorizedSenderIds` required, parse legacy records into `{ kind: 'session' }`. Pure store change with tests; no behavior change yet.

**Slice 2 — Session resolution.** `resolveBindingSession()` calling `resolveAgentSessionOptions` + `createSession`, with reuse validation, per-binding serialization, and persistence before dispatch.

**Slice 3 — Pairing picks an agent.** Desktop pairing carries an agent slug; the Connect flow gains the picker; the settings row shows the bound agent.

**Slice 4 — Commands.** `/who`, `/agents`, `/bind <agent-slug>`, `/reset`. Remove `/new` and session-id binding. Refuse legacy forms with an explanation.

**Slice 5 — Authorization.** Default `authorizedSenderIds` to the paired sender; enforce on inbound; add membership and campaign-access checks; require a fresh pairing code to rebind.

**Slice 6 — Permission-mode guard.** Downgrade `allow-all` to `ask` for messaging sessions and record it.

**Slice 7 — Failure visibility.** Desktop surfacing, reconnect gap notice, undelivered marking.

Slices 1 and 2 deliver the core value. Slice 5 should not lag far behind, since binding to HNIC raises the cost of the current channel-only trust model.

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

### Migration

- a legacy binding keeps working unchanged and is never silently re-pointed at HNIC
- upgrading a legacy binding requires a fresh pairing code

### Delegation

- a background `message_agent` from a messaging session delivers its completion to the bound chat
- a transport drop and reconnect produces exactly one gap notice

## Deferred

- Voice notes and inbound media
- Multiple agents in one chat, or @-addressing a specialist
- Approving consequential actions from the phone in any form
- Per-chat notification preferences (quiet hours, digest)
- Platforms beyond WhatsApp and Telegram

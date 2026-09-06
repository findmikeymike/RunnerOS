---
status: implemented
owner: agent
last_verified: 2026-09-03
source_of_truth: true
related: ./13-scheduled-work-composer-execution-spec.md, ./33-automations-input-aware-setup-spec.md
---

# Model Fallback Chain

## Decision

A user picks **Fallback 1** and **Fallback 2** in Settings. When a model call
fails for a reason another model could plausibly survive, Artist OS continues on
the next model in that chain instead of failing the session, workflow step, or
scheduled run.

The user's choice is the entire policy. Artist OS does not rank models, infer
price, or substitute anything the user did not name.

## The Product Judgement

An acceptable output the artist can delete in one click beats a workflow stalled
at step 3 of 8. A half-finished run costs the artist a support conversation with
themselves: they must work out what ran, what didn't, and whether restarting
double-executes anything. A finished run on a weaker model costs one glance and
one keystroke.

So this feature optimizes for **completion with disclosure**, not for output
purity. Every fallback is recorded and shown. Nothing is silent.

## Why No Cost Logic

An earlier design proposed tier ranking and billing-boundary rules to prevent a
cheap model from failing over to an expensive one.

That is unbuildable and unnecessary:

- `ModelDefinition` (`packages/shared/src/config/models.ts:60-80`) carries `id`,
  `name`, `provider`, `contextWindow`, `supportsThinking`, and `supportsImages`.
  There is no price field anywhere in the repo.
- Selecting a model **is** the cost decision. If the artist put Haiku in slot 2,
  they have accepted Haiku's cost for the cases where slot 1 is down.

Any inference layer would eventually route work to something the artist did not
choose. An explicit ordered list cannot.

## Current State

Verified in the working tree:

| Fact | Evidence |
| --- | --- |
| No model fallback exists anywhere | grep for `fallback` across `agent/` and `config/` returns only unrelated uses |
| Workflow retries the **same step with the same model** | `packages/server-core/src/workflows/runner.ts:712-752` |
| Retry budget is small and fixed | `MAX_WORKFLOW_RETRIES = 3` (`runner.ts:189`), backoff 1s doubling to 10s (`:193-194`) |
| Exhausted retries kill the run by default | `onFailure: 'stop' \| 'continue' \| 'ask'` (`runner.ts:88`) |
| Error classification already exists and is good | `ErrorCode` union (`packages/shared/src/agent/errors.ts:10-32`) with `canRetry` and `retryDelayMs` per code |
| Connections have no health or cooldown state | only `lastUsedAt` (`packages/shared/src/config/storage.ts:3004`) |

The practical failure today: a rate-limited free model burns all three retries
against the same wall, each on a longer backoff, then stops the run. A workflow
with eight steps fails eight times slowly rather than once quickly.

## Core Laws

```text
The user's ordered chain is the only policy. Nothing is inferred.
Fall back only when a different model could plausibly succeed.
Never splice two models into one response.
Never silently replay a tool call that already had an external effect.
Every fallback is visible in the session and durable in the receipt.
A failed pair goes on cooldown so the next step does not re-hit the wall.
An auth or billing failure falls back AND raises attention on the primary.
Exhausting the chain produces Needs you, never a silent stall.
```

## Data Model

### Chain configuration

```ts
interface ModelFallbackEntry {
  /** Connection slug from StoredConfig.llmConnections */
  connectionSlug: string
  /** Model id within that connection. Omit to use the connection's defaultModel. */
  model?: string
}

interface ModelFallbackChain {
  /** Ordered. Empty array preserves today's fail-fast behavior. */
  entries: ModelFallbackEntry[]
  /** Master switch. Default false until the user configures a chain. */
  enabled: boolean
}
```

Stored in two places, resolved most-specific-first:

1. `LlmConnection.fallbackChain?: ModelFallbackChain` — per connection, for
   "when *this* connection fails, try these."
2. `StoredConfig.modelFallbackChain?: ModelFallbackChain` — global default for
   connections with no chain of their own.

Both are additive optional fields. Absent chain means current behavior exactly.

Maximum two entries in V1. A third rarely helps and lengthens the worst-case
latency of a failing call.

### Validation

- An entry pointing at a deleted connection is skipped at resolve time and
  surfaced in Settings as broken, never silently dropped from storage.
- An entry pointing at an unauthenticated connection is skipped at resolve time
  with a recorded reason.
- A chain may not contain the primary itself. Self-reference is rejected on save.
- Duplicate entries are rejected on save.

### Attempt record

Every call that fell back carries this, and it reaches the receipt:

```ts
interface ModelAttempt {
  connectionSlug: string
  model: string
  outcome: 'succeeded' | 'failed'
  errorCode?: string
  startedAt: string
  endedAt: string
  /** 0 = primary, 1 = fallback 1, 2 = fallback 2 */
  chainIndex: number
}
```

## Failure Classification

The decision is per `ErrorCode` from `packages/shared/src/agent/errors.ts`. The
question is only: **could a different model plausibly succeed?**

### Fall back

Capacity, availability, and model-specific rejections. Another model has a real
chance.

| Code | Why a fallback helps |
| --- | --- |
| `rate_limited` | The quota belongs to the failed provider or key |
| `service_error` | Transient provider fault |
| `service_unavailable` | Provider down |
| `provider_error` | Overloaded or unavailable upstream |
| `network_error` | May be endpoint-specific |
| `proxy_error` | May be endpoint-specific |
| `invalid_model` | Provider dropped the model, common on free tiers |
| `data_policy_error` | OpenRouter policy restriction; another provider may allow |
| `model_no_tool_support` | The fallback model may support tools |
| timeout before or during response | Provider is not serving |

### Fall back and raise attention

The work finishes, and the primary connection gets a Needs you row so a broken
key does not hide behind a working fallback for weeks.

| Code | Attention reason |
| --- | --- |
| `invalid_api_key` | `connection-auth-failed` |
| `invalid_credentials` | `connection-auth-failed` |
| `expired_oauth_token` | `connection-auth-failed` |
| `token_expired` | `connection-auth-failed` |
| `billing_error` | `connection-billing-failed` |

### Never fall back

Deterministic rejections of the request itself. Every model rejects these, so
trying two more only wastes time and lands on the same error.

| Code | Why |
| --- | --- |
| `invalid_request` | The request is malformed or over context |
| `image_too_large` | Input exceeds limits everywhere |
| `response_too_large` | Output cap, not a provider fault |
| `queued_message_replay_failed` | Host-side replay bug, not a model failure |
| `mcp_auth_required` | An MCP source failed, not the model |
| `mcp_unreachable` | An MCP source failed, not the model |
| `unknown_error` | Fall back once only, then stop; see below |

`unknown_error` gets exactly one fallback attempt. Beyond that the chain stops,
because an unclassified error repeating on a second model is evidence the
request itself is the problem.

## Where The Switch Happens

Two distinct situations, verified against the existing backends
(`claude-agent.ts:1582` and `pi-agent.ts:1801` for turn start;
`claude-agent.ts:2865` and `pi-agent.ts:2247` for `queryLlm`).

### Mid-workflow: fall back and continue

Step 3 of 8 fails on a fallback-eligible code. Retry that step with the next
chain entry. The run continues. This is the whole point of the feature and has
no caveats.

The fallback attempt is **not** charged against `MAX_WORKFLOW_RETRIES`. Chain
exhaustion and retry exhaustion are separate budgets: a step gets its normal
retries against the primary, and each chain entry gets its own attempt.

Ordering within a step:

```text
primary attempt 1
  -> fallback-eligible failure -> chain entry 1
  -> fallback-eligible failure -> chain entry 2
  -> exhausted -> normal step retry / backoff against primary (if cooldown expired)
  -> exhausted -> onFailure policy
```

Falling back before spending backoff is deliberate. A live second model beats
waiting ten seconds to re-ask a dead first one.

### Mid-call: replay, never splice

A single call has already streamed partial output when the connection dies.
Never continue the half-written text with a second model. Two sub-cases:

**No side effects executed yet.** Discard the partial assistant text and re-run
that one call from the top with the fallback model. Output is coherent, cost is
one extra call, and the step still completes.

**Side-effect tools already executed** (a post, an email, a file write, a spend).
Do not replay them. Keep the executed tool calls and their results in the
conversation history, discard only the incomplete assistant text, and let the
fallback model continue from that state. The fallback sees "I called X and got
Y" and proceeds. This is a normal continuation, not a splice.

Side-effect classification reuses the existing pre-tool-use boundary rather than
inventing a second list. A tool is replay-unsafe when it would require approval
under the current permission mode, or when it is a known external-effect tool
such as the Gmail send gate (`packages/shared/src/agent/core/pre-tool-use.ts:751`).

If the replay-unsafe set cannot be determined for a given turn, do not replay.
Fall back at the next clean turn boundary instead and record why.

## Cooldown

Without this, a workflow with many steps re-hits a dead model on every step.

When a pair of connection and model fails with a fallback-eligible code, mark
that pair unavailable for a cooldown window. Subsequent calls skip it and start
at the next chain entry.

```ts
interface ModelCooldown {
  connectionSlug: string
  model: string
  until: string        // ISO
  reason: string       // ErrorCode
  observedAt: string
}
```

- Default window: five minutes.
- `rate_limited` uses the provider's `Retry-After` when present, clamped to a
  fifteen-minute maximum.
- Cooldowns are process-local and in-memory. They are a latency optimization,
  not durable policy, and must not survive a restart or leak into config.
- A manual user retry always clears the cooldown for that pair. The artist
  overrides the system, never the reverse.
- Cooldown never applies to auth or billing codes. Those are surfaced, not
  routed around silently on a timer.

## Scope

The chain applies everywhere a model call is made on the user's behalf:

| Surface | Behavior |
| --- | --- |
| Interactive session | Falls back, shows an inline notice, keeps the turn |
| Workflow step | Falls back per step; run continues; receipt records the model |
| Scheduled work agent task | Falls back; on exhaustion the order goes `needs-attention` |
| Automation prompt action | Falls back; uses the action's connection chain (`packages/shared/src/automations/handlers/prompt-handler.ts:178-179`) |
| `queryLlm` tool | Falls back; `LLMQueryResult.model` reports the **effective** model, per the existing backend contract |
| Mini / summarization model | Falls back, subject to `isDeniedMiniModelId` filtering on each candidate |

The `queryLlm` case matters: `packages/shared/CLAUDE.md` already forbids
returning a fabricated `LLMQueryResult.model`. Fallback makes honoring that rule
mandatory rather than incidental.

## Visibility

### In session

One quiet inline line at the point of the switch, not a toast and not a modal:

```text
Rate limited on OpenRouter · llama-3.3-70b. Continued on Groq · llama-3.3-70b.
```

### In receipts

`ModelAttempt[]` is attached to the workflow step receipt, the scheduled-work
run record, and the session turn. The Outputs detail view shows the effective
model per step when any step fell back.

This is the disclosure half of "completion with disclosure." If a weaker model
wrote the artist's report, the artist must be able to see that without
reconstructing it from logs.

### On exhaustion

When every entry fails, the failure is the same as today, with one addition: the
error names every attempt.

```text
Could not reach a working model.
  OpenRouter · llama-3.3-70b — rate limited
  Groq · llama-3.3-70b — service unavailable
  Anthropic · Haiku 4.5 — invalid API key
```

For scheduled and automated work this becomes a Needs you row with reason
`provider-unavailable` and a Retry action, reusing the attention surface from
spec 33 rather than adding a new one.

## Settings

Add a Fallback section to `AiSettingsPage.tsx`, below the connection list.

```text
Model fallback                                              [ On / Off ]

When a model is rate limited or unavailable, keep working on these instead.

  Primary       Uses each session's own connection
  Fallback 1    [ OpenRouter · llama-3.3-70b        ▾ ]
  Fallback 2    [ Anthropic · Haiku 4.5             ▾ ]

Only connections you have signed in to appear here. Artist OS never picks a
model you have not chosen.
```

- Off by default. Off behaves exactly as today.
- Pickers list only authenticated connections and their available models.
- A per-connection override lives in that connection's detail view, defaulting
  to "Use the global chain."
- No price display, because the app has no price data. Do not invent one.

## Edge Cases

| Situation | Behavior |
| --- | --- |
| Chain entry's connection deleted | Skipped at resolve; Settings shows it broken |
| Chain entry unauthenticated | Skipped at resolve; recorded in attempts |
| Fallback model lacks tool support and the turn needs tools | Treated as `model_no_tool_support`; advance to the next entry |
| Fallback model has a smaller context than the conversation | Fails `invalid_request`; do not advance, since the next entry likely also fails; surface the real reason |
| Fallback model lacks vision and the turn has images | Skip the entry; record `unsupported-input` |
| Primary recovers mid-run | Cooldown expiry lets the next step use it again; a run may legitimately mix models |
| User stops the session during fallback | Abort wins; no further chain entries are tried |
| All entries share one provider that is down | All fail fast; exhaustion message names all three |
| Thinking level unsupported on the fallback | Drop to the fallback's nearest supported level and record it |
| Chain configured but disabled | Treated as absent |

## Implementation Slices

### Slice 1 — Chain contract and resolution

- `ModelFallbackEntry`, `ModelFallbackChain`, `ModelAttempt` types
- optional fields on `LlmConnection` and `StoredConfig`
- resolver: connection chain, then global chain, skipping deleted,
  unauthenticated, self-referencing, and duplicate entries
- save-time validation
- no call-path changes yet

### Slice 2 — Failure classification and cooldown

- `shouldFallBack(errorCode)` returning `fall-back`, `fall-back-and-flag`,
  or `stop`, covering the full `ErrorCode` union
- in-memory cooldown registry with `Retry-After` support and manual clear
- exhaustive tests over every code in the union

### Slice 3 — Turn-level fallback in both backends

- clean re-run when no side effects executed
- history-preserving continuation when side effects executed
- replay-unsafe detection reusing the pre-tool-use boundary
- inline session notice
- `ModelAttempt[]` on the turn

### Slice 4 — Workflow and scheduled work

- per-step fallback with a budget separate from `MAX_WORKFLOW_RETRIES`
- attempts recorded on step receipts and run records
- exhaustion produces `needs-attention` with `provider-unavailable`
- automation prompt actions inherit the chain

### Slice 5 — `queryLlm` and mini model

- fallback inside both `queryLlm` implementations
- effective model reported honestly per the existing backend contract
- `isDeniedMiniModelId` applied to each candidate

### Slice 6 — Settings and disclosure

- Fallback section in AI settings with authenticated-only pickers
- per-connection override
- effective model shown in Outputs detail when a step fell back
- broken-entry surfacing

## Required Tests

### Classification

- every `ErrorCode` in the union maps to exactly one of the three decisions
- `invalid_request` does not consume a chain entry
- `unknown_error` falls back exactly once
- auth and billing codes fall back **and** raise attention on the primary

### Turn behavior

- partial output plus a fallback-eligible failure with no side effects produces
  one coherent response from the fallback model, not a splice
- a turn that already sent an email does not re-send it on fallback
- a turn whose replay safety cannot be determined does not replay
- user abort during fallback stops the chain

### Workflow

- step 3 of 8 falls back and the run reaches step 8
- fallback attempts do not consume `MAX_WORKFLOW_RETRIES`
- eight steps against a cooled-down primary produce one failure, not eight
- the step receipt names the model that actually ran

### Cooldown

- `Retry-After` is honored and clamped
- manual retry clears the cooldown
- cooldown does not persist across restart
- auth codes do not create cooldowns

### Chain resolution

- deleted, unauthenticated, self-referencing, and duplicate entries are skipped
  or rejected as specified
- connection chain beats global chain
- disabled chain behaves as absent

### Disclosure

- a session that fell back shows the inline notice naming both models
- exhaustion lists every attempt with its reason
- scheduled work exhaustion creates a `provider-unavailable` Needs you row
- `queryLlm` returns the effective model, never the requested one

## Launch Criteria

- Off by default; off is byte-identical to today's behavior
- No model is ever chosen that the user did not name
- No response is ever composed by two models
- No side-effect tool is ever replayed
- Every fallback is visible in the session and durable in the receipt
- A cooled-down model is skipped rather than re-hit each step
- Chain exhaustion in unattended work produces Needs you, never a silent stall
- Auth and billing failures are never hidden by a working fallback

## Product North Star

The artist should never learn the phrase "the model was busy." Work should
finish, and when it finished on the second-choice model, the artist should be
able to see that in one glance and decide whether to run it again.

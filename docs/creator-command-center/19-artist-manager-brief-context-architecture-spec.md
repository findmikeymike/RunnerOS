---
status: implemented-v1
owner: agent
last_verified: 2026-08-29
source_of_truth: true
depends_on:
  - docs/creator-command-center/08-shared-intel-context-router-spec.md
  - docs/creator-command-center/09-hq-state-of-play-proactive-routing.md
  - docs/creator-command-center/14-state-of-play-opportunity-engine-spec.md
  - docs/memory/06-memory-os-spec.md
---

# Artist Manager Brief And Context Architecture

## Decision

Make the existing HNIC (`concierge` internally) behave like an informed artist manager without loading the artist's entire filing cabinet into every conversation.

The system will:

1. evolve the existing deterministic HQ State of Play composer into the single Manager Brief engine
2. preload one compact, source-linked Manager Brief into HNIC sessions
3. keep detailed artist, campaign, analytics, timeline, and intel records in their existing source stores
4. let HNIC retrieve bounded detail through read-only tools when a question requires it
5. read a freshly composed brief through a pure tool during an existing chat because session system prompts are not a reliable mid-session update channel
6. keep HNIC as the single front-door manager rather than adding a competing top-level agent
7. add one operating skill that teaches HNIC when to trust the brief, retrieve detail, recommend, delegate, and require approval

This is a context and decision-support system. It is not permission for autonomous public action.

## Product Outcome

An artist should be able to open HNIC and ask:

```text
What should I focus on this week?
How is my audience moving?
What is the next campaign and what is missing?
How does this idea fit the year?
What did the recent intel actually change?
Who should handle the next step?
```

HNIC should answer from fresh, structured evidence without:

- asking the artist to repeat information already in Artist OS
- dumping raw context documents into chat
- claiming stale analytics are current
- confusing HQ-wide direction with one campaign
- inventing a campaign when release dates are absent
- doing specialist work when a narrower worker fits
- sending, posting, spending, publishing, deleting, or changing accounts without the existing exact approval gates

## Non-Goals

Do not:

- create a second Artist Manager agent beside HNIC
- create a second annual-plan store beside `artist-release-horizon`
- create a second campaign store beside campaign workspaces and their `mission-brief`, `release-board`, calendar, assets, outputs, and Finals
- replace Memory OS with Manager Brief data
- make an LLM compose or rank the canonical brief
- inject every full context document into HNIC
- silently hide stale, partial, malformed, or unavailable sources
- expose credentials, browser sessions, private delivery configuration, or secrets through Manager Brief tools
- let a context retrieval tool bypass routing or privacy rules
- make the UI panel the source of truth

## Current Code Truth

The implementation must extend these live paths rather than build parallel ones.

| Existing primitive | Current behavior | Required evolution |
| --- | --- | --- |
| `packages/shared/src/hq-state/composer.ts` | Deterministically composes profile, Spotify, network, calendar, community, Vault, Shared Intel, goals, and operational state into `hq-state-of-play` V1. | Add a bounded Manager Brief view and missing sources while preserving State of Play behavior. |
| `packages/server-core/src/hq-state/refresh.ts` | Regenerates and persists derived HQ state after HQ context changes. | Persist Manager Brief V1 in the same derived document and refresh HQ when related campaign truth changes. |
| `packages/shared/src/workspace-context/storage.ts` | Concierge receives every enabled context doc regardless of routing. | Split authorization from prompt delivery; stop implicit full-doc HNIC preload. |
| `apps/electron/src/renderer/lib/compose-agent-prompt.ts` | Composes renderer-launched agent prompts. | Use a shared Manager Brief prompt renderer. |
| `packages/server-core/src/sessions/SessionManager.ts` | Independently composes workflow, automation, and Pulse-launched prompts. | Use the same shared Manager Brief prompt renderer and selection rules. |
| `packages/shared/src/agent/claude-agent.ts` | Keeps prompt components stable within a session; custom launch context is not a safe live-update channel. | Refresh HNIC through a read-only tool, not prompt mutation. |
| `apps/electron/src/renderer/lib/artist-release-horizon.ts` | Stores the rolling twelve-month plan as structured JSON under `artist-release-horizon`. | Hoist its pure contract/parser to shared code; do not add `artist-annual-plan`. |
| `apps/electron/src/renderer/lib/artist-profile.ts` | Stores artist identity and `mission`, which the release horizon uses as the North Star. | Hoist its pure contract/parser; include `mission` in the HQ composer input. |
| `apps/electron/src/renderer/lib/artist-instagram.ts` | Stores the latest Instagram Insights snapshot under `artist-instagram-snapshot`. | Hoist its pure contract/parser and add it to brief growth signals. |
| Campaign workspaces | Store `mission-brief`, `release-board`, campaign calendar, scheduled work, assets, outputs, and Finals outside the HQ workspace. | Add a server-owned related-workspace reader and cross-workspace HQ refresh triggers. |
| `packages/session-tools-core` | Owns the canonical session tool registry for Claude and Pi backends. | Add bounded read-only Manager tools with backend parity tests. |
| HNIC starter definition | HNIC is the front door and the only agent allowed to call `schedule_work`. | Tighten it into the manager role and bundle one operating skill. |

## Core Principles

1. **One compiler, many views.** State of Play and Manager Brief come from one deterministic HQ composer.
2. **Summary first, detail on demand.** HNIC starts with the brief and retrieves only the section needed for the current question.
3. **Source truth remains where it is.** The brief is derived, disposable, and regenerable.
4. **Access is not delivery.** Permission to read a document is separate from whether its full body enters a prompt.
5. **Freshness is visible.** Every claim carries a source timestamp and health state.
6. **No silent inference.** Missing dates, snapshots, or campaign fields stay missing.
7. **Same prompt behavior everywhere.** Manual, workflow, automation, Pulse, Claude, and Pi paths must use the same selection and rendering contracts.
8. **Bound every return.** Prompt sections and tools have hard item and character limits.
9. **Manager recommends and delegates.** Specialists execute specialist work; existing approval boundaries remain authoritative.

## Architecture

```text
HQ context docs + related campaign workspaces + operational indexes
  -> shared normalized source adapters
  -> existing deterministic HQ composer
  -> State of Play V2 + Manager Brief V1
  -> persisted derived hq-state-of-play context doc
  -> shared prompt selector/renderer
  -> HNIC launch prompt

Existing HNIC session
  -> get_manager_brief()
  -> pure live composition + revision/freshness comparison
  -> optional bounded detail tool
  -> answer / recommendation / specialist handoff / approval-gated action
```

## Canonical Stores

| Information | Canonical source |
| --- | --- |
| Artist name, identity, mission/North Star, sound, audience, rules | HQ `artist-profile` |
| Rolling twelve-month direction | HQ `artist-release-horizon` |
| Spotify performance | HQ `artist-spotify-snapshot` plus snapshot history where available |
| Instagram performance | HQ `artist-instagram-snapshot` plus snapshot history where available |
| Research/intel | HQ Shared Intel docs and normalized Intel report |
| Global dates | HQ `artist-calendar` |
| Relationships/community | HQ `artist-network` and `artist-community` |
| Reusable assets | HQ `artist-vault` |
| Campaign identity and date | Campaign workspace `mission-brief` |
| Campaign execution readiness | Campaign workspace `release-board` |
| Campaign tasks and timing | Campaign calendar and Scheduled Work |
| Campaign work/results | Outputs and Finals scoped to the campaign workspace |
| Active work, approvals, failures | Existing operational indexes |
| Stable user preferences | Memory OS, not Manager Brief |

The Manager Brief stores references and compact derived facts. It never becomes the write target for these records.

## Shared Artist Context Contracts

Move pure types, normalization, parsers, and serializers for the following records into a shared Artist Context module:

- Artist Profile
- Release Horizon
- Instagram Snapshot
- Campaign Mission Brief
- campaign-focus selection

Renderer modules become compatibility re-exports until all imports migrate. The server and renderer must not maintain separate parsers.

Parsing and writing must have separate timestamp behavior:

- parsing preserves a valid persisted `updatedAt` or reports it missing
- parsing never replaces a source timestamp with `new Date()`
- create/update commands stamp the current time immediately before serialization
- fallback timestamps are marked inferred and cannot qualify a source as fresh

This explicitly corrects the current Artist Profile normalizer and Mission Brief builder, which replace persisted `updatedAt` during reads and would otherwise make stale data appear fresh.

Proposed package surface:

```text
packages/shared/src/artist-context/
  profile.ts
  release-horizon.ts
  instagram.ts
  campaign.ts
  index.ts
```

Add `@craft-agent/shared/artist-context` to package exports.

Spotify, Shared Intel, Calendar, Vault, operational state, and context-doc contracts remain in their current shared modules.

## Pure Composer Boundary

The shared HQ composer remains pure and performs no filesystem, workspace-registry, Output, Scheduled Work, or recommendation-store I/O.

Server adapters resolve canonical records first and pass a complete normalized snapshot:

```ts
interface BuildHqStateInput {
  workspaceId: string
  docs: LoadedContextDoc[]
  relatedCampaigns: ManagerCampaignSnapshot[]
  operational?: HqOperationalSnapshot
  now?: Date
}

interface ManagerCampaignSnapshot {
  workspaceId: string
  name: string
  primary: boolean
  mission?: NormalizedMissionBrief
  readiness?: { done: number; total: number; nextMissing: string[] }
  calendar?: ManagerCollectionSummary
  work?: ManagerCollectionSummary
  assets?: ManagerCollectionSummary
  outputs?: ManagerCollectionSummary
  sourceHealth: ManagerSourceHealth[]
}
```

Both persisted refresh and live tool reads call the same server snapshot adapter and the same pure composer. No renderer-provided campaign summary is accepted as authority.

## Manager Brief Contract

Manager Brief is a bounded view embedded inside State of Play V2.

```ts
interface ManagerBriefV1 {
  version: 1
  workspaceId: string
  revision: string
  generatedAt: string
  budget: {
    maxChars: 8000
    actualChars: number
    truncated: boolean
  }
  identity: {
    artistName?: string
    mission?: string
    sound?: string
    audience?: string
    operatingRules?: string[]
  }
  trajectory: {
    months: Array<{
      month: string
      title: string
      event: 'release' | 'promotion' | 'live' | 'creation' | 'business'
      keyGoal?: string
      source: ManagerSourceRef
    }>
  }
  campaignFocus?: {
    workspaceId: string
    name: string
    label: 'Current campaign' | 'Next campaign' | 'Latest campaign' | 'Release date needed'
    releaseDate?: string
    goal?: string
    readiness?: { done: number; total: number }
    nextMissing?: string[]
    source: ManagerSourceRef
  }
  growth: {
    spotify?: ManagerGrowthSignal
    instagram?: ManagerGrowthSignal
  }
  intelligence: Array<{
    id: string
    title: string
    summary: string
    whyItMatters?: string
    confidence: 'high' | 'medium' | 'low'
    source: ManagerSourceRef
  }>
  operatingState: {
    nextMove?: { title: string; why: string; worker?: string }
    attention: string[]
    blockers: string[]
    activeWork: string[]
  }
  sourceHealth: ManagerSourceHealth[]
}

interface ManagerGrowthSignal {
  asOf: string
  windowDays?: number
  primaryMetric: string
  value?: number
  delta?: number
  highlights: string[]
  partial: boolean
  source: ManagerSourceRef
}

interface ManagerSourceRef {
  workspaceId: string
  contextSlug?: string
  entityType?: string
  entityId?: string
  updatedAt?: string
}

interface ManagerSourceHealth {
  source: string
  status: 'fresh' | 'stale' | 'partial' | 'malformed' | 'unavailable'
  observedAt?: string
  staleAfter?: string
  message?: string
}
```

### Relationship To State Of Play

`HqStateOfPlay` becomes a backward-compatible V2 union:

```ts
type HqStateOfPlay = HqStateOfPlayV1 | HqStateOfPlayV2

interface HqStateOfPlayV2 extends Omit<HqStateOfPlayV1, 'version'> {
  version: 2
  managerBrief: ManagerBriefV1
}
```

The parser must continue reading persisted V1 documents. UI selectors must normalize both versions. The refresh path writes V2 only after all consumers support the union.

Do not create a second derived `artist-manager-brief` context document. `hq-state-of-play` remains the one persisted derived HQ artifact.

## Deterministic Revision

`revision` changes only when canonical brief content changes.

Build it from a stable serialization that excludes:

- `generatedAt`
- transient display formatting
- `actualChars`
- source check timestamps that do not change source meaning

Use the existing portable FNV-1a pattern already used by campaign calendar and Scheduled Work:

```text
manager-v1:fnv1a:<8 hex characters>
```

This is a change detector, not a security checksum.

Detail tools always read current canonical records. A source change that does not affect the bounded brief may legitimately leave the brief revision unchanged; it must still appear in a subsequent detail-tool response.

## Brief Budget

The serialized prompt section has a hard ceiling of 8,000 characters, targeting roughly 2,000 tokens or less.

Budget order:

1. identity and mission
2. campaign focus
3. next move and blockers
4. source health warnings
5. populated year-horizon lines
6. growth signals
7. intelligence highlights
8. secondary attention and active-work lines

Limits:

- at most 12 populated trajectory months
- at most 3 intelligence items
- at most 3 attention items
- at most 3 blockers
- at most 3 active-work items
- at most 3 highlights per growth source
- normalize whitespace and cap every free-text field before assembly

If the brief still exceeds the ceiling, remove the lowest-priority complete items. Never cut JSON or a sentence mid-structure. Set `budget.truncated = true` and add a source-health warning.

## Freshness Policy

Every adapter owns its observation time and stale threshold. Initial defaults:

| Source | Observation field | Stale after | Behavior when stale |
| --- | --- | --- | --- |
| Artist Profile | `updatedAt` | 180 days | Keep identity; show review warning. |
| Release Horizon | `updatedAt` | 90 days | Keep month lines; show planning review warning. |
| Spotify Snapshot | `snapshotDate` or `updatedAt` | 9 days | Label stale; do not describe as current growth. |
| Instagram Snapshot | `snapshotDate` or `updatedAt` | 9 days | Label stale; do not describe as current growth. |
| Campaign Mission Brief | `updatedAt` | 30 days while focus campaign is active | Keep facts; warn before strategic recommendations. |
| Shared Intel | `updatedAt` | rank penalty after 30 days | Old intel can remain searchable but does not enter top three by recency alone. |
| Operational indexes | existing source-health timestamps | existing adapter rules | Preserve degraded/unavailable state. |
| Calendar | event dates plus context `updatedAt` | no blanket expiry | Expired events are filtered; sync health remains separate. |

`partial`, `errors`, malformed JSON, or missing expected fields override a nominally fresh timestamp.

The UI and HNIC must distinguish:

```text
No source
Source present but stale
Source partial
Source malformed
Source fresh with no meaningful change
```

## Campaign Focus And Cross-Workspace Reads

Campaign truth is not stored inside HQ. The server must build a compact related-workspace index from configured workspaces whose `artistWorkspaceScope === 'campaign'`.

For each campaign workspace, read only the bounded records required for the requested view:

- workspace id and name
- Mission Brief title, goal, release date, timeline, and updated time
- release-board totals and missing items
- campaign calendar summary
- Scheduled Work summary
- asset/Final counts and references
- recent Output summaries

The default focus selection must reuse one shared `resolveHqCampaignFocus` algorithm so the HQ UI and HNIC cannot disagree.

Selection rules remain compatible with the current UI:

1. choose the campaign with the smallest absolute distance from today when it has a valid release date
2. prefer a future campaign when distances tie
3. label a campaign within 45 days as `Current campaign`
4. otherwise label a future campaign `Next campaign` or a past campaign `Latest campaign`
5. when no valid date exists, fall back to the primary campaign and label it `Release date needed`
6. never invent or parse a fuzzy date that the Mission Brief parser does not validate

### Cross-Workspace Refresh

Refreshing only when HQ docs change is insufficient.

Schedule an HQ refresh when any of these occur in a campaign workspace:

- `mission-brief` upsert/delete
- `release-board` upsert/delete
- campaign calendar mutation
- Scheduled Work mutation or terminal transition
- Output/Final creation, promotion, or relevant status change
- campaign workspace create/delete/rename/scope change

The refresh resolver finds the configured `artistWorkspaceScope === 'hq'` workspace. If there is no HQ, it records a diagnostic and does not write into another workspace.

Refresh remains debounced and serialized per HQ root. A failed derived refresh must not roll back the canonical campaign mutation.

## Context Access And Delivery

### Separate Contracts

Context metadata gains two independent fields:

```ts
type ContextDocDelivery = 'always' | 'on-demand'

interface ContextDocMetadata {
  // existing fields
  routing: ContextDocRouting
  enabled: boolean
  delivery?: ContextDocDelivery
  private?: boolean
}
```

Meanings:

- `routing` decides which normal agents are authorized
- `delivery: always` permits prompt injection for authorized agents
- `delivery: on-demand` permits retrieval but not prompt injection
- `private: true` disables the legacy HNIC read override; HNIC can read only when explicitly targeted
- disabled documents are neither injected nor retrievable

Context docs are not a secret store. `private` is model-access control, not credential protection. Credentials remain in the credential system.

### Backward Compatibility

- Missing `delivery` behaves as `always` for non-HNIC agents.
- For HNIC, missing `delivery` behaves as `on-demand`; this is the intentional bloat-reduction migration.
- Missing `private` behaves as `false`, preserving HNIC's existing ability to retrieve non-private enabled docs.
- Existing targeted specialist behavior remains unchanged unless a document is explicitly marked `on-demand`.
- Parsing invalid values produces a warning and coerces to `on-demand` for every agent; missing values still use the compatibility defaults above.

### HNIC Prompt Selection

HNIC receives:

1. its persona and operating skill
2. the Manager Brief prompt section from `hq-state-of-play`
3. docs explicitly marked `delivery: always` and authorized for HNIC
4. user and agent memory through the existing Memory OS renderer
5. the active-agent capability catalog
6. skills, tools, and Canvas guidance

It does not receive all enabled context docs merely because its internal slug is `concierge`.

Other agents continue using routing plus effective delivery rules.

### Generated State Metadata And Duplicate Prevention

`hq-state-of-play` is a system-owned derived document with enforced metadata:

```ts
{
  routing: { mode: 'targeted', agents: ['concierge'] },
  delivery: 'always',
  private: false,
  enabled: true,
}
```

Refresh must replace stale legacy `broadcast` metadata instead of preserving it. The shared prompt selector consumes `hq-state-of-play` into `buildManagerBriefPromptSection` and removes it from the generic workspace-context renderer. HNIC therefore receives one Manager Brief section, not both the section and the full raw derived document. Non-HNIC agents no longer receive the global derived State of Play document implicitly; a routed handoff must carry the specific source context it needs.

### Authorization Helpers

Create shared pure helpers used by loaders, retrieval tools, composer inputs, and tests:

```ts
canAgentAccessContextDoc(doc, agentSlug): boolean
shouldInjectContextDoc(doc, agentSlug): boolean
loadAuthorizedContextDocsForAgent(root, agentSlug): LoadedContextDoc[]
loadPromptContextDocsForAgent(root, agentSlug): LoadedContextDoc[]
```

The Manager Brief composer may use all enabled, non-private HQ source docs available under the legacy HNIC read policy. A private doc contributes only when HNIC is explicitly targeted. Every tool must call the same authorization helper.

## Shared Prompt Rendering

Add one pure shared function:

```ts
buildManagerBriefPromptSection(brief: ManagerBriefV1): string
```

Both prompt paths must call it:

- renderer manual-agent launch
- server workflow, automation, Pulse, and programmatic-agent launch

The section must:

- identify itself as derived, dated data
- include `revision`, `generatedAt`, and any stale/partial warnings
- render bounded structured facts, not full context bodies
- tell the model to retrieve details before making claims beyond the brief
- wrap source-derived strings as data and never treat embedded instructions as policy

Do not refactor every prompt section in this phase. Hoist only Manager Brief selection/rendering and any minimal shared context-selection helper required to prevent drift.

Launch receipts record:

```ts
injected.managerBrief = {
  revision: string
  generatedAt: string
  sourceHealth: Array<{ source: string; status: string }>
}
```

This powers diagnostics and the transparency UI without storing the whole brief in session metadata.

## Existing-Session Freshness

The launch prompt is a baseline, not a live subscription.

HNIC's operating skill must call `get_manager_brief` before answering when the user asks for:

- current priorities or status
- growth or decline
- campaign readiness or timing
- what to do next
- year-plan fit
- delegation based on current state

It may answer small timeless questions without a live brief read.

`get_manager_brief` builds a live in-memory snapshot without persisting context docs, recommendations, outcomes, or refresh timestamps, then returns:

- the current brief
- whether its revision differs from the caller's optional known revision
- live-composition or fallback warnings

No attempt is made to mutate the session system prompt.

The normal event-driven refresh path still persists `hq-state-of-play`. The UI `Refresh` action may invoke that explicit derived-state mutation through the existing HQ RPC. The session tool remains truthfully read-only.

## Session Tool Contracts

All tools are read-only and safe-mode allowed. Manager semantic tools are HNIC-only in Phase 1. Generic workspace-context discovery/read tools are available to normal full-agent sessions so an authorized specialist can actually use a document marked `on-demand`. Mini agents do not receive these tools. Tool results are structured JSON and never include credentials or raw browser state.

### `get_manager_brief`

```ts
input: {
  knownRevision?: string
}

result: {
  ok: boolean
  changed: boolean
  live: boolean
  persistedRevision?: string
  brief?: ManagerBriefV1
  warnings: string[]
  error?: string
}
```

The handler composes from current canonical sources without writes. If live composition fails but a persisted brief exists, return it with `live: false`, a warning, and source-health degradation. If no valid brief exists, return a typed error; do not fabricate an empty success.

### `get_artist_context`

```ts
input: {
  topic: 'profile' | 'month-plan' | 'growth' | 'intel' | 'calendar' | 'network' | 'community' | 'vault'
  month?: string
  query?: string
  limit?: number // 1-20, topic-specific default
}
```

Rules:

- return normalized, topic-specific data
- cap response at 12,000 characters
- for `month-plan`, require `YYYY-MM` or default to the current month
- for `intel`, search title, summary, why-it-matters, and tags; return at most the requested bounded limit
- for growth, return source timestamps and compatible historical points only
- never merge incomparable reporting windows or profiles into one trend
- apply context authorization before reading source docs

### `get_campaign_context`

```ts
input: {
  select: 'focus' | 'next-future' | 'latest-past' | 'primary' | 'by-id'
  campaignId?: string
  include?: Array<'brief' | 'readiness' | 'calendar' | 'work' | 'assets' | 'outputs'>
  limit?: number // 1-20 per collection
}
```

Default `include` is `['brief', 'readiness', 'work']`.

The response includes selection reason, exact workspace id, source timestamps, malformed/unavailable sections, and bounded structured detail. `by-id` requires an exact configured campaign workspace id. HNIC cannot pass an arbitrary filesystem path.

### `list_workspace_context`

```ts
input: {
  query?: string
  limit?: number // default 20, hard max 50
}
```

Returns only authorized enabled documents with slug, name, description, routing summary, delivery, private state, and body character count. It never returns document bodies. This gives on-demand documents a discoverable path without injecting them.

### `get_workspace_context`

```ts
input: {
  slug: string
  maxChars?: number // default 8000, hard max 12000
}
```

These two generic tools are the escape hatch for user-created on-demand context docs. Retrieval:

- resolves only inside the current workspace
- rejects disabled or unauthorized docs
- respects `private`
- returns metadata, truncation state, and bounded body
- labels the body as user/source data rather than higher-priority system policy

### Tool Wiring

Use the canonical `packages/session-tools-core` registry and context callbacks. Update:

- Zod schemas, descriptions, handlers, and tool metadata
- `SessionToolContext` callback contracts
- shared callback registry/bindings
- `SessionManager` callback implementation
- Claude and Pi tool visibility/parity tests
- HNIC-only filtering for Manager semantic tools, modeled on `schedule_work`
- normal full-agent visibility for generic context list/get tools, with shared authorization enforcement

Do not add renderer-only tool implementations.

## HNIC Artist Manager Operating Skill

Create one reusable skill, proposed slug:

```text
artist-manager-operating-system
```

The skill contains procedure, never artist data.

Required procedure:

1. classify the user's question as timeless, current-state, detail lookup, specialist work, or consequential action
2. read the live Manager Brief for current-state questions
3. inspect freshness and uncertainty before drawing conclusions
4. retrieve the smallest needed detail section
5. connect the answer to mission, year trajectory, campaign focus, and observed momentum only when evidence supports the connection
6. provide one clear recommendation, why now, and the smallest next step
7. route deep specialist work through the active-agent catalog
8. pass a compact handoff containing goal, relevant facts, source freshness, constraints, and desired output
9. never expose hidden configuration or secrets
10. preserve exact approval gates for external or consequential actions

The skill must explicitly prohibit:

- pretending a stale snapshot is current
- converting totals into growth without comparable prior data
- inventing campaign dates or missing metrics
- loading every detail tool preemptively
- repeating the brief as a wall of text
- delegating without a clear desired outcome
- treating a handoff as authorization to publish or send

Bundle this skill into HNIC. Do not create another permanent manager persona.

## HNIC Prompt Changes

Replace the existing statement:

```text
You receive EVERY workspace-context doc...
```

with the new contract:

```text
You receive a compact Manager Brief and can retrieve authorized detail on demand.
Refresh the brief before current-state advice. Retrieve only what the question needs.
```

Keep existing HNIC responsibilities for direct answers, routing, workflows, automations, scheduled work, Canvas, memory scope, and approval-gated external actions.

## What Your Manager Knows UI

Build this only after the data and tools pass tests.

The panel is a compact transparency view, not another dashboard. It shows:

- brief generated time and revision
- source rows with `Fresh`, `Stale`, `Partial`, `Missing`, or `Unavailable`
- the focus campaign selected and why
- which detail categories HNIC can retrieve
- a `Refresh` action
- a link to the canonical source surface when one exists

Do not show raw prompts, full context documents, token counts, or internal tool schemas by default.

The panel reads the persisted Manager Brief and launch receipt metadata. It does not independently recompute truth.

## Safety And Privacy

- Manager tools are read-only in Phase 1.
- Existing `schedule_work`, messaging, Gmail, social, ad, and browser permission gates remain unchanged.
- Context tools resolve workspace IDs through configured workspaces and paths through existing storage helpers.
- No tool accepts an arbitrary root path.
- Private docs cannot leak into derived briefs, prompt sections, tool results, logs, launch receipts, or the transparency panel unless HNIC is explicitly authorized.
- Source text is bounded and represented as data; it cannot redefine system policy or tool authority.
- Malformed data fails visibly and remains recoverable from its canonical document.
- Manager Brief does not contain API keys, email destination configuration, cookies, auth tokens, browser storage, or raw secret values.

## Failure Behavior

| Failure | Required behavior |
| --- | --- |
| HQ composer fails | Preserve last valid persisted brief, mark refresh warning, do not overwrite with empty state. |
| One source is malformed | Omit its claims, add `malformed` source health, continue with other sources. |
| Campaign workspace disappears | Remove it on next refresh; return a clear not-found result for stale IDs. |
| Campaign mutation cannot refresh HQ | Canonical mutation succeeds; diagnostic records refresh failure; next `get_manager_brief` composes live without writing. |
| Tool response exceeds bound | Return complete highest-priority items plus `truncated: true`; never emit broken JSON. |
| No comparable analytics history | Return latest snapshot and explicitly state that growth cannot be calculated. |
| Existing session has old revision | Tool returns `changed: true`; HNIC uses returned data for the current answer. |
| Private source is requested without access | Return authorization error without confirming hidden content. |
| No HQ workspace exists | Do not select a general/campaign workspace as a substitute. Return setup-required. |

## Implementation Phases

### Phase 1 — Shared Contracts And Backward-Compatible State

- hoist pure artist/campaign parsers to `packages/shared`
- add Manager Brief types, deterministic budgeter, revision, and prompt renderer
- extend the HQ composer with mission, release horizon, Instagram, campaign focus, and source health
- add V1/V2 parser compatibility
- keep existing UI behavior working against normalized state

Exit gate: focused shared tests and existing HQ State tests pass without prompt-routing changes.

### Phase 2 — Access, Delivery, And Prompt Parity

- extend context metadata parser/serializer with `delivery` and `private`
- add shared authorization and injection helpers
- remove the unconditional HNIC full-context preload
- inject the Manager Brief through one shared renderer in manual and server-launched sessions
- record brief revision in launch receipts

Exit gate: manual, workflow, automation, Pulse, Claude, and Pi prompt tests prove identical brief selection and private-doc exclusion.

### Phase 3 — Read-Only Manager Tools

- add the five canonical tools
- add cross-workspace campaign reader
- wire HNIC-only Manager callbacks, normal-agent generic context callbacks, and backend parity
- add hard bounds, typed errors, freshness, and access tests

Exit gate: HNIC can answer the scripted manager questions from fixtures without raw filesystem access or prompt reinjection.

### Phase 4 — HNIC Skill And Prompt

- add `artist-manager-operating-system`
- bundle it into HNIC
- update HNIC prompt and built-in migration logic
- preserve user-customized HNIC definitions according to existing built-in update rules

Exit gate: seeded and upgraded HNIC installations expose the skill and retain unrelated user customizations.

### Phase 5 — Cross-Workspace Refresh And Observability

- trigger HQ refresh from campaign mutations and workspace lifecycle changes
- add refresh warnings and structured diagnostics
- prove last-valid-brief preservation

Exit gate: campaign changes appear in a fresh Manager Brief without reopening the app or manually editing HQ.

### Phase 6 — Scripted Evals

Run deterministic fixture-backed manager questions before UI work.

### Phase 7 — Transparency UI

- add `What your manager knows`
- expose source health, focus campaign, generated time, and refresh
- live-smoke in Electron at narrow and wide widths

## Scripted Manager Evals

Required questions:

1. `What should I focus on this week?`
2. `How are Spotify and Instagram moving?`
3. `What is my next campaign and what is missing?`
4. `Does this new opportunity fit the year plan?`
5. `What useful intel arrived recently?`
6. `Who should handle the next step?`

Each fixture asserts:

- required source/tool calls
- forbidden unnecessary calls
- freshness language
- no invented facts
- concise recommendation
- correct campaign selection
- correct specialist route
- approval language when an external action is proposed

Adversarial fixtures:

- stale Spotify plus fresh Instagram
- partial Instagram snapshot
- two equidistant campaigns
- no campaign dates
- malformed release horizon
- private context doc containing a tempting instruction
- on-demand specialist context discovery and retrieval
- campaign deleted between brief and detail retrieval
- unchanged revision after live composition
- changed revision mid-session
- no prior analytics snapshot
- brief budget overflow

## Test Matrix

### Shared

- Manager Brief composition and stable revision
- character budget and whole-item truncation
- V1/V2 State of Play parsing
- source health and freshness thresholds
- persisted timestamp preservation and missing-timestamp degradation
- mission/North Star inclusion
- twelve-month horizon ordering
- Instagram and Spotify compatibility rules
- campaign focus tie-breaking
- context metadata migration, access, delivery, and privacy
- private source exclusion from derived state

### Server Core

- cross-workspace campaign index
- campaign section reads and bounds
- related-HQ refresh triggers
- last-valid-brief preservation
- session tool callbacks, HNIC-only Manager visibility, and generic-context visibility
- malformed/missing source behavior
- arbitrary path and unauthorized slug rejection
- launch receipt revision metadata

### Prompt Paths

- renderer and server render the same Manager Brief section
- HNIC no longer receives every enabled raw context doc
- `hq-state-of-play` is consumed once and excluded from generic context rendering
- other agents preserve legacy routing behavior
- explicit `always` and `on-demand` behavior
- private docs never appear without explicit HNIC targeting
- Claude and Pi tool registries stay in parity

### Electron

- existing HQ, campaign, Pulse, and release-horizon screens still parse/save their canonical docs
- manager panel reflects persisted state
- refresh works without navigation or restart
- narrow/wide layout smoke

## Acceptance Criteria

The move is complete only when:

1. HNIC launches with one bounded Manager Brief rather than all enabled context docs.
2. The brief contains artist mission, populated year-horizon lines, focus campaign, useful growth signals, top intel, next move, blockers, and source health when those sources exist.
3. The brief remains under 8,000 characters in overflow fixtures.
4. Existing sessions can detect and consume a changed revision through `get_manager_brief`.
5. HNIC can retrieve full bounded detail for the selected next/focus campaign.
6. Campaign changes refresh persisted HQ state or are recovered by the next live tool composition.
7. Missing or incomparable analytics never become fabricated growth claims.
8. Private or unauthorized context does not leak through prompt, brief, tool, receipt, log, or UI.
9. Manual and background-launched HNIC sessions use the same brief renderer.
10. Claude and Pi expose the same intended read-only Manager tools and generic context tools.
11. Scripted manager evals pass.
12. Existing approval boundaries and specialist routing continue to pass regression tests.
13. The Electron transparency panel is live-smoked; automated checks alone are not release proof.

## V1 Verification Record

Verified locally on 2026-08-29:

- all nine package typechecks pass
- 323 focused Manager Brief, context, prompt, privacy, backend-parity, and UI tests pass
- isolated campaign lifecycle coverage proves campaign addition/removal refreshes the related HQ and stale campaign IDs fail closed
- failed persisted refreshes preserve the last valid brief and expose sanitized diagnostics
- wide and narrow Electron smoke confirms the Manager transparency panel renders and refreshes in place

The deterministic scripted eval suite pins the six required questions to minimal retrieval contracts and safety rules. A provider-backed conversational quality eval remains a separate authenticated/cost-bearing release check; it is not simulated by unit tests.

## Rival Review Disposition

The cold Rival pass blocked the initial draft on five findings. All are resolved in this version:

1. **Read-only tool side effects:** `get_manager_brief` now composes live in memory and cannot call the persistence/recommendation refresh path.
2. **False freshness:** shared parser requirements now preserve persisted timestamps and prohibit read-time `new Date()` replacement.
3. **Unreachable on-demand context:** authorized full agents now receive generic list/get context tools; Manager semantic tools remain HNIC-only.
4. **Undefined campaign input boundary:** the pure composer now has an explicit normalized `relatedCampaigns` input built by a server adapter.
5. **Duplicate/broadcast derived context:** `hq-state-of-play` has enforced HNIC-targeted metadata and is removed from generic context rendering when converted into the Manager Brief section.

## Likely File Plan

Shared contracts and composer:

- `packages/shared/src/artist-context/**`
- `packages/shared/src/hq-state/types.ts`
- `packages/shared/src/hq-state/composer.ts`
- `packages/shared/src/hq-state/manager-brief.ts`
- `packages/shared/src/hq-state/index.ts`
- `packages/shared/src/workspace-context/types.ts`
- `packages/shared/src/workspace-context/storage.ts`
- `packages/shared/package.json`

Server refresh and reads:

- `packages/server-core/src/hq-state/refresh.ts`
- `packages/server-core/src/hq-state/campaign-context.ts`
- campaign/workspace mutation handlers that own refresh triggers
- `packages/server-core/src/sessions/SessionManager.ts`

Tools:

- `packages/session-tools-core/src/tool-defs.ts`
- `packages/session-tools-core/src/context.ts`
- `packages/session-tools-core/src/handlers/manager-context.ts`
- `packages/shared/src/agent/session-scoped-tool-callback-registry.ts`
- shared Claude/Pi session-tool adapters and parity tests

Prompt and HNIC:

- `apps/electron/src/renderer/lib/compose-agent-prompt.ts`
- `packages/shared/src/agent-definitions/starter-templates.ts`
- built-in HNIC migration block in `packages/server-core/src/sessions/SessionManager.ts`
- bundled `artist-manager-operating-system` skill source and generated catalog

Renderer compatibility and UI:

- renderer artist-context modules become re-exports
- `apps/electron/src/renderer/components/app-shell/ArtistHQHome.tsx`
- new compact manager-transparency component and tests

## Verification Commands

The implementing agent must discover the exact focused test files created by each phase, then run at minimum:

```bash
/Users/michaelb.williams/.bun/bin/bun test packages/shared/src/hq-state packages/shared/src/workspace-context packages/session-tools-core/src
/Users/michaelb.williams/.bun/bin/bun run typecheck:all
/Users/michaelb.williams/.bun/bin/bun run build:renderer
/Users/michaelb.williams/.bun/bin/bun run build:main
git diff --check
```

Final release proof additionally requires a running Electron smoke covering HNIC launch, brief refresh, campaign detail retrieval, private-doc denial, and the transparency panel.

## Rollback

Each phase must remain revertible:

- V2 readers continue accepting V1 state.
- Canonical source docs are never migrated into a new store.
- Disabling Manager Brief injection restores prior prompt selection without deleting data.
- New tools are additive and read-only.
- Cross-workspace refresh failures do not mutate campaign truth.
- UI removal does not remove the brief or tools.

Do not delete the V1 parser or legacy context behavior until production workspaces have been opened and verified against V2.

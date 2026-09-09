---
status: implemented; live acceptance open
owner: agent
last_verified: 2026-09-08
source_of_truth: true
related:
  - ../19-artist-manager-brief-context-architecture-spec.md
  - ../24-session-task-list-spec.md
  - ../26-agent-bound-messaging-spec.md
  - ../33-automations-input-aware-setup-spec.md
---

# Agent Task Modes And Focused Context Loading

## Current Branding pilot decision — 2026-09-08

The user has superseded the original immutable-mode UI below for deliberate
Branding Agent focus changes. Cards remain visible inside the real chat, beneath the centered agent identity
in one compact header. The first choice starts one hidden host turn; subsequent choices
select the focus for the next user turn without generating another response.
The selected card stays active and Full Brand System remains explicit.

The current Branding choices are **Brand Audit**, **Artist World**, **Voice &
Beliefs**, **Campaign Angles**, and **Full Brand System**. Artist World pairs
`artist-narrative-universe` with `artist-visual-world-director`; Voice & Beliefs
pairs `artist-belief-system` with `artist-brand-expression-strategist`. Each pair
is a focused bundle (`kind: bundle`, not `fullMode`), with both primary skills
selected and used toward one connected outcome. Other skills stay on demand.
This supersedes the original one-primary-only rule and seven-choice recipe below.
The app is in development; no compatibility migration is part of this change.


An admitted response retains its original focus through initialization, provider
fallback, and automatic authentication retry. A later selection is persisted by
the host for the next turn. Hidden starters are execution input only, never artist
memory, session-log summaries, title-generation input, or visible chat metadata.

This decision overrides conflicting removal/immutable-primary instructions below
for explicit same-agent card selections. It does not authorize provider,
permission, spending, or approval changes. The rollout below now implements capability expansion, Manager focus, and the
listed specialist recipes. Live provider performance and quality acceptance remain separate gates.

## Approved shared focus UI — 2026-09-08

The final Branding UI is the visual reference for the wider rollout: a transparent
76px header, centered 12–13px agent title without a leading icon or guide text,
centered 28px focus buttons, neutral fills, and `#fb923c` selected outline/icon/check.
A half-pixel orange divider spans only the button group, with roughly 8px clearance.
No full/slower suffix on the button and no success toast for routine focus changes.
Hover cards use opaque soot, specific artist-facing purpose and examples, local
150ms timing, keyboard access, and independent pointer-grace state per button.
The user has authorized rollout to the listed agents using this design and the
pilot's first-selection hidden start / later next-turn switching behavior.
This supersedes earlier visual instructions and immutable-mode restrictions for
explicit user selections. The lightweight Manager voice experience stays separate.

## Implemented rollout — 2026-09-08

The user authorized the wider rollout after approving the Branding presentation.
There are now 27 focused agents: Branding, 13 other Tier 1 specialists, 12 Tier 2
specialists, and the full Artist Manager. The canonical executable recipes are
`packages/shared/src/agent-definitions/task-mode-recipes/{tier-one,tier-two,manager}.ts`
and Branding's definitions in `starter-templates.ts`. They supersede provisional
labels and unsupported capability assumptions in the original matrix below.

Recipes group real installed skills rather than forcing every agent to have five
choices. Video creation and YouTube research presets are consolidated. Record
Doctor prepares producer submissions; Lyric Video has two single-asset choices;
Playlist Review does not promise unproven playlist mutation. Manager starts in
optional Just Talk, preloads only its operating skill, and keeps creator/setup
capabilities on demand. Lightweight voice is unchanged.

The shared resolver now governs direct launches, delegation, workflows, scheduled
work, Pulse, HQ actions, and deep links. Authoring forms persist explicit focus.
Missing focus/dependencies fail clearly. Forks preserve the source's current
host-owned focus; transfers validate and rebuild the destination recipe. A branch
from an older message inherits the current selected focus, not an invented
historical focus that was never recorded on that message.

`load_agent_capability` delivers installed instructions only at declared same-session
boundaries, with revision/reason/time receipts, one new expansion per response and
two per session. It cannot add source or tool authority. Focused context can select
authorized on-demand documents; budgets withhold whole documents. Optional adapters
stay on demand, with one deterministic publishing route. Source/auth retries retain
the admitted focus and original input identity even when the user changes the next
focus mid-response.

See [rollout evidence](../../audits/agent-focus-rollout-2026-09-08.md) for checks and
remaining live acceptance. No customer migration framework was added.

## Decision

Add a lightweight **What are we doing?** choice to agents that currently cover several materially different jobs.

The user chooses a plain-language **task mode**, not a skill filename. That mode tells Artist OS which skill, sources, and context to preload for this run. Other relevant capabilities remain visible to the agent as a small awareness map and can be loaded only when the conversation genuinely crosses into them.

The result should be:

- faster first responses
- fewer unnecessary reads and model loops
- clearer user intent before work starts
- the same specialist depth once deeper work is actually needed
- no new approval prompts
- no silent expansion of tools, accounts, permissions, or spending

Artist Manager remains the universal front door. It gets optional umbrella quick starts, not a blocking specialist-skill picker, and delegates focused work to the proper agent and task mode.

## Product Promise

Opening Branding Agent should no longer mean loading every branding discipline before the agent can answer.

The opening state is:

```text
What are we doing?

[ Brand Audit ] [ Narrative Universe ] [ Belief / Worldview ]
[ Visual World ] [ Brand Expression ] [ Campaign Angles ]
[ Full Brand System ]
```

Choosing **Visual World** means:

1. preload the Visual World skill and the smallest relevant artist/campaign context
2. tell the agent which adjacent branding capabilities exist and when they may matter
3. do not preload those adjacent skill bodies
4. let the agent load one when the conversation clearly enters that territory
5. delegate when the work belongs to another specialist rather than turning Branding Agent into a generalist

The user can still choose **Full Brand System** when a genuinely holistic engagement is wanted. The UI must label that choice as more comprehensive and slower.

## Why This Exists

The current agent contract lists every bundled skill in `metadata.skills`. The session launch path passes all of them into `agentSkillSlugs`, and the base agent converts them into mandatory prerequisite reads. A prompt that says “use the narrowest matching skill” cannot undo that host behavior.

The current result is especially expensive for multi-discipline agents:

- Branding Agent declares six skills, so all six are read before meaningful work.
- Agent launch prompts can also include context that the agent then reads again.
- Specialist prompts receive a broad agent catalog and inactive source detail they rarely need.
- Slow or thinking-heavy models amplify each unnecessary planning/read loop.

Task Modes fix the host contract. This is not merely a prompt rewrite.

## Current Code Truth

Implementation must extend the existing paths rather than build a second launcher or prompt system.

| Concern | Current authority | Required evolution |
| --- | --- | --- |
| Agent capability metadata | `packages/shared/src/agent-definitions/types.ts` and `starter-templates.ts` | Add validated, versioned task-mode definitions beneath the existing maximum skill/source inventory. |
| Renderer launch options | `apps/electron/src/renderer/lib/run-agent.ts` | Resolve `agentSlug + taskModeId` before composing prompts or creating sessions. |
| Server launch options | `packages/server-core/src/sessions/SessionManager.ts` | Use the same resolver for workflows, automations, Pulse, handoffs, and other non-renderer launches. |
| Shared prompt composition | `packages/shared/src/agent-prompt/compose.ts` | Inject the selected mode, bounded context, active sources, and compact handoff targets; omit unrelated agent/source detail. |
| Implicit skill activation | `packages/shared/src/agent/base-agent.ts` | Treat only resolved primary skills as implicit prerequisites. The current default activates nearly every declared skill. |
| Context access/delivery | `packages/shared/src/workspace-context/storage.ts` and `types.ts` | Preserve authorization, but let the selected mode narrow what is delivered at launch. |
| Session creation/persistence | `packages/shared/src/protocol/dto.ts`, `packages/shared/src/sessions/types.ts`, `SessionManager.ts` | Persist an immutable resolved mode snapshot and append-only expansion receipts. |
| Agent delegation | `packages/session-tools-core/src/handlers/message-agent.ts`, `packages/shared/src/agent-messaging`, `packages/server-core/src/agent-messaging/AgentMessageService.ts` | Resolve `taskModeId` before child prompt composition. The current skill override happens too late to prevent a full-bundle prompt. |
| Direct launch UI | Workers launchpad, Agent detail, Agent sessions panel, HQ/campaign actions, Chat routing suggestions, and Workflow launch dialog | Preview readiness consistently, but keep server resolution authoritative. |

There is currently `list_skills`, but no cross-provider session tool that safely loads one related skill. Capability expansion therefore requires a real host tool; a prompt telling the model to “invoke another skill” is insufficient.

## Core Laws

```text
A task mode is a focused launch recipe, not a new agent.
User-facing cards describe jobs, never internal skill filenames.
The selected mode narrows prompt delivery; it does not reduce authorized access.
Access is not preload.
Unselected skills are awareness-only until explicitly loaded.
Loading an adjacent skill cannot grant a new tool, source, permission, account, or budget.
Cross-agent work is delegated; specialists do not absorb one another.
The Artist Manager stays the front door and does not preload specialist skill bodies.
Each admitted response keeps the capability snapshot it launched with; a later focus applies only to the next input.
No mode selection counts as approval for an external action or spend.
```

## Non-Goals

Do not:

- create duplicate agents for each mode
- expose raw skill slugs or source implementation details in the UI
- require a mode picker for every agent
- force Artist Manager users through a chooser before they can talk
- make “Full” the hidden default
- switch the user's configured model or provider because a mode was selected
- mutate an already-admitted response's prompt, fallback, or retry when the user selects a later focus
- let an LLM claim that a mode or skill is active without host-owned state
- silently connect, install, enable, or spend through an optional source
- weaken existing approval, privacy, freshness, or workspace-scope rules
- migrate old sessions into a newly inferred mode

## Terminology

| Term | Meaning |
| --- | --- |
| Agent capability inventory | The maximum set of skills and sources declared by the agent definition. |
| Task mode | A named, user-facing recipe selecting a focused subset of that inventory. |
| Primary skill | The skill body preloaded before the first response. Most focused modes have exactly one. |
| Adjacent capability | A declared skill the agent is told about but does not preload. |
| Capability expansion | Host-recorded loading of an adjacent skill during an active session. |
| Major mode change | A topic change requiring a substantially different context recipe, source set, or specialist owner. |
| Full mode | An explicit comprehensive recipe allowed to preload several closely related skills. |
| Manager focus | A nonblocking umbrella intent used by Artist Manager to form a brief and route work. It is not a specialist skill mode. |

## Agent Definition Contract

Extend `AgentMetadata` with optional task modes. The existing `skills`, `sources`, and `optionalSources` remain the maximum capability inventory.

```ts
export interface AgentTaskModeDefinition {
  id: string
  label: string
  description: string
  kind: 'focus' | 'bundle'

  /** Normally one. More than one requires fullMode: true. */
  primarySkillSlugs: string[]

  /** Awareness-only until the host loads one. */
  adjacentSkills?: Array<{
    slug: string
    when: string
    expansion: 'same-session' | 'new-session' | 'delegate'
  }>

  /** Required for this mode to make its core promise. */
  requiredSourceSlugs?: string[]

  /** Helpful, but the mode can proceed without them. */
  optionalSourceSlugs?: string[]

  context: AgentTaskModeContextProfile
  fullMode?: boolean
  recommendedThinkingLevel?: ThinkingLevel
}

export interface AgentTaskModeContextProfile {
  preloadTopics: string[]
  retrieveOnDemandTopics?: string[]
  maxPreloadChars: number
}

export interface AgentMetadata {
  // existing fields remain authoritative capability allowlists
  skills?: string[]
  sources?: string[]
  optionalSources?: string[]

  taskModes?: AgentTaskModeDefinition[]
  defaultTaskModeId?: string
}
```

Validation rules:

1. Every mode id is unique inside the agent and stable across releases.
2. Every referenced skill must exist in `metadata.skills`.
3. Every required source must exist in `metadata.sources`.
4. Every optional source must exist in `metadata.optionalSources` or `metadata.sources`.
5. A focused mode may preload no more than one skill.
6. A mode preloading multiple skills must use `kind: 'bundle'`, set `fullMode: true`, and explain why the combination is a single coherent job.
7. No mode may add trusted tools, permission modes, credentials, or source access beyond the parent agent definition.
8. Recommended thinking is advisory and cannot override an explicit user/session choice.
9. An agent with zero or one meaningful mode does not show a picker.
10. A skill cannot appear as both primary and adjacent in the same mode.
11. Delegate routes cannot target the same agent/mode recursively or form a static route cycle.

## Resolved Launch Contract

For a direct interactive launch, the host may create a prompt-free pending chat shell first. It must resolve and persist the selected definition before accepting the first turn. Non-interactive launches resolve the definition before session creation. The model never resolves or invents its own active mode.

```ts
export interface ResolvedAgentTaskMode {
  agentSlug: string
  id: string
  label: string
  definitionRevision: string
  selectedAt: string
  selectedBy:
    | 'user'
    | 'manager'
    | 'workflow'
    | 'automation'
    | 'handoff'
    | 'migration'

  preloadedSkillSlugs: string[]
  adjacentSkills: Array<{
    slug: string
    when: string
    expansion: 'same-session' | 'new-session' | 'delegate'
  }>
  requiredSourceSlugs: string[]
  optionalSourceSlugs: string[]
  deliveredContext: Array<{
    topic: string
    sourceRef?: string
    revision?: string
    chars: number
  }>
  contextBudgetChars: number
}
```

Add the resolved mode to `CreateSessionOptions`, the persisted session header/config, and `launchReceipt`.

For a mode-aware session:

- `agentSkillSlugs` contains only `preloadedSkillSlugs`, not the full agent inventory.
- the full inventory remains available to the host resolver for validated expansion
- enabled sources are the required/available sources selected by the mode plus existing always-required agent sources
- inactive source instructions are not injected
- ordinary specialists receive only a small relevant handoff-target list, never the full active-agent catalog
- the launch receipt records the exact model/provider, context revisions, skills, sources, mode revision, and token/character counts

Legacy callers that do not pass a mode continue to use existing behavior until their agent is migrated. Once an agent is declared `taskModesRequired`, every automated or delegated launch must provide a valid mode or enter `Needs You`; it must not silently fall back to Full.

## Context Loading Model

### Always-on baseline

Task modes do not replace the app's canonical context routing. Every session still receives the smallest baseline already required by its workspace and agent role:

- agent identity and operating rules
- workspace/HQ/campaign identity and scope
- asset/Vault/Outputs/Release Kit contract
- the compact artist identity/voice fields required by existing delivery policy
- a bounded mission or task brief
- bounded relevant memory
- approval, privacy, freshness, and source-health rules

The baseline is bounded and may contain references instead of full document bodies.

### Mode preload

After the baseline, the resolver adds only the selected mode's task-relevant material. Examples:

| Selected mode | Preload | Retrieve only if needed |
| --- | --- | --- |
| Branding / Visual World | concise brand identity, current campaign aesthetic, known visual rules, Visual World skill | full brand audit, historical campaigns, Vault inventory, image references |
| Release / DSP Pitch | release identity, date, approved metadata, audience evidence, DSP Pitch skill | full rights packet, complete QA checklist, all campaign outputs |
| Ads / Meta | campaign goal, approved offer/creative, budget/cap summary, Meta source | Google/Spotify account detail, full brand archive, unrelated campaign history |
| Video / Spotify Canvas | track identity, duration/beat/timing references, approved visual world, Canvas skill | full long-form footage inventory, unrelated content strategy, all brand skills |

### Access remains available

Mode selection controls delivery, not authorization. A valid agent may still use existing bounded read tools to retrieve a canonical detail when the task requires it. The mode cannot bypass private-context rules, freshness rules, campaign scope, or asset approval state.

### No duplicate reads

The prompt must include a machine-readable list of already delivered context and tell the agent not to fetch it again unless:

- the user asks for a newer version
- the source is marked stale or partial
- a tool mutation invalidated the revision
- the agent needs a field omitted by the bounded view

Host telemetry should flag immediate rereads of an identical source revision.

Recent-session context is filtered to the same agent and mode. Cross-mode work enters only through a compact handoff or a deliberate bounded lookup, not a dump of unrelated session history.

### Prompt budgets

Initial targets:

| Prompt component | Target |
| --- | --- |
| Task-mode directive | <= 1,000 characters |
| Adjacent-capability awareness map | <= 1,500 characters |
| Specialist mode context | <= 12,000 characters |
| Full specialist launch input | target < 30,000 tokens; telemetry warning at 40,000 |
| Focused mode primary skills | exactly 1 unless the mode has no skill |
| Pre-work planning/read loops | no more than 2 model round trips before meaningful work |
| Specialist handoff targets | at most 6 relevant agents/modes, or retrieve on demand |

Existing hard security and data bounds remain authoritative if they are smaller.

## How The Agent Learns About Overlap

The agent receives one compact host-generated block:

```text
TASK MODE
Visual World

PRIMARY CAPABILITY — already loaded
Define a coherent visual language for the artist or campaign.

ADJACENT CAPABILITIES — awareness only; do not preload
- Brand Audit: load if existing identity evidence conflicts or must be diagnosed.
- Belief / Worldview: load if visual decisions depend on an undefined core belief.
- Brand Expression: load if the conversation moves from visual language into public behavior or voice.
- Campaign Angles: delegate or start a linked mode if the user asks for rollout concepts.

Stay in this mode while it can answer the request well. Load at most one same-session
adjacent capability when the user clearly crosses that boundary. Never gain new tools,
sources, permission, or spend through capability loading.
```

The block is generated from validated metadata. It must not contain the full text of adjacent skills.

### Same-session expansion

Add one read-only host tool available across supported model backends:

```ts
load_agent_capability({ skillSlug, reason })
```

The tool:

1. verifies the skill belongs to the current agent's capability inventory
2. verifies the selected mode marks it `same-session`
3. verifies it needs no newly enabled source, account, tool schema, permission, or spend
4. reads and returns the full skill instructions through the host
5. records the skill slug, reason, timestamp, and content revision in the session receipt
6. is idempotent for an already loaded revision
7. emits a compact activity item such as `Added Brand Expression for public behavior`

Limits:

- maximum one expansion per assistant turn
- maximum two loaded adjacent skills in one session
- a third expansion triggers a recommendation to open a linked Full/new-mode session
- expansion never changes `permissionMode`
- expansion never installs a missing skill or source

### When to open a linked session

Use a linked new session rather than prompt mutation when:

- the new topic needs a different context recipe
- it needs a source/tool not present at launch
- it crosses into another agent's ownership
- the user changes the intended deliverable
- two adjacent expansions have already been loaded
- the current work should remain auditable under its original mode

The new session receives a compact handoff: user goal, decisions already made, exact artifacts/revisions, unresolved questions, and a link to the original session. It does not copy the entire transcript by default.

### Delegation

Extend `message_agent` with `taskModeId`:

```ts
message_agent({
  agentSlug: 'branding-agent',
  taskModeId: 'visual-world',
  task: 'Define the visual system for the June single.',
  context: { /* bounded handoff */ },
  expectedOutput: 'A durable visual-world direction.'
})
```

`taskModeId` and raw `skillSlugs` are mutually exclusive. New callers use `taskModeId`; raw `skillSlugs` remain a compatibility surface for existing internal callers and must still be validated as subsets.

Delegation preserves the caller's approval ceiling. It cannot widen permissions, budgets, source access, or workspace scope.

## User Experience

### Direct specialist launch

For agents with two or more modes:

1. Clicking the worker opens its actual chat immediately; no launch modal or separate setup card appears.
2. Inside the transparent agent header, show one slim centered row of compact focus cards beneath the agent title; do not add a separate setup panel or redundant guide label.
3. The composer remains visible, but Send is disabled until the user selects a card.
4. The pending chat shell contains identity and model settings only. It loads no skills, sources, memory, or workspace context until selection.
5. Selecting the first card atomically composes and persists that exact mode, then starts one hidden host turn. Full mode appears last as the explicit comprehensive choice.
6. Required unavailable dependencies disable only the affected card and explain the exact missing connection.
7. Optional unavailable sources never disable a card; show `Works without X`.

If a launch path already supplies a valid mode, render that card selected and continue with the same host-owned recipe.

### During a session

Keep the compact choice row visible throughout the session and show the selected focus clearly:

```text
Branding Agent · Visual World
```

After the opening response, selecting another card persists the focus for the next user input. It does not generate a response by itself and cannot alter the prompt, provider fallback, authentication retry, or capability snapshot of a response already admitted. Then:

- a closely related same-agent need can load an adjacent capability
- a major change offers `Start focused session` and carries a bounded handoff
- the session records the current focus while each already-admitted turn and receipt remain immutable

Do not silently treat an unselected chat as general mode. `General / all` is an explicit card and maps to the comprehensive bundle; its description must make that scope clear.

### Full mode

Full is an explicit choice, not an automatic fallback. Its card explains what it loads and why it may take longer. Full mode is appropriate for a complete audit/system/launch package, not a vague user prompt.

### Keyboard and accessibility

- cards are real buttons with arrow/tab navigation and visible focus
- selection is announced to assistive technology
- unavailable cards expose their reason, not only disabled styling
- compact/mobile layouts use a horizontal scroller or two-column wrap without hiding Full
- mode color is supplemental; label and selected state remain explicit

## Artist Manager: Special Case

### Decision

Keep Artist Manager as the nonblocking universal front door.

Do not show specialist skill cards and do not require a selection before the user can talk. Artist Manager starts from the compact Manager Brief and its own operating skill, answers simple management questions directly, and delegates specialist craft or execution.

Add optional umbrella quick starts above an empty manager composer:

- **Today / This Week**
- **Current Release**
- **Build My Brand**
- **Create Content**
- **Grow Audience**
- **Business / Rights**
- **Build & Automate**
- **Not Sure / Just Talk**

These are **manager focuses**, not agent skill modes. Selecting one:

1. narrows which Manager Brief sections are emphasized
2. gives the manager a routing hint
3. does not load Branding, Ads, Video, Release, or other specialist skill bodies
4. does not commit the user to a workflow or external action
5. remains editable until the first message

**Build & Automate** opens three compact second-step choices instead of leaving setup vague:

- **Create an Agent**
- **Build a Workflow**
- **Schedule / Trigger Work**

Those are Manager-owned jobs. They load only the matching Manager capability and do not hand the user to a general specialist unnecessarily.

Internally, every new Artist Manager session launches under one host-owned `manager-core` recipe:

| Manager capability | Loading policy |
| --- | --- |
| `artist-manager-operating-system` | Primary and always loaded. |
| `artist-os-guide` | Load when the user asks how Artist OS works or needs in-app guidance. |
| `agent-creator` | Load only for an explicit request to create or materially revise an agent. |
| `automation-creator` | Load only when the user asks for recurring/scheduled automation design. |
| `workflow-creator` | Load only when the user asks to build a reusable multi-step workflow. |
| `skill-scout` | Load only when a capability gap requires finding an existing skill. |
| `source-recipe` | Load only when a new source/connection recipe is actually required. |
| `runneros-self-edit` | Load only for an explicit, authorized request to change the application itself. |

These are Manager's own adjacent capabilities. They are not all startup prerequisites, and an umbrella focus chip does not load them by itself.

### Manager routing examples

| Focus | Manager behavior |
| --- | --- |
| Today / This Week | Answer from the Manager Brief; retrieve bounded schedule/attention detail only if needed. |
| Current Release | Start with the focused campaign brief; delegate release QA, pitch, visuals, ads, or content only when the request becomes specialist work. |
| Build My Brand | Clarify the desired result, then launch Branding Agent in the closest mode. Use Full Brand System only for a truly holistic request. |
| Create Content | Route to Content Director, Video Director, Raw Video Editor, Content Genius, or Social Publisher based on the actual deliverable. |
| Grow Audience | Route among YouTube Intelligence, Spotify Analyst, Community, Ads, outreach, or social according to the channel/problem. |
| Business / Rights | Route to Release Manager, Catalog & Royalties, or Legal & Deals. |
| Build & Automate | Offer Create an Agent, Build a Workflow, or Schedule / Trigger Work; load only the matching Manager capability. |
| Not Sure / Just Talk | Keep the standard manager conversation and infer only enough to make a recommendation. |

These cards belong only to the full Artist Manager chat composer. The lightweight voice/conversation feature is outside this change: it receives no cards, no new picker, and no behavior change from this specification.

The manager may:

- answer a bounded management question itself
- recommend the best specialist and explain why
- open a visible focused specialist session
- delegate bounded background work through `message_agent`

The manager may not run every specialist internally, preload every skill, or treat a focus selection as permission to act.

Manager routing chooses the interaction shape as well as the target:

- **Answer directly** for priority, sequencing, status, and other manager-owned questions.
- **Background `message_agent`** for bounded read-only analysis or one clearly specified returned artifact.
- **Visible specialist session** for iterative collaboration, attachments, clarification, approvals, spending, publishing, sending, or other external mutation.
- **Workflow** for repeatable multi-step work with durable state.

## Agent Rollout Matrix

### Tier 1: mode selector required

These agents currently contain multiple distinct disciplines, expensive context paths, or platform-specific sources. They receive full task-mode routing in V1.

| Agent | Task-mode cards | Important loading rule |
| --- | --- | --- |
| Branding Agent | Brand Audit; Narrative Universe; Belief / Worldview; Visual World; Brand Expression; Campaign Angles; Full Brand System | Focused cards preload one matching skill. Full may preload all six because the requested deliverable is the whole brand system. |
| Legendary Minds | Creative Oracle; Steve Jobs; MrBeast; Tom Ford; Full Panel | A mind card loads only that installed perspective. Do not show an unavailable persona. Full Panel loads all installed minds and is explicitly slower. |
| Video Director | Viral / UGC Video; Talking / Yap Video; Spotify Canvas; Full Music Visual Campaign | Viral and Talking are Squad task presets; Canvas loads Canvas first and consults Squad/Hypermotion only if required. |
| Art Director | Single / Album Cover; Merch / Poster; Visual System; Ad Creative; Full Art Direction | Cover and Full modes may intentionally combine art direction, typography, and visual-world skills because the deliverable requires them together. Zero remains fallback-only. |
| World Builder | Narrative Universe; Immersive Campaign World; Campaign Rollout; Full World | Narrative mode does not preload rollout mechanics; rollout can retrieve the established world as a bounded input. |
| Release Manager | Delivery / Metadata; Rights / Splits; DSP Pitch; Final QA; Full Release Readiness | Each focused card loads its exact release skill. Connections remain optional unless the chosen action truly requires them. |
| Ad Strategy | Audience / Market; Budget / Channel Plan; Conversion Path; Full Ad Strategy | Research evidence is retrieved on demand; a strategy mode never enables ad-spend tools. |
| Ad Creative | Winning Ad Research; Hooks / Concepts; Visual + Copy Package; Full Creative System | Research mode does not preload production skills. Full is for a complete multi-asset system. |
| Ad Runner | Meta; Google; Spotify; Reporting / Audit; Cross-Platform | Load only the selected platform source and instructions. Cross-Platform explicitly loads all connected platform adapters. |
| YouTube Research Agent | Find Videos; Transcript + Comments; Channel Scan; Viral Ideas; Full Research | Monid/Zero are fallbacks and are not preloaded when native YouTube retrieval is healthy. |
| YouTube Intelligence Agent | Weekly Signal Scan; One Video Deep Dive; Audience Research; Content Strategy; Full Intelligence | Weekly scan uses the bounded intelligence snapshot; deep work loads only the selected research discipline. |
| Print Agent | Product Strategy; Artwork + Placement Prep; Pricing + Margin; Listing Copy; Full Product Launch | Printify/Shopify sources are enabled only when the mode/action needs them; planning cards work without a live store. |
| Raw Video Editor | Edit One Video; Social Repurpose; Direction / EDL; Full Edit | Source footage selection is mode-scoped. Social Repurpose loads the repurposing skill, not every edit discipline. |
| Spotify Analyst | Connect / Intake; Snapshot; Growth Review; Anomaly Check | Most modes use one analytics view. Source freshness must be visible and no card implies live data when disconnected. |
| Artist Manager | optional manager-focus chips listed above | Never preload specialist skills; route or delegate with an explicit specialist mode. |

### Tier 2: useful quick starts after V1 proves the pattern

These agents can benefit from clearer intent, but they either have fewer overlapping skills or lower current context cost.

| Agent | Candidate cards |
| --- | --- |
| Social Publisher | Draft; Schedule; Publish; Growth Snapshot |
| Hypermotion Agent | Motion Visual; Spotify Canvas; Full Motion Package |
| Lyric Video | Generate Lyric Video; Spotify Canvas Variant; Full Lyric Package |
| Content Genius | Content Idea / Script; Captions + Overlays; Full Social Package |
| Outreach Agent | Find Contacts; Write Outreach; Send / Follow Up |
| X Editorial | Post / Thread; Editorial Plan; Refine Voice |
| College Radio | Match Stations; Build Outreach; Full Campaign |
| Record Doctor | Diagnose Record; Revision Handoff; Collaborator Message |
| Open Slide | Build Deck; Redesign Deck; Presentation System |
| Spotify Playlist Creator | Build Artist Playlist; Curate Existing Playlist |
| Site Builder | Build New Site; Update Existing Site; Apply Website Strategy |
| Setup Concierge | Connect A Source; Create A Capability; General Setup |

Tier 2 is not required for the first pilot. Add a selector only when its cards produce meaningfully different skill/source/context recipes; cosmetic prompt presets do not justify a picker.

### No picker in V1

These agents are already narrow, have no divergent skill inventory, are generic infrastructure roles, or should classify from the request without another UI step.

| Agent(s) | Reason |
| --- | --- |
| Anything Agent | Capability-gap broker; its job is runtime discovery, not a fixed creative mode. |
| Orchestrator | Internal orchestration role; receives structured work rather than direct specialist selection. |
| TryPost; Postiz | One connected publishing lane each. |
| Signal Scout; Signal Analyst | Already split into collection and analysis roles. |
| Lottie Animation Agent; Video Editor Agent | One source-backed production lane each. |
| Scroll Stopper; Anticipation Director | One focused capability each. |
| Content Director | General routing/brief role; use a concise intake rather than skill cards. |
| Comms Agent | One focused strategy capability. |
| Catalog & Royalties; Legal & Deals; Industry Hunter | Each already represents one specialist ownership boundary. |
| IG Music Trending; Influencer Campaign; Playlisting | Power-up roles, not broad direct agents. |
| Shopify Agent; Community Agent; Website Agent | One principal domain capability each. |
| Update System Agent; Researcher | Infrastructure/general-purpose roles without a stable card taxonomy. |
| Writer; Song Director | Conversational creative roles; avoid constraining exploration prematurely. |
| Reverse Magic; Legendary Writer; Hooker; Reference Master; The Excavator | Lab specialists already separated by creative job. |
| Coder; Triager; Critic | Internal technical roles. |

Every starter agent is accounted for above. A future agent defaults to no picker until its owner defines and validates at least two materially different recipes.

### Custom and user-edited agents

- Existing custom agents remain no-mode/legacy until their definition explicitly adds modes.
- Agent Creator may propose task modes when an agent has multiple distinct jobs, but the generated definition must pass the same subset and cycle validation.
- Upgrades merge built-in starter-mode additions without replacing user-authored custom modes or labels.
- A custom mode referencing a removed skill is preserved as blocked configuration so the user can repair it; it is not deleted or remapped silently.
- Near-duplicate cards should be rejected during authoring. Different labels without different skill/source/context recipes are not real modes.

## Detailed Tier 1 Mode Recipes

The following are the initial product contract. Exact context topic adapters may evolve, but their preload boundaries must remain testable.

### Branding Agent

| Mode | Primary | Adjacent triggers | Context emphasis |
| --- | --- | --- | --- |
| Brand Audit | `artist-brand-dna-audit` | visual/world/expression only after gaps are identified | artist profile, existing brand framework, approved outputs, current public presence summaries |
| Narrative Universe | `artist-narrative-universe` | belief if the emotional thesis is undefined; visual when translating story to look | identity, lyrics/themes, release horizon, relevant campaign mission |
| Belief / Worldview | `artist-belief-system` | narrative for story structure; expression for public behavior | mission, values, recurring themes, audience relationship |
| Visual World | `artist-visual-world-director` | audit if contradictions emerge; expression when public behavior becomes central | visual rules, approved references, campaign aesthetic, relevant Vault pointers |
| Brand Expression | `artist-brand-expression-strategist` | belief when principles are unclear; visual for appearance systems | voice, audience, channels, established worldview/visual summary |
| Campaign Angles | `artist-campaign-angle-builder` | narrative for world coherence; delegate ads/content for execution | campaign mission, release facts, audience evidence, approved brand summary |
| Full Brand System | all six | none; already comprehensive | all bounded brand summaries, then detail on demand |

### Legendary Minds

Each installed mind is a separate primary skill. **Creative Oracle** may synthesize advice without impersonating unavailable minds. **Full Panel** loads only the currently installed four perspectives. Adding future minds requires a real installed capability and metadata update; a label alone is insufficient.

### Video Director

| Mode | Primary recipe | Handoff boundary |
| --- | --- | --- |
| Viral / UGC Video | Squad with a short-form/UGC task frame | Raw footage execution -> Raw Video Editor; hooks/captions -> Content Genius as needed |
| Talking / Yap Video | Squad with direct-to-camera structure, pacing, and capture needs | final edit -> Raw Video Editor |
| Spotify Canvas | Spotify Canvas skill and track timing/visual inputs | complex generation -> Hypermotion; upload/publishing remains separate |
| Full Music Visual Campaign | Squad + Canvas, with bounded brand/campaign summaries | individual edit/render tasks may be delegated |

Ownership is explicit: Video Director owns the user-facing Spotify Canvas brief and creative direction; Hypermotion owns advanced motion/render execution when delegated. Hypermotion's later quick start should say **Animate a Canvas**, not compete as a second strategy owner.

### Art Director

Cover art is intentionally multi-skill: art direction, typography, and visual-world coherence are inseparable for a complete cover. The mode resolver may preload this approved combination without weakening the general one-skill law because the mode is marked `fullMode` for that deliverable. Ad Creative uses the ad-creative capability but delegates campaign strategy or media buying.

### Release Manager

Focused release modes must never conflate readiness advice with distribution action. Delivery/Metadata may prepare or validate fields; a connected-source mutation still follows the existing approval path. Full Release Readiness composes the four release disciplines but returns one prioritized readiness report rather than four duplicated audits.

### Ads

Keep strategy, creative, and execution as three ownership boundaries:

```text
Ad Strategy -> decision and plan
Ad Creative -> concepts and approved creative package
Ad Runner -> connected-platform setup, operation, and reporting
```

Task modes narrow work inside each boundary. They do not collapse the three agents. Cross-platform Ad Runner mode is explicit because it expands connected-source schemas and may increase prompt/tool cost; it is never inferred from a generic “run ads” message.

## Launch-Path Parity

All paths use one shared `resolveAgentTaskMode()` implementation.

| Launch path | Mode behavior |
| --- | --- |
| Agent detail / Run | Open the chat immediately; select from the compact in-chat row before first send. |
| Existing agent session list | Resuming preserves the stored resolved mode; starting new opens a pending chat with the in-chat row. |
| Artist Manager text | Manager selects/recommends a specialist mode and includes `taskModeId` in the launch or delegation. |
| `message_agent` | Accept and validate `taskModeId`; reject conflicting raw `skillSlugs`. |
| Workflow | Store a deterministic mode id and resolved revision at workflow definition/run creation. No interactive picker at execution. |
| Automation / scheduled work | Store mode id plus resolved snapshot. Missing/invalid dependencies become `Needs You`, never Full fallback. |
| Pulse / proactive trigger | Trigger definition declares the exact target mode. |
| Deep link | May carry `mode=<id>`; host validates it and displays the selection before first send. |
| Agent-bound messaging | Binding still targets an agent role. A new task may be classified to a mode; an active session keeps its stored mode until a linked session is intentionally created. |
| Branch / fork | Preserve the original resolved mode and loaded-capability receipt. |
| Transfer / another host | Preserve the receipt, then revalidate installed skills/sources on the destination before running. |

Renderer and server launches must not maintain separate mode maps or prompt composers.

## State And Lifecycle

```text
unselected
  -> selected (definition validated; no session required yet)
  -> launched (resolved snapshot persisted)
  -> active
       -> adjacent capability loaded (append-only receipt)
       -> linked focused session created
       -> completed / archived

selected
  -> changed before first message (re-resolve; replace unlaunched selection)

active
  -X-> silently replace primary mode
```

### Definition changes

Every definition receives a deterministic revision hash. Sessions and scheduled runs store:

- mode id and label
- definition revision
- resolved primary and adjacent skills
- resolved source set
- delivered context references/revisions

Existing sessions never recompute against a new definition. New launches use the latest valid definition.

For scheduled work, keep the saved resolved snapshot for auditability and revalidate it immediately before execution. If the skill/source disappeared or became invalid, mark `Needs You` with the exact reason. Do not switch modes or substitute a provider silently.

### Missing dependencies

| Condition | Behavior |
| --- | --- |
| Required skill missing | Disable direct-launch card; automated launch becomes `Needs You`. |
| Required source disconnected | Disable only when the mode cannot fulfill its core promise without it; otherwise model it as optional. |
| Optional source disconnected | Keep card enabled and say `Works without X`. |
| Mode removed/renamed | Existing sessions continue from snapshot; new/scheduled launches require a valid replacement. |
| Destination host lacks dependency | Transfer remains blocked/Needs You until installed or user chooses another mode. |
| Context source stale | Show freshness and retrieve/refresh through existing policy; never present stale data as current. |

### Conversation evolution

The host, not just the prompt, enforces these cases:

1. **Same goal, deeper detail:** retrieve bounded source detail; do not change mode.
2. **Same goal, adjacent discipline:** load one approved same-session capability.
3. **Different deliverable or context recipe:** offer/start a linked new-mode session.
4. **Different agent owner:** delegate or open the specialist.
5. **External action introduced:** use existing approval gates; the mode selection grants nothing.
6. **User explicitly says stay here:** the agent may discuss the new topic, but cannot gain unavailable capabilities; explain and offer the right handoff.

## Model And Performance Policy

Task modes optimize context regardless of provider. They do not hide a slow model or silently route around user settings.

Precedence:

```text
explicit per-session model/thinking choice
  > saved per-agent choice
  > task-mode recommended thinking level
  > agent default
  > workspace default
```

A focused mode may recommend medium thinking while a Full system mode recommends high. The UI may explain this, but an explicit user choice wins. The launch receipt and session info must show the effective provider, model, and thinking level.

Telemetry per run:

- selected mode and definition revision
- provider/model/thinking level
- initial prompt tokens/characters by component
- skill reads and duplicate reads
- context/source calls before first meaningful response
- time to first model token and first meaningful answer
- adjacent-capability expansions
- linked sessions/delegations
- dependency failures and Full-mode fallback attempts

Do not use wall-clock latency alone as the acceptance gate because providers vary. Measure context and loop reduction directly, then smoke test real response quality.

## Permission, Spend, And Trust Boundary

Task modes are not approvals.

- Selecting Meta does not authorize ad spend.
- Selecting Publish does not authorize a public post.
- Selecting Outreach does not authorize email sending.
- Selecting a paid-source mode does not raise a weekly/single-run cap.
- Loading an adjacent skill cannot register a new source adapter or external mutation tool.
- Delegated work inherits the caller's ceiling and still meets the target agent's own restrictions.
- Existing approval batching remains authoritative; do not add per-call approvals because of task modes.

Any mode-specific UI mentioning a connected account must distinguish `available to read` from `authorized to change`.

## Failure And Edge Cases

1. **Double-click / rapid launch:** session creation is idempotent per launch intent; one user action cannot create duplicate sessions.
2. **Two windows:** once a session launches, host-owned mode state wins and both windows receive the same update.
3. **Card selected, app closed before send:** persist only lightweight draft selection if desired; do not create an active session or scheduled work.
4. **Skill loads twice:** return the existing loaded revision without duplicating prompt content.
5. **Skill revision changes mid-session:** preserve the loaded revision. Offer a new session for the new revision when materially relevant.
6. **Agent asks for an undeclared skill:** deny it and offer the owning agent, Skill Scout, or a supported task mode.
7. **Adjacent skill needs a new source:** deny same-session expansion and offer a linked session/handoff with the required connection named.
8. **Full mode selected by automation accidentally:** validation requires an explicit Full id in the automation definition; no inference from missing values.
9. **Mode context exceeds budget:** deterministic truncation keeps priorities and source references, marks truncation, and retrieves detail on demand.
10. **Prompt injection in context/skill files:** preserve existing instruction/source trust boundaries; context data cannot redefine mode, permissions, or capability inventory.
11. **User changes workspace/campaign:** create a correctly scoped linked session; never carry campaign-private context into another workspace by prompt copy.
12. **Offline/disconnected source:** mode continues only if the source is optional. Required-source cards fail clearly before model work.
13. **Manager misclassification:** display the proposed specialist/mode before visible launch, or include it in a cancellable delegation activity item when background work is appropriate.
14. **Agent deleted or deactivated:** scheduled/delegated launches become `Needs You`; do not route to a vaguely similar agent.
15. **No mode fits:** offer General/Full only if defined; otherwise let the user describe the job and recommend the nearest agent/mode.
16. **Unloaded adjacent skill changes after launch:** revalidate it before loading, use the current canonical revision, and record definition-time versus load-time revision drift. Already loaded instructions remain unchanged.
17. **Hidden delegation reaches an approval:** pause and surface the approval in a visible owning session; do not leave invisible work stalled.
18. **User-edited mode conflicts with a starter update:** keep the user version and surface the upstream change as a reviewable suggestion.

## Implementation Plan

### Slice 0 — shared contract and resolver

- add task-mode metadata types and schema validation
- add deterministic definition revision hashing
- implement one shared resolver used by renderer and server
- persist resolved mode and launch receipt
- preserve legacy no-mode sessions

### Slice 1 — Branding pilot

- add the seven Branding modes
- add the direct-launch card UI and selected-mode chip
- pass only the selected primary skill into `agentSkillSlugs`
- deliver the compact adjacent-capability map
- add prompt/context/token telemetry
- benchmark against the current six-skill launch

Do not migrate every agent until the pilot proves that output quality remains strong while prompt/loop cost drops.

### Slice 2 — capability expansion

- add `load_agent_capability` to the shared session tool registry
- implement backend parity for Claude/Pi/provider paths
- enforce allowlist, revision, idempotency, source/tool/permission rules, and two-expansion limit
- expose append-only activity/receipt state

### Slice 3 — delegation and Artist Manager

- extend `message_agent` with validated `taskModeId`
- add nonblocking Manager focus chips
- add compact manager routing map rather than full specialist skill text/catalog
- preserve visible and background handoff return paths

### Slice 4 — Tier 1 agents

- define, review, and validate each Tier 1 mode table above
- ensure platform/source-specific modes register only their selected active sources
- keep Full modes explicit
- add missing dependency UX

### Slice 5 — automated launch parity

- workflows, automations, Pulse, messaging, deep links, branching, transfer
- saved revision snapshots and pre-execution revalidation
- `Needs You` behavior for missing/changed definitions

### Slice 6 — Tier 2 and cleanup

- add only the Tier 2 selectors supported by measured benefit
- remove broad specialist agent-catalog injection
- remove inactive source instructions
- add duplicate-context-read warnings
- document mode authoring rules for future agents

## Required Tests

### Contract tests

- reject duplicate mode ids
- reject skills/sources outside the agent inventory
- reject multi-skill focused modes without `fullMode`
- hash definition revisions deterministically
- resolve the same mode identically in renderer and server paths

### Session tests

- `agentSkillSlugs` contains only selected primary skills
- resolved mode survives restart, resume, archive/unarchive, branch, and transfer
- existing no-mode sessions do not change
- changing an unlaunched selection creates no ghost session
- active primary mode cannot be silently replaced

### Context tests

- focused Branding mode does not preload the other five skill bodies
- delivered context revisions prevent immediate duplicate reads
- inactive source instructions and full agent catalog are absent from specialist prompts
- context truncation is deterministic and source-linked
- private/stale/campaign-scope rules remain enforced

### Expansion tests

- allowed adjacent capability loads once and records a receipt
- repeated load is idempotent
- third expansion is refused with linked-session guidance
- undeclared skill is refused
- expansion requiring a new source/tool/permission is refused
- provider backends receive the same loaded instructions

### Delegation tests

- `message_agent(taskModeId)` produces the same resolved recipe as direct launch
- conflicting `taskModeId` + `skillSlugs` is rejected
- delegation cannot escalate permission, account access, workspace scope, or spend
- manager does not preload specialist skill bodies

### UX and accessibility tests

- cards work with keyboard and screen reader
- unavailable reason is announced
- rapid clicks create one session
- Full is clearly labeled slower/comprehensive
- manager chips remain optional and the composer works without selection

### Performance and quality gate

Use the same real Branding prompt, same workspace context, same model/provider, and a cold session for both paths.

Ship the pilot only if:

- focused mode reduces initial input/context by at least 50% versus the current all-six-skill launch
- the agent begins meaningful work within two planning/read model rounds
- no unselected skill body is read before it becomes relevant
- a blind output review finds no material loss for the selected job
- selecting Full still produces the intentionally holistic behavior

Wall-clock timing is recorded but not used alone to certify the architecture.

## Acceptance Criteria

This spec is complete when:

1. Branding Agent opens with the approved compact cards and a focused choice preloads only its declared primary capability or coherent focused bundle.
2. The agent knows which adjacent capabilities exist and when to load/delegate them without reading them all.
3. Same-session capability expansion is bounded, host-validated, idempotent, and cannot widen trust.
4. Same-agent card changes apply only to the next input; different-owner or materially different work creates a linked focused session rather than mutating an admitted turn.
5. Artist Manager remains immediately conversational and uses optional umbrella focuses to route/delegate.
6. Every current starter agent has an explicit Tier 1, Tier 2, or no-picker decision.
7. Direct, manager-chat, delegated, workflow, automation, Pulse, messaging, branch, and transfer paths share the same resolver.
8. Legacy sessions retain their original behavior, while mode-enabled sessions preserve immutable per-turn receipts across later focus changes.
9. Missing dependencies fail before expensive model work and never silently select Full.
10. Prompt/context telemetry proves a material reduction without a material quality loss.

## Final Product Principle

The user chooses the job. Artist OS loads the smallest expert brain that can do it well, keeps the rest of the team within reach, and expands only when the work earns the extra context.

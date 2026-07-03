/**
 * Starter SKILL.md templates seeded into the global skills library.
 *
 * Mirrors the agent-definitions starter pattern. Each entry maps to a single
 * SKILL.md written under `~/.agents/skills/<slug>/`. Idempotent: existing
 * SKILL.md files are never overwritten.
 *
 * The creator/meta skills ship as built-ins because they're load-bearing:
 * Concierge and Orchestrator depend on them to translate "make me an agent /
 * automation / workflow" into a structured draft or save.
 */

export interface StarterSkillFile {
  /** Path relative to the skill directory, e.g. `'SKILL.md'` or `'references/foo.md'`. */
  path: string;
  /** UTF-8 file content. */
  content: string;
}

export interface StarterSkill {
  slug: string;
  /** All files belonging to the skill, keyed by relative path. */
  files: StarterSkillFile[];
}

const AGENT_CREATOR_SKILL = `---
name: Agent Creator
description: Builds a new agent through a short conversational interview, then writes the AGENT.md.
tools:
  - create_agent
inputs: A wish for a new agent — anything from one sentence to a full spec.
outputs: A saved agent activated in the current workspace, plus a chat confirmation with a link.
tags: [creator, meta, agents]
---

# Agent Creator

Use this skill when the user wants to **create a new agent**.

## What you're producing

A complete AGENT.md saved at \`~/.agents/agents/<slug>/\`. Mandatory fields:
\`name\`, \`description\`, \`systemPrompt\`. Strongly preferred fields:
\`avatar\`, \`inputs\`, \`outputs\`, \`tags\`, \`permissionMode\`, \`thinkingLevel\`.
Optional: \`skills\`, \`sources\`, \`model\`, \`llmConnection\`, \`greeting\`.

## Minimum interview

Don't ask everything at once. Ask the smallest set you need to draft something:

1. **Purpose** — "What's its job?" (one sentence)
2. **I/O** — "What does it expect as input? What should it produce?"
3. **Voice** — "Cautious, neutral, or opinionated?"

That's enough to draft. Ask follow-ups only when ambiguous.

## Inferring sensibly

Most fields you can infer:

- **Slug** — kebab-case the name. If the slug already exists, the \`create_agent\` tool will suggest a numbered variant (e.g. \`-v2\`).
- **Avatar** — pick a single emoji that matches the job. Don't ask.
- **Permission mode** — default to \`ask\`. Use \`safe\` only for read-only/research roles. Never default to \`allow-all\`; only set it if the user explicitly opts in and understands the risk.
- **Thinking level** — \`medium\` for most agents; \`high\` for research/critique/planning; \`low\` only when latency matters.
- **Tags** — pull 2–4 from the description. Use lowercase, hyphenated.

## System prompt

The system prompt is the agent's persona and operating instructions. Keep it tight (~150–300 words). Include:

1. Identity — who the agent is in one sentence.
2. Inputs and how to handle them.
3. Output format expectations.
4. Constraints (what to avoid, what to never do).
5. Voice notes if the user cared about voice.
6. **Memory scope hint** — one sentence telling the new agent how to choose between \`scope: agent\` and \`scope: user\` when calling \`save_memory\`. The rule: facts about the user themselves (identity, durable preferences, cross-agent knowledge) → \`scope: user\`; facts about how *this specific agent* should collaborate with the user → \`scope: agent\` (the default).

For specialist agents (researcher, writer, coder, critic, etc.), bias the hint toward \`scope: agent\` — most of what they learn is about their own collaboration style. For coordinator/router agents (anything that summons or talks across other agents), bias toward \`scope: user\` — their facts usually generalize.

Show the prompt to the user before saving — don't bury it.

## Bundles (skills, sources)

Don't bundle anything by default. Suggest bundles only when obvious:

- A research-style agent → suggest the user add their web-search tool / source.
- A coder agent → suggest the project's MCP server.
- A writer → suggest a "voice and style" workspace context doc instead.

If the user hasn't activated a relevant skill or source, mention it but don't add a slug that won't resolve.

## The save

Always show a complete draft before saving. The draft has every field
you're going to write. After the user confirms with a clear "yes",
"save it", "looks good", or similar, call:

    create_agent({
      slug: "...",
      metadata: { name, description, avatar, permissionMode, thinkingLevel,
                  inputs, outputs, tags, ... },
      systemPrompt: "...",
      activateInWorkspace: true
    })

After the tool returns success, post a one-line confirmation with a
clickable route link: \`/agents/<slug>\`.

## Refusals / sanity checks

Refuse to create an agent that:

- Has a slug clashing with a built-in (\`concierge\`, \`orchestrator\`) — the tool will reject these.
- Has an empty or single-word system prompt — push for at least the identity sentence.
- Asks for \`permissionMode: 'allow-all'\` without the user demonstrating awareness of what that means.

If the user just wants you to do the job yourself (one-shot), do the job
instead of creating an agent. Creating an agent is for *reusable*
personas the user will run repeatedly.
`;

const AUTOMATION_CREATOR_SKILL = `---
name: Automation Creator
description: Builds a new automation through a short conversational interview, then writes the matcher.
tools:
  - create_automation
inputs: A description of what should fire automatically and what should happen.
outputs: A saved automation activated in the current workspace, plus a chat confirmation with a link.
tags: [creator, meta, automations]
---

# Automation Creator

Use this skill when the user wants to **automate something** — a scheduled
job, a reaction to an external event, or a recurring task.

## What an automation IS

A pairing of a **trigger** (when does this fire?) and one or more
**actions** (what happens when it fires?).

### Trigger types available today

- **SchedulerTick** — cron expression. e.g. "every weekday at 9am" → \`0 9 * * 1-5\`. Optional IANA \`timezone\`.
- **WebhookReceive** — inbound HTTP POST to a unique slug-keyed URL. Requires a unique \`slug\`.
- **FileWatch** — a file/path on disk changes/appears/disappears. Needs \`watchPath\` (and optional \`watchGlob\`, \`watchChangeTypes\`).
- **PollUrl** — a watched URL's response changes. Needs \`pollUrl\` and \`pollIntervalSec\` (min 30).
- **MessageReceive** — inbound chat from an active messaging gateway (Telegram, WhatsApp, etc.).

### Action types

- \`{ type: 'prompt', prompt }\` — spawns a session with the rendered prompt. Optional \`llmConnection\`, \`model\`, \`thinkingLevel\`.
- \`{ type: 'workflow', workflowSlug, triggerInputs? }\` — starts an active saved workflow. \`triggerInputs\` string values may reference \`$CRAFT_*\`.
- \`{ type: 'webhook', url, method?, headers?, body? }\` — sends an outbound HTTP request.

If the user describes something that can't be expressed as one of the
trigger types above, say so plainly — don't fudge a fit. Suggest the
closest available, or recommend opening a feature request.

## Minimum interview

1. **The trigger.** "When should this fire?" — listen for time-based
   ("every morning"), event-based ("when an email arrives"), or
   external-system ("when a GitHub PR is opened") cues.
2. **The action.** "What should happen?" — choose a workflow action when
   the user wants a saved process/handoff chain, or a prompt action for one
   spawned agent session. Get workflow trigger inputs or prompt text,
   including how it should reference the trigger payload.
3. **The slug** — for WebhookReceive only. Otherwise infer a \`name\` from
   the description.

## Templating: \`$CRAFT_*\` env vars

**Important:** automation prompts use **shell-style env-var expansion**
(\`$VAR\` or \`\${VAR}\`), NOT mustache/handlebars syntax. The trigger
payload is exposed as \`CRAFT_*\` env vars at run time.

Always available:
- \`$CRAFT_EVENT\` — event name
- \`$CRAFT_EVENT_DATA\` — full payload as JSON
- \`$CRAFT_SESSION_ID\`, \`$CRAFT_WORKSPACE_ID\`

Common trigger-specific fields:

| Trigger | Use in prompt |
|---------|---------------|
| SchedulerTick | \`$CRAFT_LOCAL_TIME\`, \`$CRAFT_LOCAL_DATE\` |
| WebhookReceive | \`$CRAFT_BODY\`, \`$CRAFT_HEADER_<KEY>\` (e.g. \`$CRAFT_HEADER_FROM\`), \`$CRAFT_QUERY_<KEY>\` |
| FileWatch | \`$CRAFT_RELATIVE_PATH\`, \`$CRAFT_CHANGE_TYPE\` |
| PollUrl | response fields under \`$CRAFT_*\` (check \`$CRAFT_EVENT_DATA\` for the full payload) |
| MessageReceive | \`$CRAFT_FROM\`, \`$CRAFT_TEXT\`, \`$CRAFT_PLATFORM\` |

When in doubt, fall back to \`$CRAFT_EVENT_DATA\` (the full JSON) and let
the workflow or prompt parse it.

## Sanity checks before saving

- If the prompt references an agent (e.g. \`@researcher\`), confirm that
  agent exists. If not, offer to create it via \`agent-creator\` first.
- If using a workflow action, confirm the workflow exists and is active in
  the workspace. The tool refuses missing or inactive workflow slugs.
- For MessageReceive, verify a messaging gateway adapter is active. If
  none is, refuse and explain what needs to be set up.
- Cron expressions must parse — the tool validates via croner before
  writing. Bad cron = clear error back.
- For WebhookReceive, slugs must be globally unique within the
  workspace. The tool returns \`slug-exists\` if you collide.

## The save

Always show a complete draft before saving:

- Trigger type + the matcher's specific fields (cron, slug, watchPath, etc.)
- Each action: type, target workflow or target agent, trigger inputs/prompt text with \`$CRAFT_*\` references shown
- Permission mode for spawned sessions (default \`ask\`)
- Whether it's enabled (default true)

After explicit user confirmation, call:

    create_automation({
      eventName: "SchedulerTick",
      matcher: {
        name: "HN morning digest",
        cron: "0 8 * * *",
        timezone: "America/New_York",
        permissionMode: "ask",
        actions: [{
          type: "prompt",
          prompt: "Summarize today's HN front page in 5 bullets. It's $CRAFT_LOCAL_DATE."
        }]
      }
    })

After success, post a one-line confirmation. For SchedulerTick triggers,
include the next-fire timestamp returned by the tool.

## Refusals

Refuse to create an automation that:

- Uses an unsupported \`eventName\`.
- Has empty \`actions\` or a prompt action with empty \`prompt\` text.
- Has a malformed cron, or (for WebhookReceive) a malformed/duplicate slug.
- Would obviously loop infinitely (an action that fires the same trigger
  again — flag visible cases).

If the user just wants you to do the job once, do it inline instead of
creating an automation. Automations are for *recurring* or
*event-triggered* work.
`;

const WORKFLOW_CREATOR_SKILL = `---
name: Workflow Creator
description: Interviews the user briefly, then drafts a valid WORKFLOW.md for a reusable manual workflow.
tools:
  - list_agents
  - list_workflows
  - get_workflow
  - create_workflow
inputs: A description of a repeatable multi-step agent workflow.
outputs: A confirmed, saved workflow activated in the current workspace, plus a link.
tags: [creator, meta, workflows]
---

# Workflow Creator

Use this skill when the user wants to **create a reusable workflow**: a
fixed sequence of agent steps that can be run repeatedly from the Workflows
UI.

## What you're producing

A complete \`WORKFLOW.md\` file for \`~/.workflows/<slug>/WORKFLOW.md\`.
Use \`create_workflow\` to save it only after showing the complete source draft
and receiving explicit user confirmation. Use \`list_agents\` to verify agent
slugs and \`list_workflows\` / \`get_workflow\` to avoid duplicating an existing
workflow.

Supported frontmatter today:

- Top level: \`name\`, \`description\`, optional \`avatar\`, \`trigger\`,
  \`steps\`, and optional \`outputs\`.
- Trigger: only \`{ type: manual }\` is supported. Optional
  \`trigger.inputs\` drives the run form.
- Trigger inputs: \`name\`, \`type\` (\`string\`, \`number\`, or \`boolean\`),
  optional \`required\`, \`default\`, \`description\`.
- Step: \`id\`, \`agent\`, \`input\`, optional \`description\`,
  \`outputSchema\`, \`timeout\`, \`retries\`, \`onFailure\`, \`completion\`.
- \`completion\`: optional object with \`requireNonEmptyOutput\`,
  \`minOutputChars\`, and \`requireToolUse\`. Use it when a step must produce
  a substantive answer or actually call tools before it can succeed.
- \`onFailure\`: one of \`stop\`, \`continue\`, \`ask\`. \`stop\` fails the run,
  \`continue\` records the failed step and runs later steps, and \`ask\` stops
  until human checkpoint support lands.
- \`outputs\`: optional object that controls the durable output created from a
  run. Use \`mode: final-step\` for normal workflows, choose a \`kind\` such as
  \`document\`, \`report\`, \`code\`, \`image\`, \`video\`, \`audio\`,
  \`dataset\`, \`receipt\`, or \`other\`, and set \`primary.step\` when the final
  deliverable is not the last step.

Unsupported inside \`WORKFLOW.md\` today: native schedule/webhook triggers,
\`when\`, \`humanCheckpoint\`, \`parallelGroup\`, loops, branching, and
sub-workflows. To run a workflow from a schedule, webhook, file watch, poll, or
message, create a separate automation with a \`{ type: 'workflow', workflowSlug,
triggerInputs? }\` action.

## Minimum interview

Ask only what you need to draft:

1. **Outcome** — "What should this workflow produce at the end?"
2. **Run inputs** — "What should you fill in when you click Run?"
3. **Steps and agents** — "Which agents should run, in what order?"
4. **Reliability** — only if needed: "Should any step require tool use,
   a minimum-length answer, a timeout, retries, or structured JSON output?"
5. **Save behavior** — infer a slug, whether to activate in this workspace
   (default yes), and whether this replaces an existing workflow.

If the user already gave enough detail, skip the interview and draft.

## Validity rules

- Slugs and step IDs use lowercase letters, digits, and hyphens only.
- Trigger input names use letters, digits, and underscores, and must not
  start with a digit.
- Every step needs \`id\`, \`agent\`, and non-empty \`input\`.
- Every referenced \`agent\` should exist. Call \`list_agents({ activeOnly: true })\`
  before finalizing. If an agent is missing, either choose an existing agent or
  offer to create it with \`agent-creator\` first.
- Step inputs may reference only declared trigger inputs and earlier steps.
- Valid template tokens are:
  - \`{{trigger.<input_name>}}\`
  - \`{{steps.<previous_step_id>.output}}\`
  - \`{{steps.<previous_step_id>.output.<path>}}\` for structured JSON output
  - \`{{run.id}}\`
  - \`{{run.startedAt}}\`
- No expressions, filters, conditionals, loops, or future-step references.

## Step sizing principle

Prefer **fewer, richer steps**. A workflow step should represent a real handoff
boundary: a different specialist agent, a required tool/source boundary, a
durable intermediate artifact, or a retryable external operation. Do not split
normal reasoning into micro-steps such as "decide next action", "summarize so
far", "choose route", or single-question conversational nodes. If one capable
agent can hold the full procedure in context and produce the result cleanly,
keep that work inside one step.

Most useful workflows have 2-5 substantive steps. Use more only when the user
explicitly needs a longer production line or the artifact/tool boundaries are
real.

## Structured output

Use \`outputSchema\` when a later step needs reliable fields from an earlier
step. Keep schemas simple and include a top-level \`type\`.

Example:

\`\`\`yaml
outputSchema:
  type: object
  required: [summary, priority]
  properties:
    summary:
      type: string
    priority:
      type: string
      enum: [low, medium, high]
\`\`\`

Then later steps can reference \`{{steps.triage.output.summary}}\`.

## Chaining pattern

Design each step as a contract:

- **Producer steps** extract, classify, research, inspect, or generate a
  structured intermediate result. Prefer \`outputSchema\` when another step must
  consume specific fields.
- **Transformer steps** turn earlier outputs into a clearer artifact. Reference
  only earlier steps with \`{{steps.<id>.output}}\`.
- **Finalizer steps** produce the user-facing deliverable. Use
  \`outputs.mode: final-step\` unless the workflow intentionally produces no
  durable output.

Good workflow step prompts include: the exact task, relevant trigger inputs,
previous-step context, output expectations, and failure boundaries. Do not ask
the runner to act like a LangGraph-style router. Split only when a later step
needs a different agent, tool boundary, durable structured output, retry policy,
or separately inspectable artifact.

## Reliability defaults

- Use \`completion.requireNonEmptyOutput: true\` for every meaningful step
  unless empty output is acceptable.
- Use \`completion.requireToolUse: true\` when the step must inspect files,
  sources, browser state, or external systems.
- Use \`completion.minOutputChars\` for reports, drafts, reviews, and plans
  where a one-line answer would be invalid.
- Use \`retries: 1\` for research/tool-heavy steps that may hit transient
  failures.
- Use \`onFailure: stop\` by default. Use \`continue\` only when later steps can
  still produce value without that step's output. Treat \`ask\` as future-facing
  and avoid it unless the user wants a paused checkpoint.

## Draft format

Always show a complete source draft:

\`\`\`markdown
---
name: Customer Feedback Digest
description: Triage feedback, summarize themes, and draft follow-up actions.
avatar: 🧭
trigger:
  type: manual
  inputs:
    - name: feedback
      type: string
      required: true
      description: Raw feedback or support transcript
steps:
  - id: triage
    agent: triager
    input: |
      Classify this feedback and extract the core issue:

      {{trigger.feedback}}
    outputSchema:
      type: object
      required: [category, summary]
      properties:
        category:
          type: string
        summary:
          type: string
    timeout: 300
    retries: 1
    onFailure: stop
    completion:
      requireNonEmptyOutput: true
      minOutputChars: 80
  - id: action-plan
    agent: writer
    input: |
      Draft a short action plan for this category:
      {{steps.triage.output.category}}

      Summary:
      {{steps.triage.output.summary}}
    timeout: 300
    retries: 1
    onFailure: stop
    completion:
      requireNonEmptyOutput: true
      minOutputChars: 120
outputs:
  mode: final-step
  kind: report
  title: Customer Feedback Digest
  primary:
    from: step-output
    step: action-plan
---
# Customer Feedback Digest

Run this when you have raw customer feedback and want a clean action plan.
\`\`\`

## Confirmation and handoff

After showing the draft, ask "Use this as the workflow source?" If the user
confirms, call \`create_workflow\` with:

- \`slug\`: inferred kebab-case slug.
- \`metadata\`: the frontmatter object from the confirmed draft.
- \`body\`: markdown body below the frontmatter.
- \`activateInWorkspace: true\` unless the user says otherwise.
- \`overwrite: true\` only if the tool reports a slug conflict and the user
  explicitly confirms replacing the existing workflow.

After success, post a one-line confirmation with \`/workflows/<slug>\`.
`;

const SOURCE_RECIPE_SKILL = `---
name: Source Recipe
description: "When the user (or another agent) is choosing which sources/tools (MCP servers, APIs, connectors) to bundle into a new agent, asking 'what sources should this agent have,' 'which tools to give it,' 'what's the right tool set for this job,' or generally curating a focused source bundle. Also triggered during agent creation when the source-bundle step is reached. Reads the live source catalog via list_sources and applies curation rules: cap at 3, match to actual job, anti-pairing detection, dormant-source activation suggestions."
tags: [creator, meta, agents, curation, sources]
metadata:
  version: 1.0.0
---

# Source Recipe

Use this skill whenever you are deciding which sources (MCP servers, APIs, local connectors)
to bundle into an agent. The cap is tighter than skills — **3 sources per agent maximum** —
because each source spawns a process and adds tool surface area to every prompt.

## Process

1. **Call \\\`list_sources\\\` with \\\`activeOnly: true\\\`** to see what's actually spawnable in this
   workspace. Sources with \\\`tier: 'global-dormant'\\\` are not returned (you can ask for them
   separately if the user explicitly wants to discover what else is available).
2. **Read the user's intent.** What concrete actions will the agent take? A research agent
   reads sources; a writer agent might not need any; a project-specific agent likely wants
   the project's MCP only.
3. **Match sources to job.** Don't bundle Notion if the agent doesn't read or write
   knowledge. Don't bundle a search source if the agent never searches.
4. **Apply the rules below.** Converge on a final bundle.
5. **Present with reasoning** — for each chosen source, one line on why. For tempting-
   but-rejected sources, one line on why not. The "why not" matters.

## Rules

### Cap: max 3 sources per agent

Each source means a spawned process, more tools in the prompt, more places auth can fail.
Three is enough for most specialists. If you find yourself adding a fourth, ask whether
this is really one role.

### One concrete job, one source set

A research agent gets research sources. A writer gets context sources (or none). A code
agent gets the project MCP. Don't mix tool sets across roles.

### Prefer specific over general

A project's MCP server beats a generic web-fetch source for project work. A scoped API
beats a kitchen-sink one when you only need 10% of the surface.

### Don't bundle dormant globals

If a relevant source is at \\\`tier: 'global-dormant'\\\`, suggest the user activate it first.
Don't include the slug in the bundle until they confirm. The slug won't resolve in the
agent's prompt until it's activated.

### Don't bundle redundant sources

Two web-search sources, two issue trackers, two doc systems — pick one. If the user really
needs both, that's two agents, not one.

### Watch for auth status

A source with \\\`auth: 'none'\\\` or \\\`isAuthenticated: true\\\` is usable. A source needing
auth that isn't authenticated will be in the bundle list but won't actually work. Surface
this — don't silently bundle a non-functional source.

## Illustrative patterns

- **A research agent in a workspace with web-search activated** → just web-search. Maybe
  Notion if the user said they research from notes. That's it.
- **A code-review agent on a project with the project MCP activated** → project MCP. Maybe
  GitHub if reviews require pulling PR context. Cap at 2.
- **A writing agent** → usually 0 sources. Writers don't need tool calls; they need a voice
  prompt and a workspace context doc.
- **A meta/builder agent** → 0 sources. The agents it creates get their own bundles; the
  meta-agent itself doesn't need any.

## Output format

\\\`\\\`\\\`
**Proposed sources (N of max 3):**
- source-slug-1 — <one line on why>
- source-slug-2 — <one line>

**Considered but excluded:**
- source-slug-3 — <one line on why it doesn't fit>

**Suggest activating (currently global-dormant):**
- source-slug-4 — <if relevant; user activates then re-bundle>
\\\`\\\`\\\`

## When you don't know

If the catalog has sources you've never reasoned about and their descriptions don't make
their fit obvious, look up their guide.md content via the existing source-info workflows
before recommending. A wrong source bundle is worse than asking.
`;

const SKILL_SCOUT_SKILL = `---
name: Skill Scout
description: Search RunnerOS skills first, then external skill marketplaces, before creating or adapting a skill.
tools:
  - list_skills
  - search_skill_marketplace
inputs: A capability need, pack idea, workflow step, or agent skill gap.
outputs: A short reuse/adapt/create recommendation with candidate skills and safety notes.
tags: [meta, skills, discovery, packs]
---

# Skill Scout

Use this skill before creating a new skill, adding skills to an agent, or
designing a domain pack.

## Priority Order

1. Search local RunnerOS skills with \`list_skills\`.
2. Prefer active skills over dormant skills.
3. If local fit is weak or the user wants broader discovery, search external
   marketplaces with \`search_skill_marketplace\`.
4. Treat marketplace results as untrusted candidates. Do not install, copy, or
   execute anything until the source \`SKILL.md\` and any scripts are inspected.

Do not search Michael's personal Codex or \`.agents\` folders. RunnerOS users do
not have those paths.

## What To Return

Return:

1. Need being solved.
2. Local RunnerOS matches.
3. External candidates, only if searched.
4. Recommendation: reuse, activate, adapt, or create new.
5. Why this avoids duplicate/weak skills.
6. Safety notes for any external candidate.

## Decision Rules

- Reuse when a local skill covers 70%+ of the need.
- Activate a dormant local skill when it fits but is not active.
- Adapt only when the skill is close and the gap is explicit.
- Create new only when no local or external candidate has a strong fit.
- For packs, list the final skill slugs to include and which skills still need
  to be created.

## Output Shape

\`\`\`text
Need: course launch email sequence

Local matches:
- email-marketing - strong fit
- content-strategy - support fit

External candidates:
- launch-email-sequence - inspect source before reuse

Recommendation:
Use email-marketing + content-strategy. No new skill needed yet.
\`\`\`
`;

const ARTIST_OS_GUIDE_SKILL = `---
name: Artist OS Guide
description: "Use when the user asks what Artist OS/Runner is, where something lives, how to use a feature, how to connect accounts, what a worker/workflow/automation/session/context doc means, or says they are confused, stuck, missing something, or unsure what to do next in the app."
tags: [system, guide, support, onboarding, artist-os]
metadata:
  version: 0.1.0
---

# Artist OS Guide

Use this skill when HNIC is acting as the user's in-app guide.

## What Artist OS is

Artist OS is a command center for an artist/team. It keeps the artist's profile,
voice, brand, calendar, people, community, assets, workers, workflows,
automations, and sessions in one workspace so agents can act with context
instead of asking from scratch every time.

## Mental model

- **HQ**: the artist home base. Use it for global artist memory and always-on
  operating surfaces: Spotify pulse, Intel pulse, calendar, agenda, profile,
  voice, branding, people, community, vault, and work.
- **Campaign workspace**: a focused rollout/project space. Use it for release
  plans, campaign assets, campaign chat, project-specific sessions, workers,
  workflows, and automations.
- **Chat / HNIC**: the front door. Use it when the user does not know which
  worker, workflow, setting, or page they need.
- **Sessions**: saved chats/runs. Agent chats and HNIC chats become sessions.
- **Workers**: specialist agents for a job, like Branding, Comms, Social
  Publisher, Spotify Analyst, YouTube Research, Shopify, Print, Ads.
- **Workflows**: repeatable multi-step processes. A workflow can use multiple
  workers and usually has inputs, steps, and a run history.
- **Automations**: triggers that run when something happens or on a schedule.
- **Connections**: account/API setup for Google, Resend, Spotify, YouTube,
  Shopify, Printify, ads, messaging, and other services.
- **Context docs**: reusable knowledge cards that agents can read, such as
  Profile, Voice, Branding, Community, Calendar, and Artist Intel.
- **Canvas / Outputs**: durable artifacts created by workers: reports, files,
  previews, decks, images, receipts, and visual outputs.

## Navigation map

- **HQ**: global artist dashboard and pulse cards.
- **Plan**: Agenda and Calendar.
- **People**: Network and Community.
- **Vault**: assets and files.
- **Work**: Chat/HNIC, Workers, Workflows, Automations, Sessions.
- **Brain**: artist intel, profile, voice, branding, context docs, memory-like
  artist knowledge.
- **Settings**:
  - Models: AI/model defaults.
  - Connections: API keys, OAuth, Resend, Google, Spotify, commerce, ads.
  - Messaging: phone-style channels like WhatsApp/Telegram.
  - Workspace: folder, working directory, permissions/modes.
  - App: appearance, input, shortcuts, profile preferences.
  - Advanced: memory, labels, server/developer settings.

## How to answer users

1. Translate the user's confusion into a location or next action.
2. Give the shortest path: "Go to X → Y → click Z."
3. If a connection is missing, send them to **Settings → Connections** or
   **Settings → Messaging** for phone channels.
4. If the task belongs to a worker, name the worker and provide a handoff
   prompt.
5. If the task repeats, suggest a workflow or automation.
6. If the issue sounds like a bug, say what should happen, what likely broke,
   and offer to inspect/fix it.

## Common guidance

- "Where do I connect email?" → Community sending uses Resend in
  Settings → Connections → Community Email. Gmail/Google account features live
  under Google/Workspace connections when available.
- "Where do phone messages connect?" → Settings → Messaging.
- "Where did my agent chat go?" → Sessions. Agent chats are saved as sessions.
- "Where do I add fans?" → People → Community.
- "Where do I send fan emails?" → People → Community, then selected segment,
  Send With Resend.
- "Where do I change artist voice?" → Brain/Profile area, Voice page/card.
- "Where do I create a worker?" → Work → Workers → New worker, or ask HNIC.
- "Where do I create a workflow?" → Work → Workflows → Manage/New workflow, or
  ask HNIC to design it.
- "What should be in HQ vs campaign?" → HQ is global artist operating memory;
  campaign workspaces are for a specific rollout/project.

## Tone

Be concrete and calm. Do not overwhelm. Use the user's language. Prefer one
clear path over explaining every option. If the user is frustrated, skip
apologies and solve the navigation/problem directly.
`;

const RUNNEROS_SELF_EDIT_SKILL = `---
name: RunnerOS Self Edit
description: Guides Concierge when the user wants RunnerOS to inspect, edit, verify, and hot-reload its own app code through a configured local repo path.
tags: [system, developer, code, runneros]
metadata:
  version: 0.1.0
---

# RunnerOS Self Edit

Use this skill only when the user asks to change RunnerOS itself: UI fixes,
feature wiring, app behavior, tests, docs, themes, or local developer
workflow.

## Ground rule

Do not guess the repo path. Use the configured self-edit target:
\`developer.selfEdit.repoPath\`, first from the workspace config, then from
the app config. If it is missing or disabled, ask the user to point RunnerOS
at the local repo before attempting edits.

## Before changing code

1. Validate that the repo exists and looks like RunnerOS: \`.git\`,
   \`package.json\`, \`apps/electron\`, and \`packages/shared\`.
2. Check git status and preserve unrelated user changes.
3. Identify the smallest file set that owns the behavior.
4. Prefer existing commands from config:
   \`devCommand\`, \`typecheckCommand\`, \`lintCommand\`, and \`testCommand\`.

## Edit loop

- Make scoped code changes only after reading nearby files.
- Let hot reload handle UI changes when it can.
- If hot reload leaves Electron stale or frozen, restart the app cleanly.
- Run focused tests first, then broader checks when the touched surface is shared.
- Report the result in plain language: what changed, what was verified, and what risk remains.

## Safety line

Never run destructive git commands, delete user files, or push remote changes
without explicit user intent. If the working tree has unrelated edits, work
around them and call out any conflict that blocks the fix.
`;

const RAW_VIDEO_EDITOR_SKILL = `---
name: raw-video-editor
description: Edit user-shot raw video footage into polished clips, reels, shorts, interviews, tutorials, talking-head cuts, BTS edits, podcast clips, and social videos. Use when the user provides existing media files or a footage folder and wants transcript-based cutting, filler removal, captions, color/audio cleanup, or final MP4 exports rather than AI-generated video production.
---

# Raw Video Editor

## Role

Edit existing footage. Do not treat this as a generative video job.

Use this skill for raw phone/camera footage, talking-head clips, interviews, podcasts, BTS/event footage, tutorials, demos, and social cutdowns from longer footage.

Route storyboard-first, AI-generated, or provider-produced video work to Squad or Video Editor Agent instead.

## Legal Note

This workflow is inspired by Browser Use \`video-use\`, which is MIT licensed. If you reuse substantial code from that project, include its MIT copyright/license notice in the shipped bundle. If you only use the workflow idea, write Runner-native code and do not copy their helper implementation.

## Operating Rules

1. Preserve source files. Never overwrite, delete, or destructively modify raw footage.
2. Put outputs in an \`edit/\` folder next to the source media unless the user specifies another working folder.
3. Inspect before editing: list files, run \`ffprobe\`, and identify aspect ratio, duration, audio streams, and likely content type.
4. Transcribe before making speech cuts. Prefer word-level timestamps. Use ElevenLabs Scribe, WhisperX, Whisper, or an available local transcript source.
5. Build a compact edit surface, usually \`edit/takes_packed.md\`, with phrase-level timestamps grouped by source file.
6. Ask for strategy confirmation before rendering: target length, platform/aspect, pacing, must-keep moments, must-cut moments, caption style, and grade direction.
7. Never cut inside a word. Snap cuts to transcript word boundaries when word timestamps exist.
8. Pad cut edges by roughly 30-200ms to avoid chopped syllables.
9. Add short audio fades at cut boundaries to avoid pops.
10. Apply subtitles last so overlays do not cover them.
11. Self-check preview renders before presenting them: cut boundaries, first/last seconds, caption readability, audio pops, aspect framing, and final duration.

## Workflow

### 1. Inventory

Run:

\`\`\`bash
cd tools/raw-video-editor && node bin/raw-video-editor.mjs doctor --json
cd tools/raw-video-editor && node bin/raw-video-editor.mjs inspect <footage-dir> --json
\`\`\`

Create \`edit/\` and write:
- \`inventory.json\` with source files, durations, codecs, dimensions, audio streams.
- \`project.md\` with the user request, working assumptions, and session notes.

Use \`ffprobe\` for objective media facts.

### 2. Transcript Pack

Run when speech-accurate cuts matter and local Whisper is available:

\`\`\`bash
cd tools/raw-video-editor && node bin/raw-video-editor.mjs transcribe <footage-dir> --model base --json
\`\`\`

If speech matters, create:
- \`edit/transcripts/<source>.json\` for raw transcription output.
- \`edit/takes_packed.md\` for the working edit view.

The packed transcript should keep filler words and false starts visible because they are editorial signal.

### 3. Strategy

Before editing, give the user a plain-English plan:
- Intended structure
- Best takes or moments
- Cut style and pacing
- Caption treatment
- Color/audio cleanup
- Target runtime and aspect ratio

Wait for confirmation before rendering anything expensive or time-consuming.

### 4. EDL

Run:

\`\`\`bash
cd tools/raw-video-editor && node bin/raw-video-editor.mjs plan <footage-dir> --max-duration <seconds> --aspect 9:16 --json
\`\`\`

Write \`edit/edl.json\` as the source of truth with \`aspect\`, \`target_duration_s\`, \`segments\`, \`captions\`, and \`grade\`.

### 5. Render

Run:

\`\`\`bash
cd tools/raw-video-editor && node bin/raw-video-editor.mjs render <footage-dir> --out <footage-dir>/edit/preview.mp4 --json
\`\`\`

Use FFmpeg or Runner Video Studio tools. Prefer simple, reliable renders first:
- Extract selected segments.
- Apply light grade/audio cleanup per segment when needed.
- Concatenate.
- Add overlays.
- Burn captions last.
- Export \`edit/preview.mp4\`, then \`edit/final.mp4\` after approval.

### 6. Verify

Before calling the edit done:
- Check output duration with \`ffprobe\`.
- Review every cut boundary when practical.
- Check first 2s, last 2s, and several middle points.
- Confirm captions are readable and not hidden.
- Confirm no audio pops or clipped words.
- If quality is uncertain, say exactly what needs manual review.

## Output

Return final path, preview/final status, runtime, aspect ratio, what was cut, known limitations, and the next suggested edit pass.
`;

export const STARTER_SKILLS: StarterSkill[] = [
  { slug: 'agent-creator', files: [{ path: 'SKILL.md', content: AGENT_CREATOR_SKILL }] },
  { slug: 'automation-creator', files: [{ path: 'SKILL.md', content: AUTOMATION_CREATOR_SKILL }] },
  { slug: 'workflow-creator', files: [{ path: 'SKILL.md', content: WORKFLOW_CREATOR_SKILL }] },
  { slug: 'source-recipe', files: [{ path: 'SKILL.md', content: SOURCE_RECIPE_SKILL }] },
  { slug: 'skill-scout', files: [{ path: 'SKILL.md', content: SKILL_SCOUT_SKILL }] },
  { slug: 'artist-os-guide', files: [{ path: 'SKILL.md', content: ARTIST_OS_GUIDE_SKILL }] },
  { slug: 'runneros-self-edit', files: [{ path: 'SKILL.md', content: RUNNEROS_SELF_EDIT_SKILL }] },
  { slug: 'raw-video-editor', files: [{ path: 'SKILL.md', content: RAW_VIDEO_EDITOR_SKILL }] },
];

export { SYSTEM_GLOBAL_SKILL_SLUGS } from './system.ts';

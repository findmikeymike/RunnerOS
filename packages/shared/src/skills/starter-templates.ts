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

const POD_PRODUCT_STRATEGY_SKILL = `---
name: POD Product Strategy
description: Turn artwork into a sellable print-on-demand product brief with audience, garment, placement, variants, price band, and launch risks.
tags: [pod, print-on-demand, product, strategy]
---

# POD Product Strategy

Use this skill when a design, artwork folder, or product idea needs to become a concrete POD offer.

Return:

1. Audience: who would buy this and why now.
2. Product: recommended garment or product type.
3. Placement: front, back, left chest, sleeve, oversized, or other.
4. Variants: color and size guidance. Keep color sprawl tight.
5. Listing angle: title direction, description angle, tags.
6. Price band: conservative launch range and margin assumptions.
7. Risks: print quality, weak audience, brand fit, platform risk.
8. Decision: launch, hold, revise, or needs human review.

Default stance: simple products beat bloated catalogs. Reject weak products early.
`;

const POD_LISTING_COPY_SKILL = `---
name: POD Listing Copy
description: Write Shopify and POD listing copy, titles, tags, product descriptions, collection blurbs, captions, and landing-page sections.
tags: [pod, copy, listings, shopify]
---

# POD Listing Copy

Use this skill for print-on-demand product copy.

Input rule:

- Prefer real product data: product brief, garment, print placement, colors, price, material, shipping/fulfillment notes, and target buyer.
- If the task is updating an existing Shopify product, fetch or request the current product/handle first.
- Do not write final publish-ready copy from vibes only; mark missing facts.

Copy rules:

- Write clear buyer-facing copy. No vague hype.
- Do not invent product claims, delivery promises, scarcity, or discounts.
- Keep SEO useful but human-readable.
- Separate Shopify product copy, social captions, and internal notes.
- Include a short reason for each title or angle.
- Ban empty hype: "high-quality", "premium", "best-in-class", "amazing", "perfect", "revolutionary", "game-changing".
- Use clean Shopify HTML for full descriptions. No inline styles.

Shopify HTML shape:

\`\`\`html
<div class="product-description">
  <p class="product-hook">One concrete opening sentence.</p>
  <p class="product-body">Two or three sentences on buyer, feeling, use, or identity.</p>
  <ul class="product-features">
    <li>Feature or fit note.</li>
    <li>Print/product detail.</li>
    <li>Care, styling, or collection fit.</li>
  </ul>
  <p class="product-cta">Subtle closing line.</p>
</div>
\`\`\`

SEO/PDP checks:

- Title should be readable and include the core product/search phrase.
- Description should support Product/Offer schema facts when the storefront has them.
- Image alt text should describe the design and product, not keyword-stuff.
- Category/collection fit should be explicit.
- If variants/colors create duplicate pages, recommend canonical/category handling instead of writing duplicate copy.

Default output:

1. Product title options.
2. Short description.
3. Full product description.
4. SEO title/meta description.
5. Image alt text.
6. Tags and collection fit.
7. Social caption variants.
8. Missing facts and approval notes.
`;

const POD_PRICING_MARGIN_SKILL = `---
name: POD Pricing Margin
description: Price POD products conservatively using product cost, shipping assumptions, marketplace fees, discount room, and contribution margin floors.
tags: [pod, pricing, margin, commerce]
---

# POD Pricing Margin

Use this skill before recommending a live price or price change.

Rules:

- Never recommend pricing below contribution floor.
- State assumptions when costs, shipping, or fees are missing.
- Leave room for discounts and bundles when possible.
- Treat ad spend as CM2, not product gross margin.
- Mark every live price change as approval-required.

Margin waterfall:

\`\`\`text
Gross revenue
- discounts/coupons
- returns/refunds allowance
= net revenue
- product COGS
= gross profit
- outbound shipping or shipping subsidy
- payment processing fees
- marketplace/platform fees
- packaging/materials if known
= fulfillment-adjusted gross profit
- attributed marketing spend
= contribution margin
- allocated overhead if needed
= operating profit estimate
\`\`\`

Decision rules:

- Use contribution margin for scale decisions, not gross margin alone.
- If a product is single-item low AOV, flag cold ads as risky unless CM supports expected CPA.
- Reconcile cost assumptions monthly or whenever provider/product costs change.
- Recommend bundles, premium garment options, or cross-sells when single-SKU economics are weak.
- Show price floor, conservative launch price, and stretch price.

Return:

1. Known costs.
2. Unknown assumptions.
3. Margin waterfall.
4. Price floor.
5. Recommended launch price.
6. Bundle/discount room.
7. Contribution margin estimate.
8. Approval-needed changes.
`;

const POD_CONTENT_CALENDAR_SKILL = `---
name: POD Content Calendar
description: Turn POD products into daily social hooks, captions, carousel concepts, short-video briefs, and posting priorities.
tags: [pod, social, content, growth]
---

# POD Content Calendar

Use this skill when live or planned products need organic content.

Calendar rules:

- Start with 2-4 weekly themes: product, customer identity, proof/use case, behind-the-design, trend/reactive.
- Map source assets to multiple posts instead of starting from scratch every time.
- Every calendar item needs: date, platform, theme, product/source, format, owner, status, CTA, and asset need.
- Include cross-post notes when one idea becomes a TikTok, Reel, Short, carousel, or X post.
- Reserve open slots for trends, launches, and customer proof. Do not overbook.
- Match platform mix to the product and audience. Do not post everywhere by habit.
- This skill plans content. It does not dispatch live posts.

Return:

1. Product/context summary.
2. Weekly themes.
3. Calendar entries as markdown table or YAML.
4. Hooks and captions.
5. Carousel frame outlines.
6. Short-video briefs.
7. Cross-post plan.
8. Capacity/open-slot notes.
9. Posting approval packet.

Keep content tied to product URLs, collection themes, or business goals. Do not generate spammy volume just to fill a calendar.
`;

const POD_GROWTH_REVIEW_SKILL = `---
name: POD Growth Review
description: Review POD sales, listings, content output, traffic, and margin signals to produce daily/weekly next actions.
tags: [pod, analytics, growth, review]
---

# POD Growth Review

Use this skill for daily and weekly print-on-demand business reviews.

Review hierarchy:

- Sales: orders, revenue, AOV, refunds, product/channel mix.
- Catalog: new listings, drafts, stuck launches, low-margin SKUs, out-of-stock/provider drift.
- Content: posts shipped, platforms, winners, misses, asset bottlenecks.
- Traffic: Shopify sessions, product-page conversion, add-to-cart, checkout completion when available.
- Economics: gross margin, fulfillment-adjusted margin, contribution margin, ad spend exposure.
- Operations: failed automations, missing approvals, blocked credentials, broken receipts.

Rules:

- Separate signal from noise. One sale is a clue, not proof.
- Flag products that need refresh, bundle, price change, more content, or pause.
- Any price, ad, listing, product, or publishing change is approval-required.
- Prefer next actions with owners and workflow names.

Return:

1. What launched.
2. What sold or got signal.
3. What content shipped.
4. What stalled.
5. Winners.
6. Losers.
7. Margin/watchlist issues.
8. Next product/content ideas.
9. Workflow recommendations.
10. Approval-needed actions.

Judge the business by profitable repeatable velocity, not vanity automation.
`;

export const STARTER_SKILLS: StarterSkill[] = [
  { slug: 'agent-creator', files: [{ path: 'SKILL.md', content: AGENT_CREATOR_SKILL }] },
  { slug: 'automation-creator', files: [{ path: 'SKILL.md', content: AUTOMATION_CREATOR_SKILL }] },
  { slug: 'workflow-creator', files: [{ path: 'SKILL.md', content: WORKFLOW_CREATOR_SKILL }] },
  { slug: 'source-recipe', files: [{ path: 'SKILL.md', content: SOURCE_RECIPE_SKILL }] },
  { slug: 'skill-scout', files: [{ path: 'SKILL.md', content: SKILL_SCOUT_SKILL }] },
  { slug: 'runneros-self-edit', files: [{ path: 'SKILL.md', content: RUNNEROS_SELF_EDIT_SKILL }] },
  { slug: 'pod-product-strategy', files: [{ path: 'SKILL.md', content: POD_PRODUCT_STRATEGY_SKILL }] },
  { slug: 'pod-listing-copy', files: [{ path: 'SKILL.md', content: POD_LISTING_COPY_SKILL }] },
  { slug: 'pod-pricing-margin', files: [{ path: 'SKILL.md', content: POD_PRICING_MARGIN_SKILL }] },
  { slug: 'pod-content-calendar', files: [{ path: 'SKILL.md', content: POD_CONTENT_CALENDAR_SKILL }] },
  { slug: 'pod-growth-review', files: [{ path: 'SKILL.md', content: POD_GROWTH_REVIEW_SKILL }] },
];

export { SYSTEM_GLOBAL_SKILL_SLUGS } from './system.ts';

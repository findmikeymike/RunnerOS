---
status: implemented
implementation_status: development-acceptance-verified
owner: codex
created: 2026-09-15
last_verified: 2026-09-16
baseline_commit: 48cd4e1a4
---

# 52 — Builder Agent

## 1. Outcome and scope

Give the artist one clear worker for creating and maintaining reusable agents, workflows, and automations. Artist Manager decides what helps and coordinates existing work; Builder constructs the missing capability. Reuse the app's authoring tools, saved definitions, scheduled-work engine, and permissions.

**Development-stage constraint:** Artist OS is still in development. Implement the current source of truth and a small, repeatable transition for the existing development profile. Do not build a released-version compatibility framework, support speculative historic versions, or create a parallel legacy Builder system. Preserve Michael's saved agents, custom instructions, chats, workflows, schedules, files, and connections. Development status is not permission to reset data.

Implemented on canonical `main` in `5a98c0a58`, with live-discovered Active work corrections in `3d8cdc250`. Automated checks and bounded development-profile acceptance passed September 16 under the user’s explicit goal instruction. Exact evidence and verification limits are tracked in the audit; this is not packaged/public-release certification. External publishing and spending remain outside acceptance. Evidence baseline: [Builder audit](../../audits/builder-agent-2026-09-15.md). Current finishing tracker: [September 14, item 3](../../backlog/to-do-sept14.md#3-command-agents-and-division-of-responsibility).

### In this slice

- One built-in `builder` agent, displayed as **Builder**.
- Create and revise agents and sequential workflows using existing definition tools.
- Create, inspect, revise, pause and resume supported automations, including tracked agent/workflow jobs.
- Discover and choose existing skills, sources, workers and workflows before building.
- Focused Manager/Assistant handoffs and removal of conflicting stock authoring instructions.
- Current-profile transition, automated checks, and live end-to-end acceptance.

### Outside this slice

- New workflow branching, loops, parallel steps, sub-workflows or human-checkpoint engine.
- A visual automation builder or new navigation page.
- Building new integrations/MCP servers, acquiring credentials, installing arbitrary packages, or editing Artist OS application code.
- A general custom-skill authoring/import subsystem. Existing skill discovery and bundling are included; a proven missing skill can be proposed with a clear unsupported boundary.
- Automatic invention/installation of workers from Signals; recurring opportunity scanning remains separate.
- Wholesale Manager focus redesign, Branding/World Builder consolidation, Campaign Assistant implementation.
- Shared-destination coordination across concurrent workers, V2 profile enrichment and conversational background proposals remain parked.

## 2. Product decisions

| Area | Contract |
| --- | --- |
| Identity | New `builder` definition; do not rename Orchestrator or reuse its conversations. |
| Placement | Foundational worker in HQ and Campaigns, beside Assistant/Manager/Anything Agent. No new sidenav item; not a Lab default in this slice. |
| Focuses | General, Agents, Workflows, Automations. General accepts ordinary requests; a focus click is optional. |
| Default permission | `ask`; never default to allow-all or add external side effects to trusted tools. |
| Manager | Strategy, prioritization, delegation, scheduling an existing worker/workflow, answering tracked-work input requests. |
| Builder | Reusable definition construction and maintenance, including trigger configuration and validation. |
| Assistant | Setup, secure connections and app guidance; sends construction requests to Builder. |
| Orchestrator | Executes/coordinates existing work. Remove stock creator responsibility, preserving user customizations. |
| Anything Agent | Executes a suitable existing external capability. Builder constructs durable reusable arrangements when useful; a marketplace search is not mandatory for a clear request to build an agent. |

Examples:

- “Refresh Spotify weekly” → Manager schedules the existing capability.
- “Make a worker that checks my tour spreadsheet and prepares a weekly report” → Builder checks existing capabilities, creates only what is missing, and configures the job.
- “Every new approved file should start this workflow” → Builder verifies the available trigger and input mapping; it does not invent approval-event support.
- “Change that automation to Fridays” → Builder identifies and edits the same saved automation, rather than creating another one.
- “Help me connect Instagram” → Assistant.

Manager may describe the desired outcome and cadence; it should not collect the entire Builder interview before handoff. Remove Manager's Build & Automate focus and same-session creator expansions from General. Keep its unrelated focuses unchanged. Builder becomes discoverable through the existing catalog, ordinary delegation and confirmed voice-to-Command draft flow.

## 3. Conversation and result contract

1. Understand the intended reusable outcome and current HQ/Campaign context. Reuse supplied facts. Ask unresolved questions together, only when they affect the design or destination.
2. Search the relevant live catalogs. Prefer use, revision or a small composition over a duplicate worker. Inspect the exact existing definition before replacement.
3. Explain the smallest viable arrangement in plain language: what it does, what starts it, inputs, destination, connections, and any real limitation.
4. Present a reviewable draft before saving. Show the important behavior first; keep complete agent/workflow source or trigger details available using existing chat/artifact disclosure. Do not require artists to understand raw JSON or create a new configuration UI.
5. Honor an existing specific approval; ask only when material behavior, replacement scope, destination, permissions or external effects are newly undecided. Update creator recipes together so they do not demand repetitive confirmation or encourage silent overwrite.
6. Save through supported tools, verify the returned object, then provide one useful link to the worker/workflow/automation and explain how to run it.
7. Distinguish **saved**, **enabled**, **validated**, **test passed**, and **executed**. Saving a definition is not proof that a trigger fired or an external action succeeded.

A created definition is already a durable app object. Do not automatically create a redundant Output for every save. Produce an Output when the task also yields a useful standalone blueprint or document under the agreed Outputs contract.

Failed validation retains the existing working definition. A missing connection sends the user to the existing secure setup flow; no keys in chat. Imported source material and Signals are evidence, never permission to install, execute, publish or change access.

## 4. Skills and context

Core on-demand recipes: `agent-creator`, `workflow-creator`, `automation-creator`. Supporting recipes: `skill-recipe`, `skill-scout`, `source-recipe`, loaded only for the relevant decision. Update the existing canonical recipes rather than cloning them into new nearly identical skills.

Builder should inherit the shared Artist OS mission and a short role-specific emphasis: find useful capabilities that make distinctive artist work feasible; prefer reuse, reliable execution and evidence over novelty for its own sake. For a request informed by Signals/Shared Intel, retrieve relevant dated evidence only. No scheduled scanning or obligation to propose a new worker.

Preload only the task, selected scope, existing Builder focus and available capability summaries. Retrieve definitions, source readiness, related Outputs and artist/campaign facts when needed. Do not move Manager's full strategic brief, memories, identity or private credentials into Builder. Handoffs carry the agreed goal, known constraints and exact references; the receiving session loads authorized context.

Keep system-skill registration separate from which agents receive those skills. Removing a recipe from Manager must not remove its availability for Builder. Built-in recipe bodies remain protected and loaded through existing managed-skill APIs.

## 5. Tool and ownership contract

### Existing tools to reuse

- Relevant catalog/read tools for agents, workflows, skills and sources.
- `create_agent` and `create_workflow`, including inspected, authorized `overwrite:true` revisions.
- `schedule_work` for tracked worker/workflow execution, recurrence, input bindings and Calendar placement.
- `create_automation` for supported raw automation actions only, preserving current validators.

Grant Builder `schedule_work` through BOTH backend visibility and host authorization. Preserve Manager access and `supply_work_input`. Do not grant Builder Manager-wide strategic tools, secret-write authority or special user-memory privileges by copying a Manager flag.

For Artist OS stock Manager, Assistant and Orchestrator sessions, remove definition-authoring tools and direct construction guidance; route to Builder. Implement role policy centrally and enforce mutation ownership in host callbacks as well as tool discovery. Do not accidentally revoke an explicitly configured custom agent's existing tools, alter generic RunnerOS, or break dedicated system jobs. Audit all current creator callers before finalizing that policy. This is product routing and supported-tool enforcement, not a claim that unrestricted filesystem/shell access is a security sandbox.

**Required authoring fix:** current `create_agent` replacement does not round-trip every saved field: its exposed metadata omits `taskModes` and routing while the host replaces metadata wholesale. Preserve unexposed fields host-side when applying an authorized edit, or reject a replacement that cannot preserve them. An omitted field must not silently mean delete; explicit removal needs a supported, reviewed operation. Reuse the existing definition storage, not a new versioning system. Test an edited agent with saved focuses, routing and custom metadata.

Agent/workflow edits can affect other workspaces because definitions are global. Before overwrite, state that scope and inspect known references. Never rewrite already queued/running work or silently broaden its permissions. If existing revision behavior cannot preserve that boundary, reject the edit while dependent work is active and return a precise blocker; do not introduce a general versioning engine in this slice.

### Automation maintenance: small new agent-facing surface

Add focused read/edit tools, proposed names `list_automations`, `get_automation`, `update_automation`, reusing the current automation service and UI validation. Confirm name availability at implementation. Avoid a second storage format or direct internal-file editing.

- **List:** current workspace, stable ID, name, trigger summary, enabled state, execution target and last known outcome. Bounded results; no credentials or raw secret-bearing payloads.
- **Get:** stable ID plus current workspace → redacted editable configuration and opaque revision token. Preserve secret references internally. Do not return secret values just to support comparison.
- **Update:** stable ID, expected revision, allowlisted patch and the approved change intent. Support schedule/trigger settings, validated execution inputs, enabled state, title and description within the existing trigger family. For changing trigger families, return unsupported rather than duplicating/recreating silently in this slice.
- A stale revision returns a conflict without changing anything. Builder re-reads and reconciles; never retries the old patch blindly.
- Pause/resume uses update on the same ID. Delete/clone is not required for V1 Builder maintenance.
- Reuse existing workspace/team authorization, mutex, replacement validation, identity preservation and pending-work handling. Share backend logic with UI RPC rather than invoking UI RPC internally or copy-pasting it.
- Changes invalidate/cancel affected queued old-definition work using existing semantics. Report already-running work separately; pausing future triggers is not a claim to stop an in-flight action.
- Treat tracked automations and their scheduled-work records as a coherent operation. On validation failure leave both unchanged. Repeated identical updates must not spawn duplicate runs or duplicate records. Preserve existing retry/recovery mechanisms and test their integration.
- Protected/system-owned Pulse and other app-managed rules retain their current policy. Reject unsupported edits with the existing control's route; Builder is not a bypass.

Do not expose raw generated tracked-work internals for model editing. Reuse the typed `ScheduleWorkExecutionInput`, trigger and input-binding contracts for valid changes. Keep ordinary Manager scheduling on the same existing engine.

## 6. Scope, triggers and execution limits

A Builder session defaults to its originating HQ or Campaign. No silent HQ redirect for a Campaign request. Agent/workflow definitions remain global library objects, activated in the requested workspace; automations and their execution remain in that workspace. Show this distinction before saving shared-definition edits. Cross-workspace mutation is outside this slice; route to the correct workspace if required.

Supported trigger families: schedules, incoming webhooks, file changes, URL changes and incoming gateway messages. Verify prerequisites and existing authentication policy. Never default a webhook to unauthenticated access or silently make a local endpoint publicly reachable.

For tracked workflows, inspect every required input and bind it as `fixed`, `ask`, or supported `trigger` data. No fabricated empty values. Preserve IANA timezones and existing cadence placement; confirm ambiguity around actual requested times.

Workflows remain sequential with manual definition triggers; scheduled work wraps execution. No invented parallel groups, expressions, loops, approval events or human checkpoints. An unsupported request gets a useful supported alternative, clearly labeled.

Validation must not publish, send, spend or operate external accounts. A “test run” is a real run unless the engine actually offers a dry run. Use disposable internal fixtures for acceptance; obtain exact authorization before any real external side effect.

## 7. Development-profile transition

1. Add Builder to source templates, registration/recovery, current HQ/Campaign activation policy, launchpad ordering, capability catalog and handoff targets.
2. Correct creator-skill constants and startup reattachment logic so subsequent launches do not restore old stock Manager/Orchestrator authoring behavior.
3. Use existing exact-stock/recognized-fragment transition helpers where suitable. Handle `legacy:` aliases. Preserve unrelated skills, custom text and deliberate activation/deactivation choices. No blanket overwrite of AGENT.md files.
4. Current development profile may receive one narrowly scoped, idempotent update with recoverable copies of only the definitions/manifests being changed. Re-running it must not duplicate skills, agents or activation entries.
5. Leave past conversations, saved workflow/automation definitions, outputs and account connections intact. Historical chats need not be rewritten. If a customized definition prevents safe automatic adjustment, record that specific conflict rather than guessing or blocking the whole transition.
6. Verify fresh-profile defaults and the current profile after restart. No multi-version customer migration matrix, telemetry system, background cleanup or permanent legacy fallback.

## 8. Implementation sequence

### A. Builder identity and responsibility

Add the template, focused recipes, short specialist guidance, registration and HQ/Campaign availability. Wire catalog/text/voice handoffs and simplify Manager construction routing. Correct startup reattachment and implement the narrow current-profile transition. Keep this slice honest: do not advertise completed automation maintenance before B.

### B. Complete the tool path

Extend Builder scheduling access in both gates. Extract/reuse safe automation reads and replacement logic, add revision-checked maintenance tools, align role filtering and canonical creator recipes. Preserve existing Manager scheduling and UI behavior.

### C. Verify the complete experience

Run focused tests, required repository checks and canonical build. With authorized restart, exercise real provider chat through Builder using disposable definitions and local trigger inputs. Record results in the existing audit, including failures and limits. Do not call Builder complete solely because tool handlers pass tests.

## 9. Acceptance matrix

| Proof | Pass condition |
| --- | --- |
| Discovery | Builder visible once in HQ/Campaign; General usable; no forced wizard; relevant existing solution found before duplication. |
| Agent create/revise | Exact requested behavior, valid skills/sources, correct activation; same target revised without losing existing focuses, routing, unexposed custom fields or duplicating agent. |
| Workflow create/revise | Two real available workers, valid earlier-step input mapping, useful final result; unsupported branching rejected clearly. |
| Scheduled automation | Tracked worker and workflow paths save, show real next-fire state and run once with correct inputs/scope. |
| Event automation | One local file-change fixture triggers once; other trigger mappings/prerequisites get focused automated coverage. No claim of live acceptance for untested external webhooks/messages. |
| Edit/pause/resume | Stable automation ID; stale edit refused; old pending work handled coherently; pause stops future dispatch and resume does not duplicate it. |
| Failures | Missing source, inactive/missing worker, invalid workflow input, wrong workspace and unsupported trigger leave prior working config intact. |
| Manager regression | Ordinary scheduling and `supply_work_input` still work; construction routes to Builder with the agreed brief. |
| Assistant/voice | Setup remains Assistant-owned; voice opens only a confirmed unsent Builder handoff and claims no execution. |
| State preservation | Restart retains objects, connections and customizations; transition rerun makes no extra changes. |
| Tool enforcement | Wrong stock role cannot bypass authoring policy through a direct tool call; custom-agent behavior and non-Artist-OS variant remain as intended. |
| Product truth | User can distinguish save/validation/run outcomes and follow a valid result link; no unsolicited external action or automatic Output spam. |

Completion requires implementation commit(s), relevant automated checks, loaded build identity and recorded live evidence. Public-release certification is separate. Untested trigger providers and new workflow features remain explicitly outside the claim.

## 10. Primary implementation map

- Agent identity/defaults: `packages/shared/src/agent-definitions/{starter-templates,registration,defaults,storage}.ts`.
- Focuses: `packages/shared/src/agent-definitions/task-mode-recipes/manager.ts` and Builder recipe module to add.
- Skill ownership/instructions: `packages/shared/src/skills/{system,starter-templates}.ts`; managed bundle generation if bundled content changes.
- Shared/specialist prompts: `packages/shared/src/agent-prompt/{compose,artist-team-guidance}.ts`.
- Visibility: `packages/shared/src/agent/session-tool-filter-options.ts`; verify every backend adapter uses the same role policy.
- Host callbacks/startup: `packages/server-core/src/sessions/SessionManager.ts`.
- Tool schemas/handlers: `packages/session-tools-core/src/{tool-defs,context}.ts` and `handlers/{create-agent,create-workflow,create-automation,schedule-work}.ts`.
- Existing maintenance: `packages/server-core/src/handlers/rpc/automations.ts` and its existing shared transaction helpers.
- UI placement: `apps/electron/src/renderer/components/app-shell/AgentsLaunchpad.tsx`.
- Voice destination: `apps/electron/src/renderer/lib/artist-manager-voice-focus-prompt.ts` plus current handoff catalog/validation.

No additional product decision blocks starting A. Recheck handler schemas and existing-definition replacement semantics before B; resolve implementation choices within these boundaries rather than expanding the project.

# Builder ownership audit — September 15, 2026

Baseline: canonical Artist OS `main`, `48cd4e1a4`, synchronized with origin. Read-only code and installed-definition audit; no new Builder, app behavior changes, or live Builder acceptance. This document records findings and a proposed implementation boundary, not implementation approval.

## Conclusion

A dedicated Builder is a good fit. Reuse the existing authoring handlers and creator skills. Move detailed authoring responsibility and on-demand recipes out of Manager; retain Manager's ability to discover workers, delegate and schedule existing work. This requires role wiring and safe migration, not merely a new prompt.

## Audit baseline (before implementation)

- Manager (`concierge`) receives Agent Creator, Workflow Creator, Automation Creator, Skill Scout and Source Recipe through `CONCIERGE_SYSTEM_SKILL_SLUGS`. Orchestrator receives the same creator set. `packages/shared/src/skills/system.ts:1` and `packages/shared/src/agent-definitions/starter-templates.ts:175`.
- Manager explicitly authors reusable definitions in its prompt, and exposes those recipes in both General and Build & Automate. `packages/shared/src/agent-definitions/task-mode-recipes/manager.ts:19`.
- These are largely on-demand capabilities, not all full skill bodies preloaded into every conversation. The benefit is clearer responsibility and less conflicting guidance; do not claim a large token saving without measurement. `packages/shared/src/agent-prompt/compose.ts:436`, `packages/shared/src/agent-definitions/task-modes.ts:181`.
- Startup re-adds creator skills to Manager and Orchestrator. Changing templates/cards alone would be incomplete. `packages/server-core/src/sessions/SessionManager.ts:5000`, `packages/shared/src/agent-definitions/storage.ts:926`.
- The installed Manager and Orchestrator contain `legacy:agent-creator` and `legacy:automation-creator` references. Alias resolution exists. Migration must preserve custom instructions and deliberately handle aliases rather than replacing entire saved definitions.
- Canonical creator instructions live in `packages/shared/src/skills/starter-templates.ts`; local Codex/global skill copies differ, particularly around tracked scheduling. Do not copy those older instructions over the app versions.
- Voice Manager cannot execute these operations. It prepares a confirmed unsent Command handoff; Builder should be a valid destination, without pretending the voice conversation built or scheduled anything. `apps/electron/src/renderer/lib/artist-manager-voice-focus-prompt.ts:16`.

## Proposed ownership

| Role | Responsibility |
| --- | --- |
| Builder | Create/revise reusable agents, workflows, automation definitions and triggers; choose suitable existing skills/sources; validate and explain the result. |
| Artist Manager | Decide what helps the artist, delegate construction, run/schedule existing workers and workflows, handle ordinary work-input requests. |
| HQ Assistant | App guidance, connections and setup; route construction requests to Builder. |
| Orchestrator | Coordinate execution; stop acting as a second default definition author. Preserve explicit user customizations. |

Builder's core recipes: Agent Creator, Workflow Creator, Automation Creator. Supporting capabilities load only as needed: Skill Recipe, Skill Scout, Source Recipe. Connection credentials remain in Assistant's existing secure setup flow. Editing the Artist OS application itself is a separate explicit self-edit request, not implied by building an agent.

Builder should inspect existing definitions before creating duplicates. It should receive the agreed goal, intended HQ/campaign destination, relevant capability catalog, and only necessary artist context. It does not need Manager's whole strategy brief by default. Definitions can be global while activation and automation execution are workspace-scoped; the save destination must be explicit.

## Reusable tools and concrete gaps

1. `create_agent` and `create_workflow` already support replacement using `overwrite:true`; reuse them with an inspected, authorized target. Agent definitions are saved globally and optionally activated locally; workflow agent references are validated. Host callbacks: `SessionManager.ts:10559,10862`.
2. `schedule_work` supports tracked agent/workflow jobs, but visibility AND host authorization are currently Manager-only. To let Builder finish automation construction, narrowly grant Builder the required scheduling access while retaining Manager's everyday scheduling. Do not grant all Manager, secret-write or memory privileges. `packages/shared/src/agent/session-tool-filter-options.ts:18`, `SessionManager.ts:561,10787`.
3. `create_automation` appends new entries; there is no equivalent agent-facing safe edit tool. Reuse the existing guarded automation-update service behind a scoped tool, including identity/concurrency validation and queued-work cancellation, before claiming Builder can maintain existing automations. UI RPC implementation: `packages/server-core/src/handlers/rpc/automations.ts:651`.
4. Raw automation creation accepts prompt, webhook and pulse actions, not workflow-run actions. Workflow scheduling must use tracked work, not an invented raw action. `packages/session-tools-core/src/handlers/create-automation.ts:56`, `handlers/schedule-work.ts:69`.
5. Creator tools are broadly registered today, subject to permission mode; removing Manager's skill list is not a technical ownership restriction. Decide and enforce narrow role filtering consistently if Builder is to be the exclusive built-in author. Preserve user-defined agent behavior. `packages/session-tools-core/src/tool-defs.ts:2318,2355,2432`.
6. Builder needs registration, required-definition recovery, HQ/Campaign availability, launchpad placement and catalog/delegation coverage. Current foundational launchpad order is Assistant, Manager, Anything Agent. `packages/shared/src/agent-definitions/registration.ts`, `defaults.ts`, `apps/electron/src/renderer/components/app-shell/AgentsLaunchpad.tsx:1836`.

## Supported limits to communicate honestly

Automation triggers include schedules, incoming webhooks, file changes, URL changes and messaging-gateway messages. Availability depends on their actual host/service setup; creating a rule does not prove a live event will arrive.

Workflow definitions use manual triggers; an external scheduled-work wrapper starts recurring/event-driven runs. The current runner is sequential, without conditional branches, parallel groups or real human checkpoints. `onFailure:ask` is not a working resumable checkpoint. Do not promise arbitrary visual automation logic. `packages/server-core/src/workflows/runner.ts:227,880`.

## Recommended first implementation slice and acceptance

One foundational Builder with three optional focuses: Agents, Workflows, Automations; General routes naturally. Replace Manager's construction instructions with a compact Builder handoff while retaining existing scheduling and strategic judgment. Update startup migration, existing stock definitions, aliases, discovery and both scheduling gates together. Add safe automation maintenance through the existing service rather than editing internal JSON in chat.

Prove: create and revise a disposable agent; create a two-step workflow; wire a supported trigger; edit/pause the same automation without duplication; confirm saved scope and result links; verify after restart. Also prove Manager still schedules an existing worker and supplies requested work inputs, and a failed/missing connection is reported honestly. Builder should distinguish saved, enabled, test-passed and actually executed. Preserve all current artist data and connections; external publishing/spend is not part of this acceptance test.

Broader HQ/Campaign shared-destination coordination, V2 enrichment and conversational background proposals remain parked.


## Implementation and acceptance — September 16, 2026

Status: implementation present on canonical `main`; live acceptance in progress. The original audit above is historical. The user explicitly invoked `$goal` to implement Spec 52 and `$rival` plus fixes at key slices.

### Implemented

- Builder identity and four optional focuses; HQ/Campaign activation and discovery; stock Manager/Assistant/Orchestrator responsibility changes. Manager retains ordinary scheduling and tracked input answers.
- Role filtering and host enforcement, safe agent replacement preserving unexposed fields, pending-definition guards, scoped revision-checked automation reads/edits.
- Shared UI/tool replacement semantics with validation before writes, pause of broken workflows, exact queued-order recovery after partial cleanup failures. No cross-file atomicity claim.
- Narrow stock transition with exact older Manager variants, recoverable originals and activation manifests; custom definitions preserved.
- Live-discovered fixes: creation shortcuts route to Builder, result links use supported workspace-scoped deep links, Pi proxy mutations request approval once, automation reads classified as read-only.

### Review and automated evidence

- Rival slice A found older stock Manager transition and late startup ordering gaps; fixed and regression-tested.
- Rival slice B found pause-readiness and interrupted-cleanup retry holes (including trigger-only edits); fixed. Independent 71 backend checks passed.
- Independent final slice review passed proxy approval, permission classification and transition checks (79 tests). Result-link review verified actual navigation parsers and passed 56 checks.
- Full suite passed 60/60 test processes before live-discovered fixes. A fresh full run after the initial live fixes also passed 60/60 processes; final checks include the later cleanup, link, and schema fixes. Full typecheck and canonical build succeeded; final runtime checks continue.

### Live evidence so far

- Canonical unpackaged Electron, Artist OS variant, existing `~/.artist-os` profile, durable host enabled.
- Builder visible in HQ; General/Agents/Workflows/Automations displayed; normal chat works without a wizard.
- Real provider session `260916-prime-flint` saved and activated `builder-smoke-echo` and `builder-smoke-check` in HQ, revised the same echo worker while preserving routing/settings, and created `builder-smoke-chain` with required token input and earlier-step output mapping.
- Saves were correctly described as saved, not executed. No external actions. Fixtures survived restart.
- The initial restart exposed a missed pre-input-supply Manager stock body; second restart applied the corrected exact-stock transition to `concierge`.
- Same workflow revised in place; timed workflow run `d5c1c625-65f0-4f03-b789-44dbd0c2d42f` completed both steps once, producing `CHECKED: BUILDER_CHAIN_OK`. Timed worker completed once with `BUILDER_AGENT_OK`.
- Workflow execution exposed asynchronous terminal cleanup racing hidden-session deletion. Seven terminal `sendMessage` paths now await cleanup; queued follow-up dispatch remains nonblocking. Independent review passed 61 regression tests / 215 assertions. A post-fix live rerun remains required.
- File automation `8b0947` watched workspace-relative `builder-qa-fixtures/*.txt`, change events only. A single in-place file edit produced exactly one completed tracked run (`260916-fluid-dove`, `BUILDER_FILE_OK`). Absolute paths were rejected by existing policy; tool guidance now states the relative-path requirement. Readback now includes saved change types.
- Weekly automation `9f1fe4` was changed from Friday 09:00 to 10:00 America/Chicago, paused, resumed and verified enabled, then paused again on the same ID. Both QA automations are disabled after testing; no duplicates or future test dispatch remain.
- Final review aligned maintenance descriptions and cron-edit schemas with backend limits. Execution replacement still requires a complete intended execution; read views intentionally omit arbitrary secret-bearing payloads.
- Manager retained its own scheduling tool: a real HQ request scheduled `builder-smoke-echo`, order `hq-work-ff05bc983accb8106967fe93`, and completed once (`260916-fit-swamp`, exact `MANAGER_SCHEDULE_OK`). It correctly named Builder as the construction owner. Manager focus strip no longer includes Build & Automate.
- Homebody Campaign showed Builder once. Its creator shortcut exposed a missing system-recipe resolution exemption; Builder now uses the existing foundational system-skill path. Three Campaign focus-launch cases passed with an empty public skill inventory, preserving Campaign scope and an unsent draft.
- Switching away during a Manager approval exposed a pre-existing UI loss: the workspace change cleared local permission state, while the host retained insufficient data for replay. Pending requests now hydrate from existing scoped session snapshots, stay runtime-only, reject stale snapshots and cross-session responses, and clear on Stop/settlement. 64 focused tests and server/Electron typechecks passed; live recovery remains required.
- All-package typecheck passed after these fixes. The prior full suite passed 60/60 processes; a fresh final run includes the Campaign and approval-restoration changes.
- Loaded corrected Campaign shortcut: Homebody `Create with Builder` opened session `260916-early-maple`, Builder / Agents, with the requested unsent draft and Campaign scope intact.
- Approval recovery passed live for both a request emitted while viewing Homebody and an already-visible HQ approval surviving a second round trip. The original request completed once after approval; no approval leaked into the Campaign.
- Restart idempotence: all 71 snapshotted saved agent definitions, activation manifests and source configuration files remained byte-identical across the next launch. The original 20-file inventory still shows unchanged credentials/connections; only expected activation updates and two pre-existing stock workflow normalizations differ from the initial baseline.
- Manager input supply found sentence-final punctuation rejecting an exact explicit token. The fix checks each raw sentence-ending period independently; rival review caught and closed filename/URL continuation and internal-period exactness holes. Ten tests / 37 assertions pass; current-human/timestamp/origin guards remain intact. The original input request is waiting for the loaded-build retry, with no invented value or duplicate work.
- Result links now render canonical workspace IDs, but the live click exposed a second routing gate: server OPEN_URL recognized only older views and sent automation routes to the external blocker. The passive in-app route allowlist is being aligned; external URL validation remains unchanged.
- Remaining live gates: corrected deep links, post-fix workflow cleanup, Manager input supply and final restart/preservation.

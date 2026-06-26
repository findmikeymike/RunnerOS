# New Pack Builder Agent Brief

Use this when a new agent is helping Michael create specific packs such as
Merch Biz, Online Course, Ads Ops, Video Studio, or other personal operating
bundles.

## RunnerOS In Plain English

RunnerOS is a local Electron/Bun/TypeScript control-plane app for running agent
teams. It combines:

- standalone agents: persistent specialist roles
- skills: reusable instructions/workflows for agents
- sources/tools: connected capabilities like Google Ads, Shopify, files, video,
  messaging, or local CLIs
- workflows: durable multi-step jobs that spawn real agent sessions
- automations: triggers such as schedules, file drops, webhooks, URL polls, or
  messages
- packs: installable bundles that activate the right team/setup for a domain

The goal is not just chat. The goal is an operator system where an orchestrator
can run recurring company work with approval gates.

## Main vs Personal Version

Keep these two lanes separate:

- **Standard RunnerOS / main app:** core product features that normal users
  should get. Pack infrastructure, workflow support, automation primitives,
  safety gates, and general starter packs belong here.
- **Personal Ops version:** Michael's operator setup. Domain packs like Merch
  Biz or Online Course should be installed and tested here first as Michael's
  working company OS.

Do not confuse product/repo lanes with pack install variants:

- `main` pack variant = safe defaults for normal users.
- `personal-ops` pack variant = Michael/operator-flavored setup.
- `runner-os-core` pack variant = internal build/debug setup.

Those variants live inside a pack. They are not separate repos.

## Pack Mental Model

A pack is a setup kit. It does not run by itself.

Pack = "install this department/team setup."

Workflow = "repeatable multi-step job."

Automation = "trigger that runs something."

Agent = "worker/persona."

Orchestrator = "manager that chooses, proposes, and queues work."

Install flow:

1. User or orchestrator chooses a pack.
2. Runner shows an install plan.
3. User approves.
4. Runner activates agents, skills, sources, and workflows.
5. If the pack declares automations, they are returned as setup-required.
6. Orchestrator proposes concrete schedules/triggers.
7. User approves.
8. Orchestrator calls `create_automation`.

Important: pack install must not silently start background crons or external
actions.

## Current Pack Capability

Packs can declare:

- `agents`
- `skills`
- `sources`
- `workflows`
- `automations`
- `guardrails`
- `profiles` / install variants
- `dependencies`
- runtime startup context

The installer activates agents, skills, sources, workflows, and records the
active pack. Declared automations are exposed as `requiresSetup.automations`
and must be converted into real `create_automation` calls after approval.

Workflow-backed automations are supported:

```json
{
  "type": "workflow",
  "workflowSlug": "daily-company-brief",
  "triggerInputs": {
    "time_horizon": "today",
    "source_payload": "$CRAFT_EVENT_DATA"
  }
}
```

Automation history records both workflow start and final completion state.

## Key Files

Pack spec:

- `docs/packs/01-spec.md`

Pack starter definitions:

- `packages/shared/src/packs/starter-templates.ts`

Pack parser/storage/installer:

- `packages/shared/src/packs/parser.ts`
- `packages/shared/src/packs/storage.ts`
- `packages/shared/src/packs/installer.ts`
- `packages/shared/src/packs/types.ts`

Pack session tools:

- `packages/session-tools-core/src/handlers/packs.ts`
- `packages/session-tools-core/src/tool-defs.ts`
- `packages/session-tools-core/src/context.ts`

Runtime wiring:

- `packages/server-core/src/sessions/SessionManager.ts`

Workflow templates:

- `packages/shared/src/workflows/starter-templates.ts`
- `packages/shared/src/workflows/storage.ts`

Automation action support:

- `packages/shared/src/automations/types.ts`
- `packages/shared/src/automations/schemas.ts`
- `packages/shared/src/automations/validation.ts`
- `packages/shared/src/automations/handlers/workflow-handler.ts`
- `packages/session-tools-core/src/handlers/create-automation.ts`

Creator skill guidance:

- `docs/creator-skills/02-automation-creator.md`
- `docs/creator-skills/04-workflow-creator.md`
- `packages/shared/src/skills/starter-templates.ts`

Michael's installed local automation skill:

- `/Users/michaelb.williams/.agents/skills/automation-creator/SKILL.md`

If local Codex skills/agents are edited, rebuild:

```bash
python3 /Users/michaelb.williams/.codex/scripts/rebuild_codex_catalog.py
```

## How To Create A New Domain Pack

For a pack like Merch Biz or Online Course, build the domain as an operating
bundle:

1. Define the business outcome.
2. Define departments/roles needed.
3. Pick or create agents.
4. Run `skill-scout` before creating skills. Search local RunnerOS skills first,
   then external candidates like SkillsMP only if local fit is weak.
5. Pick or create skills.
6. Pick sources/tools needed.
7. Define workflows that produce useful artifacts.
8. Define suggested automations, but do not auto-enable them.
9. Define guardrails and external dependencies.
10. Add the pack to starter templates if it belongs in the product, or install it
   only into Personal Ops if it is Michael-specific.

Example pack shape:

```yaml
---
name: Merch Biz
description: Operate merch research, product drops, listings, content, and ads.
version: 0.1.0
category: commerce
owner: runner
tags: [merch, ecommerce, content, ads]

agents: [orchestrator, researcher, writer, critic, ads-agent, shopify-agent]
skills: [customer-research, competitor-profiling, ad-creative, content-strategy]
sources: [shopify, google-ads, youtube-research]
workflows: [merch-drop-research, product-listing-draft, weekly-merch-review]
automations: [weekly-merch-review]

guardrails:
  permissionMode: ask
  requiresApprovalFor: [publish-content, spend-money, budget-change, external-write]

profiles:
  main:
    description: Safe defaults for normal Runner users.
    permissionMode: ask
  personal-ops:
    description: Michael's merch operator setup.
    permissionMode: ask
---
# Merch Biz

Operating notes, cadence, dependencies, and approval policy.
```

## What The Next Agent Should Avoid

- Do not make packs auto-run background work on install.
- Do not mix Michael-only business config into the standard product unless it is
  generalized.
- Do not hard-code local absolute paths for normal users.
- Do not call a pack "installed and running" unless its automations were created
  and approved.
- Do not create near-duplicate agents/skills if existing ones can be reused.
- Do not search Michael's personal `.codex` or `.agents` skill folders for
  product behavior. Normal RunnerOS users only get RunnerOS-shipped skills.
- Do not bypass approval for sending, publishing, account mutation, ad spend,
  budget changes, production changes, or deletes.

## Good Deliverable For Each New Pack

For each requested domain pack, deliver:

- pack name and slug
- purpose in one sentence
- agents included
- skills included
- sources/tools included
- workflows included or needed
- recommended automations with exact trigger/action drafts
- dependencies/credentials needed
- guardrails
- whether it belongs in standard RunnerOS or Personal Ops only
- tests/typechecks run

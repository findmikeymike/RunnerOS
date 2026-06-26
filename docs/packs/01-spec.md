# Packs

Packs are installable operating bundles. They do not replace agents, skills,
sources, workflows, or automations. They activate a known-good set of those
pieces together, with install variants and guardrails.

The design follows the useful part of Hermes/PAI: one coherent operating
system made from deterministic files, lifecycle rules, memory/context, tools,
skills, and specialist agents. RunnerOS keeps each primitive separate, then
uses packs as the bundle layer.

## Storage

Global pack library:

```text
~/.agents/packs/<slug>/PACK.md
```

Workspace activation manifest:

```text
<workspace>/.runner-packs.json
```

`PACK.md` is source of truth. The manifest only says which pack/install variant
is active in a workspace.

## `PACK.md`

```yaml
---
name: Ads Ops
description: Operate paid acquisition with approval-gated campaign work.
version: 1.0.0
category: growth
owner: runner
tags: [ads, growth, approvals]

agents: [ads-strategist]
skills: [google-ads]
sources: [google-ads]
workflows: [campaign-brief]

guardrails:
  permissionMode: ask
  requiresApprovalFor: [campaign-create, budget-change]
  blockedTools: []

profiles: # API field name; user-facing concept is "install variants"
  main:
    description: Safe defaults for normal users.
    permissionMode: ask
  personal-ops:
    description: Operator-flavored install variant.
    agents: [operator]
    workflows: [daily-growth-review]
    permissionMode: ask
  runner-os-core:
    description: Product/debug install variant.
    sources: [runner-docs]

dependencies:
  - kind: external
    slug: google-ads-oauth
    required: true
    note: Google Ads OAuth credentials must be connected before writes.
---
# Ads Ops

Human notes, setup expectations, and operating conventions live here.
```

## Install Variants

Install variants let one pack activate with different defaults without
pretending to be a repo/product lane:

- `main`: general RunnerOS user defaults.
- `personal-ops`: operator-flavored defaults.
- `runner-os-core`: product/debug defaults.

Top-level activation is always included. A variant adds to it.

These are not the same thing as separate app repos/worktrees like main app,
Personal Ops, or RunnerOS Core. Those remain product/version boundaries.

## Install Behavior

The installer:

1. Loads the pack.
2. Builds an install plan for the selected install variant.
3. Validates referenced agents, skills, sources, and workflows exist.
4. Reports missing dependencies before changing workspace state.
5. Activates each primitive through its existing storage API.
6. Records the active pack/install variant in `.runner-packs.json`.

Automations may be declared as recommended cadence, but pack install does not
silently enable background behavior. Agents can now request approved
`create_automation` calls, including workflow-backed actions, after showing the
user the trigger, schedule/path/slug, workflow target, trigger inputs, and
permission mode.

## Why Packs Matter

An orchestrator can choose agents and tools, but it should not have to guess
the operating system for a domain. Packs make that domain explicit:

- which team is active
- which tools are allowed
- which workflows matter
- which credentials are missing
- which approval rules apply
- which install variant is being used

That is the Hermes lesson: deterministic infrastructure first, then agents.

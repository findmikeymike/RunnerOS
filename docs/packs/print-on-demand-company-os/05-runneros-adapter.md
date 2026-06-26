---
status: draft
owner: agent
last_verified: 2026-06-26
source_of_truth: false
---

# RunnerOS Adapter

This maps the portable Print-On-Demand Company OS to RunnerOS primitives.

## Pack Slug

```text
print-on-demand-company-os
```

## Install Variant Defaults

### `main`

Safe user-facing setup.

- permission mode: `ask`
- installs agents, skills, workflows, sources
- returns automations as setup-required

### `personal-ops`

Michael operator setup.

- permission mode: `ask`
- same core pack
- stronger startup context around daily business loops
- suggested design inbox path: `~/RunnerOS-POD/inbox/designs`

### `runner-os-core`

Internal debug setup.

- permission mode: `ask`
- focuses on testing pack install, workflow triggers, and source wiring

## RunnerOS Agents To Seed

New:

- `pod-ops-orchestrator`
- `pod-intake-agent`
- `pod-product-strategist`
- `pod-catalog-manager`
- `pod-content-director`
- `pod-growth-analyst`

Existing:

- `print-agent`
- `shopify-agent`
- `social-publisher`
- `hypermotion-agent`
- `video-editor-agent`
- `ads-agent`
- `researcher`
- `writer`
- `critic`
- `orchestrator`

## RunnerOS Skills To Seed

New:

- `pod-product-strategy`
- `pod-listing-copy`
- `pod-pricing-margin`
- `pod-content-calendar`
- `pod-growth-review`

Existing:

- `printify-commerce`
- `print-product-assets`
- `shopify-commerce`
- `social-publishing`
- `ad-creative`
- `content-strategy`
- `customer-research`
- `competitor-profiling`

## RunnerOS Sources

Use existing source slugs:

- `printify`
- `shopify`
- `printing-press-social`
- `hypermotion`
- `video-studio`
- `google-ads`
- `meta-ads`

## RunnerOS Workflows To Seed

- `pod-design-intake`
- `pod-product-launch`
- `pod-content-batch`
- `pod-daily-social-publishing`
- `pod-daily-business-review`
- `pod-weekly-growth-review`

## Pack Metadata Draft

```yaml
---
name: Print-On-Demand Company OS
description: Operate a print-on-demand apparel business from design drops through product launch, Shopify, content, social posting, and growth review.
version: 0.1.0
category: commerce
owner: runner
tags: [pod, print-on-demand, printify, shopify, apparel, content, social]

agents:
  - pod-ops-orchestrator
  - pod-intake-agent
  - pod-product-strategist
  - pod-catalog-manager
  - pod-content-director
  - pod-growth-analyst
  - print-agent
  - shopify-agent
  - social-publisher
  - hypermotion-agent
  - ads-agent
  - researcher
  - writer
  - critic

skills:
  - pod-product-strategy
  - pod-listing-copy
  - pod-pricing-margin
  - pod-content-calendar
  - pod-growth-review
  - workflow-creator
  - automation-creator
  - customer-research
  - competitor-profiling
  - printify-commerce
  - print-product-assets
  - shopify-commerce
  - social-publishing
  - content-strategy
  - ad-creative
  - google-ads
  - hyperframes

sources:
  - printify
  - shopify
  - printing-press-social
  - hypermotion
  - video-studio
  - google-ads
  - meta-ads

workflows:
  - pod-design-intake
  - pod-product-launch
  - pod-content-batch
  - pod-daily-social-publishing
  - pod-daily-business-review
  - pod-weekly-growth-review

automations:
  - pod-design-drop-intake
  - pod-daily-business-review
  - pod-content-batch
  - pod-daily-social-publishing
  - pod-weekly-growth-review

guardrails:
  permissionMode: ask
  requiresApprovalFor:
    - external-write
    - publish-content
    - product-create
    - product-update
    - price-change
    - spend-money
    - delete-data
  notes:
    - Pack install must not silently enable automations.
    - Live Printify, Shopify, social, and ad actions require approval.
---
```

## Implementation Files

RunnerOS wiring should happen in:

- `packages/shared/src/agent-definitions/starter-templates.ts`
- `packages/shared/src/skills/starter-templates.ts`
- `packages/shared/src/workflows/starter-templates.ts`
- `packages/shared/src/packs/starter-templates.ts`

Add tests near existing starter-template, parser, installer, and workflow storage tests where practical.

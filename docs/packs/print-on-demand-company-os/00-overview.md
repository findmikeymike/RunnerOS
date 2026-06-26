---
status: draft
owner: agent
last_verified: 2026-06-26
source_of_truth: false
---

# Print-On-Demand Company OS

Portable operating spec for an installable autonomous print-on-demand business pack.

## Goal

Michael makes or approves the designs. The system handles the repeatable business work:

- ingest new artwork from a watched folder
- turn artwork into product briefs
- create Printify product plans and drafts
- prepare Shopify products, collections, prices, and landing-page copy
- generate daily social content
- post or schedule approved social assets
- track sales, listings, content output, and growth signals
- surface approvals only when business risk is real

This is not a single mega-agent. It is a small operating team with workflows, triggers, receipts, and approval gates.

## Design Principle

Build the business brain as portable files first:

- agents
- skills
- workflows
- automation recipes
- approval policy
- handoff/message contracts

RunnerOS installs those files through its pack system. Codex or Hermes should be able to reuse the same logic through adapters.

## V1 Scope

Start with the core loop:

```text
design file dropped
-> intake and QA
-> product strategy
-> Printify product draft/plan
-> Shopify listing draft/plan
-> content plan
-> approval packet
```

Then add the growth loop:

```text
live products
-> daily content batch
-> social publishing plan
-> performance review
-> winner expansion ideas
```

## Out Of Scope For V1

- customer support automation
- compliance/legal agent
- Etsy/TikTok Shop/Amazon Merch launch
- autonomous ad spend changes
- full external event database
- silently enabling automations on install

These are later modules once the first loop works reliably.

## Pack Modules

| Module | Purpose |
|---|---|
| Catalog | intake, QA, product strategy, Printify, Shopify |
| Growth | content direction, social publishing, creative batching |
| Analytics | daily and weekly sales/listing/content review |
| Control | orchestrator, approvals, receipts, retry/stuck-work checks |

## Guardrails

Require approval for:

- uploading artwork to external services
- creating/updating/publishing Printify products
- creating/updating/publishing Shopify products or pages
- posting/scheduling social content
- price changes
- ad spend
- deleting/archive actions

Allow without approval:

- local file inventory
- image QA
- product plan drafts
- listing copy drafts
- content ideas
- report generation
- dry runs

## Success Criteria

V1 is useful when a new design drop can produce:

- asset QA summary
- product brief
- Printify draft action packet
- Shopify draft action packet
- content batch
- approval checklist
- durable receipt of what happened

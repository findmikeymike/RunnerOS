---
status: draft
owner: agent
last_verified: 2026-06-26
source_of_truth: false
---

# Workflows

These are the first workflows the pack should install.

## `pod-design-intake`

Trigger:

- manual
- file watch on design inbox

Inputs:

- `asset_path`
- `designer_notes`
- `target_collection`

Steps:

1. `pod-intake-agent`: inspect file/folder, dedupe, QA.
2. `pod-product-strategist`: create product brief.
3. `critic`: review product brief for weak audience, weak offer, or print risks.

Output:

- design intake report
- product brief
- continue/hold recommendation

## `pod-product-launch`

Trigger:

- manual
- after approved intake report

Inputs:

- `product_brief`
- `asset_path`
- `shopify_collection`
- `printify_shop`

Steps:

1. `pod-catalog-manager`: create product manifest.
2. `print-agent`: create Printify dry-run/action packet.
3. `shopify-agent`: create Shopify draft/action packet.
4. `writer`: produce title, description, tags, product-page copy.
5. `critic`: review launch packet.

Output:

- approval packet for Printify/Shopify writes
- draft listing copy
- launch receipt template

## `pod-content-batch`

Trigger:

- manual
- schedule
- after product launch packet

Inputs:

- `product_context`
- `content_goal`
- `platforms`

Steps:

1. `pod-content-director`: define hooks and angles.
2. `writer`: draft captions and carousel copy.
3. `hypermotion-agent`: draft video/creative plan when useful.
4. `critic`: identify weak, risky, or off-brand content.

Output:

- content calendar batch
- social post drafts
- video briefs

## `pod-daily-social-publishing`

Trigger:

- schedule
- manual

Inputs:

- `approved_content_batch`
- `platforms`

Steps:

1. `pod-content-director`: select posts for today.
2. `social-publisher`: dry-run platform publishing commands.
3. `critic`: review live-action risk.

Output:

- approval packet for posting/scheduling
- post receipts after approval

## `pod-daily-business-review`

Trigger:

- daily schedule

Inputs:

- `sales_notes`
- `listing_notes`
- `content_notes`

Steps:

1. `pod-growth-analyst`: summarize sales/listing/content health.
2. `ads-agent`: read-only paid signal review when accounts exist.
3. `pod-ops-orchestrator`: turn findings into next actions.

Output:

- daily business brief
- stuck-work list
- next actions

## `pod-weekly-growth-review`

Trigger:

- weekly schedule

Inputs:

- `week_context`
- `goals`

Steps:

1. `pod-growth-analyst`: find winners/losers.
2. `researcher`: suggest niche/product expansion.
3. `pod-product-strategist`: propose next designs/products.
4. `pod-content-director`: propose next content themes.
5. `pod-ops-orchestrator`: create next-week plan.

Output:

- weekly growth report
- product expansion plan
- content plan
- approval-needed changes

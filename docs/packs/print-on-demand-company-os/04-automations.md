---
status: draft
owner: agent
last_verified: 2026-06-26
source_of_truth: false
---

# Automations

These are recipes. Installing the pack must not silently enable them.

The orchestrator should show the full trigger, workflow target, inputs, and permission mode, then call `create_automation` only after approval.

## V1 Recipes

### Design Drop Intake

Type: `FileWatch`

Path:

```text
~/RunnerOS-POD/inbox/designs
```

Matcher:

```json
{
  "watchPath": "~/RunnerOS-POD/inbox/designs",
  "watchGlob": "**/*.{png,jpg,jpeg,webp,svg,psd,ai}",
  "watchChangeTypes": ["add"],
  "allowExternalWatchPath": true
}
```

Action:

```json
{
  "type": "workflow",
  "workflowSlug": "pod-design-intake",
  "triggerInputs": {
    "asset_path": "$CRAFT_EVENT_FILE_PATH",
    "designer_notes": "$CRAFT_EVENT_DATA",
    "target_collection": ""
  }
}
```

## Daily Business Review

Type: `SchedulerTick`

Cron:

```text
0 8 * * 1-5
```

Action:

```json
{
  "type": "workflow",
  "workflowSlug": "pod-daily-business-review",
  "triggerInputs": {
    "sales_notes": "$CRAFT_EVENT_DATA",
    "listing_notes": "",
    "content_notes": ""
  }
}
```

## Content Batch

Type: `SchedulerTick`

Cron:

```text
0 9 * * 1,3,5
```

Action:

```json
{
  "type": "workflow",
  "workflowSlug": "pod-content-batch",
  "triggerInputs": {
    "product_context": "recent launches and priority products",
    "content_goal": "organic product discovery and daily posting",
    "platforms": "instagram,tiktok,x,youtube"
  }
}
```

## Daily Social Publishing

Type: `SchedulerTick`

Cron:

```text
0 10 * * 1-5
```

Action:

```json
{
  "type": "workflow",
  "workflowSlug": "pod-daily-social-publishing",
  "triggerInputs": {
    "approved_content_batch": "latest approved POD content batch",
    "platforms": "instagram,tiktok,x,youtube"
  }
}
```

## Weekly Growth Review

Type: `SchedulerTick`

Cron:

```text
0 15 * * 5
```

Action:

```json
{
  "type": "workflow",
  "workflowSlug": "pod-weekly-growth-review",
  "triggerInputs": {
    "week_context": "this week POD sales, launches, content, and open loops",
    "goals": "increase profitable listing velocity and identify winners"
  }
}
```

## Optional Later Recipes

- hourly stuck publish retry
- Printify webhook order/fulfillment sync
- Shopify webhook product/order sync
- daily pricing review
- weekly provider/product expansion
- approved content folder to publishing queue

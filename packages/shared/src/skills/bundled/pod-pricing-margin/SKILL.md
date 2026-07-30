---
name: pod-pricing-margin
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

```text
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
```

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

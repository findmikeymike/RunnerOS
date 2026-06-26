---
status: draft
owner: agent
last_verified: 2026-06-26
source_of_truth: false
---

# Skills

These are portable playbooks. RunnerOS can seed them as skills; Codex or Hermes can reuse them as instruction files.

## New Skills

### `pod-product-strategy`

Playbook for turning artwork into a product concept.

Outputs:

- audience
- product type
- design placement
- color/variant limits
- price band
- title angle
- collection fit
- risks

### `pod-listing-copy`

Playbook for product names, descriptions, tags, collection copy, and landing-page copy.

Rules:

- prefer real product data before writing final copy
- no fake scarcity
- no unsupported claims
- write for buyer intent
- keep titles clear enough for search and humans
- produce Shopify-ready HTML, SEO title/meta, image alt text, and social-ready variants
- avoid empty hype like "premium", "amazing", "perfect", and "game-changing"
- note missing facts instead of inventing materials, shipping, or product claims
- include collection/category fit and duplicate-content SEO cautions when variants sprawl

### `pod-pricing-margin`

Playbook for price floors and contribution-margin math.

Rules:

- never recommend a price below contribution floor
- use the full margin waterfall: gross revenue, discounts/refunds, COGS, shipping, payment fees, marketplace/platform fees, packaging, marketing spend, contribution margin
- default to conservative launch pricing until real demand appears
- show floor price, conservative launch price, stretch price, and bundle/discount room
- treat ad spend as contribution margin pressure, not gross margin

### `pod-content-calendar`

Playbook for daily and weekly social content.

Outputs:

- 2-4 weekly themes
- dated entries with platform, theme, source product, format, owner, status, CTA, and asset needs
- hooks and captions
- carousel frames
- short-video briefs
- cross-posting plan
- open slots for trends/reactive content
- posting approval packet

Rules:

- do not overbook the calendar
- map one source asset to multiple platform-native posts when useful
- this skill plans content; it does not dispatch live posts

### `pod-growth-review`

Playbook for daily and weekly business review.

Outputs:

- what launched
- what sold
- what content shipped
- what stalled
- winners/losers
- margin/watchlist issues
- next product ideas
- workflow recommendations
- approval-needed recommendations

Review sales, catalog, content, traffic, economics, and operations separately.

### Catalog Mutation Safety

Shared rule for `pod-catalog-manager`, `print-agent`, and `shopify-agent`:

- fetch current state before proposing updates
- show current and proposed values
- list affected variants/colors/sizes/SKUs before variant changes
- require explicit bulk confirmation for large changes
- surface tool errors directly; do not silently continue dependent work

## Existing Skills To Reuse

Likely reusable skills:

- `printify-commerce`
- `print-product-assets`
- `shopify-commerce`
- `social-publishing`
- `ad-creative`
- `content-strategy`
- `customer-research`
- `competitor-profiling`
- `marketing-ideas`

Before implementation, verify each slug exists in the active RunnerOS global library or seed it with this pack.

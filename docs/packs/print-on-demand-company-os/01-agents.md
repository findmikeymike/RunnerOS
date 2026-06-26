---
status: draft
owner: agent
last_verified: 2026-06-26
source_of_truth: false
---

# Agents

V1 should reuse existing RunnerOS agents and add only the missing POD-specific managers.

## Existing Agents To Reuse

| Agent | Job In Pack |
|---|---|
| `print-agent` | Printify catalog, artwork upload plans, product drafts, placement QA |
| `shopify-agent` | Shopify product/listing/collection/store work |
| `social-publisher` | Instagram, TikTok, X, YouTube posting through dry-run/approval flow |
| `hypermotion-agent` | motion/video assets and short-form creative |
| `video-editor-agent` | structured video project edits when needed |
| `ads-agent` | read-only paid media review and later retargeting plans |
| `researcher` | niche, product, competitor, and trend research |
| `writer` | titles, descriptions, captions, product copy |
| `critic` | quality gate for copy, offers, and launch packets |
| `orchestrator` | general workflow routing |

## New POD Agents

### `pod-ops-orchestrator`

Pack-specific manager. Owns the business loop and decides which specialist runs next.

Responsibilities:

- start the right workflow from design drops, schedules, or manual requests
- split work between product, content, and analytics agents
- keep approval gates visible
- avoid duplicate launches
- summarize receipts and next actions

### `pod-intake-agent`

Turns a design file or folder into a clean input record.

Responsibilities:

- inventory files
- hash/dedupe assets
- check dimensions, transparency, aspect ratio, and obvious print risks
- separate final art from mockups, notes, and references
- create an intake summary for product strategy

### `pod-product-strategist`

Turns artwork into a sellable offer.

Responsibilities:

- identify likely buyer/audience
- choose product type, garment style, color range, and collection
- define title angle, description angle, and tags
- recommend price band and margin target
- reject weak products before they waste catalog work

### `pod-catalog-manager`

Coordinates product launch across Printify and Shopify.

Responsibilities:

- convert strategy into a product manifest
- hand Printify-specific work to `print-agent`
- hand Shopify-specific work to `shopify-agent`
- collect IDs, URLs, dry-run outputs, and receipts
- keep products in draft unless explicitly approved

### `pod-content-director`

Creates the daily content machine around live or soon-to-live products.

Responsibilities:

- define hooks, angles, captions, carousel concepts, and short-video briefs
- route video work to `hypermotion-agent` or `video-editor-agent`
- route final posting to `social-publisher`
- keep content tied to product URLs and campaign goals

### `pod-growth-analyst`

Tracks whether the business is actually improving.

Responsibilities:

- daily KPI summary
- listing velocity
- content output
- product winners/losers
- margin and pricing watch
- weekly recommendations for expansion, refresh, or pause

## Optional Later Agents

- marketplace publisher for Etsy/TikTok Shop/Amazon
- support triage
- returns/resolution
- formal compliance/IP guard
- provider scoring agent
- pricing specialist
- experiment manager

Do not add these until V1 has real product launches and receipts.

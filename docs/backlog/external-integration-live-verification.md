---
status: active
owner: agent
last_verified: 2026-07-10
source_of_truth: true
---

# External Integration Live Verification Backlog

## Status

Backlog / release gate.

## Why

Several RunnerOS integrations are wired, tested, and safety-gated locally, but still need real account/API smoke tests before we call them end-to-end production-proven.

Local tests prove app wiring. Live tests prove scopes, provider schemas, OAuth/token persistence, permission prompts, and real provider behavior.

## Rule

No integration is marked "fully end-to-end verified" until it passes:

- setup from the normal UI/settings path
- app restart persistence
- one read-only live command
- one dry-run/approval-preview command when writes exist
- one smallest safe approved write only when appropriate
- receipt/output captured when the integration creates an external action
- no secrets printed in logs, chat, receipts, or Canvas

## Live Verification Queue

### Shopify Agent

- [ ] Create/connect a Shopify custom app token through Settings -> Secrets.
- [ ] Confirm `SHOPIFY_SHOP`, `SHOPIFY_ACCESS_TOKEN`, and optional `SHOPIFY_API_VERSION` persist after restart.
- [ ] Run `node tools/shopify/bin/shopify.mjs doctor --agent`.
- [ ] Run read smoke: products list, orders list, locations list, inventory items.
- [ ] Run write-preview smoke: product create, product update, collection create, inventory adjust without `--confirm`.
- [ ] Confirm GraphQL mutations are approval-gated even with comment-prefixed queries.
- [ ] With explicit approval, create one draft product or draft collection in a dev store.
- [ ] Confirm receipt file can be published/displayed in Canvas.

### Printify Agent

- [ ] Save `PRINTIFY_API_TOKEN` through Settings -> Secrets.
- [ ] Confirm the token persists after restart and is injected into agent/tool runtime.
- [ ] Install or bundle `printify-pp-cli` with documented provenance/checksum.
- [ ] Run `node tools/printify/bin/printify.mjs doctor --agent`.
- [ ] Run read smoke: shops, catalog blueprints, print providers, variants, products, uploads, orders.
- [ ] Run proofing smoke: margin matrix, placement matrix, personalization batch, product drift, asset reuse, fulfillment risk.
- [ ] Run write-preview smoke for upload/product/order/webhook commands without `--confirm-runner`.
- [ ] With explicit approval, create one smallest safe draft/test artifact in a dev Printify shop.
- [ ] Confirm receipt/output can be published/displayed in Canvas.
- [ ] Confirm no token values appear in logs, chat, receipts, or Canvas.

### Google Ads

- [ ] Connect through the intended RunnerOS Google Ads UI path.
- [ ] Confirm OAuth token, developer token, and optional login customer ID persist after restart.
- [ ] Run `node tools/google-ads/bin/google-ads.mjs doctor --agent`.
- [ ] Run account discovery and one GAQL read query.
- [ ] Verify missing/expired auth states are clear in UI and source guide.
- [ ] If writes are exposed, confirm they are previewed and approval-gated.

### Meta Ads

- [ ] Connect Meta OAuth through the normal source flow.
- [ ] Confirm token persistence after restart.
- [ ] Run account/campaign/ad set read-only smoke.
- [ ] Verify beta/access-denied states are clear and actionable.
- [ ] If write tools are exposed, confirm approval-gated preview before any live mutation.

### YouTube Research

- [ ] Save YouTube Data API key through RunnerOS settings/source flow.
- [ ] Confirm key persists after restart.
- [ ] Run `node tools/youtube-research/bin/youtube-research.mjs doctor`.
- [ ] Smoke search, channel uploads, transcript, embed, and comments reads.
- [ ] Verify read-only boundary is respected.

### Zero

- [ ] Install/check Zero through Settings -> Secrets, not manual terminal-only setup.
- [ ] Confirm CLI path, wallet status, and saved secrets persist after restart.
- [ ] Run search/get/fetch with a tiny spend cap.
- [ ] Confirm paid-call approval and wallet funding flows are explicit.
- [ ] Confirm binary outputs can be saved and published to Canvas.

### Social Publisher / Printing Press Social

- [ ] Validate each supported platform profile setup: Instagram, TikTok, X, YouTube.
- [ ] Run `doctor --json` and `doctor --live --json`.
- [ ] Confirm dry-run post, exact `--reply-to` comment reply, and existing `--thread-url` DM reply flows produce usable guarded plans.
- [ ] Confirm scheduled publishing waits at `needs-approval`, rejects changed account/payload/media bindings, executes once after exact approval, and records a durable receipt.
- [ ] Give Social Publisher a direct bounded mandate to answer inbound comments/messages and confirm eligible replies send without per-item approval while run limits are enforced.
- [ ] Schedule the same bounded inbox task and confirm the schedule resolves one exact profile, inbox scope, and run boundary.
- [ ] Confirm cold DMs, posts/uploads, account changes, block/report actions, and sensitive/business/legal/safety replies remain outside the mandate and stop or escalate.
- [ ] Confirm private DM bodies do not enter global memory, Workspace Context, shared Outputs, or public receipts.
- [ ] Confirm exact-target fallback guards prevent a reply from becoming a top-level comment or new DM thread.
- [ ] Confirm browser/CDP recovery is clear for missing sessions, expired login, CAPTCHA/2FA, account mismatch, and selector drift.

### Spotify Analyst / Playlist Creator

- [ ] Connect a real Spotify browser profile through Settings -> Social Accounts and confirm live status.
- [ ] Capture and normalize one Spotify for Artists analytics snapshot, then verify the saved snapshot and `artist-spotify-snapshot` context payload.
- [ ] Capture a second compatible reporting window and confirm delta/anomaly analysis skips unavailable metrics instead of treating them as zero.
- [ ] Dry-run, approve, and create one private test playlist; confirm exact account/track bindings, idempotency, and the durable receipt.
- [ ] Confirm expired login, wrong account, CAPTCHA/2FA, missing analytics fields, and browser selector drift stop clearly without fabricating data or writing a playlist.

### Hypermotion / Remotion / HyperFrames

- [ ] Run local `doctor` in packaged and dev app contexts.
- [ ] Create one HyperFrames HTML preview.
- [ ] Create one Remotion/R3F preview.
- [ ] Render one short MP4.
- [ ] Confirm preview HTML, poster frame, MP4, and receipt render in Canvas.
- [ ] Confirm missing dependency/provider errors are actionable.

### 3D Agent / 3DCellForge

- [ ] Run tool health check from the app agent context.
- [ ] Generate one GLB/GLTF or Three/R3F artifact.
- [ ] Confirm Canvas preview renders without CSP/protocol errors.
- [ ] Confirm open-external fallback works for heavier scenes.

### Canvas External/Local Web Previews

- [ ] Display local HTML file through the safe local protocol.
- [ ] Display localhost URL.
- [ ] Display external-link card for remote URL.
- [ ] Confirm blocked/failed loads show retry/open-external actions.
- [ ] Confirm agent screenshot review triggers once per changed/opened artifact, not repeatedly.

### Secrets Vault

- [ ] Add/update/delete a secret through Settings -> Secrets.
- [ ] Confirm secrets are injected into agent/tool runtime after restart.
- [ ] Confirm secret values are never logged or rendered in Canvas.
- [ ] Confirm tools fail clearly when required secrets are missing.

## Update Agent Follow-up

The Update System Agent should eventually surface this checklist as a "live verification needed" section, separate from package/tool update checks.

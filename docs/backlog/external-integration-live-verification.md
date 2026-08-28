---
status: active
owner: agent
last_verified: 2026-08-27
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

#### Merch Product Builder: End-to-End Manual Smoke

Use one production-ready, non-sensitive test image and a controlled Printify shop.
The product must remain unpublished throughout this smoke.

1. **Launch from Campaign**
   - [ ] Find `Merch Product Builder` in the Campaign workflow library and start one run with the test image.
   - [ ] Confirm Print Agent leads the run and receives the selected artwork and product choices.
   - [ ] Confirm the workflow creates no duplicate document Output.

2. **Bounded Printify draft**
   - [ ] Confirm exactly one private Printify artwork upload is created.
   - [ ] Confirm exactly one unpublished Printify product is created from that upload.
   - [ ] Confirm the workflow records the upload ID, product ID, shop, blueprint, provider, variants, placement, price, and unpublished status.
   - [ ] Confirm no second upload or product appears after a retry or repeated scheduler/session event.

3. **Mockups and final kit**
   - [ ] Confirm official Printify mockup URLs are captured.
   - [ ] Confirm downloadable official mockups are saved into session data; otherwise confirm the final kit states the exact download gap and retains the source URLs.
   - [ ] Confirm the final Merch Launch Kit appears once in Outputs with product, margin, QA, mockup, Shopify, and approval status.

4. **Conditional Shopify behavior**
   - [ ] With Shopify disconnected, confirm the workflow records `Shopify skipped — not connected` and completes without failure.
   - [ ] With Shopify connected, confirm it performs only the read-only connection and duplicate/listing analysis.
   - [ ] Confirm it does not create a duplicate Shopify product or perform a Shopify write.

5. **Approval and failure boundaries**
   - [ ] Confirm publishing, syncing, ordering samples, spending money, updates, deletes, and other consequential actions stop for exact approval.
   - [ ] Confirm `--private-draft` cannot authorize publish or another mutation.
   - [ ] Use unsuitable artwork once and confirm the run stops at `Needs Artwork Fix` without uploading or creating a product.
   - [ ] Confirm expired auth, wrong shop, provider failure, or malformed product data produces an honest blocked result without claiming a completed product.
   - [ ] Confirm no credentials or sensitive values appear in logs, chat, receipts, Outputs, or Canvas.

### Google Ads

- [ ] Add the exact dashboard identity through Settings -> Connections -> Ad Accounts, open its isolated sidecar, log in, and verify the discovered customer ID.
- [ ] Restart RunnerOS and confirm the saved Google Ads login remains isolated and usable.
- [ ] Run `browser_tool accounts`, then attach the exact profile with `browser_tool account google-ads <profile>`; confirm a generic browser is not used.
- [ ] With one login that manages multiple client accounts, confirm separate saved profiles cannot silently cross account IDs.
- [ ] Connect API/OAuth through the intended RunnerOS Services path when structured reporting is required.
- [ ] Confirm OAuth token, developer token, and optional login customer ID persist after restart.
- [ ] Run `node tools/google-ads/bin/google-ads.mjs doctor --agent`.
- [ ] Run account discovery and one GAQL read query.
- [ ] Verify missing/expired auth states are clear in UI and source guide.
- [ ] If writes are exposed, confirm they are previewed and approval-gated.

### Meta Ads

- [ ] Add the exact dashboard identity through Settings -> Connections -> Ad Accounts, open its isolated sidecar, log in, and verify the discovered `act` account ID.
- [ ] Restart RunnerOS and confirm the saved Meta Ads login remains isolated and usable.
- [ ] Run `browser_tool accounts`, then attach the exact profile with `browser_tool account meta-ads <profile>`; confirm a generic browser is not used.
- [ ] With one login that manages multiple client accounts, confirm separate saved profiles cannot silently cross account IDs.
- [ ] Connect Meta OAuth through the normal source flow when structured API access is desired.
- [ ] Confirm token persistence after restart.
- [ ] Run account/campaign/ad set read-only smoke.
- [ ] Verify beta/access-denied states are clear and actionable.
- [ ] If write tools are exposed, confirm approval-gated preview before any live mutation.

### YouTube Research / Weekly Intelligence

- [ ] Save YouTube Data API key through RunnerOS settings/source flow.
- [ ] Confirm key persists after restart.
- [ ] Run `node tools/youtube-research/bin/youtube-research.mjs doctor`.
- [ ] Smoke search, channel uploads, transcript, embed, and comments reads.
- [ ] Verify read-only boundary is respected.
- [ ] Run the default weekly Intelligence job against all configured channels and confirm only each channel's newest unseen upload is ingested.
- [ ] Confirm a second unchanged run skips transcript ingestion and a newly published upload becomes eligible exactly once.
- [ ] Confirm the required HQ report appears on the main dashboard and categorized `youtube-intel` nuggets route into Shared Intel.
- [ ] Exercise missing transcript, provider timeout, malformed nugget block, and missing report Output failures without marking the job successful.

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

#### Daily Social Comment Replies Automation: Five-Step Manual Smoke

Run these in order. Keep the automation disabled until step 2, and use a controlled
account/comment for the live write in step 3.

1. **HQ Calendar routing**
   - [ ] In Artist HQ Calendar, open a day and verify `Add event` and `Add job`.
   - [ ] Exercise the progressive Event, Agent Task, and Workflow Run paths without saving throwaway work.
   - [ ] Confirm campaign-owned Social Publish and Review work is absent or explicitly routed into the primary campaign rather than owned by HQ.
   - Pass evidence: screenshots or notes showing the available HQ choices and the campaign-routing behavior.

2. **Activate Daily Replies**
   - [ ] From either HQ or Campaign Automations, find `Daily social comment replies` in the template gallery.
   - [ ] Confirm the template is disabled by default, targets Social Publisher, covers all saved profile packs, and excludes DMs.
   - [ ] Add or enable it once and confirm the next run is `4:00 PM` in `America/Chicago`.
   - [ ] Confirm activating it from one surface does not create a duplicate active automation from the other surface.
   - Pass evidence: automation ID, enabled state, schedule/timezone, and resolved profile count. Do not record credentials.

3. **Controlled exact-reply run**
   - [ ] Use one real, non-sensitive unanswered test comment on a known profile.
   - [ ] Run the automation or its safe test path and confirm the reply is attached to that exact comment.
   - [ ] Confirm it never falls back to a new top-level comment.
   - [ ] Confirm the private receipt identifies platform, exact profile, target comment, reply, and outcome without exposing private bodies or credentials.
   - Pass evidence: provider comment/reply IDs or URLs plus the redacted receipt location.

4. **Fail-closed and escalation cases**
   - [ ] No connected profiles: stop clearly without creating a reply or receipt that claims success.
   - [ ] Expired authorization, wrong account, CAPTCHA/2FA, or selector drift: stop and show the correct recovery action.
   - [ ] Duplicate or already-replied comment: skip without sending twice.
   - [ ] Sensitive, business, legal, safety, or otherwise human-required comment: escalate without improvising a reply.
   - Pass evidence: one result per exercised case, including the visible error/escalation state and proof that no external write occurred.

5. **Restart and schedule persistence**
   - [ ] Restart RunnerOS.
   - [ ] Confirm the same automation ID remains enabled with the `4:00 PM` Chicago schedule.
   - [ ] Confirm its saved profile-pack scope, comments-only boundary, and Social Publisher target remain unchanged.
   - [ ] Confirm the next scheduler tick does not duplicate a reply already completed in step 3.
   - Pass evidence: pre/post-restart automation ID and configuration plus the next-run display.

### TryPost / Postiz Provider Publishing

- [ ] Connect TryPost with a real Personal Access Token through its source and verify account/content-type discovery.
- [ ] Create and preview a TryPost draft with a known-compatible video, then schedule/publish only after exact approval and verify the returned post ID/status.
- [ ] Connect Postiz Cloud with a real API key through its source and verify `integrationList` plus the target `integrationSchema`.
- [ ] Create a Postiz draft, then schedule/publish only after exact approval and verify the returned post ID/integration receipt.
- [ ] Confirm unsupported media/platform combinations stop before writes and ambiguous connected accounts are never guessed.
- [ ] Confirm disconnected, expired/rotated credential, wrong account, provider quota/subscription, rate-limit, and provider failure states are actionable.
- [ ] Confirm Postiz comment/DM requests route to Social Publisher instead of claiming unsupported provider capability.
- [ ] Smoke one self-hosted Postiz custom MCP source without storing its URL or key in workspace files.

### Spotify Analyst / Playlist Creator

- [ ] Connect a real Spotify browser profile through Settings -> Spotify and confirm Artist Analytics, Web Player, and Spotify Ads Manager status independently.
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

### Squad Video Director

- [ ] Run Squad `doctor` and modular preflight from both dev and packaged app contexts.
- [ ] Generate one no-spend storyboard and confirm its Output is visible in Canvas.
- [ ] Confirm a live provider run stops for explicit approval, uses the configured provider rather than assuming OpenAI, and records an honest pending/completed receipt.
- [ ] Confirm missing provider keys, packaged runtime files, and failed generation return actionable errors without claiming a finished video.

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

---
status: active-release-gate
owner: unassigned
last_verified: 2026-08-26
source_of_truth: true
---

# Artist OS Lemon Squeezy Licensing

## Product Decision

- Direct-sale desktop app with one-time purchases.
- Two editions: **Basic** and **Premium**.
- **Premium v1 launches at $299 USD as a one-time purchase.** This is the real launch price, not a temporary or crossed-out discount.
- Artist OS is **bring your own AI account/key (BYOK)**. The purchase does not include AI credits, model subscriptions, or third-party API usage.
- Premium permits three active Mac installations.
- The purchase grants perpetual use of Artist OS Premium v1 and includes updates throughout major version 1.
- Future major versions are optional paid upgrades. The v1 license continues to work if the customer does not upgrade.
- Basic pricing and its exact included agent/skill roster remain undecided. Do not sell Basic until its capability manifest is defined and enforced.
- Prices live only in Lemon Squeezy. They are not hard-coded in Artist OS.
- A signed entitlement identifies the purchased edition; the renderer cannot choose or upgrade its own tier.

## Lemon Squeezy Product Setup

Created in Lemon Squeezy test mode on 2026-08-26:

- Product: `Artist OS`
- Product ID: `1319593`
- Default variant: `Premium v1 - One-Time`
- Premium v1 variant ID: `2062961`
- Store ID: `251463`
- Price: `$299 USD`
- Billing: one-time; no renewal
- License keys: enabled
- Activation limit: `3`
- License duration: perpetual
- Checkout disclosure: AI providers are connected and paid for separately by the customer

The resulting variant ID belongs in `LEMON_VARIANT_ID_PREMIUM_V1`. Set `LEMON_VARIANT_ID_BASIC_V1=disabled` so a Basic checkout is not required for launch. When Basic is approved later, replace the sentinel with its real variant ID; unknown variants still fail closed.

## Implemented Foundation

- Separate Artist OS licensing identity, storage, URLs, service config, signing authority, and CI variables. ScriptOS and general Runner credentials/data are not reused.
- Lemon Squeezy license activation, validation, deactivation, webhook reconciliation, refunds/disabled-license handling, seat limits, idempotency, D1 persistence, rate limits, and safe public errors.
- Ed25519-signed offline entitlements bound to one installation, with retained public-key rotation support.
- Artist OS desktop activation UI, first-run prompt, Settings management, automatic refresh, offline lifetime access, and protected local storage.
- Premium is required; Basic can be explicitly disabled. Every enabled variant maps to an exact signed edition/plan pair.
- Licensing runs only when the runtime variant is `artist-os`; general Runner bypasses it.
- Unlicensed users keep read/export recovery access. Licensing never deletes or relocates user files.

## Required Before Taking Money

- [x] Set Premium v1 at $299 USD one-time, with BYOK, three Mac activations, v1 updates, and optional paid future-major upgrades.
- [ ] Decide Basic price and exact included capabilities before making its checkout public.
- [ ] Define the exact Basic/Premium agent, skill, workflow, and tool manifest.
- [ ] Add capability filtering and backend enforcement for that manifest; hiding cards in the UI is not sufficient.
- [x] Create the Artist OS Premium v1 one-time variant in Lemon Squeezy test mode with license keys enabled. Basic remains explicitly disabled until approved.
- [x] Set the Premium v1 activation limit to three and its license duration to perpetual.
- [ ] Approve and publish the Artist OS refund policy and purchase terms before enabling live checkout.
- [x] Create separate Cloudflare D1 test and production databases, wire their IDs into `wrangler.jsonc`, and apply migrations `0001` through `0003` to both.
- [x] Deploy the isolated test entitlement service and verify `/readyz` plus a signed webhook event persisted to test D1.
- [ ] Confirm ownership of `artistos.app`, create `license.artistos.app`, and deploy the production `/readyz`, `/v1/activate`, `/v1/validate`, `/v1/deactivate`, and webhook routes.
- [x] Generate a new Artist OS Ed25519 signing key and keep its private key only in the gitignored, owner-readable local authority file.
- [ ] Copy the private signing key into protected Cloudflare/GitHub deployment secrets before deploying; never commit it.
- [x] Generate the desktop **public** keyring with `bun run artist-os:license:keyring`; commit it with the licensing implementation.
- [x] Configure Lemon test-mode webhook signing for order and license-key lifecycle events.
- [x] Prove real Lemon order creation, activation, second computer, seat limit, deactivation, refund, disabled license, replay, and out-of-order webhook behavior in test mode.
  - [x] Real $299 test order created a perpetual three-seat Premium license; deployed activation and online validation both succeeded.
  - [x] Real Lemon `license_key_updated` delivery passed signature validation and was applied to test D1.
  - [x] Second and third installations activated; a fourth received the exact non-retryable `SEAT_LIMIT_REACHED` response.
  - [x] Exact deactivation freed one seat without affecting another installation, and the same installation reactivated successfully.
  - [x] Disable/re-enable events revoked and restored all bindings through real signed Lemon webhooks.
  - [x] A full test refund permanently revoked existing bindings and blocked both validation and new activation.
  - [x] The deployed receiver returned `REPLAY` for an identical signed delivery and marked late real Lemon updates `STALE`.
- [ ] Run `bun run artist-os:license:verify-production` before every customer desktop release.
- [ ] Replace/confirm buy, support, privacy, updates, and recovery URLs.
- [ ] Add privacy policy and purchase terms covering the minimal activation data sent to the license service.
- [ ] Complete signed/notarized macOS packaging, updater configuration, and clean-Mac installation proof.
- [ ] Smoke Premium purchase from checkout through app activation on clean machines. Smoke Basic separately before its later public launch.

## Environment Contract

The complete non-secret template is [authority.env.example](../../packages/entitlement-service/authority.env.example). Live values belong in environment/secret stores, never Git.

Key commerce values:

- `LEMON_STORE_ID`
- `LEMON_PRODUCT_ID`
- `LEMON_VARIANT_ID_BASIC_V1`
- `LEMON_VARIANT_ID_PREMIUM_V1`
- `LEMON_API_KEY`
- `LEMON_WEBHOOK_SECRET`

Key signing values:

- `ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT`
- `ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT`
- `ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON`

## Release Truth

The code foundation is integrated. Commerce is **not live** until the unchecked external configuration, tier enforcement, deployment, signing, and clean-machine proof above are complete.

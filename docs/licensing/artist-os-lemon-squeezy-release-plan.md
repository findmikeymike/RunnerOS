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
- [ ] Configure the owned `itsthemagic.io` domain and `license.itsthemagic.io`, then deploy the production `/readyz`, `/v1/entitlements/activate`, `/v1/entitlements/validate`, `/v1/entitlements/deactivate`, and webhook routes.
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

### September 25 production and friend-beta check

**Delegation saved with explicit approval:** Michael authorized the nameserver switch and supplied the GoDaddy identity verification. GoDaddy now displays custom nameservers `ajay.ns.cloudflare.com` and `liv.ns.cloudflare.com`. Cloudflare remains pending propagation. Direct queries to the assigned Cloudflare server return the original Netlify A/CNAME targets; the sales page returned HTTP 200 after saving. The local recursive resolver still returned old GoDaddy NS at that check, so global propagation is not certified. Production Worker deployment and complimentary licensing remain pending live Lemon configuration; the signed-in Lemon dashboard reports the store application received and awaiting review, with Test mode checked. Live commerce is blocked on Lemon approval (official activation documentation says typically 2–3 business days, not a guaranteed deadline). Test products must be copied to live mode after activation; production product/variant credentials must then be verified before deployment. No production license or friend invitation was created.

**Earlier checkpoint — DNS prepared before approval (superseded by saved delegation above):** Signed-in Cloudflare onboarding created free pending zone `32ffd449300ea114c7bd4def7fae5474` for `itsthemagic.io`, assigned `ajay.ns.cloudflare.com` and `liv.ns.cloudflare.com`. All six transferable records match the GoDaddy table; Cloudflare supplies its own NS/SOA. A/CNAME records are DNS-only and Bot Preference Sync is off to preserve existing website behavior. GoDaddy DNSSEC shows Turn On DNSSEC (currently off). GoDaddy's nameserver editor is populated but Save has not been clicked, pending exact delegation confirmation. Original nameservers for rollback: `ns69.domaincontrol.com`, `ns70.domaincontrol.com`. API can read zone status but not its DNS records with the existing token; record comparison used the authenticated UI.

Preserved record values: `A @ 75.2.60.5`; `CNAME www illustrious-frangollo-908312.netlify.app`; `CNAME pay paylinks.commerce.godaddy.com`; `CNAME _domainconnect _domainconnect.gd.domaincontrol.com`; `TXT @ google-site-verification=h3E17iWoMiVWJJA8ZvK516FMJkQgQe_Kkqvi-pcoVa8`; `TXT _dmarc v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;`. Original TTLs were one hour; imported records use Cloudflare Auto. No MX records existed in the complete source table.

**Authorized desktop domain preparation:** Michael approved `license.itsthemagic.io`. Uncommitted code now targets this host, the existing Artist OS product page, `/contact`, and `/privacy`. The legacy signed issuer remains unchanged solely to preserve existing entitlements; it is not a network destination. Production deployment/readiness checks now require the same activation origin as the packaged app. 49 focused deployment, service, shared-contract and desktop-authority/client tests passed. The initial Cloudflare API zone-create attempt returned HTTP 403 because the saved token lacks zone-create permission; subsequent approved dashboard setup and delegation are recorded above. Production commerce and complimentary license issuance are still unverified.

**Domain correction after account inspection:** Michael does not believe he owns `artistos.app`; its existing code/config references are unverified placeholders and must not be used for production. He identified `itsthemagic.io` as the central sales site. Signed-in GoDaddy inspection confirmed ownership of both `itsthemagic.io` and `artistos.cloud`. Magic's nine records include the Netlify apex/www targets, GoDaddy pay and domainconnect entries, Google verification, DMARC and GoDaddy NS/SOA. Artist OS cloud's seven records include `staging -> artistos-staging.onrender.com`, `www -> artistos.cloud`, domainconnect, DMARC and GoDaddy NS/SOA. No MX or licensing records appeared in either complete table. No DNS changes were made. Michael clarified that `artistos.cloud` belongs to a separate web app that may be linked later. Do not use or change that domain for this desktop release. The proposed desktop setup is sales at `itsthemagic.io/products/artist-os` and activation at `license.itsthemagic.io`; no web-app integration is authorized by this work. The current Cloudflare Worker custom-domain route requires an active Cloudflare zone, so DNS preparation is required before a production endpoint switch.

- Michael approved free Premium v1 licenses for friends, rather than expiring beta access. AI provider access remains BYOK.
- Read-only calls using the existing protected Artist OS authority succeeded. Cloudflare's visible worker list includes `artistos-entitlement-test` but no production entitlement worker. The domain query returned no visible `artistos.app` zone; this does not establish ownership or visibility in other accounts.
- Historical lookup of the unowned `artistos.app` identified Name.com; that domain is excluded from this release setup. The owned `itsthemagic.io` uses GoDaddy DNS and Netlify website hosting. Preserve its existing records.
- The configured test `/readyz` returns HTTP 200, ready, environment test. Lemon product `1319593` is published in test mode. No live Artist OS product was returned by the configured API credential's product list; a separate live credential/account may exist.
- Proposed free-license path: reuse the approved Premium variant and normal activation with a product-restricted, single-use complimentary checkout per friend. Verify a zero-cost order actually produces an accepted license before issuing invitations. No manual key-generator or keyless access bypass exists in the inspected implementation. No friend license, discount, or invitation has been created.
- Current activation requires the matching order email, configured product/variant, accepted order status, and perpetual license. A key issued to the owner email cannot be assumed to activate using a friend's email. Existing Premium permits three installations; one license per friend is preferable to a shared key.
- Next: confirm Cloudflare zone activation, await Lemon store approval, copy and verify the live Premium product/variant, configure production authority and deploy, then verify production readiness and a complimentary activation through the packaged app. Signed/notarized packaging and clean-Mac acceptance remain separate gates.

Lemon references: [store activation](https://docs.lemonsqueezy.com/help/getting-started/activate-your-store), [license generation](https://docs.lemonsqueezy.com/help/licensing/generating-license-keys), [discount restrictions](https://docs.lemonsqueezy.com/api/discounts/create-discount). Complimentary issuance remains a proposal pending a verified zero-cost checkout.

The code foundation is integrated. Commerce is **not live** until the unchecked external configuration, tier enforcement, deployment, signing, and clean-machine proof above are complete.

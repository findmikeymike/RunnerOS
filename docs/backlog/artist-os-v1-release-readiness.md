---
status: active-release-gate
owner: unassigned
last_verified: 2026-08-27
source_of_truth: true
---

# Artist OS V1 Release Readiness

The short, release-level checklist for selling and distributing Artist OS Premium v1. Detailed commerce implementation evidence remains in [Artist OS Lemon Squeezy Licensing](../licensing/artist-os-lemon-squeezy-release-plan.md).

## Current Truth

- Premium v1 is planned at **$299 USD, one time**, with BYOK and three active Mac installations.
- The licensing backend, signed entitlements, refund/revocation behavior, seat recovery, desktop activation UI, and test-mode Lemon Squeezy flow are implemented and tested.
- The branch is still open for product edits. Do **not** begin final packaging until those edits are approved.
- Basic is deferred. It must remain unavailable until its capabilities and backend enforcement are defined.

## Now — Finish The Editable App

- [ ] Complete the remaining product, copy, navigation, and UI edits.
- [ ] Smoke the licensing experience in the real desktop shell:
  - [ ] Unlicensed first launch and activation prompt.
  - [ ] Valid Premium activation.
  - [ ] Settings license status and deactivation controls.
  - [ ] Invalid, refunded, revoked, offline, and service-unavailable messaging.
  - [ ] Read/export recovery access while unlicensed.
- [ ] Run the core Artist OS smoke checklist across HQ, Campaigns, Creative Lab, Team Mode, agents, workflows, automations, Outputs/Finals, Settings, and restart recovery.
- [ ] Fix all release-blocking defects found in smoke; record minor non-blockers separately.
- [ ] Freeze the Premium v1 feature scope and customer-facing copy.

## Before Taking Real Money

- [ ] Approve and publish the refund policy, privacy policy, purchase terms, support route, recovery route, and update policy.
- [ ] Confirm the live Lemon Squeezy product, Premium variant, price, three-seat limit, license duration, checkout copy, tax/business settings, and customer emails.
- [ ] Confirm the production buy, support, privacy, updates, and recovery URLs in the app.
- [ ] Confirm ownership of `artistos.app` and configure `license.artistos.app`.
- [ ] Store production Cloudflare, Lemon Squeezy, and entitlement-signing secrets only in protected deployment secret stores.
- [ ] Deploy the production entitlement service and verify `/readyz`, activation, validation, deactivation, webhook signatures, replay protection, refund revocation, and logs without exposing customer secrets.
- [ ] Run `bun run artist-os:license:verify-production` against the exact production authority used by the release build.

## Final Mac Release Pass

- [ ] Resolve every bundled tool, binary, model, license, checksum, and provenance gate in [Tool Licensing + Packaging Audit](./tool-licensing-packaging-audit.md).
- [ ] Build both supported Mac architectures from the frozen release commit.
- [ ] Sign with the Artist OS Developer ID identity, notarize, staple, and pass Gatekeeper verification.
- [ ] Verify updater configuration, signed update metadata, versioning, download URLs, and rollback/recovery behavior.
- [ ] Install and smoke the release artifact on clean Apple Silicon and Intel Macs with no developer tools or Homebrew assumptions.
- [ ] Complete a real production purchase through checkout, license delivery, app activation, restart, offline validation, exact deactivation, seat reuse, and refund/revocation.
- [ ] Confirm upgrades preserve existing workspaces, user agents, workflows, settings, secrets, and Team Mode data.
- [ ] Confirm logs, crash reports, exports, synced folders, and support bundles contain no keys, cookies, license secrets, or private content.

## Release Decision

- [ ] Tag the exact verified commit and retain hashes for the shipped installers.
- [ ] Archive the completed smoke evidence and release authority output.
- [ ] Publish only when every required item above is checked or explicitly accepted as a documented non-blocker.

## Deferred — Not A Premium V1 Blocker

- [ ] Decide Basic pricing and its exact agent, skill, workflow, and tool manifest.
- [ ] Enforce Basic/Premium capabilities in trusted backend/runtime boundaries before offering Basic checkout.
- [ ] Complete Windows packaging and clean-machine certification before advertising Windows support.

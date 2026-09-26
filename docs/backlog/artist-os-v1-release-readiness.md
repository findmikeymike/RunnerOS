---
status: active-release-gate
owner: unassigned
last_verified: 2026-09-23
source_of_truth: true
---

# Artist OS V1 Release Readiness

The short, release-level checklist for selling and distributing Artist OS Premium v1. Detailed commerce implementation evidence remains in [Artist OS Lemon Squeezy Licensing](../licensing/artist-os-lemon-squeezy-release-plan.md).

## Current Truth

- Premium v1 is planned at **$299 USD, one time**, with BYOK and three active Mac installations.
- The licensing backend, signed entitlements, refund/revocation behavior, seat recovery, desktop activation UI, and test-mode Lemon Squeezy flow are implemented and tested.
- The branch is still open for product edits. Do **not** begin final packaging until those edits are approved.
- Basic is deferred. It must remain unavailable until its capabilities and backend enforcement are defined.

## September 23 checkpoint — not yet distributable

Current evidence: [release smoke audit](../audits/release-smoke-2026-09-23.md). Fresh HQ defaults, campaign navigation, Composio Gmail setup/persistence/send/search/read/draft, and Release Kit media previews have live development-build evidence. Native file-dialog timing, invalid-media promotion, license recovery, and real saved-model validation received bounded fixes and regression coverage. See the audit for exact build/test boundaries; this is not packaged acceptance.

Before a friend demo, the practical gates are:

1. Restore/verify the production entitlement host and provide valid demo seats. `license.artistos.app` did not resolve in the September 23 check.
2. Choose the existing Developer ID fingerprint, notarization credentials, and public HTTPS update feed; build the actual current arm64 candidate. Existing September 6 artifacts are stale and unnotarized.
3. Test Finder install, activation, first useful response, quit/reopen, and data/connection preservation on a clean Apple Silicon Mac. Intel remains uncertified because runtime artifacts are missing.
4. Present model setup honestly: the shipped free OmniRoute route returned a provider restriction. Supported BYOK worked. Never include developer credentials, saved accounts, test profiles, or user workspaces in the demo artifact.

Working Outputs do not currently provide automatic same-ID revision history. Preserve an old version by keeping its file and creating a separate revision Output; immutable Release Kit snapshots are a different guarantee. Agent guidance now states this boundary, but broader revision UX remains a product decision. This pass also does not certify final Instagram/TikTok publishing or physical voice.

The public paid-release checklist below remains open. Do not equate local tests, an executable build, or signed historical artifacts with release readiness.

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
- [ ] Configure activation at `license.itsthemagic.io` under the owned Magic domain. `artistos.app` is not owned; `artistos.cloud` belongs to the separate web app and is excluded from desktop setup.
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

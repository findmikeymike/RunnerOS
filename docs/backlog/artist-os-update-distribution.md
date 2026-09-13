---
status: pending
owner: unassigned
last_verified: 2026-09-13
---

# Artist OS packaging and update distribution

Release/update code is integrated into main. Public distribution is not yet configured or verified. Local development launches and smoke tests do not require an update feed.

## Before packaging

- [ ] Choose and provision the public HTTPS base URL for `latest-mac.yml` and update artifacts. Set `ARTIST_OS_UPDATE_URL` in the packaging environment and supply it to the manual preflight workflow. Do not use the old private GitHub feed or embed credentials in the URL.
- [ ] Verify anonymous downloads of the manifest and every referenced artifact from a clean environment. The current URL gate validates shape, not actual accessibility.
- [ ] Run `bun run check-version` and `bun run release` from clean main. Every Artist OS package, including unsigned verification packages, now requires the update URL; ordinary compiled development launches do not.

## Before public release

- [ ] Build arm64 and x64 packages from the intended commit and verify matching build provenance and production entitlement authority.
- [ ] Sign, notarize, staple, and validate on a clean Mac. Follow existing [release-readiness gates](./artist-os-v1-release-readiness.md).
- [ ] Run `bun run release -- --verify-artifacts --artifact-dir PATH`. Both architecture ZIPs are required; listed DMGs are also checked. This validates names/version, sizes, hashes, and nonempty blockmaps, not signing or archive contents.
- [ ] Plan and verify publication order: upload immutable binaries/blockmaps before exposing their manifest; retain the prior release for recovery.
- [ ] With explicit release approval, test an actual update from an older installed version on each supported architecture. Confirm saved HQ/campaign data, model connections, credentials, and browser sessions survive; validate download failure, interrupted download, failed installer recovery, and separation from Runner's updater cache.

Current observed blocker: `bun run release` rejects missing `ARTIST_OS_UPDATE_URL`. No public feed has been selected by this integration work, and no release was published.

Implementation and commands: [Release preflight](../updates/artist-os-release-preflight.md). Passing preflight alone is not public-release acceptance.

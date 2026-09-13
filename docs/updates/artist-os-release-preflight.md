# Artist OS release preflight

`bun run release` is read-only validation. It does not build, sign, commit, tag, push, upload, or publish.

Before packaging, set `ARTIST_OS_UPDATE_URL` to the intended public HTTPS directory for update manifests and binaries. Every Artist OS package, including unsigned verification packages, requires this value. Ordinary compiled development launches do not. The old private GitHub feed is rejected, and Artist OS uses its own updater cache identity.

- `bun run check-version`: validate desktop package versions (the independently deployed entitlement service is excluded).
- `bun run release`: require clean main, consistent versions, and an explicit update URL.
- `bun run release -- --verify-artifacts --artifact-dir PATH`: validate a separately built `latest-mac.yml`, both architecture ZIPs, and any listed DMGs. Check exact names/version, sizes, SHA512 hashes, and nonempty blockmaps.
- The manual GitHub preflight workflow performs these source checks without publishing credentials or release permissions.

Passing these checks does not prove the feed is reachable, the binary is signed/notarized, build provenance matches the source, or production licensing is configured. Those require separate release acceptance. ZIP/DMG contents and blockmap semantics are not certified by this checksum check.

Updater readiness now comes only from electron-updater's validated download event. Check errors are surfaced; stale cached files do not enable installation. Failed installer handoff invokes the existing recovery hook, while cleanup failure retains the downloaded update for retry. Menus refresh when readiness changes and handle rejected update requests.

Integration validation: focused release/updater tests, package version check, product-isolation gate, and package typechecks. No publishing, live installer run, or app restart was performed.

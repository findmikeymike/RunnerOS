---
status: current
owner: agent
last_verified: 2026-08-14
source_of_truth: true
---

# Craft Agents Upstream Audit — August 2026

## Scope

Reviewed Craft Agents OSS releases `v0.9.0` through `v0.11.4` (April 30–August 6, 2026) against Artist OS. Artist OS remains a separate product; upstream code is selectively adapted, never wholesale merged.

## Integrated Now

- **Daily config backups:** before initialization or migration, preserve the first config seen each day and retain the newest three copies inside the active product root.
- **Safer stale-lock recovery:** lock files now record executable identity and validate a live PID before treating another instance as active, preventing a recycled PID from blocking startup.
- **Bun packaging compatibility:** use the hoisted linker expected by this monorepo and patch the incorrect production dependency in `incr-regex-package` instead of forcing incompatible dependency majors globally.
- **Claude SDK packaging:** all platform builders copy the SDK from the workspace root; the exact-current macOS bundles contain SDK `0.3.220`. A live packaged Claude session remains part of smoke testing.

## Already Present From Earlier Ports

- Source/browser stability and authentication fixes.
- Pi and Claude SDK integration.
- Claude native runtime packaging.
- Product-specific source and credential isolation.

## Additional Ports Integrated

1. **Claude SDK `0.3.220` and Pi `0.80.6`**, including the Explore-mode blocked-tool compatibility change required by the newer Claude SDK.
2. **Background-agent continuity** through a persistent streaming query, normalized terminal notifications, existing task UI events, and idle-session result surfacing.
3. **Session-load retry** for stale loaded flags and lost transport replies.
4. **Updater handoff diagnostics and recovery** with a product-owned always-on log, cleanup before install, and clean relaunch if the handoff fails.
5. **Pi prompt-cache split** keeping stable context in the cached prefix and volatile state in the user-message tail.

Exact files, transfer instructions, intentionally unported features, and remaining live smokes are recorded in `17-craft-upstream-porting-ledger-2026-08.md`.

## Deliberately Deferred

- Craft Projects, Kanban, and Conductor beta: overlap Artist OS Campaign, Release Board, agents, and workflows.
- Lark and Telegram forum features: useful only if Artist OS chooses those channels.
- Dropping macOS Intel support: do not inherit this upstream decision without an Artist OS support decision.
- Broad mobile UI ports: product work, not a reliability fix.

## Dependency Security Position

The unsafe blanket dependency overrides were removed. The final audit reports 75 advisories across 25 packages: 1 critical, 31 high, 38 moderate, and 5 low. Many are newly disclosed transitive issues whose parent packages do not yet expose safe compatible releases.

The critical advisory is `protobufjs <7.5.5`, reached through the WhatsApp `libsignal` dependency. Do not force a major override inside that protocol stack. Resolve it as a dedicated WhatsApp upgrade lane with connection, pairing, send, receive, reconnect, and credential-preservation smokes. Other runtime-relevant upgrade lanes include Axios/Baileys, `builder-util-runtime`/electron-updater, Sharp, and Undici/Pi.

## Verification Completed

- Product isolation gate.
- Full TypeScript typecheck.
- Electron and WebUI production builds.
- Arm64 and x64 macOS app/DMG/ZIP packaging pass completed.
- Packaged Claude SDK version verified as `0.3.220`.
- Artist OS bundle ID, product name, and `artistos://` scheme.

The generated installers are not release-ready: strict signature verification fails, the local keychain reports zero valid code-signing identities, and notarization was skipped. Restore a valid Developer ID identity, rebuild, verify both architectures, then notarize and staple.

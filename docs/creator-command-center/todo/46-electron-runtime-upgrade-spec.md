---
status: todo
owner: agent
last_verified: 2026-09-04
source_of_truth: true
---

# Electron Runtime Upgrade

## Purpose

Evaluate and perform a controlled Electron upgrade when the current product
work settles. Artist OS currently resolves Electron `39.8.10`; the latest
stable release was `44.2.0` when this reminder was written. Choose the target
from Electron's then-current supported stable lines rather than treating
`44.2.0` as permanently correct.

## Why revisit it

- Keep the embedded Chromium and Node runtimes on a supported, security-patched
  release line.
- Pick up startup, preload, IPC, memory, window, navigation, PDF, DevTools, and
  crash fixes that matter to a long-running desktop agent app.
- Improve the foundation for embedded browser panes, output previews, packaged
  updates, notifications, and cross-platform window behavior.
- Prevent a later forced upgrade from spanning too many Electron majors at once.

This is maintenance with possible responsiveness and reliability gains. It does
not by itself improve agents, campaigns, workflows, or product UX. New Electron
APIs such as window-state restore, per-WebContents zoom, frame PDF export, or
main-process `net.WebSocket` should only be adopted for a separate product need.

## Approach

1. Use an isolated worktree based on the current integration branch.
2. Record launch time, idle memory, browser-pane behavior, and packaged-app
   behavior on `39.8.10` before changing dependencies.
3. Review every breaking change from Electron 40 through the selected target.
4. Upgrade Electron and only the packaging/native dependencies required for
   compatibility. Do not combine this with product feature work.
5. Run automated checks, then test the built and packaged Artist OS app on each
   supported platform. Compare measurements with the baseline.
6. Merge centrally so product worktrees inherit one verified runtime version.

## Watchouts

- **Embedded browser panes:** exercise navigation, redirects, OAuth/login,
  persistent partitions, popups, downloads, DevTools attachment, and pane
  teardown. This is the highest-risk area because Artist OS has a substantial
  custom `BrowserView` manager.
- **Custom protocols and previews:** verify output assets, thumbnails, PDFs,
  media range requests, session isolation, and packaged ASAR paths.
- **Notifications:** Electron 42+ uses macOS `UNNotification`; notifications
  require a signed application. Test signed packages and make unsigned-dev
  failure legible.
- **Installer behavior:** Electron 42+ downloads its binary on first invocation
  instead of package `postinstall`. Confirm clean installs, CI caches, offline
  expectations, and all build scripts.
- **Operating-system floor:** Electron 44+ requires macOS 13 and drops 32-bit
  Windows/Linux artifacts. Confirm the supported-user policy before selecting it.
- **Native and packaging dependencies:** rebuild/test native modules and validate
  `electron-builder`, signing, notarization, auto-update, and platform artifacts.
- **Changed defaults:** check file-dialog starting locations, offscreen rendering
  scale, PDF WebContents behavior, clipboard usage, screen/audio capture, and
  Linux frameless-window behavior.
- **Dirty parallel work:** do not use a feature worktree or sweep unrelated files
  into the runtime-upgrade commit.

## Completion gate

- Typecheck and relevant Electron main/preload/renderer tests pass.
- Development launch works with `CRAFT_PRODUCT_VARIANT=artist-os`.
- Browser panes, OAuth, custom protocols, previews, notifications, file dialogs,
  deep links, single-instance handling, and quit/relaunch are manually smoked.
- Signed macOS package launches and notifications work; signing, notarization,
  update metadata, and a clean-install path are verified.
- Supported Windows and Linux builds are checked before claiming cross-platform
  readiness.
- Before/after measurements show no material startup, memory, or interaction
  regression. Any claimed improvement is measured rather than inferred.

## Decision

Do not postpone indefinitely: Electron 39 is outside Electron's latest-three-
stable-major support policy as of this review. Schedule the work as an isolated
maintenance upgrade. If macOS 12 support is still required at execution time,
choose the newest supported Electron line compatible with that requirement or
make the operating-system policy an explicit release decision.

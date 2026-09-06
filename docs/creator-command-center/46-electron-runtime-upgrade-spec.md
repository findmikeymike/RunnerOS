---
status: shipped
owner: agent
last_verified: 2026-09-06
source_of_truth: true
---

# Electron Runtime Upgrade

## Outcome

Artist OS moved from Electron `39.8.10` (dev) / `39.2.7` (what packaging
actually shipped) to **Electron `44.2.0`** — embedded Node `24.20.0`, Chromium
`152.0.7977.76` — on 2026-09-06, on branch `codex/electron-runtime-upgrade` in
an isolated worktree, then landed on `main`.

The upgrade itself was small. What it surfaced was not: three pre-existing
breaks in how the app was built and packaged, each of which would have shipped
regardless of Electron version. They are recorded below because the next person
to touch packaging will hit their shadows otherwise.

## What changed for the runtime

| Change | Why |
|---|---|
| `electron` `^39.8.10` → `^44.2.0` | The upgrade |
| `electron-builder.common.yml` `electronVersion: 39.2.7` → `44.2.0` | Packaging pinned its own Electron, so every shipped build embedded 39.2.7 while dev ran 39.8.10. Nobody had been testing the runtime users got. |
| `notifications.ts`: `failed` handler | Electron 42+ delivers macOS notifications via `UNNotification`, which only works from a code-signed app. Unsigned dev builds now log a legible warning instead of silently showing nothing. |
| `index.ts` dialog bridge: remembers last-used folder | Electron 43+ opens every file dialog in `~/Downloads` unless `defaultPath` is set, and stops the OS remembering the last folder. Picking a workspace from Downloads every time is a regression. The bridge now tracks it, per Electron's own migration note. |
| `overrides.node-abi: ^4.35.0` | `@electron/rebuild`'s ABI table predated Electron 44. |
| `npmRebuild: false` | Nothing under `node_modules` ships (`files:` excludes it; natives go via `extraResources`), so rebuilding against Electron's ABI was pure cost and the first place packaging failed. |
| `apps/electron` `engines.node` `>=18` → `>=22.12` | Electron's installer, electron-builder 26.15 and Playwright all require it now. `>=18` was already false. |

Breaking changes reviewed for 40→44 and found **not** to apply: `clipboard`
module removed from renderers (all 22 renderer usages are `navigator.clipboard`;
nothing imports Electron's module), `clipboard` API rearchitecture, login-item
attributes, `clearStorageData` quotas, PDF guest WebContents, offscreen
rendering scale, `NativeImage.toBitmap`, `select-client-certificate`,
`net.request` frame destinations, cookie change causes, 32-bit targets.
**`BrowserView` is not removed** through 44; the 41-site pane manager runs on
the shim unchanged.

## Pre-existing breaks found and fixed on the same branch

1. **The packaged app died at boot on Electron 39.** `files: "!node_modules/**/*"`
   excludes everything; only the Claude SDK was copied back. sharp's JavaScript
   is bundled into `main.cjs` but its native binary lives in `@img/sharp-<platform>`,
   which nothing copied. The Sept 5 package failed with
   `Could not load the "sharp" module` before showing a window. Fixed: `@img`
   natives ship via `extraResources` on all three platforms, and
   `scripts/gate-sharp-natives.ts` refuses to package without them (wired into
   the four `electron:dist:artist-os*` scripts and `build-dmg.sh`).
2. **A clean clone could not build the renderer.** `.gitignore`'s generic `dist`
   rule silently dropped 22 files from a vendor update under
   `vendor/voice-core-web/dist`, while tracked code imported them. Committed, and
   the directory is un-ignored.
3. **Packaging depended on which Node happened to be on PATH.** electron-builder
   26.15 needs Node ≥ 22.12 (`@noble/hashes` 2 is ESM-only); it had worked only
   because the interactive shell had a newer nvm Node active. `engines` now says
   so.

## Measurements (dev app, fresh profile, same method both sides)

| | 39.8.10 dev | 44.2.0 dev | 44.2.0 packaged |
|---|---|---|---|
| Time to first renderer process | 5.89 s | 4.93 s | 8.89 s |
| Idle RSS, main + children, +20 s | 771 MB | 785 MB | 385 MB |
| Non-cache errors in boot log | 0 | 0 | 0 |
| Single-instance lock | honoured | honoured | — |

No material regression. Launch is not slower; memory is within noise. There is
no packaged 39 column because the Sept 5 package could not boot (see below);
this is the first packaged Artist OS measured at all.

## Verified

- Typecheck against Electron 44 types: clean. Full suite: 8090 pass, 0 fail
  (identical to `main`).
- Dev launch on 44 with `CRAFT_PRODUCT_VARIANT=artist-os`; boot-log parity with
  39 (same two "No LLM connection" lines on a fresh profile, nothing else).
- BrowserView pane manager smoked over CDP through `window.electronAPI.browserPane`,
  the same API the UI uses: create and settle, navigate with title, state
  (`canGoBack`, `isLoading`, owner fields), 302 redirect followed, second
  navigation then `goBack`, `reload`, `destroy`. **9/9 on 44, and 9/9 on 39 with
  the identical script.** The Chromium GPU compositor logs `ProduceOverlay` /
  `Invalid mailbox` for hidden panes on both (34 lines on 39, 26 on 44) — noise,
  not a regression.
- Unsigned macOS package via `electron:dist:artist-os` (Node 24 on PATH): builds
  with `@img` natives inside `Contents/Resources/app/node_modules`, embeds
  Electron 44.2.0, and **boots** — 8.89 s to first renderer, 385 MB idle, zero
  non-cache errors. The only step that did not run is `afterPack`'s signed
  Voice Core helper install, which needs a signing identity this machine does
  not have.
- Single-instance lock honoured on 44.

Two things observed and left unexplained: the packaged app did not expose
`--remote-debugging-port` (the dev launch did), so the pane smoke ran against
the dev launch on the same runtime; and `electron-builder` reports ~1000
"missing optional dependencies" for other platforms' sharp natives, which is
expected on a single-host install.

## Not verified — needs a signed build or another platform

- Windows and Linux packages (scripts and configs updated; not built here).
- Notifications on a signed build; the `:mac` pipeline requires
  `VOICECORE_MOONSHINE_SIGN_IDENTITY` and was not run.
- Deep links, custom-protocol output previews, OAuth inside a pane, downloads,
  DevTools attach, pop-out windows.
- Signing, notarization, auto-update metadata, clean-install path.

## Open decision: macOS 12

Electron 44 requires **macOS 13+**; Chromium 152 dropped Monterey. Electron 43
(Chromium 150, supported into early 2027) keeps it. Apple stopped patching
Monterey in September 2024. Reverting to 43 is two lines: `package.json` and
`electronVersion`. Nothing else in this upgrade depends on the choice.

## Still true from the original brief

New Electron APIs (window-state restore, per-WebContents zoom, frame PDF
export, main-process `net.WebSocket`) were **not** adopted. Adopt them for a
product need, not because they exist.

## Follow-ups surfaced — resolved 2026-09-06 (production hardening)

- `bun run build` / `bun run start` restored: the six arbitrary shadows became
  named tokens (`shadow-hairline-top`, `-card-lift`, `-panel-lift`,
  `-accent-ring`, `-accent-ring-strong`) and `validate-assets.ts` was restored.
- CI: all 52 env- and order-dependent failures fixed at their causes (see
  GIT-FACTS §5 for the three new traps); `CRAFT_BUNDLED_ASSETS_ROOT` set in the
  workflow and root `test` script; an `isolated` job now runs the `.isolated.ts`
  files, which had never run anywhere.
- Node floor: `.nvmrc` = 24, root and app `engines.node >= 22.12`.
- Remote TLS validation on by default (`CRAFT_INSECURE_TLS=1` opt-out).
- sharp gate wired into the Linux and Windows build scripts.

Still open: the packaged app does not expose `--remote-debugging-port`
(deliberate or not is unknown); Windows/Linux builds and a signed macOS build
remain unverified on this machine.

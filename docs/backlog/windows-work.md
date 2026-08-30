---
status: active
owner: unassigned
last_verified: 2026-08-30
source_of_truth: true
---

# Windows Work

Current execution backlog for shipping Artist OS on Windows 11 x64. Windows ARM64 is deferred.

## Current Verdict

- Core code portability: **promising**.
- Windows release readiness: **blocked**.
- Do not advertise Windows support until the release gate below passes.

Verified against `codex/artist-os-licensing` at `440bfe602`.

## Foundation Already Present

- Artist OS product-specific app ID, name, icon, URL protocol, and update feed.
- Electron NSIS x64 installer configuration with per-user installation.
- Windows runtime resolution for Bun, Codex, Copilot, uv, Python virtual environments, and `.exe`/`.cmd` tools.
- Git Bash discovery and user-selectable fallback.
- Windows path validation, including drive-letter and UNC paths.
- Electron `safeStorage` integration for protected credentials and licensing.
- Windows updater, VC++ Redistributable detection, and executable-locking workarounds.

## Confirmed Blockers

- [ ] Supply and verify the Windows x64 Lyrics Transcriber runtime:
  - `tools/lyrics-transcriber/bin/win32/x64/whisper-cli.exe`
  - `tools/lyrics-transcriber/bin/win32/x64/whisper-cli.exe.provenance.json`
  - `tools/lyrics-transcriber/bin/win32/x64/ffmpeg.exe`
  - `tools/lyrics-transcriber/bin/win32/x64/ffmpeg.exe.provenance.json`
- [ ] Make `bun run electron:dist:artist-os:win` complete from a clean checkout. Its runtime gate currently fails because all four files above are missing.
- [ ] Add Windows x64 Electron build, NSIS packaging, and packaged-artifact inspection to CI. The existing Windows workflow validates only the server path.
- [ ] Establish a Windows code-signing pipeline and verify the installed app through SmartScreen.
- [ ] Complete a clean Windows 11 install/restart/update/uninstall smoke with no developer tools installed.

## Capability Work

- [ ] Bundle or explicitly mark unsupported the Windows x64 Printify CLI. Only the macOS ARM64 binary is currently present.
- [ ] Generate one compatibility inventory covering every visible agent, source, tool, and native runtime.
- [ ] Add a packaged-mode doctor contract that distinguishes missing binary, invalid binary, missing credentials, wrong account, and provider failure.
- [ ] Add an in-app compatibility report with clear `working`, `degraded`, `blocked`, and `unsupported` states.
- [ ] Verify browser login persistence, uploads/downloads, account identity, CAPTCHA/2FA recovery, and guarded social receipts on Windows.
- [ ] Verify lyrics, image, video, document conversion, Spotify, Social Publisher, YouTube Intelligence, and Paid Ads workflows.

## Core Reliability Checks

- [ ] Test workspace creation, reopening, restart persistence, and recovery after interrupted writes.
- [ ] Test paths containing spaces, Unicode, long paths, another drive, and UNC locations.
- [ ] Test credential and licensing persistence through Windows DPAPI on a clean machine.
- [ ] Test agent, MCP, browser, and pool subprocess cleanup on quit and update handoff.
- [ ] Verify VC++ Redistributable failure messaging and document conversion after installation.
- [ ] Verify logs, crash reports, Team Mode, exports, and synced workspaces do not leak secrets or browser data.

## Release Gate

Windows support may be announced only when all of these are true:

- [ ] `bun run electron:dist:artist-os:win` succeeds in clean Windows CI.
- [ ] The unpacked app and NSIS installer pass automated artifact inspection.
- [ ] The installer is signed and passes SmartScreen verification.
- [ ] Core Artist OS workflows pass on a clean Windows 11 x64 machine without Git, Bun, Python, FFmpeg, or other developer tooling preinstalled.
- [ ] Restart, update, uninstall, and user-data preservation behavior are verified.
- [ ] Every visible capability has an honest compatibility state and repair path.
- [ ] A final Windows compatibility report is published with no unresolved core blocker.

## Current Evidence

- `bun run scripts/prepare-lyrics-runtime.ts gate --platform win32 --arch x64`: **failed**, four runtime/provenance files missing.
- Focused Windows-shaped unit tests for paths, Git Bash, VC++ detection, and browser-window styling: **25 passed, 0 failed**.
- No packaged Windows Artist OS artifact or clean-machine smoke evidence exists in this checkout.

Detailed design and audit phases remain in [Windows Reliability Audit Plan](./windows-reliability-audit-plan.md). Earlier tool-specific notes remain in [Windows Version](./windows-version.md).

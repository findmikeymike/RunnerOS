---
status: backlog
owner: agent
last_verified: 2026-07-08
source_of_truth: false
---

# Tool Licensing + Packaging Audit

Backlog / release gate for every bundled or agent-called external tool.

## Goal

Users should be able to download RunnerOS and run core agents without manually installing FFmpeg, Whisper, Python, platform CLIs, or other hidden dependencies. Every bundled/downloaded tool must also be commercially safe to ship.

## Scope

Audit every integrated tool/source/agent dependency, including:

- FFmpeg / FFprobe used by lyric video, video editor, Squad/Hypermotion-style flows, raw video tools, audio conversion, thumbnails, and render pipelines.
- Whisper transcription engine for Vault song transcription and timed lyrics.
- Python or Python-like runtimes used by vendored tools.
- Node/Bun CLIs under `tools/`.
- Browser/CDP/Playwright/Chromium dependencies.
- Image/video generation helper binaries or provider SDKs.
- Commerce/social/ads CLIs and wrappers.
- Any model weights downloaded, cached, bundled, or referenced by the app.

## Required Matrix

Create and maintain a release matrix:

| Dependency | Used by | License | Commercially shippable? | Bundle/download strategy | mac arm | mac intel | win x64 | win arm | linux x64 | Doctor check | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FFmpeg / FFprobe | video/audio tools | TBD, prefer LGPL build | TBD | bundled external binary or first-run download | TBD | TBD | TBD | TBD | TBD | required | avoid GPL builds unless legal/product accepts obligations |
| Whisper engine | Vault transcription | TBD, likely `whisper.cpp` MIT path | TBD | bundled binary + model download/cache | TBD | TBD | TBD | TBD | TBD | required | verify exact model license |
| Whisper models | Vault transcription | TBD, verify per model file | TBD | first-run model download/cache | n/a | n/a | n/a | n/a | n/a | required | store model provenance/checksum |
| Python runtime | Python-backed tools | TBD | TBD | avoid when possible; otherwise bundled runtime | TBD | TBD | TBD | TBD | TBD | required | no user-installed Python assumption |

## Current Whisper Integration Status

- Added `tools/lyrics-transcriber` as the RunnerOS wrapper around `whisper.cpp`.
- The wrapper supports `doctor`, `install-model`, and `transcribe`.
- `transcribe` writes the stable app contract: `lyrics_text`, `lyric_lines[]`, `transcript.json`, and `lyrics.txt`.
- Electron packaging includes the wrapper folder for Mac/Windows/Linux packaged resources.
- Vault now exposes lyrics transcription/review wiring:
  - Campaign Vault has a `Transcribe` action for master/demo audio.
  - First transcription can auto-download the selected model into `~/.runneros/whisper/models`.
  - Machine transcripts are saved as lyrics assets with `reviewRequired: true`.
  - User-approved edits become canonical lyrics for agents.
  - Lyric Video Agent prefers approved Vault lyrics and uses transcription only as fallback.
- Still needed before product-ready shipped builds:
  - procure/build app-owned portable `whisper-cli` binaries per platform at `tools/lyrics-transcriber/bin/<platform>/<arch>/`
  - procure/build app-owned LGPL-safe FFmpeg binaries per platform at `tools/lyrics-transcriber/bin/<platform>/<arch>/`
  - approve exact binary sources/licenses and commit/download their sibling `.provenance.json` files
  - decide default model and checksum/provenance policy
  - add Settings/Diagnostics visibility for local transcription runtime/model status
  - smoke packaged Mac/Windows builds on clean machines with no dev tools installed
- Packaging guard now exists:
  - `node tools/lyrics-transcriber/bin/lyrics-transcriber.mjs doctor --json` rejects PATH fallback when `CRAFT_IS_PACKAGED=1` or `RUNNEROS_REQUIRE_PACKAGED_LYRICS_RUNTIME=1`.
  - `bun run scripts/prepare-lyrics-runtime.ts gate` blocks Electron dist scripts unless bundled `whisper-cli`, bundled `ffmpeg`, and both provenance files exist.
  - `bun run scripts/prepare-lyrics-runtime.ts copy -- --whisper-cli ... --ffmpeg ...` copies candidate binaries into the package path and refuses Homebrew-linked macOS binaries unless explicitly overridden for dev-only artifacts.

## Release Rules

- Prefer MIT/BSD/Apache/LGPL-safe dependencies for shipped binaries.
- Do not bundle GPL FFmpeg builds unless the product accepts GPL obligations.
- Keep external binaries replaceable and separate from app code when license terms require it.
- Include third-party notices, source/license URLs, versions, and checksums.
- Do not assume `PATH`, Homebrew, system Python, system FFmpeg, CUDA, or user-installed tools.
- Every source/tool needing a binary must have a `doctor` path that distinguishes:
  - missing binary
  - missing model/runtime
  - unsupported platform
  - failed validation
  - license/provenance not approved
  - ready
- First-run download/install flows must be explicit, resumable, and visible in Settings/Diagnostics.

## Packaging Requirements

- Ship or auto-download known-good binaries per platform.
- Cache downloaded models/binaries in an app-owned location.
- Verify checksum before use.
- Show install/download progress and failure recovery.
- Allow users to remove large models/binaries from Settings.
- Keep provider/API-key setup separate from local runtime setup.
- Make packaged-app `doctor` run from the same app context agents use, not only dev shell.

## First Priorities

1. Inventory every current bundled source/tool and its runtime dependencies.
2. Decide FFmpeg strategy: LGPL-only packaged build vs first-run download.
3. Finish Whisper strategy: `whisper.cpp` bundled binary plus first-run model download/cache.
4. Add checksum/provenance verification for model downloads.
5. Add Settings/Diagnostics controls for FFmpeg, Whisper engine, model cache, and model license/provenance.
6. Add third-party notices/provenance files for every shipped/downloaded binary and model.
7. Smoke packaged Mac app with no Homebrew/PATH assumptions.
8. Smoke packaged Windows app with no Python/FFmpeg/Whisper preinstalled.

## Open Questions

- Which Whisper model ships by default, if any: `base`, `small`, or download-only?
- Should large models be optional per project/song, or global app cache only?
- Do we support Linux packaged app at launch?
- Do we need a legal review before bundling LGPL FFmpeg binaries?
- Do we expose a Settings page for "Local Engines" with FFmpeg, Whisper, Python/runtime, browser, and model status?

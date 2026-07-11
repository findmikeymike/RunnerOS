---
status: active
owner: unassigned
last_verified: 2026-07-11
source_of_truth: true
---

# Windows Reliability Audit Plan

## Mission

Make RunnerOS reliable and easy to use on Windows without requiring users to install developer tools, repair PATH, edit configuration files, or understand which hidden runtime an agent needs.

The first supported target is Windows 11 x64. Windows ARM64 is explicitly deferred until x64 passes the complete release gate.

## Starting Context

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`
- Branch: `codex/creator-social-integration`
- Electron currently builds an NSIS Windows x64 target.
- `apps/electron/electron-builder.yml` contains Windows-specific payload and `extraResources` handling for executable locking.
- Existing related backlogs:
  - [Windows Version](./windows-version.md)
  - [Tool Licensing And Packaging Audit](./tool-licensing-packaging-audit.md)
  - [External Integration Live Verification](./external-integration-live-verification.md)
- Preserve unrelated dirty work. Check `git status --short` before edits and stage only owned files.

## Known Risk Areas

- Printify and Lyrics Transcriber do not yet have proven Windows runtime coverage.
- FFmpeg, FFprobe, Whisper, models, rendering tools, and other native binaries need architecture, checksum, provenance, and license verification.
- Some tool lockfiles or native dependencies may contain macOS-only packages.
- Shell commands may assume POSIX syntax, executable permissions, shebang execution, `/tmp`, slash-built paths, or Unix command availability.
- Windows requires correct `.exe` and `.cmd` resolution without relying on developer PATH.
- Spaces, Unicode, long paths, drive letters, UNC paths, case-insensitive filesystems, antivirus locks, and interrupted copies can expose failures absent on macOS.
- Browser/CDP session storage, uploads/downloads, credentials, CAPTCHA/2FA recovery, and account verification need real Windows proof.
- A source being visible in Settings does not prove its packaged tool or runtime can execute.

## Core Principle

Do not perform a one-time manual checklist and call Windows complete. Generate the compatibility inventory from the actual code, manifests, agent metadata, packaging configuration, and shipped artifact. CI must fail when a new bundled capability is not classified.

## Required Outputs

The work should eventually produce:

1. A generated JSON compatibility inventory.
2. A readable Markdown compatibility matrix generated from the same data.
3. A static Windows portability scanner with focused tests.
4. A packaged-artifact inspector.
5. A normalized `doctor` result contract for local tools and runtimes.
6. Windows CI for tests, packaging, artifact inspection, and migration proof.
7. An in-app Local Engines / Compatibility diagnostics surface.
8. A clean-machine Windows smoke report.
9. A final compatibility report labeling each capability `working`, `degraded`, `blocked`, or `unsupported`.

## Phase 1: Define The Launch Contract

Freeze the support promise before changing tools.

- Target Windows 11 x64.
- Define the minimum core user journey:
  - install and launch
  - create or open a workspace
  - configure an AI provider
  - configure service keys without exposing them
  - launch HNIC and one normal agent
  - create an Output and reopen it
  - use Calendar and Automations
  - restart without losing state
  - update and uninstall safely
- Define representative advanced workflows:
  - browser session and account verification
  - YouTube Intelligence
  - Spotify Analyst or Playlist Creator
  - Social Publisher dry-run and guarded execution
  - one image/video workflow
  - lyrics transcription
- Classify optional capabilities honestly. A blocked optional tool must not make the whole app unusable, but its UI must explain the blocker.

Exit gate: one written x64 support contract and a fixed list of release-blocking workflows.

## Phase 2: Generate The Compatibility Inventory

Build a script that scans the real repository instead of maintaining a separate hand-written list.

Inventory sources:

- built-in and starter agent definitions
- agent skills and required/optional sources
- bundled source definitions
- `tools/*` package manifests and executable entrypoints
- Electron `files` and `extraResources`
- runtime resolvers and environment-variable overrides
- native package dependencies and platform filters
- model/runtime download code
- approval and credential requirements

Each inventory row should include:

- capability, agent, skill, source, and tool identifiers
- entrypoint and runtime type
- Windows x64 support status
- required binaries and expected packaged paths
- required credentials and browser dependence
- native dependencies
- `doctor` command and result status
- license, provenance, version, and checksum status
- clean-machine verification status
- owning test and documentation links

CI must report an error when a visible or bundled capability has no inventory classification.

Exit gate: deterministic JSON and Markdown outputs generated from source, with tests proving newly added unclassified tools fail validation.

## Phase 3: Static Portability Audit

Create focused checks for Windows-hostile patterns. Findings must be evidence-based; do not mass-rewrite harmless test fixtures.

Check for:

- hardcoded `/tmp`, `/bin`, `/usr`, Homebrew, or macOS application paths
- shell command strings where `spawn` or `execFile` argument arrays are safer
- `shell: true` without a documented Windows need
- `chmod` or shebang execution relied upon at runtime
- missing `.exe` or `.cmd` resolution
- direct slash concatenation instead of Node path APIs
- assumptions that environment-variable keys or paths are case-sensitive
- filenames that collide on a case-insensitive filesystem
- illegal Windows filename characters or reserved names
- unsafe quoting around paths containing spaces or Unicode
- commands requiring `bash`, `sh`, `sed`, `grep`, `which`, or other Unix utilities
- unsupported symlink behavior
- long-path and UNC-path rejection
- native dependencies that exclude `win32-x64`
- package lockfiles that include only Darwin binaries for shipped tools
- temp/cache/output paths outside app-owned directories

Add tests using Windows-shaped paths even when running on macOS. Keep true Windows process behavior for Windows CI.

Exit gate: scanner runs locally and in CI, every finding is triaged, and accepted exceptions are narrow and documented.

## Phase 4: Packaged Runtime And Artifact Audit

Build the real Windows NSIS and unpacked artifacts. Source code presence is not sufficient.

Verify the artifact physically contains and can resolve:

- Electron main/preload/renderer output
- Bun
- Codex
- Copilot CLI
- UV and command wrappers
- bundled MCP/session servers
- required Node modules and native modules
- every packaged `tools/*` directory
- tool-specific binaries, models, templates, and schemas
- Windows icons, protocol registration, updater metadata, and uninstall metadata

Run each tool's `doctor` using paths and environment matching the packaged app. Do not allow developer PATH fallback.

Test artifact paths containing spaces and a non-ASCII username. Verify antivirus/file-lock failures leave recoverable state.

Exit gate: artifact inspector fails on missing, wrong-architecture, unproven, or unexpectedly PATH-resolved runtime dependencies.

## Phase 5: Native Runtime And Licensing Closure

Resolve every native dependency deliberately.

Priority runtimes:

- FFmpeg and FFprobe
- Whisper CLI and model files
- Printify CLI
- Google Ads CLI
- image/video rendering dependencies
- browser/Chromium dependencies
- Python-like or UV-managed tool environments

For each binary or model require:

- exact source URL or build recipe
- version
- target platform and architecture
- license and commercial-shipping decision
- SHA256 checksum
- sibling provenance metadata
- update/replacement policy
- packaged or first-run download strategy
- offline and interrupted-download behavior

Prefer MIT, BSD, Apache, or approved LGPL-compatible distributions. Do not silently ship GPL or uncertain artifacts.

Exit gate: no required Windows runtime has unknown origin, architecture, checksum, or license status.

## Phase 6: Normalize Doctor Contracts

Every local tool or runtime must report one of these actionable states:

- `ready`
- `unsupported-platform`
- `binary-missing`
- `wrong-architecture`
- `credential-missing`
- `credential-invalid-or-expired`
- `model-missing`
- `runtime-validation-failed`
- `license-or-provenance-blocked`

Doctors must distinguish local runtime readiness from provider/account readiness. They must not expose secrets or return a generic command failure when a specific diagnosis is possible.

Exit gate: normalized machine-readable doctor results with contract tests for success and each meaningful failure family.

## Phase 7: Windows CI

Add Windows x64 CI in increasing-cost layers:

1. Typecheck and portable unit tests.
2. Static portability scanner.
3. Existing-install migration tests.
4. Windows Electron build.
5. NSIS/unpacked artifact inspection.
6. Packaged-context doctor suite.
7. Small hermetic media/runtime smoke fixtures.

CI must not rely on globally installed Python, FFmpeg, Whisper, Bash, developer CLIs, or credentials.

Exit gate: repeatable green Windows CI from a clean hosted runner.

## Phase 8: Clean Windows VM Smoke

CI cannot prove desktop usability, account sessions, SmartScreen, or installer behavior. Use a clean Windows 11 VM with no developer tooling.

Test:

- install, first launch, workspace creation, restart, update, uninstall
- paths with spaces, Unicode username, long workspace path, and another drive
- Settings, Keys, browser accounts, and secret persistence
- HNIC, Setup Concierge, normal agent launch, and session restart
- Calendar, Automations, Outputs/Finals, Vault, and Canvas
- browser login persistence, downloads/uploads, account mismatch, CAPTCHA/2FA recovery
- YouTube Intelligence
- Spotify
- Social Publisher
- one visual/video render
- lyrics transcription using WAV, MP3, and M4A
- interrupted job, missing binary, expired credential, and failed download recovery
- logs and crash reports for accidental secret leakage

Record evidence for each workflow. Never mark a capability working from source inspection alone.

Exit gate: complete clean-machine matrix with reproducible evidence and no release-blocking failure.

## Phase 9: In-App Compatibility Diagnostics

Add a quiet Settings or Diagnostics surface that reads the same inventory and doctor contracts.

Show:

- capability and dependency name
- status
- installed version and architecture
- credential state without secret values
- model/runtime size and location
- last successful validation time
- one clear repair, reconnect, install, or retry action
- exportable redacted report

Avoid exposing raw binary paths unless useful for troubleshooting. Optional blocked tools should not make unrelated features look broken.

Exit gate: a Windows user can understand and repair normal setup failures without opening a terminal.

## Phase 10: Final Review And Release Gate

Run adversarial reviews at these slice boundaries:

- after inventory/static scanner
- after artifact/runtime audit
- after CI
- after clean-machine smoke

The final review must cover:

- silent PATH fallback
- secret leakage
- wrong-account actions
- unsafe shell quoting
- writable/executable path handling
- updater and uninstall residue
- binary provenance and license gaps
- false-ready UI states
- recovery from interrupted installs, downloads, and jobs

Publish a final compatibility report with `working`, `degraded`, `blocked`, and `unsupported` labels. Do not call Windows supported until the Windows 11 x64 core contract passes on a clean machine.

## Recommended First Slice

Start with inventory and detection, not tool-by-tool fixes.

1. Read `docs/backlog/windows-version.md`, `docs/backlog/tool-licensing-packaging-audit.md`, and `apps/electron/electron-builder.yml`.
2. Map existing build/runtime scripts under `scripts/build`, `scripts/build/win32.ts`, and Electron runtime resolution.
3. Define the inventory schema.
4. Generate the first JSON/Markdown matrix from agents, sources, tools, and packaging configuration.
5. Add failure coverage for an unclassified bundled tool.
6. Run a rival review of the inventory for missing capability classes.
7. Only then prioritize repairs by user impact and release severity.

## Definition Of Done

Windows work is complete only when:

- Windows 11 x64 installs and runs from the shipped artifact.
- Core workflows pass without developer tooling or manual PATH repair.
- Every visible capability has an honest compatibility state.
- Required binaries/models are present or installed through a verified app flow.
- Doctors and UI distinguish actionable failure states.
- Credentials and private account data remain machine-local and redacted.
- CI and clean-machine evidence agree.
- The published compatibility report contains no unresolved core blocker.


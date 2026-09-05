# Artist OS / Voice Core integration refresh

## Authority and scope

- Consumer: `RunnerOS/.worktrees/main/artist-os`, branch `codex/artist-website-engine` (the canonical Artist OS checkout, not the old voice prototype).
- SDK source: `Conversation AI System/voice-core-rs` on `codex/pocket-tts-refresh`, baseline `652111c` plus the recorded uncommitted SDK changes.
- Historical comparison only: `RunnerOS/.worktrees/active/voice-hnic-v1`. Its uncommitted work was not merged, reset or discarded.
- Artist OS keeps its actual Artist Manager/session/tool engine. No replacement LLM brain, animation work, app restart, credential migration, push or release performed.

## Implemented slices

1. Refreshed checked-in Web SDK, matching rebuilt WASM, and current Electron Moonshine modules. Vite and TypeScript resolve the same checked-in cloud entry point instead of a stale Bun file-package copy. `vendor/voice-core-snapshot.json` records source revision, dirty-source status and exact runtime hashes. Run `node scripts/check-voice-core-snapshot.mjs` to detect drift.
2. Native Electron bridge: lazy helper, exact model readiness, signed bundled installation, per-window and per-session ownership, bounded mono PCM, helper retirement and quit cleanup. Lite/Balanced DEV assets live only in ignored `apps/electron/.voice-core-dev/`, outside packaged resources. No model downloads or secrets are included in the SDK snapshot.
3. Renderer: native Moonshine injected as a transport, not the unsupported WASM provider. Balanced is default; Lite/Quality/cloud selections are explicit and readiness-checked. Inworld explicitly uses `inworld-tts-2-flash`. Input/output selection is persisted locally. No silent cloud fallback.
4. Async lifecycle guards cover setup, double Start, Stop, workspace changes, unmount, late session creation and cleanup before restart. Speaker-echo barge-in remains disabled; Chromium echo cancellation is requested, not certified.
5. Tool adapter checks cancellation before dispatch, serializes turns, speaks completed top-level results rather than intermediate tool/subagent text, disables empty-answer replay, and joins cancellation on shutdown. Unconfirmed shutdown poisons the current runtime lifecycle and prevents another voice start through it.
6. Ordinary permission/admin/legacy credential requests use the existing approval components. Voice sessions are visible in chat/history. Unified account authentication and source activation explicitly hand off to that same chat session; no action is automatically replayed after Stop.

## Confirmed findings and dispositions

| Finding | Disposition |
|---|---|
| Old SDK and hard-coded AssemblyAI in Artist OS | Updated SDK and native Moonshine transport; cloud retained as explicit option |
| Stop during setup could still open microphone/dispatch later | Lifecycle and pre-dispatch cancellation guards with regressions |
| Workspace switch retained old workspace closure/session | Runtime invalidated, session setup scoped to the current generation |
| Hidden approvals/account requests | Inline standard approvals plus visible conversation and explicit auth handoff |
| Empty-response retry could repeat tool actions | Upstream transport retry opt-out; manager opts out and emits truthful uncertainty |
| Intermediate/subagent text could be spoken as result | Only final top-level answer accepted after backend completion |
| End stopped audio without waiting for agent drain | Optional SDK LLM stop contract, adapter drain, failed-drain quarantine |
| Forced five-second server cleanup falsely looked like confirmed drain | `complete.stopReason: timeout` preserves uncertainty; voice rejects it |
| Two-minute timer cancelled users reading approvals | Inactivity pauses for approval/auth and resets on progress; thirty-minute total cap |
| Generic source-activation timer could revive stopped voice work | Voice ownership blocks generic retries; explicit user chat handoff transfers ownership |
| Unified auth emits complete before auth request | Auth-marked completion is a handoff, never spoken success |
| Fresh Moonshine install fails outside cached test profile | Confirmed signing/Keychain blocker below; checks NOT bypassed |

## Native signing blocker — NOT ready to ship

The real Artist bridge launches the native helper and reports native tier support. A fresh-profile signed Balanced installation fails committing its protected rollback anchor. It also fails using the original Voice Core resources/helper, so this is not an Artist resource-copy regression.

Evidence: valid model signatures and file hashes; native rollback library diagnostic returns Keychain OSStatus `-34018` (missing entitlement). The development helper is linker/ad-hoc signed with no team identity/entitlements. `security find-identity -v -p codesigning` returned zero valid identities visible in this environment.

Required next work:

1. Establish the Apple signing/provisioning identity and approved Keychain access configuration for Artist OS's helper. Do not add plaintext/file rollback-anchor fallback or weaken signature/trust checks to make a demo pass.
2. Resolve native `com.voicecore.electron` rollback identity versus per-consumer app/storage isolation. Different apps currently have different filesystem locks but a shared native service identity. Define and test trusted per-app binding before distributing to Artist OS/Personal/other consumers.
3. Produce signed native resources and packaging checks. DEV evaluation assets deliberately do not enter packaged resources. Standard Artist OS distribution does not yet include an approved Moonshine native resource bundle.
4. Repeat a clean-profile install/warmup through the real Artist bridge, then live microphone → agent tool with approval → final spoken result. Include denied approval, cancellation, workspace/window changes and a long speaker/microphone soak.

## Verification boundary

- Focused Artist voice/IPC/lifecycle tests: 44 pass, 0 fail.
- Electron TypeScript: pass.
- Main/preload bundles and renderer production compilation tested in temporary output directories (not substituted for the running app).
- Voice Core Web contract tests: 132 pass, 0 fail (local socket tests require unsandboxed loopback).
- Electron sidecar tests: 13 pass, including consumer path override and packaged override rejection.
- Native host suite after sanitized signing-error mapping: 17 pass.
- Snapshot hashes verified. Models and native DEV artifacts remain untracked/ignored.
- Real native fresh installation: FAILED due to the confirmed signing requirement. No live Artist microphone/agent/tool/audio acceptance claimed.

Cancellation requests cannot undo an external side effect already completed. Confirmation signals and stale-session isolation reduce replay/overlap risk; they do not provide transactional rollback for arbitrary tools. Auth/source setup currently continues in chat, not automatically back in voice. Other TTS/STT exports in the refreshed SDK are not all exposed or certified in this Artist UI.

## Refresh commands

From Voice Core, rebuild the Web TypeScript package and its matching WASM, then run `node tools/export-runner-voice-sdk.mjs <absolute-artist-os-root>`. The exporter copies runtime artifacts and selected unchanged Electron modules, strips example-app install scripts, and records hashes. Consumer-specific fixes belong outside vendor modules. Update the consumer lockfile when SDK dependencies change.

For development assets only, `node tools/stage-runner-moonshine-dev.mjs <absolute-artist-os-root>` stages existing macOS arm64 helper/libraries and Lite/Balanced evaluation packs without touching userData or signing private keys. It refuses an existing destination. This is not production packaging or a signing workaround.

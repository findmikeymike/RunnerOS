# September 23 release verification

Initial baseline: canonical `main`, HEAD `4c9353523`, with the existing uncommitted durable campaign-deletion fix and audit edits preserved. Sections below record successive checkpoints; later evidence supersedes earlier pending states. User subsequently authorized coherent commits, isolated-profile restarts, supported model credentials, and one self-email. No push or distribution was performed.

## Verified in this pass

- Desktop version consistency: all release packages agree on `0.8.13`.
- Full repository typechecking passed.
- Full regression suite completed: **65 processes passed, zero failed, zero omitted**. This includes the pending deletion-guard tests.
- Artist OS main, preload, and renderer builds passed; renderer emitted existing bundling/deprecation warnings. Build artifacts reflect the tested working tree, not a clean release commit.
- Reviewed pending deletion guard: checks durable running/paused/approval-waiting work and draining backends before and after acquiring the deletion lease. Read/recovery failures block deletion; failed second checks release the lease. Existing regression coverage remains intact.
- Apple Silicon lyrics runtime presence gate passed; packaged-mode doctor located bundled Whisper/FFmpeg. This machine already has the Whisper model cached, so this does not prove first-download behavior on a clean Mac.
- Existing arm64 packaged app passes strict/deep code-sign verification when macOS trust services are accessible. Initial sandbox verification returned a trust error; the unrestricted verification succeeded. This package is historical, not a build of the current release candidate.

## Concrete release gaps

1. Intel lyrics runtime gate fails: both binaries and provenance files are missing. Resolve before advertising Intel support or explicitly limit the beta to Apple Silicon.
2. Gatekeeper rejects the existing arm64 package: `source=Unnotarized Developer ID`. A current signed, notarized candidate still needs building and clean-machine acceptance.
3. Production entitlement verifier stops with `Missing production Artist OS entitlement release authority.` This describes the current verification environment, not proof that no remote service exists.
4. Release preflight rejects the dirty working tree. Preserve and finish the pending work, then obtain commit authorization before final packaging. No update-feed reachability was established in this pass.
5. Durable workflow host startup deliberately remains opt-in through `CRAFT_DURABLE_READ_HOST=1` (documented in `docs/workflows/08-durable-execution-upgrade/start-here.md` and `state.md`). Fresh profiles use legacy execution. Profiles containing durable journals need an explicit supported recovery policy before distribution; do not enable this globally as a speculative fix.

## Live smoke status

User authorized the isolated-profile smoke. Launched the development build with a fresh `CRAFT_CONFIG_DIR`, sanitized environment, and a shell wrapper that skips user startup files. The normal app was not running; no normal-profile data or credentials were copied.

- Fresh HQ loaded successfully with My Workspace and no campaigns.
- Settings showed zero saved secrets and zero connected services. Models → Connections → Conversation ordering is correct; Essential has Composio, Monid, and Inworld, with no separate Gmail card.
- Add provider reached the provider-choice screen and secure API-key entry.
- Composio setup reached its secure project-key field, with Save and verify disabled while empty. Requested direct user credential entry; verification and Gmail OAuth are pending.
- OmniRoute Auto appeared Ready. Startup log confirms this launch started its gateway rather than reusing an existing listener. Its configured data directory is beneath the temporary profile. This proves gateway startup, not a successful model response.
- No first-run wizard appeared automatically in this unpackaged development launch. Packaged activation/onboarding remains unverified.
- Startup emitted an early missing-LLM-connection error before creating the default connection, plus font CSP and accessibility-focus warnings. No crash observed; first-response behavior remains unverified.

Temporary profile: `/tmp/artist-os-smoke-20260923-WJwnZa/profile`. It remains open at Composio setup for direct credential entry. First useful result and restart persistence remain pending. No social posting, model request, or paid action was performed.

## Evidence

- `/tmp/artist-os-release-suite-20260923.log`
- `/tmp/artist-os-release-types-20260923.log`
- `/tmp/artist-os-release-main-20260923.log`
- `/tmp/artist-os-release-preload-20260923.log`
- `/tmp/artist-os-release-renderer-20260923.log`
- `/tmp/artist-os-lyrics-doctor-20260923.json`
- `/tmp/artist-os-smoke-20260923-WJwnZa/startup.log`

This is progress toward a release candidate, not release certification.

## Composio follow-up

User completed Composio/Gmail setup directly in the temporary app. The card showed Gmail connected with the expected account. Manual Refresh completed without losing connected status. Quit and relaunched the same temporary profile, then refreshed again: Gmail remained connected without key reentry or another OAuth flow. Restart log contained no ERROR/Error matches at the time checked. The initial sandboxed relaunch exited 134 without log output; the authorized unrestricted relaunch succeeded.

This verifies connection setup and persistence, not Gmail search/read/draft execution. Temporary app remains open; normal profile is untouched. Restart evidence: `/tmp/artist-os-smoke-20260923-WJwnZa/restart.log`.

## Launch abort follow-up — required distribution check

The sandboxed relaunch generated macOS crash report `Electron-2026-09-23-143800.ips` (PID 28800, launched 14:37:47, aborted 14:37:48). Stack shows `_RegisterApplication` / `NSApplication` initialization and SIGABRT before observed Artist OS startup. The same build and temporary profile launched successfully outside the command sandbox. Restricted launch environment is the leading explanation, not a proven root cause; no normal-install reproduction is established.

Do not change application behavior speculatively. Before distributing to friends, test the actual signed/notarized candidate from Finder on a clean Mac, including quit/reopen and connection persistence. If this abort reproduces there, treat it as a release blocker and investigate the native startup stack. Track this separately from successful Composio persistence; do not describe the entire restart smoke as crash-free.

## Fresh HQ worker defect

Confirmed fresh HQ activation manifest was empty, while campaign workers were present. `createInitialWindows` created the first workspace directly, bypassing RPC starter activation. Fixed first-run Artist OS creation to write HQ defaults only when the workspace directory is new. HQ defaults now also include registered base/HQ default workers, deduplicated. Existing directories are not repopulated, preserving deliberate deactivation.

Focused storage/GRAVITY tests: 132 passed, zero failed. Main build passed. Explicitly restored missing defaults in this temporary test HQ using saved deactivations as exclusions; live Workers UI now shows 16 workers including Artist Manager, GRAVITY, Builder, Artist Direction, and Content Genius. This repair proves UI consumption; another brand-new-profile launch is still needed to certify the patched startup path. Normal profile unchanged. Also observed HQ navigation retaining the campaign route briefly after switching from campaign: track separately.

### Post-commit fresh-profile verification

Commit `1f32097b7`: launched another completely new profile at `/tmp/artist-os-smoke-20260923-WJwnZa/fresh-hq-verification`. Without manual activation or manifest repair, startup wrote 15 active worker slugs and the live HQ Workers page displayed 16 workers including Artist Manager and GRAVITY. First-run HQ startup fix is now live-verified in development mode. Log: `/tmp/artist-os-smoke-20260923-WJwnZa/fresh-hq.log`. Returned to the original Composio-connected temporary profile afterward.

## Gmail send smoke — blocked before any email tool call

User authorized one self-email (or babyturtlehands recipient); chose connected account self-email. Artist Manager session `260923-keen-ravine` received exact subject/body and single-send authorization with Sent verification.

First attempt never started its worker: sanitized PATH excluded Bun, resolver fell back to Electron for a Bun-target bundle, producing `__require is not a function` and a 30-second startup timeout. Corrected the test launch PATH to include the installed Bun directory while preserving environment/credential isolation. This was a development test harness issue; missing-runtime fallback/error quality remains a follow-up.

Second attempt started Pi successfully but the default OmniRoute route failed with HTTP 403: `oc/big-pickle: auth — OpenCode's free tier can only be used from within OpenCode`. No Gmail tool call or send occurred. This is a confirmed first-use model-provider blocker despite the model showing Ready. Do not certify keyless first use. Need a supported default route or accurate setup-required state before release. Requested supported model setup directly in the test app to continue Gmail execution verification. Evidence: `/tmp/artist-os-smoke-20260923-WJwnZa/gmail-smoke.log` and the session UI.

## Gmail live send passed

Used the explicitly invoked apikeys skill. Existing environment OpenRouter key returned 401; the preferred vault key returned 200. A standalone attempt to use the encrypted credential store was safely refused because it could not unlock Electron's store; no credentials were overwritten. Used environment authentication instead: verified vault key remained in process memory, not config/scripts/log output. Only a non-secret temporary OpenRouter connection was configured.

Artist Manager ran Composio status and send with Haiku 4.5. Approved the single self-test message in the app's exact-message permission UI. Subject actually sent: `Composio Gmail Connection Test` (agent changed the originally requested test wording; still within user's general self-test authorization). Inspected tool output directly: `ok: true`, message ID `1a0d01d7b874406e`, labels `SENT`, `INBOX`, `UNREAD`. Exactly one successful send observed. Receipt verifies Sent status; no separate search/read tool was invoked. No email was sent to the alternate recipient. Composio connection, persisted auth, approval, and live send are verified; read/search/drafts remain separate checks.


## Extended goal pass — September 23

### Live Gmail search/read/draft passed

In the same isolated profile, Artist Manager searched for the exact self-test message, read it, and created one explicitly authorized unsent draft. Actual tool results were inspected: draft `r-1701894315465586862`, message `1a0d047a8901e9f2`, label `DRAFT`, subject `Artist OS draft smoke 2026-09-23`. No second send or unrelated mailbox reading. Together with the earlier send receipt this verifies Composio setup, persistence, search, read, draft, approval, and send through the app/agent path.

### Local UI smokes

- Campaign Release Kit → HQ opens HQ home; returning to the campaign restores Release Kit. Fixed creation-time navigation that could write the destination route into the outgoing workspace, plus recovery for already-saved foreign routes. Commit `61ccd88f` also updates stale HQ roster assertions.
- Imported synthetic orange PNG and two-second H.264 test video through the actual picker into test campaign `boop`. Both previews rendered; video scrubber reached `0:02` and returned to Play. Files persisted after restart.
- Single Art → From computer → PNG now defaults to Single Art / cover-art, with Primary Cover Art label. Cancel leaves existing finals intact. Automatic intent overrides are restricted to compatible image categories.
- Native file selection survived the former 30-second deadline and returned Final details. Dialog capabilities now allow ten minutes, with longer enclosing handler/client deadlines; ordinary RPC deadlines remain unchanged. Commit `c49d1d88`.
- Models shows OmniRoute `Model access unverified`, with provider availability guidance. Further live testing exposed that the underlying stored Pi connection test previously returned unconditional success; the real-model probe was subsequently fixed and verified as described below.

### Distribution facts refreshed

- `license.artistos.app` did not resolve outside the command sandbox, while `artistos.app` and a control domain resolved. Packaged activation uses that production host; development overrides do not certify it.
- Developer ID Application signing identities already exist (three entries share the display name). Choose the exact fingerprint for a candidate. Do not create another certificate unnecessarily.
- The existing `release-artist-os/mac-arm64/Artist OS.app` is a September 6 historical artifact with an obsolete private-GitHub update feed. It is not this working tree's candidate.
- A friend beta still needs the real entitlement service/seat, public HTTPS update feed, current signed/notarized arm64 artifact, and clean-Mac Finder activation/reopen smoke. Intel runtime support remains incomplete. No production deployment, purchase, notarization submission, or external publication occurred.


### Additional verified behavior and limits

- Saved model validation now runs a bounded real request using the exact saved model and authentication route. Live OpenRouter passed; the restricted OmniRoute route failed with access denied. Strict probes disable both provider/model substitution and model-not-found retry. Delayed credentials cannot revive a destroyed probe. Focused probe/runtime tests and cold review covered cleanup and redaction.
- License activation failures restore a retryable state; license-status read failures show Retry. Definitive revocation denies execution before attempting persistence, even if saving fails. That guarantees denial in the current process; inability to save revocation can still leave an older offline entitlement on disk for a subsequent restart. Tests do not certify durable revocation under a failed storage device.
- Agent-created Markdown Output `3d6b453f-3be8-4ff3-809c-a9fb75b80661` appeared in campaign `boop`, retained its agent provenance, and opened after the workspace-path fix. Continue with agent returned to the originating campaign session and prefilled the Output identity.
- The first generated checklist added unsupported facts. A correction request changed its file in place, and the agent incorrectly claimed version continuity. **Working Output same-ID version history is not implemented.** A test-only before-image was preserved separately for this audit. Tool/context guidance now explains the limitation before editing: retaining history requires a new source file/new Output, while an explicitly approved in-place edit has no automatic old-version retention. Release Kit snapshots are independent immutable copies. This is not a new versioning engine or certification of general historical revision recovery.
- Created Creative Lab in the disposable profile: six specialists appeared. Song Pad saved `Release smoke song`, a synthetic rough line, and a test note. All three persisted after quit/reopen and reopening Songs → the saved song.
- Checked 15 selected smoke logs/config/session files for the authorized OpenRouter key; no raw matching key appeared. This is a bounded scan, not a guarantee about every log/export.
- Common credential/session filenames were absent from inspected app tools/resources/dist packaging trees. Bundled arm64 lyrics FFmpeg and Whisper linked only macOS system libraries in `otool -L`; clean-Mac execution is still required.
- Prepared the missing local arm64 Bun 1.3.9 with the existing official pinned/checksum-verifying download helper, using a separate staging directory and exclusive copy. Confirmed Mach-O arm64, version, and the new packaging presence gate. This generated ignored runtime is local preparation, not a committed binary or packaged release. Do not run generic `build-dmg.sh` as a shortcut: it deletes vendor/build directories and is not the Artist OS release workflow.


### Last runtime checkpoint

Relaunched the same isolated profile with PATH limited to `/usr/bin:/bin:/usr/sbin:/sbin`. A real Artist Manager response succeeded. Process inspection confirmed the actual child command used `apps/electron/vendor/bun/bun` (prepared pinned 1.3.9), not the developer Bun install or Electron. The read-only question about same-ID Output history received the correct answer: unsupported; preserve the old file and create a separate revision Output. This verifies the loaded guidance in one live turn, not perfect future model compliance.

The latest file-path fix also covers nonexistent targets, unavailable additional roots, relative roots, and dangling/escaping symlinks. Canonicalizing an existing ancestor lets new files remain within the intended workspace without granting another root. The additional-root failure is isolated; it does not disable healthy authorized roots.

Uncertified by this pass: actual packaged activation, production purchase/refund/seat reuse, clean-machine install/update/recovery, physical microphone/voice, and Instagram/TikTok final publication. Existing fixture coverage is not a substitute for these live checks. No social post was published.


## Final verification for the bounded goal

- Full regression runner: **66 processes passed, 0 failed, 0 not run** (`/tmp/artist-os-release-suite-last.log`). This includes the new isolated path tests. Nested failure-sentinel text is intentional test-runner coverage, not a suite failure.
- Full repository typechecking passed (`/tmp/artist-os-release-types-certified-tree.log`).
- Artist OS main and preload builds passed; renderer build passed with existing bundling warnings. Latest loaded main: `/tmp/artist-os-release-main-delivery.log`; renderer: `/tmp/artist-os-release-renderer-verified.log`; preload was rebuilt with the dialog timeout policy.
- Document tools: **19 Python smoke tests passed** from a separate temporary uv cache (`/tmp/artist-os-release-doc-tools-isolated.log`). The initial cache-access failures occurred before tools executed under the command sandbox; the isolated unrestricted pass downloaded dependencies and completed.
- Dependency containment and product isolation passed (`/tmp/artist-os-release-containment.log`, `/tmp/artist-os-release-product-isolation.log`).
- Additional final focused checks: Output guidance contracts, exact-model probe/cancellation, Bun presence gate, and canonical file-boundary tests passed. The Spotify hydration test passed 30 repeat runs after correcting its test-only time budget.

Code milestones from this goal: `61ccd88f9`, `c49d1d885`, `e1a4b6f69`, `95c3962ec`, `c9a2f327b`, `26fc5b6c3`, `1f0a8d0ef`, `6865523e9`, `103b43e28`, `0288a0d47`. No push, tag, release upload, social publication, or production deployment. Pre-existing durable deletion changes and other audit edits remain preserved and unstaged. The temporary smoke app remains separate from the normal profile.

Next real release step: production entitlement authority and current signed/notarized arm64 packaging, followed by clean-Mac activation/reopen/update and the outstanding external workflow smokes. Do not ship the temporary test profile or developer keys. Passing this development-build pass does not certify distribution.

# September 23 release verification

Baseline: canonical `main`, HEAD `4c9353523`, with the existing uncommitted durable campaign-deletion fix and audit edits preserved. No commit, push, distribution, or real-account action is authorized by this report.

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
5. Durable workflow host startup still depends on `CRAFT_DURABLE_READ_HOST=1` in `apps/electron/src/main/index.ts`. No packaging assignment of that flag was found. An ordinary packaged launch must have an explicit supported policy for durable execution/recovery; development launch evidence is insufficient.

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

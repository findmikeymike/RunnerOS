# Recovery state — r3, 2026-09-12

> CURRENT STATUS — 2026-09-13: PARKED for Artist OS V2 at `/Users/michaelb.williams/RunnerOS/.worktrees/Artist OS v2 features/conversation-background-tasks`, branch `codex/conversational-work-spec`. Michael authorized a local feature-branch checkpoint commit. No merge or push authorized. Do not continue implementation or relaunch without his direction. Live T203 failed to establish acceptance; later phases remain unfinished. The dated history below records prior authorizations and locations and is superseded by this notice. See root `V2-PARKED.md`.

Worktree /Users/michaelb.williams/RunnerOS/.worktrees/conversational-work-spec; branch codex/conversational-work-spec; HEAD d0b5bae3c. Original uncommitted specs preserved. User authorized implementation; no commit/merge/push or app relaunch authorized. No app process was relaunched, provider called, or microphone activated during implementation.

## Accepted

P1 T101/T102 and phase review: native admission contract proof plus actual SDK/WASM/worklet playback proof. T201 native implementation accepted independently; task identity/crash cuts, immutable voice tool cap, exact specialist focus selection and existing Command fallback verified. T202 SDK external assistant turns, durable delivery leases/acknowledgements, result queue, call integration and saved-output controls accepted independently. Evidence/T-201.md and T-202.md contain commands/counts/hashes and reviewer verdicts. Feature remains default off; candidate opt-in CRAFT_ARTIST_VOICE_WORK_BRIDGE=1 plus renderer/SDK capability handshake.

Final T202 review: host32pass173assertions; SDK/scheduler/combined playback19pass115assertions; upstream41contracts. Root combined voice regressions74pass421assertions. Electron/server TypeScript, Artist OS variant main/worker/renderer/preload builds, local asset copy and197-file SDK integrity passed. Actual wrapper source reconstructed from c348947 plus new cumulative conversational-work-sdk.patch; WASM unchanged; original upstream checkout preserved.

## Next required work

T203 is executable but cannot run until Michael permits candidate relaunch (S-APP) and fresh live provider/specialist readiness is checked (S-LIVE). Its packet describes the real draft + unrelated spoken exchange + saved-result announcement test and recovery checks. Existing canonical Electron binary is available; no candidate-local binary was downloaded. Do not launch implicitly or call completed fixture proof a live result.

G-P2-EXIT remains pending T203. P3 question/approval continuation and later certification are not implemented/accepted; do not claim the entire conversational bridge complete. Background execution remains in-process and does not auto-resume after a crash. All work remains uncommitted. Resume by checking this state, plan validity and source/build drift, then honoring the user's explicit launch decision.

## Authorized pre-live work — r3

Michael permits useful independent code work while smoke is delayed. T204 accepted: task details and explicit cancellation using accepted host APIs. Additive sequencing reviewed by host_map; no live gate bypass. Source checkpoint and impact in evidence/pre-live-sequencing.md. T303 interactive remainder stays gated. Final SDK observer guard review updated production/call/scheduler count to19pass117assertions; prior build evidence remains dated, rebuild candidate after T204.

T204 final: independent review PASS; targeted14pass59assertions, broader81pass448assertions, Electron TypeScript, Artist OS renderer build, SDK integrity and diff check pass. Evidence/T-204.md has final hashes. Useful offline controls complete; live/visual/focus proof still deferred. No need to relaunch until Michael is ready. Remaining P3 questions/approvals/revisions retain their original gates; no further scope was silently advanced.

2026-09-13: Michael authorized candidate launch for testing; see evidence/launch-authorization.md. Fresh main/preload/T204 hashes match. Launch in progress; S-LIVE and T203 not yet verified.

2026-09-13 candidate opened and verified in UI. Moonshine local resources restored via existing development bundle symlink; hearing ready. S-LIVE blocked on current Gemini/OpenRouter/Low route unsupported by native-work capability. Conversation settings open; no microphone or worker task started. See evidence/T-203.md.

- Direct-provider preparation follow-up: Michael connected direct DeepSeek; Conversation UI now verifies DeepSeek V4 Flash with reasoning Off. HQ call preparation reports ready with Start call enabled. Earlier route-selection blocker resolved; no microphone call or real draft/result smoke yet. T203 remains pending. See evidence/T-203.md.

- Live T203 exposed an omitted “confirm” phrase and conflicting Command-only prompt instructions. Both corrected; 90 targeted regressions and Electron type check pass. Model routing remains prompt-guided and requires live retest; no T203 acceptance. App restart required to load corrected main and renderer bundles. See evidence/T-203.md.

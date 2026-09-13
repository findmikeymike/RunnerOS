# T-202 SDK implementation evidence

2026-09-12. Implementation-only SDK evidence; independent phase acceptance belongs to the parent task. No app relaunch, physical microphone test, provider call, commit, merge or push.

## Authoritative source and provenance

- Exact baseline: `c348947065e3926b9f56f292fb9e086f23d04597`.
- Isolated editable reconstruction: `/var/folders/lr/1wbdlzk56pv44s9crktlfrdm0000gn/T/artist-voice-sdk-2uyt1zof/voice-core-rs/wrappers/web`.
- Sources changed for this extension: `src/VoiceCoreWeb.ts`, `src/audio/AudioGraph.ts`, `src/types.ts`, `src/index.ts`.
- New authoritative contracts: `contract-tests/external-assistant-turn.test.mjs` and `contract-tests/fixtures/external-playback-harness.mjs`.
- Cumulative source/test patch: `docs/tts-agent/conversational-work-sdk.patch`, SHA-256 `af048c53952ac486bc0573998b4f7647417fd08116bb42848d16c4e74d515a70`. It includes and supersedes the avatar patch; apply only the cumulative patch to the baseline.
- Fresh baseline archive plus cumulative patch reconstructed 69 source/test files byte-identical to the isolated source. Independent build location: `/tmp/voice-sdk-baseline-y5_ewppy/voice-core-rs/wrappers/web`.
- All 172 generated dist files compared byte-for-byte against fresh compilation of the reconstructed baseline. Thirteen generated files differ from the previous vendor snapshot.
- Snapshot inventory remains 197 runtime files. No recorded file is missing; only the expected README, package.json and PROVENANCE.md are outside runtime hash inventory.
- Matching WASM unchanged: SHA-256 `f8fb301ca1a38cc2b9a755c250757a458adf94d773eebcf0e4cf62577495a58d`.

## Public contract

`externalAssistantTurn({origin:'worker-result',turnId,text})` returns unsupported when stopped/unconfigured, deferred while foreground/user/playback/drain/flush is busy or less than 700ms quiet, or accepted with immutable `{turnId,generation,done,cancel}`. `done` resolves delivered/interrupted/failed; total delivery timeout is 45 seconds. Input is bounded to 40 words and 2000 characters.

`getExternalAssistantTurnStatus()` exposes `{supported,idle,idleForMs}`. `getSdkCapabilities().externalAssistantTurns` advertises support; application admission remains separately default-off.

The exact AudioGraph pending flush request ID and playback epoch gate history commitment. Event text starts as an uncommitted assistant preview, uses existing TTS chunking/runtime-worker PCM/viseme queues, and becomes final history only after consumed audio acknowledgement. Cancellation before acknowledgement clears output and resolves interrupted. Once consumption is acknowledged, cancelling cannot label already heard speech unseen; final history commitment completes that delivery. Stalled finalization still remains bounded by the timer.

No `completeUserTranscript` call is used for external events. A busy offer never aborts ordinary conversation. Old delivery handles cannot cancel a newer generation. Observer exceptions are isolated; observer-triggered interruption suppresses stale speech-start aliases.

## Fresh checks

From the isolated wrapper root:

`tsc -p tsconfig.build.json` — pass.

`node --experimental-strip-types --test contract-tests/external-assistant-turn.test.mjs contract-tests/response-playback-completion.test.mjs contract-tests/tts-viseme-metadata.test.mjs contract-tests/consumed-audio-visemes.test.mjs` — 42 pass, 0 fail.

From Artist OS worktree:

`bun test --ignore-scripts apps/electron/src/renderer/lib/voice-task-delivery/external-assistant-turn.test.ts apps/electron/src/renderer/lib/voice-task-delivery/playback-proof.test.ts` — 20 pass, 137 assertions. Production API subset: 11 pass, 75 assertions. The pre-existing prototype remains separate and unchanged.

`node scripts/check-voice-core-snapshot.mjs` — 197 runtime files pass; source patch hash independently verified.

`bunx tsc --noEmit -p apps/electron/tsconfig.json` — pass before the final two-line event-alias guard; source compile and actual-wrapper regressions passed after that guard.

The fixtures control browser devices/provider streams and time, while executing the actual vendored wrapper, shipped runtime adapter, matching WASM and real output worklet. Assertions cover consumed history, real PCM/phonemes, foreground preservation, 700ms quiet reset, stale flush, stale handles, barge-in, stop, zero audio, provider failure, 45-second stall timeout and observer reentrancy. Host leases, application scheduling and cross-call reconciliation are separate T-202 evidence owned by their implementers. Live milestone remains T-203 and requires Michael's launch permission/smoke test.

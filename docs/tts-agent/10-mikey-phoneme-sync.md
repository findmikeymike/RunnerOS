# Mikey phoneme playback and warmup

Mikey uses Inworld's phoneme timestamps to select the existing GLB's mouth
shapes. The avatar fades into the stage over 500 ms when its model is loaded.
The status shows a small green check after voice preparation completes, and
removes it on errors, settings mismatch, connection, shutdown, and active calls.
Reduced motion disables the fade and ambient head/blink movement.

## Signal path

Artist OS opts into `phonemeTimestamps: true` on its existing Inworld transport.
The request uses `timestampType: WORD` with `timestampTransportStrategy: SYNC`.
Phonetic details arrive alongside audio, not after playback. The transparent
Electron voice proxy needs no change. No second speech or audio pipeline,
provider, model download, GLB change, or additional application dependency is
introduced.

The transport reads `audioChunk.timestampInfo.wordAlignment.phoneticDetails`
and maps its source timings onto the audio actually emitted by the transport,
including the existing 30 ms boundary crossfade. Explicit `[silence]` overrides
provider `bmp` labels. Missing or malformed timing retains amplitude fallback;
verified silence produces an empty pose. PCM is not changed by the metadata.

Accepted audio carries timing through a separate bounded metadata queue because
WASM audio JSON does not preserve arbitrary fields. The existing engine can
resample and return different chunk boundaries. Timings follow audio duration,
not one input chunk per output chunk. The output worklet counts only consumed
source PCM, including silent samples; prebuffer waits, underruns, generated
fade tails and cleared audio do not advance this cursor.

`VoiceCoreWeb.onPlaybackFrame` includes optional `visemes` with normalized
symbol/weight pairs. Adjacent shapes blend over up to 25 ms, bounded by each
phoneme's duration. Empty timed poses close the mouth. Undefined poses while
consuming audio use the existing RMS fallback. Silence between words, stopping,
interruption, and handoff discard old cues. A stalled visual feed closes after
200 ms. A timed quiet consonant can still close the lips at zero RMS.

The app maps provider groups through the existing `VISEME_MAP`: `bmp` to PP,
`fv` to FF, `aei` to AA, `o` to O, `qw` to U, and the remaining authored groups.
AA opening is scaled to 0.75 for restrained delivery; full PP closure is retained.
The engine's consumed-sample clock is not a calibration of external speaker or
Bluetooth hardware latency.

## Evidence and limits

A short synthetic phrase was sent four times through the real Artist OS proxy
and configured Inworld TTS 2 Flash voice. First audio arrived in 80/163 ms
without alignment and 111/100 ms with alignment. Both aligned replies included
61 phonetic entries; first timing arrived with first audio. This is two small
pairs, not a latency benchmark or guarantee. The requests did not activate a
microphone or change credentials/settings.

Both recorded timing sets passed offline transport mapping with zero fallback
chunks. The actual recorded audio from one reply also passed the same parser;
the other regression used matching synthetic audio framing. The repository
retains a minimal sanitized metadata fixture, not credentials or recordings.

An isolated browser rendered the exact app dialog and GLB at AA/O/U/PP/FF:
shapes were visibly distinct, PP closed, and no gross beard/skin clipping was
observed. Warmup and error hid the ready check; prepared state showed it.
These isolated visual checks do not prove a live conversation or perceived
lip-sync quality. The generated teeth and beard remain candidates for future
artistic refinement.

Before release, smoke-test a physical call: word matching, rapid interruption,
repeated calls, specialist handoff, close/reopen, reduced motion, and output
route changes. Compare perceived timing on the user's actual speakers/headset.
Do not claim these device checks from unit tests or synthetic fixtures.

## Automated validation

- SDK package compilation and all 182 contract tests passed, including real
  shipped WASM resampling, metadata acceptance/retry ordering, crossfade remapping,
  sample-clock accounting, stale epochs, interruption, and observer isolation.
- An isolated Chrome harness exercised the actual SDK Worker, WASM, AudioGraph
  and output AudioWorklet using synthetic PCM and silent synthetic capture. Both
  first and restarted calls emitted PP/O/AA groups and drained to zero; local
  interruption cleared immediately. No physical microphone or provider was used.
  These checks establish browser integration, not perceived device synchronization.
- App bridge/pose/rig and readiness regression tests passed. Electron TypeScript
  compilation passed with the updated vendored SDK. After merging main through
  `bb4be34b5`, full discovery passed 8,577 tests (one skip, zero failures across
  737 files); all 20 isolated files passed 343 tests. Focused lint had no errors;
  three existing hook warnings remain. The test run used localhost access and a
  60-second per-test timeout.
- The production renderer build passed and emitted both AudioWorklets as real
  files. Its GLB hash matches the unchanged source asset; the 197-file SDK
  snapshot and cumulative source-patch hash verify. The user's running app was
  deliberately not rebuilt or relaunched.

## Reproduction

The cumulative SDK source/test patch is `mikey-avatar-playback.patch`, applied
at Voice Core revision `c348947065e3926b9f56f292fb9e086f23d04597`.
The SDK implementation is also committed as `7467b9a` on
`codex/phoneme-playback-sync` in the Conversation AI System repository.
Compile `voice-core-rs/wrappers/web` with its existing matching WASM package;
run the web contract tests, then verify `vendor/voice-core-snapshot.json` with
`node scripts/check-voice-core-snapshot.mjs` in Artist OS. Do not hand-edit
vendored JavaScript. The existing GLB remains 5,583,104 bytes.

Provider reference: https://docs.inworld.ai/tts/capabilities/timestamps

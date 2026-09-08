# Mikey in the voice-call modal

The voice modal now loads the existing Artist Manager GLB in its avatar stage.
The surrounding call controls, hidden-by-default captions, independent voice
settings, warmup/capture boundary, context pipeline, and specialist handoff stay
with their existing owners.

## Asset and rendering

The bundled asset is 5,583,104 bytes, SHA-256
`d4d3d2ac404bd2be9f33643ac827f1bd5c7aaddb41f126f77ddfae20f533540f`.
It retains the original development rig and uses the app's existing Three.js
dependency through a lazy import. There is no runtime asset download or new
3D service dependency. The production renderer build emits the GLB as its own
hashed asset and a separate avatar runtime chunk.

`MikeyAvatar` loads independently of voice startup. It uses restrained blinking
and head movement, preserves authored eye rest, limits DPR to 1.5 and rendering
to at most 30 FPS, reduces motion when requested, and suspends hidden rendering.
Close, failed load, and graphics context loss dispose the renderer, model,
textures, image bitmaps, observers, fetch, and scheduled work. A neutral icon
keeps the stage usable if graphics fail.

## Playback connection

The current TTS transport supplies audio without verified timed visemes. This
integration therefore uses **audio-reactive mouth opening, not phoneme sync**.
`VoiceCoreWeb.onPlaybackFrame` observes actual output-worklet PCM after the
existing fades. It does not inspect microphone input, enqueued audio, model
tokens, request timing, or create another AudioContext.

Audible RMS observations are bounded to approximately 30 Hz. Silence/clear/stop
emit zero immediately, without waiting for the existing conversation-state
grace period. Graph/session epochs reject late messages. Observer exceptions
cannot fail audio. The app keeps the latest observation outside React state,
rejects old sessions, and closes the mouth when the producer stalls for 200 ms.
Hardware output latency and phoneme timing are not inferred by this meter.

The bundled portable facial controller and mapping are retained for a future
verified timed-viseme feed. No invented viseme cues are generated. The current
asset remains a development facial rig: authored eye alignment, eyelids, teeth,
beard deformation, and expressions still need artistic review in a real call.

## Upstream provenance

The SDK change was made in an isolated source checkout at the existing snapshot
revision `c348947065e3926b9f56f292fb9e086f23d04597`, then compiled. The full
source/test change is [mikey-avatar-playback.patch](mikey-avatar-playback.patch).
The vendor manifest records that source is dirty plus the patch hash; WASM,
providers, and TTS request behavior are unchanged. Do not hand-edit vendored JS.

To reproduce, apply the patch at the Voice Core repository root at that revision,
build `voice-core-rs/wrappers/web`, and run its contract tests with its existing
matching WASM package. Run `node scripts/check-voice-core-snapshot.mjs` in Artist
OS to verify the checked-in runtime bytes.

## Verification boundary

- SDK package compilation passed. Full upstream contracts passed 154/154;
  a final extra edge case plus the targeted rerun passed 31/31. Tests run the
  actual output worklet, check byte-identical PCM against the original, and
  cover observation cadence, silence, epoch fencing, and observer errors.
- App playback bridge, pose/resource tests, preserved portable controller and
  binding tests, lifecycle and handoff regression checks passed.
- Actual modal and GLB were exercised in an isolated local browser fixture:
  neutral/speaking, End, Close/reopen, captions default/reset, and injected asset
  failure. The fixture uses synthetic visual input and never starts a microphone
  or provider. This is not evidence of a live call or audible alignment.
- Renderer build passed and bundles the exact asset. Focused lint has no errors.
- All 18 isolated test files passed (320 tests). After incorporating main's
  chat-history update `ad0cabed2`, the full discovery suite passed 8,555 tests,
  one skip, zero failures across 733 files (208.75 seconds). The run used a
  60-second per-test timeout and localhost access for its local test servers;
  a sandboxed attempt could not start those servers. Typecheck and the renderer
  build also passed after this update.
- Full Electron typecheck passed after restoring the already-locked
  `@types/sax@1.2.7` installation with user permission. Its archive integrity
  matched `bun.lock`; no dependency manifest or lockfile change was needed.

Before release, run a physical microphone/provider call in Artist OS: check first
speech timing, silence, interruption, rapid Stop/restart, output-route latency,
agreed specialist handoff, close/reopen, reduced motion, and sustained CPU/GPU
memory and frame time. Compare voice latency with the avatar enabled/disabled.
No live latency or device-performance guarantee is made by this implementation.

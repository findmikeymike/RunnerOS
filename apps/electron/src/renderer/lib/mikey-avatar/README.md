# Mikey call avatar

`assets/mikey.glb`, `bind-avatar.mjs`, `facial-controller.mjs`, and their portable
tests come from the approved integration source in Conversation AI System:
`avatar-production/artist-manager-v001/{rig,runtime}`. The GLB is bundled by Vite;
no remote asset service or API is required. The two source runtime modules are
preserved unchanged; the controller test uses a local copy of its mapping contract.

The live fallback in `pose.ts` opens one mouth shape from measured speaker RMS.
It does not infer phonemes. Playback timestamps use `performance.now()`; inactive,
silent, stale (over 200 ms), or non-speaking samples close the mouth. The portable
controller retains the viseme mapping for a future verified playback-clock feed.
It is not fed fabricated cues. Source eye axes remain uncalibrated, so live gaze
stays at authored rest.

The renderer imports lazily when the call stage opens and fails independently of
audio. It caps DPR at 1.5 and frame rate at 30, stops rendering while hidden,
honors reduced motion, and releases model/GPU resources on close or graphics loss.
The familiar profile placeholder remains visible until loading succeeds, or if
graphics fail. Reopening the stage retries graphics creation.

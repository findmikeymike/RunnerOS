# Video Director / Canvas smoke-test follow-up

## Evidence

- Homebody session `260916-warm-heath` created video Output `0036de4f-ac06-42b6-8735-1e7843530d61` with `showInCanvas: true`. Later board calls confirmed its card existed.
- Squad doctor reported Fal and WaveSpeed configured, modular orchestration ready, and its optional OpenAI director unavailable. That backend requires an API key independently of the chat-model connection. The successful modular run was not blocked by it.
- Output primary is the original MP4 under the workspace `media/` directory, outside the session folder. The renderer obtains an authorized data URL through the Output asset RPC. Its CSP already permits `data:` media.
- Saved Canvas capture at 03:27 UTC contains the video frame and player. During this investigation, the original video played through 0:07 in Outputs. A blanket claim that this MP4 cannot render in Electron is unsupported.

## Fixes

- Output invalidations during a pending list request now cause a trailing read rather than being lost behind the old request.
- Multiple mounted consumers retain their refresh subscriptions independently. First consumer on workspace re-entry refreshes instead of trusting a permanently loaded cache, including when work finished while that workspace was not visible.
- Video/audio previews report ready only after media data loads, and display a readable error if playback loading fails. Video uses inline playback and explicit preload.
- Squad source guidance explains that its OpenAI director is optional and should not be presented as broken setup when the selected modular route works.

The refresh race is reproduced by regression tests; it cannot retrospectively be proven to be the exact cause of the user's initial blank view. No CSP permissions were broadened, no generation repeated, and no original media changed.

## Verification

- 19 focused tests pass; repository typecheck and final Electron typecheck pass; main and renderer builds pass.
- Reloaded the latest renderer in the running Artist OS profile. Opened the original Homebody conversation and played its Canvas video through 7.058866 seconds; the player returned to Play at 0:07 without an error.
- Renderer fixes are live. The newly built Squad guide wording takes effect after a main-process restart. No commit or restart performed in this slice.

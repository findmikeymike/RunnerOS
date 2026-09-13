# Voice Core consumer snapshot

Source revision: `c348947065e3926b9f56f292fb9e086f23d04597`.
Source has recorded SDK edits: yes.

Apply **only** `docs/tts-agent/conversational-work-sdk.patch` to that revision. This cumulative source/test patch includes and supersedes `mikey-avatar-playback.patch`; applying both is incorrect. It adds consumed-playback observation, Inworld phoneme alignment and correlated external assistant turns with cancellation and a 45-second bound.

Build `voice-core-rs/wrappers/web` with `tsc -p tsconfig.build.json` using the existing TypeScript dependency. The vendored `dist` files are compiler output, never hand-edited. Retain the matching existing `pkg` WASM bundle; this change does not rebuild WASM or replace providers. The complete runtime file inventory, source-patch hash and exact generated hashes are in `../voice-core-snapshot.json`.

The new event-speech method reuses the runtime worker, TTS chunker, PCM queue and viseme scheduler. It commits assistant history only after its exact consumed-output flush; no fake user transcript is introduced. Artist OS admission remains feature-gated separately.

The cloud entry point avoids optional WebGPU inference imports; the full SDK entry point retains its optional model-provider dependencies.

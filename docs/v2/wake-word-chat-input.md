---
status: deferred
owner: unassigned
last_verified: 2026-09-25
source_of_truth: true
---

# Wake-word chat input

User-requested V2 candidate, explicitly parked outside V1. Research and proposed integration only; no implementation or live wake-word verification yet.

## Experience

Opt in once, then say a distinctive phrase such as “Hey Artist” to activate speech input without clicking the microphone. Show a listening indicator, capture the command, stop after silence, and place the transcript in the current agent chat. First version preserves review before sending. Optional automatic sending can follow for fully hands-free commands, retaining ordinary agent permission rules.

## Integration proposal

- Use Hermes Agent's wake-listener lifecycle as a reference rather than importing its agent runtime. Hermes code is MIT licensed; retain required notices for any copied code.
- Prototype **sherpa-onnx keyword spotting** first: local detection, configurable phrases without custom training, no API key, and JavaScript/Node support. Its code is Apache-2.0; verify the exact model and dependency redistribution terms separately before bundling. Engine selection remains provisional until measured in Artist OS.
- Reuse `useChatDictation.ts`, `FreeFormInput.tsx`, and `chat-dictation-service.ts` for existing local transcription and composer insertion. Current dictation uses manual stopping or a maximum duration; add voice-activity/silence endpointing for the hands-free path.
- Keep one app-level microphone owner. Coordinate wake detection, chat recording, and existing voice mode; suspend detection during recording and spoken playback, then resume when eligible. Prefer app-owned capture feeding local detection to avoid a second backend microphone permission path.
- Bind each activation to the focused chat/session at capture start. Cancel on a target change; never send into a newly selected chat or multiple open panels. Preserve existing cancellation fences and draft text.
- Keep wake detection off by default with a visible armed state and immediate off control. Process ambient wake audio locally without retaining or transmitting it. Reuse existing transcription behavior only after activation.
- Bundle or explicitly provision a pinned engine/model with integrity checks; avoid silent runtime dependency installation. Run inference outside the UI thread.

## First bounded slice and acceptance

Prototype one phrase for the current chat while Artist OS is open. Measure activation latency, missed and false triggers, idle CPU/memory, and transcription delay. Test music playing, ordinary conversation, headphones, built-in microphones, silence, and the app's own TTS. Verify microphone contention, sleep/wake and device changes, repeated triggers, permission denial, navigation during capture, and existing-draft preservation. Test the actual packaged target platforms before claiming release readiness.

Named-agent phrases, background/minimized operation, automatic sending, and opening full voice conversations are later extensions, not initial scope. No new agent is needed.

## Research references

Reviewed September 25, 2026; recheck upstream versions and model licenses before implementation.

- [Hermes wake-word behavior and engines](https://hermes-agent.nousresearch.com/docs/user-guide/features/wake-word)
- [Hermes MIT license](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE)
- [Hermes listener implementation](https://github.com/NousResearch/hermes-agent/blob/main/tools/wake_word.py)
- [sherpa-onnx project](https://github.com/k2-fsa/sherpa-onnx)
- [sherpa keyword spotting](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)

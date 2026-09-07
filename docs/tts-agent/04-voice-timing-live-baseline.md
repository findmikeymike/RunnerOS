# Artist Manager live voice timing — 2026-09-07

Measured development baseline, not a latency fix or release certification.

## Environment

- Source: `2ec62406e` on canonical Artist OS main; existing Electron/Vite development app, HMR loaded, no process restart.
- Session model: `pi/deepseek-v4-pro`, connection `pi-api-key`, thinking `medium`; main logs confirmed DeepSeek endpoint. No provider-switch receipt occurred in the measured sessions. Auxiliary `queryLlm` logs use v4 Flash and must not be mistaken for the conversational model.
- Moonshine Balanced, local; Inworld speech; High energy manager style.
- Yeti Stereo Microphone input; Default - Symphony I/O Thunderbolt output.
- Typed run `05b3e9c5-2174-4432-8271-a551d6feef13`, session `260907-awake-oasis`.
- Microphone run `5946d610-d63b-4204-b296-276cbdd58506`, session `260907-alert-plain`.
- Source logs: existing Runner `main.log`; scalar timing extraction saved locally to `/private/tmp/artist-os-voice-baseline-records.json`.

## Results

Times below start at accepted typed input or accepted final transcript. First answer audio is provider PCM availability, not a physical audible-onset measurement.

| Trial | First model text | Final answer delivered | First answer audio | Playback complete |
| --- | ---: | ---: | ---: | ---: |
| Typed greeting, first turn | 11.247 s | 12.351 s | 12.705 s | 31.453 s |
| Same typed greeting, warm turn | 2.765 s | 4.035 s | 4.459 s | 23.785 s |
| Spoken greeting, first turn | 10.552 s | 11.482 s | 11.780 s | 24.585 s |
| Spoken prioritization question, tool lookup | 28.775 s | 31.893 s | 32.310 s | 97.509 s |
| Spoken release-date follow-up | 27.593 s | 32.773 s | 33.155 s | Failed; partial playback only |

Both typed inputs were `Hello, how are you?`. The person spoke a different greeting and then natural follow-up questions, so this is not a controlled same-phrase STT comparison. The first spoken final contained six words rather than the previously reported single random word. Human confirmation of verbatim recognition remains separate.

Startup to Listening was 2.964 s typed and 2.923 s microphone. Initial Manager session creation was 29 ms and 34 ms respectively. These session-creation timings do not include subsequent agent/provider startup, which occurs after manager-request.

Moonshine finalize-request to accepted final was 98 ms on the first spoken turn and 234 ms on the second. This does not measure acoustic end-of-speech detection. Speech began after the runtime was ready, so immediate-start clipping is not ruled out.

Both first turns made three distinct Read calls for Artist OS Guide, Artist Manager Operating System, and Skill Scout. They completed within 16 ms as observed in the renderer. These were not duplicate calls. The prioritization question invoked `get_manager_brief`; its tool-start/result interval was 12 ms, with no error. First answer synthesis requests took 280–411 ms to produce PCM across these four turns.

## Concrete speech failure

The third spoken turn generated 1,407 characters. The speech path sent two small chunks followed by a 1,257-character chunk. The app displayed `Text too long: 1257 chars (max 1000 per send_text)`, emitted a TTS error, and stopped the conversation at 41.654 s after accepted input. The final playback-complete marker accompanies error cleanup and does not mean the full answer was spoken. No permission request or external mutation was observed in these diagnostic turns. The runtime is stopped.

First repair: enforce the Inworld per-message size limit while preserving every character, cancellation, and audio ordering. This defect is independent of model latency and reproducible from the captured chunk length.

## Interpretation and next change

The observed multi-second delay is predominantly in the agent/model path. Reading local files is quick, but deciding to call tools and generating the response incurs model round trips. The adapter then waits for the full final answer before releasing it to TTS: about 0.9–3.1 s after first model text in these turns. The prioritization answer also produced 1,130 characters, with playback continuing for roughly another minute after answer audio became available.

First target: a bounded conversational response policy that avoids mandatory startup skill reads on greetings and keeps spoken answers short, followed by explicit final-answer streaming where tool commentary cannot leak into speech. Compare the same route before considering model/provider changes. Re-run a true same-phrase microphone test and an immediate-start test separately for clipping.

The original trace stage `model-fallback` was misleading: the server emits `model_fallback_started` from `onProtectedTurnStart` even when no switch happens. Commit `3c33a6061` renames our diagnostic stage to `model-fallback-guard-start`; old baseline records retain the old spelling. Those records are not evidence of fallback.

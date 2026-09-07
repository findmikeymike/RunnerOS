# Artist Manager voice timing baseline

Status: instrumentation, not a latency fix or measured live result.

## Run the controlled comparison

Use the canonical Artist OS app built from the timing commit. In the Manager
voice panel, expand **Response timing**, enable **Measure this conversation**,
and choose the input before Start. No diagnostic setting persists after the
panel owner reloads. No model, provider, voice, reasoning, or device preference
is changed by instrumentation. Existing agent permissions still apply.

Record the source commit, app version, model/connection/reasoning, STT tier,
voice style, and microphone/output selection alongside the report. The
`session-setup-ready` marker includes the session ID and configured model,
connection, and reasoning when the session API supplies them. Use that ID to
check the actual provider attempt in existing main logs; a configured model
alone is not proof of the model that ultimately answered.

1. Enable **Type instead of speaking for this test**. Start; send the supplied
   `Hello, how are you?` twice, waiting for full playback each time. This tests
   first-turn session setup versus the warm session. The real STT transport
   still prepares, but capture is not forwarded and ambient transcripts are
   ignored. The accepted typed input enters the same VoiceCore response path.
2. End, uncheck typed input, Start. Say that same sentence twice after
   Listening. A person must check whether the transcript matches their speech.
3. In the same measured conversation, request one bounded, read-only tool lookup
   (for example, ask the Manager to read the current artist profile and state
   the artist name in one sentence). Confirm a tool-start/result pair occurred;
   if it did not, this is not a tool trial. Do not request an external action.

Keep all settings fixed. These are sequential trials, not identical session
histories. Repeat cold/warm trials before drawing a model performance conclusion.

Use **Copy timing report**, or extract `[voice-timing]` JSON records from the
existing Electron main log. Reports retain the last 500 markers in the panel;
long traces may be truncated there. Logs receive all emitted records.

## Interpret the markers

All elapsedMs values use the same renderer monotonic clock within a random run
ID. A run is one Start/Stop. Turn numbers advance only after the SDK accepts a
final input. Raw late transcripts do not advance an active answer's turn.

| Interval | Meaning |
| --- | --- |
| start → stt-ready / listening | STT startup / complete runtime startup |
| first-partial → stt-final | Partial recognition to accepted final; not speech-end latency |
| stt-finalize-request → stt-final | Native endpoint finalization, including IPC |
| stt-final or typed-input → manager-request | SDK/queue/session setup before dispatch |
| session-setup-start → session-setup-ready | Initial Manager context and session creation |
| manager-request → manager-first-text | First renderer-observed model text, including server/provider work |
| tool-start → matching tool-result | Tool interval (numeric tool ID; failed flag preserved) |
| manager-first-text → answer-delivered | Remaining agent work and final-answer buffering |
| tts-request → matching tts-first-audio | Provider synthesis until first nonempty audio chunk |
| accepted input → first answer tts-first-audio | Answer audio available, NOT necessarily audible yet |
| accepted input → playback-start | Worklet playback onset; may be progress speech |

`manager-first-text` may be intermediate commentary. It is recorded once per
attempt; `model-attempt-reset` allows another first-text marker. Fallback and
approval/auth waits are explicit. The SDK's misleadingly named llm-first-token
is deliberately not used as the model-first-text measurement.

Activity and answer TTS requests have separate kind labels, even if the answer
arrives while an activity request is queued. The existing SDK does not report
an exact answer-onset boundary when activity and answer play without a gap.
Do not claim audible answer latency from first audio availability, synthesis
completion, runtime Speaking, or a progress announcement. `playback-complete`
is the SDK completion event, not a physical speaker measurement.

The new log path records counts and timing metadata, not transcripts, prompts,
raw audio, credential values, tool names/arguments/results, or provider errors.
It does not change the application's pre-existing conversation/history logging.
No duplicate-call, streaming, STT, or provider fix is included in this slice.

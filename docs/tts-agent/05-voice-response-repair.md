# Voice response repair — 2026-09-07

## Changes, in order

1. Shared Voice Core Web/Electron chunking fixed upstream at `a2abae9`.
   Whole-answer events and iterator-end tails now drain through bounded chunks.
   Formatting expansion and Unicode boundaries are covered; requests remain
   sequential and cancellation-aware. The Inworld 1,000-unit guard is retained.
2. Artist OS imports the rebuilt TypeScript/WASM SDK through its standard
   exporter. Snapshot hashes and source revision identify the exact dependency.
3. Voice sessions preload the actual loaded instructions for the Manager,
   Artist OS Guide, and Skill Scout rather than paying a model/tool round trip
   to reread them. Missing bodies retain the original prerequisite. Artist
   context, catalog, sources, memory, tool permissions, and normal chat remain
   unchanged. A new session is needed to pick up updated skill instructions.
4. The spoken prompt defaults to one to three sentences, no more than 60 words,
   and directly answers greetings. Explicit requests for detail can still be
   long; this is guidance, not text truncation. Tool results still govern claims.

Model, provider, reasoning, microphone, output and voice-style preferences were
not changed. Final answers still wait for committed completion: current deltas
may be tool commentary or may be replaced on fallback, so speaking them early
would be unsafe. True final-answer streaming needs a separate event contract.

## Validation

- Shared SDK: 145 web contract tests pass, web typecheck and WASM build pass.
- Regression tests reproduce oversized bulk-answer and unpunctuated-text
  failures before the fix; cover combined/separate/missing done events,
  normalization growth, split Unicode events, incrementality and cancellation.
- Independent code review found no remaining blocking issues in chunking or
  voice session policy.
- Artist OS: 8,303 tests passed on the initial integration; Electron typecheck
  and renderer production build passed. The clarified spoken-format contract
  passed a fresh full suite: 8,304 pass, 1 skip, 0 fail, and typecheck passed.

This work does not claim a fix for Moonshine immediate-start clipping. The prior
microphone run captured full sentences but started after readiness; that specific
physical timing scenario remains unverified.

## Live comparison on the same model

Existing Electron development app loaded source `c2c8725bd` via HMR. DeepSeek v4
Pro, medium thinking, High energy, Moonshine Balanced, and existing audio devices
were unchanged. Run `e07713ca-0b0f-4caf-bf55-43704c7c8e24`, session
`260907-apt-sunset`; startup to Listening was 3.226 s.

| Trial | Prior answer-audio availability | Updated | Tool calls |
| --- | ---: | ---: | ---: |
| First typed greeting | 12.705 s | 7.461 s | 0 (previously 3) |
| Same greeting, warm session | 4.459 s | 2.883 s | 0 |
| Prioritization question | 32.310 s | 25.709 s | 1 |

These are individual observations, not a statistical provider benchmark. The
prior prioritization question was spoken; the repeat was typed and had a
different session history. Both timing intervals start at accepted input.

The greeting replies were 39 and 29 characters. The prioritization answer was
still 902 characters: the initial 60-word prompt did not reliably constrain it.
Inspection found mandatory profile-audit memory and written brief formats, plus
an ambiguous instruction to put detail in chat despite all final text being
spoken. The follow-up prompt correction explicitly makes the entire final reply
the spoken reply, preserves required checks, and separates spoken formatting
from written report formats. No text truncation or extra summarizer is used.

A deliberately requested long answer produced 1,451 characters. All 14 speech
requests completed, the largest was 183 characters, and the app returned to
Listening with zero errors. Total playback completed 102.933 s after input.
The runtime was then stopped. This verifies the previously failing bulk-answer
shape through the real Inworld transport, while physical audio quality still
requires the listener's assessment.

Scalar trace: `/private/tmp/artist-os-voice-response-live.json`. No spoken text,
audio, tool payloads or credentials are added to this diagnostic artifact.

## Final spoken-format trial

Source `c9693197c`, fresh session `260907-vivid-chrome`, run
`66efdeff-c008-4172-89c5-b754875a4781`. Same DeepSeek v4 Pro/medium route.
The same prioritization question returned 58 words (306 characters), with no
speech errors. It used one tool taking 18 ms, but first model text arrived at
31.261 s and answer audio at 32.440 s after input. The spoken format improved;
model/agent response latency remains unresolved. This cold-session trial is not
directly comparable to the previous warm tool trial. Runtime stopped afterward.

Scalar trace: `/private/tmp/artist-os-voice-response-final-live.json`.
Next comparison should isolate reasoning/model speed while preserving the
normal Manager's settings; do not attribute this remaining wait to the chunker.

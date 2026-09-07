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

## Model comparison controls

The collapsed Response timing panel now accepts a test model ID and lower
reasoning (Low or Off). These overrides apply only when timing is enabled and
only to the newly created voice session. Blank selections retain Manager
settings; the current connection and approval policy are preserved. The launch
receipt records the requested trial model and reasoning. Effective model and
fallback events still need verification in live logs.

The controls are in memory, lock while the runtime is starting/running/stopping,
and never write the saved Manager or default connection. Review found no
blocking issue. The regression test covers disabled diagnostics, default
selections, explicit Off, non-mutation, and matching receipt configuration.
After merging current main (including the Signals briefing work), the full
repository test command, Electron typecheck, renderer production build, and
185-file SDK snapshot check all passed. Verification logs are under
`/private/tmp/artist-os-voice-trial-{suite,typecheck,build}.log`.

The user selected a speed-first comparison: DeepSeek Pro/medium, Pro/low, and
Flash/low. An isolated Pi benchmark was prepared conceptually, but automatic
approval review rejected creating its harness twice, requiring explicit consent
to send the existing full Artist Manager context to `api.deepseek.com`.
At that point no benchmark request ran and no credentials were decrypted.
Temporary encrypted credential copies were removed; comparison awaited consent.

## Authorized model comparison and focused voice candidate

The user subsequently explicitly authorized sending the existing Artist Manager
context to the configured DeepSeek endpoint, including testing a focused voice
mode without tools. Both isolated Pi comparison matrices completed successfully:
18 turns, no errors or tool calls. These are sequential individual observations,
with provider caching, not latency distributions or end-to-end audio timings.

| Context / model | Cold greeting, final text | Warm greeting, final text | Priority answer, final text |
| --- | ---: | ---: | ---: |
| Full / Pro medium | 3.867 s | 1.792 s | 5.267 s |
| Full / Pro low | 2.651 s | 1.821 s | 11.696 s |
| Full / Flash low | 1.354 s | 1.141 s | 2.027 s |
| Compact / Pro medium | 2.519 s | 3.252 s | 3.137 s |
| Compact / Pro low | 2.256 s | 1.529 s | 2.371 s |
| Compact / Flash low | 1.090 s | 1.008 s | 1.578 s |

Full voice context was 65,399 characters (17,437 input tokens in the first
trial); the compact benchmark prompt was 2,631 characters. Compact Flash's
priority reply began at 1.101 s and contained 38 words. Lower reasoning on Pro
alone did not consistently reduce delay. Some Pro/medium greetings became
unsolicited planning, motivating the strong delivery rule after the brief.
The priority answers used supplied snapshot data, with no fresh tool lookup.

Numeric evidence: `/private/tmp/artist-os-model-speed-results.json` and
`/private/tmp/artist-os-model-speed-compact-results.json`. The latter also holds
local answer text for quality inspection. Encrypted credential copies were
removed after each run; saved settings were not changed.

The candidate under Response timing uses a main-owned, streaming, tool-free
model service. It creates no Agent/SessionManager runtime, registers no tools,
does not replay failed or empty replies, and does not substitute models. API-key
credentials stay in main. Unsupported auth/model/protocol combinations fail
explicitly. Normal Manager chat and voice remain unchanged unless this test
mode is selected. Focused transcripts are temporary and not saved to chat.

Each turn receives the existing bounded Manager Brief with freshness warnings
and provenance, refreshed through the normal authorized context API. The
conversation can discuss goals, priorities and decisions; actions are referred
to Manager chat. Recent successful conversation history is bounded. Cancellation
is tied to the owning app window and handles pending registration, navigation,
renderer loss and late provider events.

The actual new main-owned service was then tested with its production connection,
credential, model-resolution and streaming dependencies in an isolated windowless
Electron host. It used the real generated HQ document and the new prompt builder
(3,491 characters), confirmed `pi-api-key` / `pi/deepseek-v4-flash` / low,
and registered in 249 ms. All four requests completed without errors or fallback.

| Actual focused service | First text | Final text | Words |
| --- | ---: | ---: | ---: |
| Greeting | 1.572 s | 1.931 s | 27 |
| Warm greeting | 1.550 s | 1.739 s | 11 |
| Priority | 1.970 s | 2.435 s | 45 |
| Action request | 0.966 s | 1.331 s | 38 |

The action request explicitly directed scheduling/messaging to Manager chat and
claimed no execution. The first greeting still included unsolicited campaign
commentary, a remaining conversational-quality issue. Snapshot grounding does
not prove fresh tool verification. These measurements still exclude TTS/audio.
Local evidence: `/private/tmp/artist-os-focus-service-live-results.json`.

Nineteen focused service, renderer-transport and prompt tests pass. They cover
streaming before completion, absent tools/retries/fallback, bounded history,
owner/turn isolation, provider failure and timeout, cancellation during pending
setup/context, and context warnings. Review also found and closed a hook setup
microtask race; ownership is now rechecked immediately before registration.
The complete repository suite passed: 8,358 tests, 1 skip, 0 failures. Electron
typecheck, main/preload bundles, and renderer production build also passed.

## Integrated focused voice playback

Canonical development app restarted on main `1f1c41293`. Existing High energy,
Moonshine Balanced and audio devices were preserved. Response timing explicitly
selected focused/no-tools, `pi/deepseek-v4-flash`, low, typed input. Run
`5c73c326-2209-47b5-b21e-204a7624398c`; Listening at 3.515 s. Actual session
receipt confirmed `pi-api-key`, Flash and low; setup took 24 ms.

| Typed trial | First model text | Final model text | Playback started | Playback completed |
| --- | ---: | ---: | ---: | ---: |
| Greeting | 0.724 s | 1.067 s | 2.483 s | 11.533 s |
| Warm greeting | 1.106 s | 1.114 s | 1.578 s | 5.059 s |
| Priority question | 0.999 s | 1.401 s | 1.529 s | 17.019 s |
| Schedule-post request | 1.343 s | 1.761 s | 1.801 s | 14.703 s |

Times start at accepted typed input. All four turns returned to Listening with
no errors, tool calls or fallback. The priority answer was 207 characters and
used the current brief's Artist Profile next step. The schedule request explicitly
said it could not schedule and required Manager chat; nothing was scheduled.
The first greeting still mentioned the current release unprompted. The action
reply also redirected toward profile completion, which can feel overbearing.
These quality issues remain visible rather than being hidden by truncation.

Speech synthesis began before complete model text on the longer replies,
verifying the streaming path through Voice Core and Inworld. Compared with the
earlier 25–32 s priority-answer waits, this is a substantial observed improvement;
the context and session histories differ, so it is not a controlled distribution.
Physical listening quality and microphone-start clipping are still not certified.
Runtime stopped after the four tests. Scalar evidence:
`/private/tmp/artist-os-focused-voice-live.json`.

## Microphone comparison

The user then tested the microphone live with focused Flash/low and the same
devices/style, run `7eb55cbd-f2a3-4e5d-912b-ee0aa12c1d1a`. Listening appeared at
3.023 s; first capture was 60 ms later. The first two accepted utterances each
contained 17 characters / four words, rather than the prior one-word symptom.
Finalization took 98 ms and 133 ms. Playback began 2.053 s and 1.218 s after the
accepted final transcripts, respectively.

The user continued for nine completed turns, all without errors, fallback or
tools. Playback-start waits after final transcription were 2.053, 1.218, 2.504,
1.611, 1.412, 4.048, 5.467, 1.798 and 2.115 s (median 2.053 s). The 5.467 s
outlier remains part of the result; this is not a consistent sub-two-second
guarantee. This fresh voice start followed the typed trials in a warm app, and
does not prove first-install/cold-machine or before-Listening speech behavior.
The original clipping symptom was not reproduced; no STT fix is claimed.

The conversation also showed a tendency to redirect creative/content discussion
toward the brief's checklist. Focused voice is the strongest tested v1 candidate,
with conversational judgment and reliable action handoff still requiring polish.
The user stopped the microphone run; UI returned to Ready. Scalar evidence:
`/private/tmp/artist-os-focused-microphone-live.json`.


## Spoken completion and confirmed Command handoff

The user reported one reply ending mid-question, “Can”, in microphone turn 7.
That turn delivered 134 text characters; its three completed synthesis chunks
were 35, 94 and 3 characters (plus two removed boundary spaces). Playback completed
before the next capture. This points upstream of playback; the historical
provider finish reason was not recorded, so token exhaustion is a hypothesis,
not a retrospective certainty.

Focused low reasoning now receives a 2048-token total output budget (reasoning
included); off remains 512. Spoken answers still target 60 words. Provider
completion reason and available output/reasoning counts enter scalar diagnostics.
A length completion surfaces an incomplete-reply error instead of silently
committing successful history or replaying partial speech.

The prompt keeps the same Artist Manager identity, calls the work surface
Command, and explains readiness without dashboard fractions or invented launch
blockers. Exact counts remain factual: 2 of 21 completed means 19 open.

Focused voice now exposes one bounded tool, `open_command_chat`, using a captured
catalog of active agent names, slugs and short descriptions. A valid tool call
only prepares an offer naming the destination and agreed task. The next clear,
unqualified affirmative confirms it within two minutes. No provider round trip
is needed for confirmation. Declining, qualifying the answer, changing topic,
stopping or restarting invalidates that offer. Invalid/duplicate/failed tool
output cannot open a chat.

After the closing acknowledgement finishes playback, voice shuts down before
Command opens a normal agent session. The agreed brief is prefilled and unsent;
the artist reviews and sends it. Normal agent permissions, context and model
settings apply there. Only the agreed brief carries over, not a saved voice
transcript. Cleanup failure, interruption, stale workspace or unavailable target
blocks navigation. This was initially an opt-in focused candidate under Response
timing. The Conversation settings integration below makes it the normal voice
path; Command sessions remain unchanged.


A real Flash/low trial selected Branding Agent correctly and confirmed in 0 ms,
but streamed “Opening the draft now” before the app's confirmation offer. To
prevent this, sessions with handoff available hold the short model reply until
its completion shape is known. Tool turns discard all model preamble and speak
only the app-generated offer. Ordinary turns then emit their completed reply;
Voice Core still chunks synthesis/playback. This trades the remaining text
streaming time for reliable handoff wording and avoids speaking a truncated
reply in this mode. The no-handoff transport retains direct streaming. Measure
this added wait in the integrated run rather than reusing earlier TTFT claims.


### Fresh verification

At `621a3482e`, the full app suite passed 8,393 tests, with one skip and zero
failures. Electron typecheck, main bundle and renderer production build passed.
The buffered production-service trial returned a greeting in 1.249 s and a
complete 55-word answer in 1.571 s; the measured text hold was 381/772 ms.
The trusted offer took 3.215 s; confirmation made zero provider calls and zero
credential reads. No incomplete completion or provider error occurred in these
four turns. Greeting still volunteered a campaign mention, so conversational
judgment remains a model-quality limitation.

The canonical app was restarted, then the actual UI used typed input through
Voice Core/Inworld, run `c2c44a4a-2651-4e04-a1d3-98309e0072f2`. The request was
artist-wide playful/raw/colorful branding. Listening took 3.827 s. The trusted
Branding Agent offer began playback 3.125 s after input and finished normally.
Separate “Yes, sounds good” began acknowledgement playback after 448 ms;
playback completed and Stop occurred at the same trace timestamp. The app then
opened Branding Agent session `260907-sleek-peak` in Command, with a populated
unsent draft, normal DeepSeek Pro selection and Approval Mode. No drafted work
was sent or executed. Scalar evidence: `/private/tmp/artist-os-voice-handoff-ui-live.json`.

The draft correctly kept artist-wide scope, but also added unrelated campaign
facts. The final prompt now requires the handoff brief to contain only work and
direction actually agreed in the conversation, excluding snapshot campaign
names/dates/blockers unless requested. The destination agent loads its own
normal context, so this handoff does not need to duplicate it.


Two fresh production-service sessions verified that final scope rule. Artist-wide
visual directions produced a Branding Agent offer in 1.710 s; an evergreen
identity guide took 1.975 s. Both retained the requested work and omitted
snapshot campaign names, dates, readiness blockers and metrics. These were
proposal-only checks (no navigation/execution), distinct from the earlier full
UI handoff proof. Evidence: `/private/tmp/artist-os-voice-scope-live-results.json`.
The UI test draft was subsequently labelled as test input and manually cleaned;
it remains unsent and is not an approved creative direction.


### Focused selection surviving navigation

A follow-up exposed a host UI bug: measurement, focused mode and voice-model
selection were plain hook state. Navigating out of HQ remounted the hook with
focused mode off and the normal Manager model, making the next call slow again.
Those user-selected values now persist alongside existing local voice/device
preferences. Typed test input remains session-only so a later call uses the
microphone. A packaged app is a separate build/profile and does not update when
Git main or the development renderer changes.


### Dedicated Conversation settings

Settings → Conversation now owns a profile-level `artistManagerVoice` record:
exact connection/model, off/low reasoning, speaking style and hearing provider.
It is independent of Agent definitions, Command session settings, connection
defaults and global fallback settings. No second Manager identity is created.
The initial route is unconfigured; users explicitly choose their voice model.
Save validates the exact supported API-key route without fetching credentials.
Malformed stored settings are reported, not overwritten. Deleted connections
and unavailable models fail explicitly rather than falling back to Command.

Every normal conversation uses the focused runtime and reads these saved
preferences at Start. Registration resolves that voice connection and model
without consulting the Manager. Response timing only controls measurements;
it cannot switch runtimes or models. The dialog links to Conversation settings
and keeps local hardware selection/model installation together. Confirmed
handoffs still open an unsent draft in the normal Command agent and preserve
that agent's normal model, context and permissions.

The interim localStorage persistence patch above is superseded for voice
model/style/hearing by the dedicated app configuration. Only measurement and
existing hardware preferences remain local; typed diagnostic input is session-only.


Production settings verification used an isolated copy of the profile and the
actual storage/resolver/provider implementation. Two fresh service instances
registered with no model or reasoning override and selected the saved
`pi-api-key / pi/deepseek-v4-flash / low` route (registration 1 ms / 0 ms).
A greeting produced first text in 1.264 s and completed in 1.452 s (13 words,
normal stop). This is LLM-only timing, not microphone-to-playback timing.
Manager file bytes and every other configuration field stayed unchanged;
Command still resolves through the existing Pro default. The temporary
credential copy was removed. Evidence: `/private/tmp/voice-settings-live-results.json`.

The tested Flash/low, High energy, Moonshine Balanced configuration was then
saved only in the Mikey Mike development profile (`~/.artist-os-dev`). Read-back
verified the voice record and preservation of the Manager and all other
configuration fields. The packaged app's separate `~/.artist-os` profile was
not migrated or changed. Evidence: `/private/tmp/voice-settings-applied.json`.


### Call surface cleanup

The conversation modal now presents a quiet portrait call surface: Manager
name, short state label, an avatar area and compact call controls. The current
avatar area is a neutral person icon pending the artist's supplied asset; it
is not an animated avatar or lip-sync implementation. Captions are optional
and off by default, resetting when the window closes. The gear reveals audio
devices, installation, a Conversation settings link and collapsed timing
diagnostics. Setup and errors remain reachable when a call cannot start.
Start, connecting cancellation, End and window-close still use the existing
voice lifecycle. This change does not alter model routing or the audio pipeline.


### Prepare on open, capture on Call

Opening the call modal now prepares the selected local Moonshine transport and
registers the bounded voice Manager session. No microphone, cloud STT session,
model request or TTS request starts during this preparation. Call waits for
and reuses that same preparation; `VoiceCoreWeb.start()` remains the capture
boundary. The native transport's existing idempotent start retains the warmed
model. AssemblyAI remains unopened until Call. Inworld synthesis remains on
demand; this does not claim that all network or audio-device startup disappears.

Closing, unmounting, changing workspace/device/diagnostic options, or installing
a model releases preparation. A dedicated cleanup wrapper covers native STT
and the focused session even when Voice Core never started (its normal destroy
path otherwise skips unstarted transports). Late preparation cannot start
capture; quick Call is deduplicated against the in-flight preparation. Settings
are checked again at Call; if another window changed them, capture is blocked
and the next Call prepares the new configuration. Cleanup failure still blocks
restart. Timing now distinguishes preparation, Call requested and Listening.

An isolated real-hook harness verified warm-only zero-capture/zero-request
behavior, reuse, quick Call, cancellation/late completion, reopen, device/timing
invalidation, missing configuration, cloud deferral and settings changes. It
used the real native renderer transport and focused transport with mocked
Electron/media/VoiceCore boundaries; it is not physical microphone or measured
click-to-listening evidence. Report: `/private/tmp/artist-os-voice-warm-hook-harness/result.json`.


### Cleaner settings and contextual openings (2026-09-07)

Conversation settings now uses one searchable voice-model picker across
supported, authenticated API-key connections. Each option carries both the
model and its exact connection. Fast/Flash/Haiku/mini families are offered;
unsupported authentication/protocols and specialized audio/image/search/coding
models are excluded. Main still validates the exact SDK route at Save.
Unsupported legacy selections are preserved until the user explicitly chooses
a supported replacement. Hearing offers Moonshine Balanced or AssemblyAI;
Inworld setup is a compact status badge and Services link. No Command setting
or existing saved voice selection was changed by this UI update.

For a first-turn greeting-only utterance, the focused service sends a short
Manager greeting prompt without the artist snapshot or handoff catalog. The
whole-utterance check does not catch substantive questions beginning with
"um hey". Real work receives the normal snapshot, available agents and bounded
conversation history. This removes irrelevant artist statistics from the
opening request instead of relying only on another prompt admonition.

An isolated production-provider check used the saved DeepSeek v4 Flash/low
route with the real artist snapshot and available-agent catalog. A greeting
returned a neutral 15-word reply in 2.512 seconds (first text 2.447 seconds).
The user's exact creative campaign/video-agent question then received a
42-word recommendation for Scroll Stopper in 2.110 seconds. Both completed
normally without fallback. These are model timings; microphone detection and
TTS playback are excluded. The temporary credential copy was removed.
Evidence: `/private/tmp/artist-os-voice-greeting-live-results.json`.

Settings verification: five pure model-option tests, eight browser checks
against the actual page/components with mocked IPC, and Electron typecheck.
Screenshot: `/private/tmp/artist-os-voice-settings-redesign/conversation-settings.png`.

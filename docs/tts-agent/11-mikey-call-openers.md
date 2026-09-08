# Mikey starts the call

After the user presses Call and `runtime.start()` completes, Mikey opens with one short greeting. Modal warmup alone still does not activate the microphone or play speech. A user who speaks before activation finishes takes priority and suppresses the opener.

The profile parser reads `artist-profile` during the existing preparation phase. Missing, malformed, or unsafe-for-speech names produce a nameless greeting. Eight curated casual openers provide variation without a model round trip or invented campaign updates. Selection excludes the previous opener for that workspace while the main-process service lives; the bounded cache resets when the app restarts.

The SDK's existing transcript entry point carries a private per-transport opening cue. Renderer captions and user callbacks filter that cue, and the focused transport marks it as an opening turn over IPC. The main service emits the curated text through its normal streaming events, records only an assistant history message, and rejects opening requests after any prior turn. It does not call a model or offer a handoff for the greeting. Subsequent artist replies retain the existing context and handoff behavior.

Speech uses the existing TTS, output consumer and phoneme/avatar path. Session ownership, stop/cancel, late-event rejection and observer cleanup remain in that path. No second audio player, voice provider, SDK change, or avatar asset is added.

Tests cover named/nameless output, no consecutive opener repetition, one-time admission, no model request, assistant-only history, cue filtering and user-first suppression at the transport boundary. A physical call still needs to confirm perceived opener timing, interruption and lip sync after an authorized build/relaunch. Do not treat tests as proof of those device checks.

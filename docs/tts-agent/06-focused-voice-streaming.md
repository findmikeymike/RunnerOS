# Focused voice streaming — 2026-09-07

Ordinary replies previously waited for the entire model response whenever the
Command handoff tool was available. DeepSeek v4 Flash now streams a local
`voice_reply({text})` envelope on the verified official endpoint with voice
reasoning Off. This uses one model request, no tool executor or second model
round trip. App-validated handoffs still require confirmation and open an unsent
draft. Command model and reasoning settings are independent and unchanged.

The SDK payload hook enforces one tool choice only for that exact tested route.
Reasoning-enabled DeepSeek rejected forced tools in live testing. Other models,
custom endpoints and reasoning settings preserve their existing buffered path.
Plain text marker instructions were also tested and ignored by the provider;
they are not part of the implementation.

Speech streams from append-only parsed arguments, never from a handoff's
arguments. Mixed tools, rewritten speech, invalid final arguments, cancellation,
truncation and provider failure cannot commit history or navigate. Already
streamed speech cannot be retracted after a later provider failure.

Local timing metadata is now recorded without enabling the diagnostic UI.
It contains scalar timing/size/status fields, never transcripts, prompts, keys
or tool arguments. The moving clock follows the stable artist brief to retain
more reusable provider prefix; a cache-hit improvement was not measured.
Common complete confirmations such as “Yeah, do it” now avoid an intent request.
Qualified or unclear replies retain contextual interpretation.

## Live evidence

Production focused service, isolated profile, fictional Riley North context;
configured official DeepSeek endpoint. No TTS, microphone, navigation or work
execution in this benchmark. These small samples are observations, not a
statistical latency guarantee.

| Same sequential trial | Flash Low: first delivered text | Flash Off with streaming: first text | First sentence | Full response |
| --- | ---: | ---: | ---: | ---: |
| Long career question | 2.522 s | 0.748 s | 0.880 s | 1.628 s |
| Follow-up | 1.754 s | 0.853 s | 1.028 s | 1.514 s |

The streamed answers were 59 and 39 words. The Branding Agent offer completed
in 2.095 s; “Yeah, do it” emitted the original handoff without another provider
request (below 1 ms in this run). An earlier streaming run delivered first text
in 0.891/0.718 s. Offer and confirmation passed both runs.

This measures text available to Voice Core, not audible response time. The next
physical call's automatic STT, TTS and playback timings can locate any remaining
end-to-end delay. No speculative STT threshold or shared Voice Core change was
made.

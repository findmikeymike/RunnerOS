# Voice Core Web

Browser wrapper for the voice runtime.

Vite consumers must emit the WASM runtime worker as an ES module:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
});
```

Current status:

- TypeScript package scaffold
- Vite demo scaffold
- wasm-bindgen runtime crate
- browser capability probes
- worker runtime boundary
- explicit JS-owned transport interfaces
- browser-side transport orchestration hooks for STT -> LLM -> TTS
- mock STT/LLM/TTS transports for local end-to-end pipeline validation
- browser-side OpenAI LLM adapter
- provider-neutral LLM selection for OpenAI, Together AI, Groq, OpenRouter, and custom/self-hosted gateways
- versioned built-in model recommendations plus a strict parser for operator-delivered catalog refreshes; custom model IDs remain editable
- browser-side Inworld TTS adapter
- token-based AssemblyAI browser STT adapter
- live demo wiring for mock transports, OpenAI LLM, Inworld TTS, and AssemblyAI STT via same-origin proxies
- bounded local Vite dev proxy endpoints for all five LLM choices and AssemblyAI token issuance
- optional backend session-token gate for commercial web access

The browser runtime now includes bounded realtime capture/playback queues,
streaming resampling, playback backpressure, and generation-safe barge-in.
Physical browser/device certification remains a separate release gate.

Notes:

- Capability reporting currently has two surfaces on purpose:
  - `getCapabilities()` returns browser/runtime environment probes such as `audioWorklet` and `sharedArrayBuffer`
  - `getSdkCapabilities()` returns wrapper-level SDK support flags such as `runtimeSetters`, `toolCalling`, and `commercialWebGate`
- This split is temporary but intentional. It avoids breaking existing web callers while the broader SDK contract is being aligned across platforms.
- The browser STT path should prefer a same-origin WebSocket proxy that can attach the real `Authorization` header server-side.
- The browser Inworld TTS path should also use a same-origin WebSocket proxy so the real `Authorization: Basic ...` header stays server-side.
- The web AssemblyAI adapter now matches the native transport on core query params: `encoding=pcm_s16le`, `end_of_turn_confidence_threshold`, `min_end_of_turn_silence_when_confident`, `max_turn_silence`, `vad_threshold`, and repeated `keyterms_prompt`.
- Direct browser OpenAI API keys are for local dev only and now require the explicit `allowInsecureBrowserProviderKeys: true` opt-in. For production, point `createOpenAiTransportBundle()` at a backend proxy base URL and keep provider credentials server-side.
- AssemblyAI and Inworld provider secrets are rejected from `VoiceRuntimeConfig`; use temporary tokens or trusted same-origin proxies.
- Runtime configuration is validated fail-closed and can only change while stopped. Transport replacement remains available while running and is transactional.
- Browser commercialization is account/session based, not native Cryptlex client enforcement. Use `requireCommercialAccess: true` with a short-lived backend-issued `sessionToken` when you want the wrapper to refuse startup without backend authorization.
- For your own internal or private web apps, leaving `requireCommercialAccess` off is acceptable. For customer-facing sold web integrations, keep it on and enforce tokens server-side.
- Recommended proxy contract:
  - HTTP proxy requests carry `X-VoiceCore-Session: <token>`
  - WebSocket proxy URLs carry `voice_core_session_token=<token>`
  - your proxy should validate that token and must not forward it upstream to OpenAI, AssemblyAI, or Inworld
- Server-side integration kit: [`server/README.md`](./server/README.md)
- Local dev proxy now supports a dev-only session endpoint:
  - `POST /api/voicecore/session`
  - returns a short-lived signed token for local gating tests
- To force local gating in Vite dev:
  - set `VOICECORE_WEB_REQUIRE_SESSION=true`
  - optional: set `VOICECORE_WEB_SESSION_SECRET=...`

Local live test flow:

1. Set env vars before running Vite:
   - `OPENAI_API_KEY=...`
   - or `TOGETHER_API_KEY=...`, `GROQ_API_KEY=...`, or `OPENROUTER_API_KEY=...`
   - for custom/self-hosted: `VOICECORE_LLM_API_BASE=...` and optional `VOICECORE_LLM_AUTH_TOKEN=...`
   - `ASSEMBLYAI_API_KEY=...`
   - `INWORLD_RUNTIME_KEY=...`
2. Run `npm run dev` in this package directory.
3. Open the local app and click:
   - `Use Live OpenAI` with the default base URL `/api/openai`
   - `Use Live Inworld TTS` with the default WebSocket proxy `/api/inworld/tts/ws`
   - `Use Live STT` with the default WebSocket proxy `/api/assemblyai/ws`
4. Click `Start` and test mic -> STT -> LLM -> TTS

Local gated test flow:

1. Start Vite with:
   - `VOICECORE_WEB_REQUIRE_SESSION=true`
2. In the demo:
   - click `Fetch Dev Session Token`
   - confirm `Require backend-issued commercial session token before start` is enabled
   - click `Start`

The Vite dev server now exposes:

- `/api/openai/chat/completions`, `/api/together/chat/completions`,
  `/api/groq/chat/completions`, and `/api/openrouter/chat/completions`
  Same-origin dev proxies using the matching server-side API key
- `/api/custom/chat/completions`
  Same-origin dev proxy using `VOICECORE_LLM_API_BASE` and optional
  `VOICECORE_LLM_AUTH_TOKEN`
- `/api/assemblyai/ws`
  Same-origin dev WebSocket proxy to AssemblyAI using `ASSEMBLYAI_API_KEY`
- `/api/inworld/tts/ws`
  Same-origin dev WebSocket proxy to Inworld TTS using `INWORLD_RUNTIME_KEY`

LLM routes accept only exact `POST /chat/completions` traffic, cap request bodies,
strip browser credentials and query parameters, reject upstream redirects, abort
provider work when the browser disconnects, and never expose provider keys to the
browser. These are development routes, not a production backend or rate limiter.

Architecture note: browser providers remain JS-owned because native/network
transport crates are not browser-compatible; the WASM boundary intentionally
contains transport-light conversation state and audio normalization.

# Source inspection evidence

2026-09-10; r1; worktree base 4491d212283bf5c31599c4488201ccaf75236a29. Read-only review, not runtime verification. Hashed source manifest: ../sources.json.

- useArtistManagerVoice: focus preparation and Call lifecycle; Inworld phonemeTimestamps:true; onPlaybackFrame; handoff completion closes call. Normal speech and avatar should remain here.
- artist-manager-voice-focus main/shared/renderer transport: ephemeral focus owner/session, bounded conversation history and user-turn streaming; no persistent worker ownership by itself.
- focused voice prompt: explicitly forbids work and offers unsent Command draft. Bridge-enabled prompt must be capability-aware and preserve disabled fallback.
- AgentMessageService.messageAgent: active specialist checks, permission/depth validation, receipt and hidden child, background:true returns immediately. Detached asynchronous execution does not survive process death.
- shared agent-messaging storage: JSON receipt temp-file then rename; atomic file replacement, not transactional launch or durable executor.
- SessionManager: constructs AgentMessageService, persists passive result info, eligible Goal-only continuation, respondToPermission and cancelProcessing. Worker interaction/approval originates from exact child session; ordinary hidden-child agent-message restrictions cannot be bypassed casually.
- Existing receipt states are running/succeeded/failed/cancelled/timed-out. Waiting and interrupted are new bridge states, not claims about existing schema.
- Vendor VoiceCoreWeb.completeUserTranscript aborts current response pipeline before generation. pushAssistantText exists but is not established as a safe external event/TTS API. agentSpeechComplete aliases assistantAudioStop; consumed-audio arbitration needs T-102 proof.

A separate read-only mapping agent confirmed worker seams and the single-turn/permission/cancellation/restart gaps. No external repository code was installed or run. Third-party README web reads inform architecture only; exact remote commit was not pinned and must be resolved if code reuse is later proposed.

# Signals Audio Briefing

## Behavior

- The final Weekly Signal Brief includes `## Your Briefing`: a conversational manager recap targeting 120-150 words. It explains supported insights and artist relevance, with a next move only when justified. The full report and sources remain intact.
- The parser tolerates 80-180 words but refuses missing, unavailable, oversized or markup-heavy scripts. Older reports do not acquire invented recaps.
- Signals shows Listen and a text disclosure for eligible final reports. Playback has native play/pause, seek, volume, speed, and close controls. Nothing is synthesized before a click.
- Changing reports or leaving the player pauses audio. Unrelated output refreshes preserve playback; actual report revisions reset it.

## Integration

- Uses the existing encrypted Inworld key/voice resolution, including legacy aliases; default voice Dennis and `inworld-tts-2-flash`.
- `outputs:readSignalBriefingAudio` is local-only and not an agent tool. The host verifies workspace permission, published output provenance, the successful workflow's final output, and the saved primary file. Renderer text is compared with the saved briefing, never used as arbitrary synthesis input.
- Only the briefing text is sent directly to Inworld. No LLM or microphone session is started. Provider errors, tokens, and report text are not logged.
- Audio is cached in the local app config cache, outside the workspace, keyed by workspace/output, report content, voice, and model. Concurrent identical requests share synthesis; replay uses cached audio. Writes are atomic; corrupt cache entries can regenerate. Network and payload sizes are bounded.
- Existing installed workflow files are preserved byte-for-byte so scheduled definition digests remain valid. Only an exact previous built-in Signal Analyst prompt is refreshed. Customized prompts and deleted definitions stay untouched. New installs receive the briefing instructions in both the agent and workflow.

## Verification

- Focused backend/parser/template regression tests cover ownership, final-report provenance, stale text, cache reuse/invalidation, concurrency, credentials, corrupt audio, errors, timeouts, and preservation of installed schedules/customizations.
- `scripts/verify-signal-briefing.mjs` exercises the actual React player and report-content hook inside isolated Electron. It covers on-demand generation, duplicate clicks, pending-request cancellation, report switches, setup errors, retry, speed, pausing detached audio, stable background refreshes, and revision reload.
- Desktop and 390px screenshots with the built renderer styles were inspected without horizontal overflow.
- Tests use mocked Inworld responses and synthetic local audio. No live paid Inworld request or real collector/synthesis run was made during implementation; voice quality and real-account delivery require that separate smoke test.

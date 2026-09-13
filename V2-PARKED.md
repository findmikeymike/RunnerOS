# V2 Conversation Background Tasks — parked

Parked at Michael’s request on 2026-09-13. Do not resume implementation or promote this to the current product without his direction.

Current location: `/Users/michaelb.williams/RunnerOS/.worktrees/Artist OS v2 features/conversation-background-tasks`
Original location: `/Users/michaelb.williams/RunnerOS/.worktrees/conversational-work-spec`
Branch: `codex/conversational-work-spec`. Michael authorized a local checkpoint commit of all feature implementation, tests, vendored SDK changes and specifications on this branch. This is an unfinished V2 checkpoint, not live acceptance. Moved with `git worktree move`; 4,452 source/spec files verified identical and Git dirty status unchanged before this parking note.

The existing simple voice-to-Command product remains the intended current experience. This candidate is unfinished: live confirmation/routing was incoherent, the first real saved-result-in-call milestone never passed, and later question/approval/revision work remains incomplete. Do not equate automated tests with live acceptance.

Latest changes add explicit “confirm” recognition and resolve contradictory Command-only prompts. 90 targeted tests, Electron type check, and main/renderer builds passed. Relaunched for smoke; Michael still reported incoherent confirmation and chose to defer the feature. Candidate app was quit before parking. The initial parking move did not commit, merge, push, or launch the canonical app. The subsequent checkpoint commit is authorized for this feature branch only; main and remotes remain untouched.

Resume through `docs/build-specs/conversational-work-bridge/start-here.md`, `state.md`, and `evidence/T-203.md`. Historical paths inside those documents are evidence of the original location. Verify all setup and rebuild after moving; generated files and dependency links may retain old absolute paths. Saved voice preferences and runtime data remain in Michael’s existing `.artist-os` profile; parking does not reset them.

The existing machine-local `apps/electron/.voice-core-dev` symlink is preserved and ignored (like the development resource directory), rather than committed as a machine-specific dependency.

# Video Studio recovery and Content Lab build plan

Status: bounded recovery, shared rendering, rendered-result review, coordinated saves, and saved-agent handoff implemented; not integrated into Artist OS main. Content Lab and full editor acceptance remain open.

## Authority and scope

- Product baseline: canonical Artist OS `main`, `c5d30de2e`.
- Historical editor: `.worktrees/archive/2026-08-30/video-agent-tools`, branch `codex/video-agent-tools`, `abca04422` (June 21).
- Continuation: `.worktrees/active/video-studio-content-lab`, branch `codex/video-studio-content-lab`, based on current main.
- Historical branch diverges by 23 commits and trails main by 1,081 commits at inspection. It must not be merged wholesale. Video code was recovered with a scoped three-way patch; current permissions and current application infrastructure were preserved.
- The older branch's “Creative Lab” toolbar shortcut was excluded. Creative Lab remains the writing/song space. Content Lab is the proposed home for content production; no new workspace kind or navigation hub is installed by this pass.
- Other agents' Lab Inspiration and licensing changes in canonical main remain untouched. No commit, restart, live provider request, publication or deployment was performed.

## What exists

| Area | Recovered implementation | Evidence / limitation |
| --- | --- | --- |
| Project model | Local versioned JSON, validation, coordinated expected-content saves, backup recovery, media/track/clip metadata | Editor/RPC, agent and CLI share short cross-process commit locks; unrelated direct filesystem writes bypass them |
| Human editor | Media bin, clip timeline, drag/trim/split/move/delete/duplicate, lanes, snapping, undo/redo, inspector | UI source and pure math/state regressions; interaction acceptance still required |
| Import | Video/audio/image/caption import, probe metadata, thumbnails, waveforms | Real FFmpeg fixture tests; invalid-media and large-import UX require more acceptance |
| Captions | SRT/VTT parsing, cue storage, caption clips, burn-in | Render tests; caption authoring UI remains limited |
| Audio and timing | Per-clip speed, volume, fades, muted/hidden tracks | Real rendering tests; full live mixed-audio preview is absent |
| Agent tools | Timeline/media reads, contact sheets, rendered inspection, edits, snapshots/diff/undo, export | Structured handlers and tool registry; no provider-driven co-edit acceptance |
| Output integration | Project Output opens editor; render/receipt assets recorded | Existing Artist OS route retained; no separate project library/hub yet |
| Composition | CLI/UI and agent use one shared renderer for crop/transform/opacity and linear x/y motion | Real decoded frame/audio parity tests; unsupported transitions/effects/easing are rejected |
| Playback | Explicit Source/Rendered switch; Render & review exports and opens actual MP4 | Rendered result includes composition/audio/captions; live source playback is not a real-time compositor. Edits mark results stale; older render freshness is unverified |
| In-editor agent command | Starts the saved, activated Video Editor Agent session for the current project | Strict workspace/permission/reference checks; accepted, draft and pending delivery states; real provider/UI acceptance remains unrun |
| Advanced engine | Roadmap and candidate-engine proposal | No adopted engine, benchmark or integration proof; old external comparisons are historical |

## Review findings and this pass

Confirmed through source inspection and disposable reproductions, not inferred from schema fields:

- Speed-adjusted splits used timeline offsets as source offsets. Fix source boundaries in CLI, agent handler and UI, and leading UI trim.
- Export destination checks compared strings; symlink/hardlink aliases and receipt paths could overwrite original media. Resolve filesystem identities before export and preserve source files on failure.
- Fractional render durations rounded up to whole seconds. Preserve exact requested timeline duration within frame/codec precision.
- CLI silently ignored geometry that the agent renderer supported. Initial recovery rejected geometry; the continuation now consolidates both into `tools/video-studio/lib/render-engine.mjs`, supports existing geometry consistently, and explicitly rejects unsupported transitions, effects, easing and keyframe properties.
- UI import reloaded disk without saving pending edits. Save and verify persistence before importing.
- Any workspace Output update could create a false project conflict. Compare this project's disk content with its last saved fingerprint.
- Late loads could populate a newly selected project. Key editor state by workspace/output and ignore stale asynchronous loads.
- Save ignored missing/false bridge results. Require confirmed write success before clearing dirty state.
- Source preview timing ignored speed and could skip immediately adjacent clips. Correct time conversions, playback rate, and boundary selection; name the preview honestly.
- Import awaited derivative generation then overwrote a potentially newer project. Check the captured disk content immediately before committing and reject an import if a save completed during that wait. This does not provide atomic coordination with in-flight asynchronous or separate-process writes.
- Both renderers silently dropped text after eight clips and truncated text/captions at 180 characters. Remove those limits and verify actual rendered frames. Align CLI visual layers with track order.
- Historical render tests silently returned when fixture creation failed. Render verification must assert successful fixture creation.

## Gates before a powerful Content Lab hub

1. **Finish this recovery slice.** Focused rendering/storage/UI-helper tests, current-tree typechecks and renderer build. Review the actual patch. Then authorized isolated-app acceptance: import, edit, save, reopen, source preview, export, external project changes and wrong-workspace races. No claim of visual acceptance from pure tests.
2. **One render contract — implemented for current capabilities.** CLI/UI and agent export share composition logic and capability validation. Independent decoded frame/audio comparisons cover geometry, layering, text, captions and audio. New capabilities must extend that shared contract and its evidence.
3. **Responsive render jobs — partially implemented.** UI export now runs in a separate process using the running runtime, with a five-minute child limit, larger RPC deadlines, bounded diagnostics and POSIX descendant termination. Busy project RPCs fail immediately rather than queue past request expiry. Failure removes the partial MP4 and records a failure receipt. Progress, user cancellation, recovery, Windows descendant termination and packaged FFmpeg/runtime acceptance remain open. Agent rendering remains synchronous in its own handler path.
4. **Durable human/agent co-editing — save foundation implemented.** Editor save, RPC import, shared storage, agent edits/undo/export and CLI mutations use one expected-content commit helper. Comparison, backup and replacement occur under a short cross-process lock. Editor drafts persist immediately per workspace/output with explicit restore/discard/download and original disk baseline. Remaining work: conflict merge UX, safe automatic stale-lock recovery and live human/agent co-edit acceptance. The in-editor agent handoff is now connected through the existing saved-agent launcher.
5. **Real composition preview.** Preview edited layers, images, text/captions and mixed audio at the actual playhead. Validate preview/export parity, gaps, clip boundaries, speed, fades, rotation and resizing. Only then call it a timeline composition preview.
6. **Content Lab first vertical slice.** Project library → import footage → human/agent edit → rendered preview → platform export → Output → explicitly chosen Campaign/Release Kit. Reuse existing content tools (raw-video analysis/repurposing, Video Director, lyric video, Hypermotion) through clear entry points. No publishing permission is implied by export or Final.
7. **Advanced features by measured value.** Transitions, better captions, beat/marker editing, effects, templates, batch variants and keyboard/precision tools. Revalidate external engine capabilities and licenses before adopting a dependency. A schema field is not a shipped feature.

The suggested lead outcome is reliable human + agent editing, with fast captioned variants next. User preference can change that ordering. The scope of “high powered” is intentionally expressed as independently testable slices, not a claim that this audit completes a professional editor.

## Verification record

- Historical branch: 70 focused tests, 354 assertions passed; some old tests contained silent fixture-return paths, so this count alone is not comprehensive render proof.
- Current recovered tree: **104 focused tests passed, 0 failed, 513 assertions** across storage, CLI, agent handlers, RPC import helpers and UI editing helpers (`/tmp/video-integration-tests-final.log`). These include real FFmpeg frames/audio, source preservation, text past the eighth clip/180 characters, layer ordering, speed splits, fractional duration and concurrent-save rejection.
- Shared, server-core, Electron and session-tools typechecks passed. After a test-only strict-indexing correction, the affected actual-frame text regression also passed again (1/1).
- Artist OS main and renderer builds passed in the isolated worktree. Renderer emits existing dependency/deprecation and chunk-size warnings. Build logs: `/tmp/video-integration-build-main.log`, `/tmp/video-integration-build-renderer.log`.
- Independent review verified current permission checks and registrations, then verified the import-conflict guard; the remaining shared-writer race is explicitly documented above.
- Full repository regression suite, live Electron interaction, real agent/provider co-editing, long-render cancellation and packaged/clean-machine acceptance were **not** run. No claim that the editor or Content Lab is complete.
- Existing source/profile data was not used as fixture material.

## Shared rendering continuation

- Added Source/Rendered view selection and Render & review through the existing MP4/Outputs flow. Playback of the actual result uses output time and speed 1 without applying clip effects twice. Editor mutations are blocked during export; composition edits mark the last known render stale.
- Independent audio checks exposed AAC timestamps millions of years from zero when combining speed and delay. Rebuilding sample timestamps after delay fixes silent playback; regression checks verify timestamp bounds, initial silence, audible volume and tail duration through both entrypoints.
- CLI export compares the loaded project bytes immediately before writing export history. Concurrent saved edits cause failure rather than replacing the newer project. This is optimistic detection, not atomic cross-process revision control.
- The shared engine ships in Electron's existing tools tree and is copied into the standalone server's repository-relative distribution layout. Packaged clean-machine execution is not yet certified.
- Fresh combined focused gate: **116 tests passed, 0 failed, 644 assertions** across seven files (`/tmp/video-render-final-tests.log`), including actual decoded media, process responsiveness/termination, and refusal of overlapping work. Shared typecheck and dependency containment passed.
- Fresh server-core, session-tools-core and Electron typechecks passed. Both Artist OS main-process and renderer builds passed; renderer retains dependency/deprecation, CSS and chunk-size warnings. Logs: `/tmp/video-render-final-*-typecheck.log`, `/tmp/video-render-final-build-main.log`, `/tmp/video-render-final-build-renderer.log`.
- Existing dialog/RPC timeout regressions: **2 tests passed, 26 assertions** after rerunning with localhost access (sandbox initially blocked the test server). Combined with the focused gate: 118 passing tests, 670 assertions.
- Independent review checked export-time editor mutation guards and process/timeout behavior; overlapping RPC admission is now fail-fast for import, export and reports. No live app launch/restart, merge, commit or provider call was performed.

## Coordinated saves and draft recovery continuation

This section supersedes earlier notes about separate writers and best-effort comparisons; earlier verification counts describe their respective passes.

- The editor's existing writable Output RPC now requires the exact content originally loaded. Validation, workspace permissions and safe asset targeting remain enforced. Missing or stale baseline fails without modifying project or backup.
- `tools/video-studio/lib/project-storage.mjs` provides one compare-and-commit path for participating editor/RPC, agent and CLI writers. It uses an exclusive sidecar lock, expected-content comparison, prior-content backup and a flushed temporary file replaced by rename. Symlink aliases resolve to the same lock; hardlinked project files are refused.
- Creation is create-only unless an explicit overwrite option is supplied; overwrite still compares its captured baseline under the lock. Read/mutate/write retains the read baseline; snapshot restore/undo compares against the current project's baseline. Import and export compare inside the same commit lock after their long work finishes.
- Corrupt-file recovery also compares its captured baseline before replacing the live file. It preserves the prior backup and refuses to overwrite an intervening save.
- Drafts persist synchronously on timeline/raw-JSON/undo edits, scoped by workspace/output. Return to the editor offers Restore, Discard and Download. Restoration preserves invalid raw JSON and its original saved baseline; a newer disk project blocks stale saves. Storage failures are visible. Successful confirmed save clears only the matching draft.
- Scope limits: unrelated direct filesystem writes do not participate in locks; there is no automatic conflict merge. A crash during the short commit leaves a lock that requires verified-owner recovery rather than unsafe timeout-based lock stealing. Local drafts use browser storage and are not a cross-device or multi-window draft history. Live Electron navigation/recovery acceptance remains unrun.
- Final review found and closed a model/baseline mismatch in import: the parsed project and expected bytes now come from one shared read rather than two separate disk reads. A regression proves an intervening save is preserved. Recovery resolves symlink aliases to the same canonical backup used by commits.
- Final review also reproduced export overwriting its own project before the later save failed. CLI and agent export now share a destination guard that protects the project, backups, save lock, undo/snapshot namespace and media before writing either output or receipt, including filesystem aliases. The original destructive reproduction now refuses and preserves the project byte-for-byte.
- Fresh final verification: **170 focused tests passed, 854 assertions** across ten files (`/tmp/video-save-complete-tests.log`), plus **15 registered save-RPC tests passed, 63 assertions** (`/tmp/video-save-final-rpc-tests.log`): **185 passing tests, 917 assertions** total. Includes real competing Node processes, symlink identity, stale save/backup preservation, draft storage, actual rendered frames/audio, import baseline pairing and protected export destinations.
- Shared, server-core, session-tools-core and Electron typechecks passed. Artist OS main-process and renderer builds passed; dependency containment and diff checks passed. Renderer retains existing build warnings. Latest main build includes all final storage/guard fixes; renderer build covers the unchanged final draft UI. Logs: `/tmp/video-save-*-typecheck.log`, `/tmp/video-save-build-main.log`, `/tmp/video-save-build-renderer.log`, `/tmp/video-save-containment.log`.
- Independent final review verified participating writer coverage and replayed the previously destructive self-export. Full repository suite, live Electron recovery/navigation and packaged runtime acceptance remain unrun. This recovery/rendering/save foundation was committed as `7c0efaa9` in the isolated continuation worktree; canonical main was not changed or restarted.

## Saved-agent handoff continuation

- The editor command now saves the project and launches the existing saved `video-editor-agent` with its strict source/skill checks, model, permission mode, context and launch receipt. The agent must be activated and allowed in the workspace. No separate hardcoded agent persona or provider is introduced.
- The RPC checks local workspace, chat/write permissions, the actual Output project asset and its safe filesystem path before launch. The prompt names the current project and existing Output, instructs structured conflict-safe edits, and includes the return route. Invalid/disabled targets fail before session creation.
- Launch acknowledges the persisted user message rather than waiting for model completion. Definite send failure returns the retained session and editable draft. At 15 seconds without acknowledgment, the result is `pending`, with the session available for inspection and no automatic retry. Late acknowledgments do not erase a newer user draft.
- The UI claims its duplicate-click guard before project save, handles save/launch failures together, preserves retry text per workspace/output, restores failed sends into the session composer, and navigates to the returned session. It never reloads the project as if editing had already finished.
- No live provider execution or app restart was performed. Session creation/delivery are tested with injected managers; live provider, sidebar/navigation, permissions prompts, and returning to edited output still need an app walkthrough before this is called accepted in-product behavior.
- Verification for the handoff slice: **53 focused tests passed, 171 assertions**, plus **12 independent registered-endpoint tests passed, 35 assertions**: **65 passing tests, 206 assertions**. Endpoint tests cover permissions, activation, missing/invalid projects, unsafe symlink paths, human-message origin and exactly one session during overlapping handoffs. Logs: `/tmp/video-agent-tests.log`, `/tmp/video-agent-rpc-tests.log`.
- Server-core and Electron typechecks and both Artist OS builds passed (`/tmp/video-agent-*-typecheck.log`, `/tmp/video-agent-build-main.log`, `/tmp/video-agent-build-renderer.log`). The renderer reports existing build warnings. Independent review found no remaining blocker within this bounded handoff slice. No full-repository regression or live-provider acceptance claim is made.

## Browser acceptance continuation

- Added `scripts/test-video-studio-ui.ts` and its synthetic fixture. Run `bun scripts/test-video-studio-ui.ts` with Chrome and FFmpeg installed; `PLAYWRIGHT_CHANNEL` can select another installed Chromium channel. It bundles the real React page, editor helpers and draft storage, with synthetic filesystem/session bridges and shell boundaries. Browser requests are intercepted locally; no real profile, provider or running Artist OS app is used.
- Six scenarios pass: exact saved-byte baseline; invalid draft restoration and explicit discard across navigation/reload; newer external save preservation; rendered-media selection and native playback clock; save-before-agent with duplicate-click prevention; draft/pending session navigation and retained retry text.
- Render review uses real synthetic MP4s and native browser seek events. The fixture serves byte ranges so Chrome can seek; no production playback change was necessary. The result at 1.25 seconds maps to a 1250ms timeline position at playback rate 1.
- Parent independently reran all six scenarios successfully (`/tmp/video-studio-ui-final.log`). Harness TypeScript checking passed. This is interaction acceptance with synthetic IO, not visual styling certification, real backend export or live provider/native Electron acceptance. Those remaining gates still apply.

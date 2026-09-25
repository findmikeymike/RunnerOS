# Video Studio Roadmap

## Status

Proposed implementation roadmap, grounded in the current RunnerOS codebase and the reference editors.

## Ground Truth

RunnerOS already has a strong project model. The schema in `packages/shared/src/video/types.ts` includes media metadata, multi-track timelines, markers, selections, captions, overlays, effects, templates, export records, transforms, crop, opacity, volume, speed, transitions, keyframes, and text styling.

The active renderer is much narrower. `packages/session-tools-core/src/handlers/video-tools.ts` and `tools/video-studio/bin/video-studio.mjs` currently use a simple FFmpeg path that supports practical video/image/audio/text export, basic clip adjustments, title/text overlays, and audio mixing. It does not execute transforms, crop, opacity, speed, volume, transitions, keyframes, captions, overlays, effects, templates, thumbnails, waveforms, or true platform export variants.

The specs below separate:

- `ready now`: fits the existing FFmpeg/tool path
- `typed-only`: schema exists, but renderer/UI/tools do not execute it yet
- `engine work`: needs a real composition engine or a larger render graph

## Reference Repos Used

- DesignCombo React Video Editor: React timeline UX, multi-track editing, transitions/effects, export presets, Remotion-backed render direction.
  Source: https://github.com/designcombo/react-video-editor
- Diffusion Studio Core: TypeScript browser composition engine using Canvas2D/WebCodecs, realtime playback, high-fidelity rendering, keyframes, transitions, masking, captions, audio ramps, checkpoints.
  Source: https://github.com/diffusionstudio/core
- OpenReel Video: browser CapCut-style editor shape, multi-track timeline, frame scrubbing, ripple editing, transitions, chroma key, color/effects, audio tooling, WebCodecs/WebGPU direction.
  Source: https://github.com/Augani/openreel-video
- OpenCut: best reference for future Editor API, plugin-first architecture, MCP/headless/scripting direction.
  Source: https://github.com/opencut-app/opencut

## Product North Star

Video Studio should be a local-first, agent-operable editor:

- humans edit visually in the native RunnerOS Video Studio page
- agents mutate the same `.runner-video.json` project through structured tools
- unsupported features fail loudly before export
- preview and export should eventually match
- export variants should be first-class, not afterthoughts

## Current Baseline

Already present:

- native Video Studio project type and JSON schema
- source/tool registration through `sources/video-studio`
- starter Video Editor Agent wired to the `video-studio` source
- media import and project update RPCs
- simple FFmpeg MP4 export
- clip look adjustments for a practical subset
- timeline edit operations such as split, duplicate, delete, pack, trim, drag, lane management
- co-edit guardrails around save/export/agent handoff
- local receipts and export history

Known weak points:

- import probes duration only for clip placement; media assets do not store full `durationMs`, `width`, `height`, `fps`
- no thumbnails or waveforms
- platform presets are stored as strings but not executed as real export profiles
- stacked video lanes render full-frame overlays at `0:0`, so PiP/layout work is not real yet
- typed transitions/keyframes/captions/effects are not rendered
- preview is still an approximation of the project, not the same composition as export

## Phase 1: Finish The Existing Engine

Goal: make the current editor reliable and useful before swapping engines.

### 1. Real Media Probe

Status: `ready now`

Current truth:

- `clipDurationForImport()` uses `ffprobe` for video/audio duration.
- media assets do not persist full probe results.
- `video-studio probe` returns basic file metadata, not full editor metadata.

Spec:

- Add shared probe helper for `durationMs`, `width`, `height`, `fps`, `hasAudio`, `hasVideo`, `codec`, `sizeBytes`.
- Use it in RPC import and CLI probe.
- Store fields on `VideoMediaAsset`.
- Recompute clip duration from probe unless user overrides it.
- Make `inspect` warn when media metadata is missing.

Acceptance:

- imported 16s video appears as 16s in media, clip, timeline, and preview
- bad or unsupported media fails with a clear error
- CLI `probe --json` and RPC import agree on metadata

### 2. Thumbnails And Waveforms

Status: `ready now`

Current truth:

- schema has `thumbnailPath` and `waveformPath`
- no generation path exists

Spec:

- Generate first-frame thumbnail for video/image imports with FFmpeg.
- Generate compact waveform JSON or PNG for audio/video-with-audio.
- Store paths on `VideoMediaAsset`.
- Use thumbnails in media bin and timeline clips.
- Use waveform display on audio lanes.

Acceptance:

- every imported video shows a real thumbnail in media bin and timeline
- every audio/video-with-audio clip can show a waveform
- missing generation is a warning, not a broken import

### 3. Export Presets And Platform Variants

Status: `ready now`

Current truth:

- export accepts a `preset` string
- only `simple-mp4` behavior exists

Spec:

- Add preset registry:
  - `mp4-16x9-1080p`
  - `mp4-9x16-1080x1920`
  - `mp4-1x1-1080`
  - `mp4-4x5-1080x1350`
  - `mp4-source-size`
- Presets define width, height, fps, bitrate tier, audio bitrate, and fit mode.
- Export UI should show a compact export dropdown.
- Agent tools accept preset slugs and fail on unknown presets.
- Add batch export command for platform variants.

Acceptance:

- one project exports YouTube, TikTok/Reels/Shorts, square, and 4:5 variants
- receipts include preset, dimensions, fps, codec settings, and output path
- unsupported presets fail before FFmpeg runs

### 4. Speed, Volume, And Fades

Status: `typed-only`, but fits FFmpeg

Current truth:

- `VideoClip.speed` and `VideoClip.volume` exist
- renderer ignores both
- no fade fields exist yet

Spec:

- Render video speed with `setpts`.
- Render audio speed with chained `atempo` for 0.25x-4x.
- Render clip volume with `volume`.
- Add optional `audioFadeInMs` and `audioFadeOutMs` to clip audio settings or a small `audio` sub-object.
- Render audio fades with `afade`.
- UI: speed and volume controls in inspector.

Acceptance:

- 0.5x, 1x, 2x exports have correct duration
- per-clip volume changes are audible in export
- fade-in/out works for audio clips and video clips with audio

### 5. Basic Captions End-To-End

Status: `typed-only`, current renderer rejects caption media

Current truth:

- schema has `VideoCaptionTrack` and `VideoCaptionCue`
- `.srt`/`.vtt` are recognized as caption media
- caption tracks are empty and not burned into export

Spec:

- Add SRT/VTT import parser.
- Store cues in `project.captions`.
- Add caption clips or `captionCueIds` only when needed for timeline editing.
- Basic caption editor: text, start, duration.
- Burn-in captions using FFmpeg subtitles/drawtext first.
- Style subset: font size, color, background, position.

Acceptance:

- importing SRT creates editable cues
- export burns captions at correct times
- invalid caption timing is caught by validation/inspect

## Phase 2: Make Multi-Lane Editing Real

Goal: make stacked video, text, and layout edits actually render.

### 1. Transform, Crop, Opacity

Status: `typed-only`, engine stretch

Current truth:

- schema has `transform`, `crop`, and `opacity`
- renderer overlays prepared video at `0:0` full-frame

Spec:

- Implement FFmpeg support for:
  - crop
  - scale
  - rotate where practical
  - x/y overlay position
  - opacity
- Add layout presets:
  - fill
  - fit
  - center
  - picture-in-picture
  - split left/right
  - split top/bottom
- UI: transform controls in inspector plus drag handles later.
- Agent tool: `video_clip_transform`.

Acceptance:

- two video tracks can render as PiP, split screen, or stacked overlay
- hidden tracks and disabled clips stay out of export
- inspect warns when a transform cannot render in the selected engine

### 2. Transitions

Status: `typed-only`, engine stretch

Current truth:

- schema has `transitionIn` and `transitionOut`
- renderer hard-cuts only

Spec:

- Start with dissolve/crossfade only.
- Support transitions between adjacent clips on the same track.
- Validate transition duration cannot exceed clip handles.
- UI: transition icon between butted clips.
- Agent tool can set/remove transition by clip id.

Acceptance:

- adjacent clips export with crossfade
- impossible transition durations fail before export
- packed clips with transition do not create visual gaps

### 3. Rich Text MVP

Status: `typed-only`, partial renderer exists

Current truth:

- `VideoTextPayload` has font, weight, color, alignment, background, stroke
- renderer draws plain centered white text

Spec:

- Render font size, color, background, stroke, alignment, and position.
- Add text presets:
  - lower third
  - hook title
  - subtitle
  - label tag
- Add text track UI with direct edit.

Acceptance:

- exported text matches visible text settings
- text does not require editing raw JSON
- unsupported fonts fall back predictably

## Phase 3: Composition Engine

Goal: preview/export parity and advanced effects without exploding FFmpeg complexity.

Preferred direction: adopt Diffusion Studio Core behind a RunnerOS render-engine adapter, while keeping FFmpeg as the stable fallback.

Why:

- Diffusion Core already targets browser NLE composition with Canvas2D/WebCodecs.
- Its feature set maps closely to RunnerOS typed fields: layers, keyframes, transitions, captions, masks, effects, audio ramps, checkpoints.
- It is a better fit for interactive preview than a giant FFmpeg string builder.

Spec:

- Add engine capability manifest:
  - `ffmpeg-simple`
  - `diffusion-core`
  - later `remotion-template`
- Add project-to-engine adapter.
- Add feature detection before render.
- Add preview mode that uses the same engine path as export where possible.
- Keep `.runner-video.json` as the source of truth, not engine object state.

Acceptance:

- the same project can be inspected against selected engine capabilities
- unsupported features fail loudly
- preview and export match for supported features
- FFmpeg fallback remains available for simple reliable MP4 export

## Phase 4: Agent Production Layer

Goal: make agents useful without letting them silently break edits.

### 1. Snapshot, Diff, Revert

Status: absent

Spec:

- Before every agent mutation, create lightweight project snapshot.
- Agent tool result includes changed clips/tracks/media/exports.
- Add `video_project_diff`.
- Add `video_project_revert`.
- UI shows agent changes in a compact history panel.

Acceptance:

- user can revert the last agent edit
- agent tool receipts explain what changed
- conflicting human edits block stale agent saves

### 2. Render Queue And Batch Variants

Status: absent

Spec:

- Add render queue records with status, preset, engine, output path, error.
- Batch export platform variants.
- Agent can enqueue renders and report receipts.

Acceptance:

- multiple exports can run or queue without corrupting project state
- failed render keeps usable error report
- UI shows current and past render jobs

### 3. Headless/Scriptable Editor API

Status: future, inspired by OpenCut

Spec:

- Keep CLI JSON-first.
- Add stable operation names for agent/workflow use:
  - `project.create`
  - `media.import`
  - `clip.add`
  - `clip.split`
  - `clip.trim`
  - `clip.transform`
  - `timeline.pack`
  - `captions.import`
  - `export.enqueue`
  - `project.inspect`
- Later expose the same operations through MCP/source tools.

Acceptance:

- UI and agents call the same edit operations
- dry-run is available for destructive commands
- operation outputs are machine-readable

## Priority Order

1. Real media probe, thumbnails, waveforms.
2. Export presets and platform batch variants.
3. Speed, volume, audio fades.
4. Captions import and burn-in.
5. Transform/crop/opacity for real stacked video.
6. Crossfade transitions.
7. Diffusion Core adapter spike.
8. Snapshot/diff/revert for agent edits.
9. Render queue.
10. Rich text, effects, chroma key, advanced color.

## Guardrails

- Do not claim a feature is supported because it exists in TypeScript.
- `inspect` must report project features unsupported by the selected renderer.
- Agent tools must fail loudly for missing media, unsupported clip types, unknown presets, and stale project versions.
- Keep FFmpeg simple path working while engine work happens.
- Do not make Computer Use the default way for video agents to operate the editor.

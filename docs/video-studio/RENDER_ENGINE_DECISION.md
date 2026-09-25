# Video Studio Render Engine Decision

## Status

Proposed.

Decision: keep the current FFmpeg renderer as the stable simple exporter, then add a composition-engine adapter. Diffusion Studio Core is the best first candidate for the interactive editor engine. Remotion/Hypermotion should stay available for code-owned/template video, not become the default NLE engine.

## Why This Decision Exists

RunnerOS has a rich video project schema, but the active render path is simple. The current FFmpeg renderer is useful for basic MP4 output, but it is the wrong long-term center for CapCut-style editing because every new visual feature becomes a fragile `filter_complex` expansion.

The target is not just "can export a file." The target is:

- multi-lane composition
- preview matches export
- agents can inspect what will actually render
- unsupported features fail before execution
- platform variants are repeatable
- advanced features can land without rewriting the editor every time

## Current RunnerOS Engine

Location:

- `packages/session-tools-core/src/handlers/video-tools.ts`
- `tools/video-studio/bin/video-studio.mjs`

What it does well:

- local FFmpeg export
- video/image/audio/text clip support
- basic project validation
- adjustment subset with `eq`, grain/noise, sharpen, vignette
- simple title/text draw
- audio mixing with `amix`
- receipts and export records

What it does not execute yet:

- transform position/scale/rotate
- crop
- opacity
- clip speed
- per-clip volume
- audio fades
- transitions
- keyframes
- caption burn-in
- overlays/effects/templates
- thumbnails/waveforms
- true export presets
- preview/export parity

## Reference Engine Lessons

### DesignCombo React Video Editor

Useful lesson:

- React timeline editors work best when timeline state, preview, and export are tied to a composition model.
- DesignCombo is the clearest UI reference for track UX, inspector UX, transitions/effects, and export presets.
- It points toward Remotion for renderable React compositions.

RunnerOS use:

- borrow UI patterns and Remotion lessons
- do not inherit a product-specific state model

Source:

- https://github.com/designcombo/react-video-editor

### Diffusion Studio Core

Useful lesson:

- A browser-native engine can provide both interactive playback and high-fidelity rendering.
- Canvas2D/WebCodecs maps well to a local Electron editor.
- Its features map directly to RunnerOS typed fields: layers, keyframes, transitions, masks, captions, rich text, audio ramps, checkpoints.

RunnerOS use:

- strongest candidate for the future interactive composition engine
- should sit behind a RunnerOS adapter
- `.runner-video.json` remains source of truth

Risks:

- Electron must support the needed browser APIs and isolation headers.
- Project adapter must be carefully tested.
- Licensing/watermark/commercial constraints must be verified before shipping broadly.

Source:

- https://github.com/diffusionstudio/core

### OpenReel Video

Useful lesson:

- A serious browser editor needs frame scrubbing, ripple editing, transitions, color/effects, chroma key, audio tools, and GPU/WebCodecs direction.
- It validates the product feature list, especially for creator workflows.

RunnerOS use:

- borrow feature targets and UI expectations
- do not copy the full app architecture

Source:

- https://github.com/Augani/openreel-video

### OpenCut

Useful lesson:

- The future-facing power is an Editor API, plugins, scripting, MCP/headless operation, and agent-addressable editing.

RunnerOS use:

- borrow the API/headless/MCP direction
- do not wait for or depend on OpenCut's rewrite

Source:

- https://github.com/opencut-app/opencut

## Options Considered

### Option A: Keep Extending FFmpeg Only

Pros:

- already works locally
- easy to call from CLI/tools
- deterministic MP4 output
- no browser isolation issues
- good fallback for agents

Cons:

- preview will keep drifting from export
- transforms/transitions/keyframes become hard to maintain
- advanced effects and captions become brittle
- every feature increases filter graph complexity
- bad fit for interactive editing

Verdict:

- keep it, but do not make it the long-term composition engine.

### Option B: Diffusion Studio Core Adapter

Pros:

- TypeScript/browser-native
- built for composition and NLE-style use
- supports many roadmap features directly
- better preview/export parity path
- fits Electron better than a server-only renderer

Cons:

- needs adapter work
- needs Electron/WebCodecs validation
- may need COOP/COEP style isolation support
- licensing/commercial terms must be checked before productizing

Verdict:

- best first composition-engine candidate.

### Option C: Remotion As Main Editor Engine

Pros:

- React-native mental model
- strong deterministic rendering
- already adjacent through HyperFrames/Hypermotion docs/tools
- good for templated, programmatic, captioned, data-driven, and 3D videos

Cons:

- not the best default for interactive NLE timeline playback
- users expect direct manipulation, scrubbing, and live timeline edits
- RunnerOS already has a separate HyperFrames/Remotion-shaped lane

Verdict:

- keep for template/code-owned video generation, not the main timeline engine.

### Option D: Copy OpenReel/OpenCut Architecture

Pros:

- close to full creator-editor product shape
- lots of useful feature examples

Cons:

- too large for RunnerOS integration
- different product shell and assumptions
- OpenCut is actively changing direction

Verdict:

- use as reference, not as direct foundation.

## Recommended Architecture

Add a render engine boundary instead of baking every feature into one FFmpeg function.

Concept:

```ts
export interface VideoRenderEngine {
  id: string;
  label: string;
  capabilities: VideoRenderCapabilities;
  inspect(project: RunnerVideoProject): VideoEngineInspection;
  render(input: VideoRenderInput): Promise<VideoRenderResult>;
  preview?(input: VideoPreviewInput): Promise<VideoPreviewSession>;
}
```

Capabilities:

```ts
export interface VideoRenderCapabilities {
  mediaTypes: string[];
  transforms: boolean;
  crop: boolean;
  opacity: boolean;
  speed: boolean;
  volume: boolean;
  audioFades: boolean;
  transitions: string[];
  keyframes: string[];
  captions: boolean;
  textStyles: boolean;
  effects: string[];
  exportPresets: string[];
}
```

Initial engines:

- `ffmpeg-simple`: current stable local exporter
- `diffusion-core`: future interactive composition engine
- `remotion-template`: future bridge for HyperFrames/templated video workflows

Project rule:

- `.runner-video.json` is always the source of truth.
- Engine-specific objects are generated from the project, never the primary saved state.

## Migration Plan

### Step 1: Capability Manifest

Add engine capability metadata for `ffmpeg-simple`.

`inspect` should compare project features against engine capabilities and return:

- supported features
- unsupported features
- warnings
- hard blockers

Acceptance:

- a project with captions reports "captions unsupported by ffmpeg-simple" before export
- a project with Lottie/HTML fails loudly before render
- agent tools can include engine-limit notes automatically

### Step 2: Strengthen FFmpeg Simple

Implement features that are cheap and reliable in FFmpeg:

- real probe metadata
- thumbnails
- waveforms
- platform presets
- speed
- volume
- audio fades
- SRT/VTT burn-in
- richer text subset

Acceptance:

- current simple exporter becomes useful for common production tasks
- no composition engine dependency required for basic creator edits

### Step 3: FFmpeg Transform Bridge

Implement the smallest useful visual composition upgrade:

- crop
- scale
- x/y position
- opacity
- PiP/split-screen presets
- crossfade only

Acceptance:

- stacked video lanes can produce real layouts
- adjacent clips can dissolve
- unsupported keyframes/effects still fail clearly

### Step 4: Diffusion Core Spike

Build a narrow adapter spike:

- load one video source
- load one image/text overlay
- apply position/scale/opacity
- play preview in Electron
- export a short MP4 or verified render output

Acceptance:

- real Electron smoke test proves playback works
- exported output matches preview for the supported subset
- blockers are documented with exact API/runtime constraints

### Step 5: Composition Preview

Use the composition engine for editor preview when selected.

Acceptance:

- preview no longer uses a separate approximation for supported features
- export and preview share the same project-to-engine adapter
- stale/unsupported project states are visible in UI

### Step 6: Default Engine Switch

Only switch the default after:

- feature parity beats FFmpeg for common projects
- export is reliable
- licensing is cleared
- Electron smoke tests are stable
- fallback engine remains available

## Agent Requirements

Agents need engine awareness.

Every video edit/export tool should know:

- selected engine
- engine capabilities
- project features used
- whether the requested export is possible
- what will be ignored or rejected

Agent behavior:

- never silently ignore a requested feature
- inspect before export
- dry-run before expensive render
- save receipts
- explain render limits in plain language

## Testing Gates

Required tests before claiming support:

- schema validation for new fields
- CLI/RPC import probe tests
- engine capability inspection tests
- export preset tests
- one golden render smoke per engine
- preview/export parity smoke for composition engine
- stale project/co-edit guard tests
- agent tool failure tests for unsupported features

## Final Call

Use a hybrid path:

1. FFmpeg remains the reliable simple exporter.
2. FFmpeg gets the cheap creator features first.
3. A render-engine interface prevents more hard-coding.
4. Diffusion Studio Core gets a focused Electron spike.
5. Remotion stays in the template/programmatic video lane.
6. OpenCut's API/headless direction informs the agent interface.

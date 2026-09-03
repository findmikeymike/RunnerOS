# Raw Video Editor

```bash
node bin/raw-video-editor.mjs doctor --json
node bin/raw-video-editor.mjs inspect /path/to/footage --json
node bin/raw-video-editor.mjs transcribe /path/to/footage --model base --json
node bin/raw-video-editor.mjs plan /path/to/footage --max-duration 45 --aspect 9:16 --json
node bin/raw-video-editor.mjs render /path/to/footage --out /path/to/footage/edit/preview.mp4 --json
node bin/raw-video-editor.mjs sync-master /path/to/performance.mp4 /path/to/master.wav --out /path/to/footage/edit/performance-synced.mp4 --json
node bin/raw-video-editor.mjs repurpose /path/to/source.mp4 --out-dir /path/to/edit/variants --json
node bin/raw-video-editor.mjs repurpose /path/to/source.mp4 --out-dir /path/to/edit/variants --brief /path/to/variant-brief.json --render --json
```

Local FFmpeg-based raw footage editor for RunnerOS workers. It preserves source media and writes all generated files to `edit/`.

## Master audio synchronization

`sync-master` matches faint camera playback against a clean song master, estimates the starting offset and linear device-clock drift, then renders a reviewable video with the master replacing the scratch audio.

- Add `--analyze-only` to write the match report without rendering.
- Add `--camera-mix 0.1` to retain a quiet amount of the original camera audio. The default is `0`.
- Add `--master-offset-ms <milliseconds>` for a deliberate manual nudge after reviewing the preview. Positive values select a later point in the master.
- Weak or ambiguous matches fail closed. `--force` exists only for an explicitly reviewed manual preview.

The matching engine is Runner-owned code based on public signal-processing methods. It does not copy or bundle SynAudio, its CLI, or another LGPL/GPL synchronizer.

## Social video variants

`repurpose` analyzes one pinned video, creates scene previews and a brief template, then renders up to five meaningfully different edits for review. A filter, font swap, crop nudge, or re-encode alone is rejected as cosmetic.

The Artist OS Create variants action is the render authorization. Once the brief identifies the exact source, destinations, rights basis, and edits, use `--render` without asking for another plan approval. Each result is written to the manifest immediately so later failures do not erase successful work. Posting remains separately approval-gated.

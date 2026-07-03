# Raw Video Editor

Use this source when editing existing footage, not generating new AI video.

```bash
node bin/raw-video-editor.mjs doctor --json
node bin/raw-video-editor.mjs inspect <footage-dir> --json
node bin/raw-video-editor.mjs transcribe <footage-dir> --model base --json
node bin/raw-video-editor.mjs plan <footage-dir> --max-duration 45 --aspect 9:16 --json
node bin/raw-video-editor.mjs render <footage-dir> --out <footage-dir>/edit/preview.mp4 --json
```

Outputs live in `<footage-dir>/edit/`:

- `inventory.json`
- `takes_packed.md`
- `transcripts/*.json` when transcription runs
- `edl.json`
- `preview.mp4` or chosen output
- `render-report.json`

The tool preserves source media and requires FFmpeg/ffprobe for real MP4 renders.

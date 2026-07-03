# Raw Video Editor

```bash
node bin/raw-video-editor.mjs doctor --json
node bin/raw-video-editor.mjs inspect /path/to/footage --json
node bin/raw-video-editor.mjs transcribe /path/to/footage --model base --json
node bin/raw-video-editor.mjs plan /path/to/footage --max-duration 45 --aspect 9:16 --json
node bin/raw-video-editor.mjs render /path/to/footage --out /path/to/footage/edit/preview.mp4 --json
```

Local FFmpeg-based raw footage editor for RunnerOS workers. It preserves source media and writes all generated files to `edit/`.

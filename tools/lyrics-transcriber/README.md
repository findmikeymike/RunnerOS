# RunnerOS Lyrics Transcriber

Local Whisper transcription wrapper for song/master audio.

This tool is built around `whisper.cpp` because it is easier to package as app-owned binaries than Python Whisper stacks. It does not upload audio.

## Commands

```bash
node bin/lyrics-transcriber.mjs doctor --json
node bin/lyrics-transcriber.mjs install-model --model base.en --json
node bin/lyrics-transcriber.mjs transcribe --audio-file /path/to/song.wav --model base.en --out-dir /path/to/lyrics --json
```

## Output Contract

`transcribe` writes:

- `transcript.json`
- `lyrics.txt`
- intermediate Whisper WAV input
- raw whisper JSON when available

The `transcript.json` shape is:

```json
{
  "ok": true,
  "engine": "whisper.cpp",
  "audio_file": "/path/to/song.wav",
  "lyrics_text": "line one\nline two",
  "lyric_lines": [
    { "text": "line one", "start_time": 0, "end_time": 2.4 }
  ],
  "review_required": true
}
```

Lyric Video and Vault code should treat `lyrics_text` plus `lyric_lines` as the saved contract.

## Runtime

Environment overrides:

```bash
RUNNEROS_WHISPER_CPP_CLI=/path/to/whisper-cli
RUNNEROS_WHISPER_MODEL=/path/to/ggml-base.en.bin
RUNNEROS_WHISPER_MODEL_DIR=/path/to/model-cache
RUNNEROS_FFMPEG=/path/to/ffmpeg
```

Dev shells may use those overrides or PATH. Packaged app builds must not rely on PATH.

Default model cache:

```text
~/.runneros/whisper/models
```

## Packaging Notes

- `whisper.cpp` is MIT licensed.
- Mac arm64 currently bundles `whisper-cli` built from `whisper.cpp` v1.9.1 and a minimal FFmpeg 8.1.2 LGPL build under `bin/darwin/arm64/`.
- Verify the exact downloaded model file license/provenance before bundling models inside the app. The current app downloads models into the user cache instead.
- Package FFmpeg as an LGPL-safe external binary unless product/legal accepts GPL obligations. The current Mac arm64 FFmpeg binary was configured without GPL/nonfree/external libraries.
- `doctor` must pass in packaged app context before Vault exposes transcription as ready. Packaged mode is detected through `CRAFT_IS_PACKAGED=1` or forced with `RUNNEROS_REQUIRE_PACKAGED_LYRICS_RUNTIME=1`.
- For shipped users, bundle `whisper-cli` and `ffmpeg` at `bin/<platform>/<arch>/`. The app resolves that before checking PATH, and packaged mode rejects PATH fallbacks.
- Every bundled binary must have a sibling `.provenance.json` file. Missing provenance is a packaged-mode blocker.
- The app can download the selected model on first transcription into `~/.runneros/whisper/models`, so users should not need terminal commands for model setup.
- If a packaged build cannot bundle `whisper-cli` yet, show the `doctor` blockers in-app and keep transcription disabled instead of sending users into developer setup.

Prepare/check release runtime:

```bash
bun run lyrics-runtime:doctor
bun run lyrics-runtime:copy -- --whisper-cli /path/to/whisper-cli --ffmpeg /path/to/ffmpeg
```

`scripts/prepare-lyrics-runtime.ts` refuses Homebrew-linked macOS binaries by default because those usually break on clean user machines. Use `--allow-nonportable` only for local throwaway dev artifacts.

See `THIRD_PARTY_NOTICES.md` for bundled runtime provenance and license notes.

## Product Notes

Song transcription is not perfect. Vault should save transcripts as review-needed until the user confirms/corrects lyrics.

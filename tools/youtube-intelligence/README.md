# YouTube Intelligence

Evidence-backed YouTube transcript intelligence pipeline for RunnerOS agents.

This tool is intentionally deterministic. It fetches or accepts transcripts, normalizes them, chunks them with timestamps, and writes extraction packets. The agent/skill performs the LLM judgment pass.

## Commands

```bash
node bin/youtube-intelligence.mjs doctor
node bin/youtube-intelligence.mjs prepare --video "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --provider auto --out ./youtube-intel/dQw4w9WgXcQ
SUPADATA_API_KEY="..." node bin/youtube-intelligence.mjs prepare --video dQw4w9WgXcQ --provider supadata --allow-paid --out ./youtube-intel/dQw4w9WgXcQ
node bin/youtube-intelligence.mjs prepare --video dQw4w9WgXcQ --transcript ./transcript.txt --out ./youtube-intel/dQw4w9WgXcQ
node bin/youtube-intelligence.mjs batch-prepare --input ./targets.txt --out ./youtube-intel/batch-run --provider auto --max-videos 25 --channel-limit 10
node bin/youtube-intelligence.mjs batch-prepare --channel @channelhandle --out ./youtube-intel/channel-run --provider auto --max-videos 25
node bin/youtube-intelligence.mjs compile --cards ./youtube-intel/dQw4w9WgXcQ/intel-cards.json --out ./youtube-intel/dossier.md
```

Provider order for `--provider auto`:

```text
cache -> local youtube-research
cache -> Supadata -> local youtube-research when --allow-paid is passed
```

Supadata calls consume credits and require `--allow-paid`. Default Supadata mode is `native`, which avoids AI-generated transcript charges. Use `--supadata-mode auto` or `--supadata-mode generate` only when that spend is approved.

Supadata credentials come from `SUPADATA_API_KEY` or the active product cache selected by `CRAFT_INTEGRATION_CACHE_ROOT`:

```json
{ "supadataApiKey": "..." }
```

Runner and Artist OS set `CRAFT_INTEGRATION_CACHE_ROOT` for their managed agents. Direct CLI use must set that variable, pass `--cache-dir`, or use `--no-cache`; the tool never guesses another product's cache path.

## Batch Input

`batch-prepare` accepts many videos and channel targets at once:

```text
https://www.youtube.com/watch?v=dQw4w9WgXcQ
dQw4w9WgXcQ
@channelhandle
https://www.youtube.com/@channelhandle
https://youtu.be/9bZkp7q19f0	./local-transcript.txt
./another-transcript.txt
```

Supported rows:

- one YouTube URL or video ID per line
- one YouTube channel handle/URL per line
- `video<TAB>transcript-file` for known transcript files
- transcript file paths by themselves

Channel rows expand through `tools/youtube-research` using `youtube channel-uploads`. Control per-channel expansion with `--channel-limit`.

Batch outputs:

- `run-manifest.json`
- `batch-extractor-prompt.md`
- `cross-video-reducer-prompt.md`
- `dossier-template.md`
- `agent-context-pack-template.json`
- `videos/<videoId>/...` per-video packets

Use `--continue-on-failure` when one bad/private/missing transcript should not stop the whole run.

## Outputs

- `raw-transcript.json`
- `chunks.json`
- `extraction-packet.json`
- `extractor-prompt.md`
- `reducer-prompt.md`
- `report-template.md`

The raw transcript and timestamped chunks are the source of truth. Intel cards and reports are derived artifacts.

# RunnerOS Genesis Lyric

App-owned Genesis lyric-video engine fork.

This tool vendors the lightweight Genesis single-video source modules under `vendor/genesis/` so RunnerOS agents can make structured lyric clips without mutating `/Users/michaelb.williams/Cascade Windsurf 3/Genesis`.

The fork intentionally excludes Genesis campaign runtime data, uploads, outputs, jobs, portal state, API server state, test outputs, caches, provider-generation modules, API-key templates, and `.git`.

## Commands

```bash
node bin/genesis-lyric.mjs doctor --json
node bin/genesis-lyric.mjs storyboard --brief-file brief.json --json
node bin/genesis-lyric.mjs plan --brief-file brief.json --json
node bin/genesis-lyric.mjs preflight --brief-file brief.json --json
node bin/genesis-lyric.mjs render --brief-file brief.json --approved --json
```

`storyboard` is a no-spend Genesis Creative Director / Motion Director planning pass. It ports the real Genesis cinema-mode, capture-realism, motion-compiler, and motion-QA grammar into this app-owned fork. It returns scene beats, image prompts, compiled image-to-video motion prompts, QA findings, media-generation handoff instructions, and the final render handoff.

## Brief Shape

```json
{
  "title": "Watching Tornado Videos on Youtube",
  "audio_file": "/path/to/song.wav",
  "image_file": "/path/to/still.png",
  "video_file": "/path/to/visual.mp4",
  "lyrics": "line one\nline two",
  "duration_seconds": 8,
  "aspect_ratio": "9:16",
  "output_dir": "/path/to/output"
}
```

Use either `video_file` or `image_file` for local no-provider rendering. Generated visuals from WaveSpeed, Fal, Replicate, Zero, or other tools should be created outside this tool and passed back as `video_file`/`image_file`.

Supported aspect ratios are `9:16`, `1:1`, and `16:9`.

## Scope

- Single lyric videos only.
- Good for TikTok/Reels/Shorts lyric clips, captioned song teasers, and lyric-first audio-drop videos.
- Requires `lyrics` or timed `lyric_lines`; silent Spotify Canvas loops belong in the Spotify Canvas/Hypermotion lane.
- Includes the Genesis shot/motion director grammar for one-off storyboard planning.
- Not the Genesis 20-day campaign planner, portal/API, scheduler, or batch worker architecture.
- Does not call image/video generation providers or read provider API keys.

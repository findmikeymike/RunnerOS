# Captions and Lyric Alignment
*Date: 2025-12-13*

## Two caption types
### 1) Narration captions (voice memo)
- Source: transcription of memo audio
- Timing: transcript timestamps
- Usage: most "story"/"context" content

### 2) Lyric captions (song vocals)
- Source: lyrics text + timing
- Timing options:
  - Primary: forced alignment
  - Fallback: manual timestamp UI

## Forced alignment design (high level)
- Input:
  - vocal audio reference (ideally vocals stem; otherwise master)
  - plain-text lyrics
- Output:
  - word-level or line-level timestamps

## Manual fallback (high level)
- UI lets user timestamp:
  - line start/end or word start/end
- Store as an explicit timing track used by the manifest.

## How it feeds RunnerOS Genesis Lyric
- `bin/genesis_lyric.py` accepts `lyrics` or `lyric_lines` in the brief.
- Untimed plain-text lyrics are normalized across the target duration.
- Timed `lyric_lines` should use `text`, `start_time`, and `end_time`.
- `align_with_audio: true` can attempt forced alignment when optional transcription dependencies are available; failures fall back to the provided line timing.

## Rendering requirements
- Captions must be readable on all backgrounds:
  - box/background + shadow
  - safe margins for 9:16
  - consistent animation defaults

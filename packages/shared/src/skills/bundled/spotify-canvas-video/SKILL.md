---
name: spotify-canvas-video
description: "Create Spotify Canvas visuals: silent vertical 3-8 second loops from footage, motion design, or approved image/video generation. Use when the user asks for Spotify Canvas, Canvas loop, 5s song visual, or a Spotify-ready visual for a track."
---

# Spotify Canvas Video

Use this for Spotify Canvas work only.

## Hard Format

- Vertical 9:16.
- 3-8 seconds; default to 5 seconds.
- Silent visual loop. Do not add voiceover, subtitles, captions, CTA, logo, or promo copy.
- Never use "Listen now", "out now", lyric text, or ad-style lower thirds unless the user explicitly overrides Spotify Canvas rules.
- Design for seamless looping: the final frame should naturally return to the first frame.

## Routing

1. If the user provides footage, route to Raw Video Editor or Video Editor and make a 9:16 5s loop.
2. If the user wants designed motion, route to Hypermotion/Remotion and render a deterministic MP4.
3. If the user wants generated footage, use the shared `media-generation` source and the connected provider that fits the job. WaveSpeed, Fal, Replicate, or Zero can be valid. Do not require OpenAI unless the selected provider actually needs it.
4. Use Squad only when its preflight is clean for the selected brief. If Squad asks for OpenAI but a non-OpenAI provider is available, do not call the request blocked; route around Squad and produce a provider-ready Canvas brief instead.

## Brief Shape

Use a Canvas-specific brief, not a multi-shot ad brief:

```json
{
  "format": "spotify_canvas",
  "aspect_ratio": "9:16",
  "duration_seconds": 5,
  "loop": true,
  "audio": "none",
  "text_overlay": false,
  "voiceover": false,
  "cta": false,
  "visual_direction": "one emotionally specific loop"
}
```

## Output

Give the user:

1. The loop concept in one paragraph.
2. The exact production prompt or edit plan.
3. Provider/tool choice and why.
4. Approval needed before spend/render if applicable.
5. Final MP4 path only after the file exists.

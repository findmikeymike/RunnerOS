---
name: squad
description: Use Squad to produce personal creative content through its Python CLI: social videos, UGC, app demos, music promos, faceless narratives, image assets, voiceover, captions, audio mix, and carousel/slideshow exports. Always preflight before provider spend.
---

# Squad

Squad is a Python-first creative production system for making social content for the owner: videos, UGC ads, app demos, music promos, faceless narrative videos, carousel/slideshow posts, image assets, narration, captions, music/audio mix, and review manifests.

Use this skill when an agent needs to run Squad as a tool.

## Rule Zero

Run preflight first. Do not spend provider credits until preflight returns `"ok": true` and the user or supervising agent has approved the paid run.

Do not print `.env.local`, API keys, provider tokens, or raw secret values.

## Startup Protocol

Before an important video/image-heavy run, ask or infer the operating mode:

1. **Auto** — run Squad end to end and report the output.
2. **Watch** — run Squad and launch Squad Studio so the user can watch visually.
3. **Guided** — draft the brief/plan, then pause for user edits or approval in Squad Studio before spend.
4. **Checkpointed** — run to key gates and pause for approval on script, images, clips, audio, or final.
5. **Manual Studio** — user drives the GUI; agent executes commands and handles errors.

Defaults:

- Cheap/simple request: Auto is fine.
- Important creative/video request: offer Guided or Checkpointed.
- Image/clip-heavy request: offer Watch or Checkpointed.
- Premium spend: use Guided or Checkpointed unless the user explicitly says Auto.

Do not make the GUI mandatory. Use it when visual judgment, edits, approvals, or comparison matter.

## Main Commands

Launch local visual cockpit:

```bash
.venv/bin/python scripts/squad_studio.py --install
```

Then open `http://127.0.0.1:7860`. After the first install, use:

```bash
.venv/bin/python scripts/squad_studio.py
```

No-spend video preflight:

```bash
.venv/bin/python scripts/run_creative_production.py \
  --brief-file brief.json \
  --video-quality budget \
  --budget-cap-usd 1.00 \
  --preflight-only
```

No-spend storyboard / plan board for human or agent review:

```bash
.venv/bin/python scripts/build_storyboard_plan_board.py \
  --brief-file brief.json \
  --output-dir .outputs/storyboards/run_review \
  --video-quality budget
```

Budget video run:

```bash
.venv/bin/python scripts/run_creative_production.py \
  --brief-file brief.json \
  --video-quality budget \
  --budget-cap-usd 1.00
```

Run with local assets:

```bash
.venv/bin/python scripts/run_creative_production.py \
  --brief-file brief.json \
  --asset-root /absolute/path/to/assets \
  --video-quality budget \
  --budget-cap-usd 1.00
```

Inspect latest creative run:

```bash
.venv/bin/python scripts/show_creative_production_run.py --latest
.venv/bin/python scripts/creative_operator_next.py --latest
```

Local carousel/slideshow export, no paid providers:

```bash
.venv/bin/python scripts/run_carousel_production.py \
  --brief-text "Create a 6 slide TikTok slideshow about why this app solves the real problem" \
  --product "the product/topic" \
  --platform tiktok \
  --slides 6
```

## Capability Map

### UGC scripted ad

Use for believable creator-style ads, founder/persona reads, testimonial-feeling promos, and direct-response product clips.

Best brief signals:

- `output_type`: `full_production`
- `campaign_goal`: say this is UGC, creator-on-camera, testimonial, talking head, or presenter-led
- `hook_direction`, `script_bits`, `must_say`, `avoid_phrases`, `tone_direction`, `cta_text`
- `character_lock` for consistent creator/persona identity
- `world_profile` for setting, lighting, and sonic world

Good for: music drops, apps, SaaS, products, books, launches.

Watchouts: do not let UGC fall into generic image-to-video if the user clearly asked for presenter/creator content. Keep scripts human and punchy; do not speak strategy notes out loud.

### App demo ad

Use for apps, tools, SaaS, dashboards, onboarding flows, and screen-led demos.

Best brief signals:

- real app/product description
- concrete user pain
- 3-5 visual beats
- proof/result moment
- CTA
- optional asset folder with screenshots, logos, screen recordings, or product images

Good for: mobile apps, web apps, internal tools, feature launches.

Watchouts: avoid vague "beautiful app" language. Say what the screen proves.

### Music promo / lyric video

Use for artists, singles, albums, performance visuals, lyric-driven clips, release teasers, and mood films.

Best brief signals:

- artist/song/release name
- platform
- hook or lyric bits
- mood and visual world
- `cinema_mode`: usually `performance`, `noir`, `documentary`, or `surreal`
- optional music/audio assets through `--asset-root`

Good for: TikTok/Reels/Shorts release content, vibe pieces, lyric cards, performance-style clips.

Watchouts: keep the concept emotionally specific. Do not make generic "artist in neon room" unless asked.

### Faceless narrative

Use for documentary-style, mystery, explainer, educational, history, lore, or psychological story videos where no presenter is needed.

Best brief signals:

- topic
- thesis
- emotional angle
- audience curiosity gap
- desired length/platform
- must-cover points

Good for: YouTube Shorts, TikTok explainers, lore videos, story-led promos.

Watchouts: demand a real thesis. Avoid filler narration and generic "hidden pattern" claims unless the brief earns it.

### Product ad / multi-shot social

Use for visual product spots, mood-led promos, product lifestyle content, fashion, physical goods, and cinematic social ads.

Best brief signals:

- product identity
- audience
- desired emotional reaction
- visual setting
- proof/demo moment
- CTA
- `cinema_mode`, `character_lock`, `world_profile`

Good for: high-polish short ads, brand mood pieces, product reveal clips.

Watchouts: keep each shot doing a job. No filler beauty shots unless the brief asks for a pure mood film.

### Carousel / slideshow

Use for static social slide content: Instagram carousels, TikTok-style slideshow posts, LinkedIn document posts, saveable explainers, argument carousels, and step-by-step posts.

Command path: `scripts/run_carousel_production.py`.

Good for: cheap fast content, strong hooks, educational slides, thought-leadership posts, TikTok static slideshow content.

Watchouts: this lane should not route through paid video production. Static slides are the default; use MP4 slideshow export only when needed.

### Image assets

Use when the user needs still images, source visuals, posters, covers, product shots, or reference frames.

Best brief signals:

- exact subject
- style
- aspect ratio/platform
- brand/character/world constraints
- whether images feed a later video run

Watchouts: include the actual scene intent. Do not generate generic pretty frames.

## Brief JSON

Do not put CLI options in `brief.json`. These belong on the command line:

- `video_quality`
- `budget_cap_usd`
- `asset_root`
- `preflight_only`

Minimum brief:

```json
{
  "product_description": "what is being promoted",
  "campaign_goal": "what content to make and why",
  "platform": "tiktok",
  "output_type": "full_production",
  "max_cost_usd": 1.0
}
```

High-control brief:

```json
{
  "product_description": "new single from an independent artist",
  "campaign_goal": "Make a punchy TikTok promo with a bold emotional hook, three fast visual beats, and no generic intro.",
  "platform": "tiktok",
  "output_type": "full_production",
  "max_cost_usd": 1.0,
  "hook_direction": "psychological, bold, emotionally spiking",
  "script_bits": ["raw line or proof point to weave in"],
  "must_say": ["listen before midnight"],
  "avoid_phrases": ["game changer", "unlock your potential"],
  "tone_direction": "plainspoken, urgent, not ad-copy",
  "aesthetic_notes": "close, intimate, tactile, premium but not sterile",
  "cinema_mode": "performance",
  "character_lock": "same artist, copper braids, exhausted-but-magnetic presence",
  "world_profile": "basement club, magenta side light, sweaty walls, crowd breath",
  "cta_text": "listen now"
}
```

## Creative Controls

Use these fields to keep direction open without making prompts bloated:

- `hook_direction`: what kind of opening force the content needs
- `script_bits`: user-provided lines, proof, claims, lyrics, or talking points
- `must_say`: required phrases
- `avoid_phrases`: banned cliches or wrong claims
- `tone_direction`: voice and attitude
- `aesthetic_notes`: visual taste and scene intent
- `cinema_mode`: compact directing lane such as `performance`, `documentary`, `noir`, `surreal`, or other supported modes
- `character_lock`: identity/persona consistency
- `world_profile`: setting, lighting, atmosphere, sound world
- `cta_text`: call to action

Prefer compact, decisive direction over long prompt soup.

## Music Library

Squad picks background music from a local folder of audio files. To enable it:

1. Drop audio files (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`) into any folder.
2. Name them with mood/energy/genre/instrument hints so the audio router can pick them — e.g. `cinematic_dark_premium_120bpm.wav`, `funny_high_pop.mp3`, `nostalgic_low_ambient_keys_loop.wav`. Subfolders are walked recursively; the folder name counts as a hint too.
3. Point Squad at the folder, either:
   - **Per-run:** `--music-library-root /absolute/path/to/music` (repeatable)
   - **Persistent:** `export SQUAD_TRACK_LIBRARY_ROOT=/absolute/path/to/music`

Inspect what Squad sees before a real run:

```bash
.venv/bin/python scripts/inspect_music_library.py /absolute/path/to/music
```

Tracks flagged with ⚠ have no extractable tags — rename their files with hints from: `premium`, `cinematic`, `dark`, `dreamy`, `nostalgic`, `luxury`, `energetic`, `funny`, `calm`, `weird`, `gritty`, `romantic`; `hip-hop`, `ambient`, `electronic`, `indie`, `pop`, `jazz`, `rock`; `drums`, `bass`, `synth`, `pads`, `keys`, `guitar`, `piano`, `strings`; `low`/`medium`/`high`; `instrumental`, `bed`, `loop`.

A run with no library configured logs `"no matching track was available from 0 candidates"` in the audio mix plan — captions and voiceover still ship, but there's no music bed.

## SFX Library

Same idea for sound effects:

1. Folder of `.wav`/`.mp3` files organized by tag: `<root>/impact/*.wav`, `<root>/transition/*.wav`, `<root>/room_tone/*.wav`, `<root>/fire/*.wav`, `<root>/hand_clap/*.wav`. Intensity in the filename (e.g. `high-hit.wav`) is preferred when the cue has matching intensity.
2. Enable: `export SQUAD_SFX_LIBRARY_ROOT=/absolute/path/to/sfx`

Without a library, planned SFX cues are written to the manifest for reference but no SFX audio is mixed in.

## Visual Polish (Upscale)

Free local upscale + sharpen pass between assembly and caption burn-in. Captions therefore render at the polished resolution (sharper text on every output).

Enable: `export SQUAD_VISUAL_POLISH_TARGET_HEIGHT=1080`

No-op when unset, when source is already ≥ target, or when ffprobe can't read the source.

## Spend Rules

- Default to `--video-quality budget`.
- Default to `--budget-cap-usd 1.00`.
- Do not use `standard` or `premium` until a budget run proves the direction.
- Never rerun blindly after a provider error. Inspect the manifest and error first.
- For carousel/slideshow, prefer the local no-provider runner unless the user explicitly wants generated image/video assets.

## After A Run

Inspect:

- `final_status`
- `manifest_path`
- `final_asset_path`
- `review_path`
- `total_spend_usd`
- `video_attempts`
- `motion_plan`
- `output_qa_report`

If not review-ready, report the blocker. If review-ready, show the output path and ask for human review or redo direction.

## Do Not Do

- Do not expose secrets.
- Do not bypass preflight.
- Do not raise quality or budget without approval.
- Do not put CLI flags inside `brief.json`.
- Do not route carousel/slideshow briefs through video production.
- Do not edit successful manifests by hand.
- Do not delete run folders unless explicitly asked.
- Do not treat every request as generic image-to-video. Pick the right domain.

## Deeper Reference

Read `docs/squad-cli-agent-contract.md` for the stricter outside-agent operating contract.

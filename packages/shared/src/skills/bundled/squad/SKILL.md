---
name: squad
description: Use Squad through Runner's local wrapper for no-spend storyboards, production preflight, approval-gated video runs, review packets, and artifact-window publishing.
---

# Squad

Use this skill when an agent needs Squad creative production: social videos, UGC, app demos, music promos, faceless narratives, carousel/slideshow content, image assets, voiceover, captions, audio mix, storyboard boards, and final MP4 review outputs.

## Rule Zero

Storyboard or preflight first. Do not spend provider credits until preflight is clean and the user or supervising agent approves the run.

Never print `.env.local`, API keys, provider tokens, or raw secret values.

## Runner Wrapper

Run from the Runner workspace root. Use the `squad` source Local path shown in Runner context, then append `/bin/squad.mjs`:

```bash
node <squad-source-local-path>/bin/squad.mjs doctor --json
node <squad-source-local-path>/bin/squad.mjs storyboard --brief-file brief.json --json
node <squad-source-local-path>/bin/squad.mjs preflight --brief-file brief.json --json
node <squad-source-local-path>/bin/squad.mjs run --brief-file brief.json --approved --budget-cap-usd 1.00 --json
node <squad-source-local-path>/bin/squad.mjs inspect-latest --json
```

If Squad is not found, set:

```bash
export SQUAD_HOME=/absolute/path/to/Squad
```

Michael's local default is `/Users/michaelb.williams/CAS4/Squad`.

## Artifact Window

`storyboard` and `run` return a `create_output` payload. Pass it to Runner's `create_output` tool exactly, keeping `showInCanvas: true`.

- Storyboard output uses `storyboard-board.html` as the primary asset.
- Video output uses the final MP4 as the primary asset.
- Manifest/review packets are supporting assets.
- The wrapper stages run artifacts under `squad-artifacts/` so Runner can preview them.

## Operating Modes

- **Storyboard**: no-spend HTML board for plan review.
- **Preflight**: no-spend production readiness check.
- **Budget run**: approved production run with `--video-quality budget --budget-cap-usd 1.00`.
- **Guided/checkpointed**: pause for user approval on script, images, clips, audio, or final.
- **Studio/manual**: use Squad Studio only when visual editing or live watching matters.

## Brief JSON

Do not put CLI options in `brief.json`. Keep these on the command line: `video_quality`, `budget_cap_usd`, `asset_root`, `preflight_only`, and approval flags.

Minimum:

```json
{
  "product_description": "what is being promoted",
  "campaign_goal": "what content to make and why",
  "platform": "tiktok",
  "output_type": "full_production",
  "max_cost_usd": 1.0
}
```

Useful control fields:

```json
{
  "hook_direction": "bold psychological hook, no generic intro",
  "script_bits": ["raw line or proof point to weave in"],
  "must_say": ["required phrase"],
  "avoid_phrases": ["game changer"],
  "tone_direction": "plainspoken, urgent, not ad-copy",
  "aesthetic_notes": "specific visual direction",
  "cinema_mode": "performance",
  "character_lock": "same creator across shots",
  "world_profile": "basement club with magenta side light",
  "cta_text": "listen now"
}
```

## Spend Rules

- Default to `--video-quality budget`.
- Default cap: `--budget-cap-usd 1.00`.
- Do not use `standard` or `premium` until a budget run proves the direction.
- Never rerun blindly after provider failure. Inspect the JSON error and manifest first.
- Do not raise budget or quality without explicit approval.

## After A Run

Inspect:

- `final_status`
- `manifest_path`
- `final_asset_path`
- `review_path`
- `total_spend_usd`
- `video_attempts`
- `motion_plan`

If there is no review-ready artifact, stop and report the blocker.

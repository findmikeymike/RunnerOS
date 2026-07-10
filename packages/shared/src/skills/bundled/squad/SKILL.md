---
name: squad
description: Plan, storyboard, preflight, and produce approval-gated creative videos with RunnerOS's bundled Squad engine.
---

# Squad

Use Squad for storyboard-first creative production: social videos, UGC, product and app demos, music promos, faceless narratives, carousels, image assets, voiceover, captions, audio mix, and final video review.

## Rule Zero

Storyboard and preflight before production. Never spend provider credits until the user has approved the brief, provider lane, quality, and budget in the current conversation.

Never print API keys, provider tokens, `.env` files, or raw secret values.

## Built-In Runner Wrapper

Use the Local path supplied by Runner's built-in `squad` source:

```bash
node <squad-source-local-path>/bin/squad.mjs doctor --json
node <squad-source-local-path>/bin/squad.mjs recipe --brief-file brief.json --json
node <squad-source-local-path>/bin/squad.mjs storyboard --brief-file brief.json --json
node <squad-source-local-path>/bin/squad.mjs preflight --brief-file brief.json --provider-mode auto --json
node <squad-source-local-path>/bin/squad.mjs run --brief-file brief.json --approved --budget-cap-usd 1.00 --provider-mode auto --json
```

Do not require `SQUAD_HOME`. RunnerOS ships its own Squad fork.

## Provider Modes

- `auto`: use the native production lane when its director is configured; otherwise return a modular orchestration plan.
- `openai`: require the native OpenAI-directed production lane.
- `modular`: plan generation through connected media providers or Runner agents, without claiming that Squad itself generated assets.
- `external`: validate user- or agent-supplied assets before handoff to an editor/assembler.

When modular/external mode returns a plan, use the connected `media-generation` source for asset generation and Video Editor Agent or Hypermotion for assembly. A plan is not a finished video.

## Brief JSON

Minimum:

```json
{
  "product_description": "what is being promoted",
  "campaign_goal": "what to make and why",
  "platform": "tiktok",
  "output_type": "full_production",
  "max_cost_usd": 1.0
}
```

Useful controls include `hook_direction`, `script_bits`, `must_say`, `avoid_phrases`, `tone_direction`, `aesthetic_notes`, `cinema_mode`, `character_lock`, `world_profile`, and `cta_text`.

Keep `video_quality`, `budget_cap_usd`, `asset_root`, provider mode, and approval flags on the command line.

## Outputs

`storyboard` and `run` return a `create_output` payload when there is a reviewable artifact or receipt. Pass that payload to Runner's `create_output` tool exactly. Keep `showInCanvas: true`.

- Storyboard primary asset: `storyboard-board.html`.
- Finished production primary asset: final MP4.
- Manifests, JSON boards, and review packets: supporting assets.
- Modular plans: receipts, clearly labeled as waiting for generation or assembly.

Do not claim production succeeded unless the final asset exists.

## Spend Rules

- Default quality: `budget`.
- Default cap: `$1.00`.
- Do not raise quality or budget without explicit approval.
- Never rerun blindly after provider failure. Inspect the returned error and manifest first.

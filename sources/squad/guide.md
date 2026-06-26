# Squad

Use this source for Squad creative production: no-spend storyboards, preflight, budget video runs, review packets, carousels, and agent-readable production receipts.

Run commands from the Runner workspace root, not from inside `tools/squad`, so generated artifacts land under the workspace and can be shown in the artifact window.

## Commands

```bash
node tools/squad/bin/squad.mjs doctor --json
node tools/squad/bin/squad.mjs storyboard --brief-file brief.json --json
node tools/squad/bin/squad.mjs preflight --brief-file brief.json --json
node tools/squad/bin/squad.mjs run --brief-file brief.json --approved --budget-cap-usd 1.00 --json
node tools/squad/bin/squad.mjs inspect-latest --json
```

## Artifact Window

`storyboard` and `run` return a `create_output` JSON payload.

Pass that payload directly to Runner's `create_output` tool. Keep `showInCanvas: true`.

- Storyboards publish `storyboard-board.html` as the primary asset.
- Video runs copy the final MP4, manifest, and review packet into `squad-artifacts/runs/...` before publishing.
- All previewable files must live inside the Runner workspace; do not publish paths directly from `/Users/michaelb.williams/CAS4/Squad/.outputs`.

## Safety

- Storyboard first.
- Preflight before provider spend.
- `run` refuses to start unless `--approved` is present.
- Never expose `.env.local`, API keys, provider tokens, or raw secret values.
- Default to `--video-quality budget --budget-cap-usd 1.00`.
- Do not use standard or premium quality without explicit approval.

## Setup

By default this wrapper looks for Squad at `/Users/michaelb.williams/CAS4/Squad`.

Other installs should set:

```bash
export SQUAD_HOME=/absolute/path/to/Squad
```

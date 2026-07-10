# RunnerOS Squad

App-owned Squad video workflow fork, bundled with RunnerOS.

This tool vendors the Squad production modules under `vendor/squad/` so RunnerOS agents can use Squad workflows without an external Squad checkout.

## Commands

```bash
node bin/squad.mjs doctor --json
node bin/squad.mjs recipe --brief-file brief.json --json
node bin/squad.mjs storyboard --brief-file brief.json --json
node bin/squad.mjs preflight --brief-file brief.json --json
node bin/squad.mjs run --brief-file brief.json --approved --budget-cap-usd 1.00 --json
```

## Provider Modes

- `--provider-mode auto`: use native production when the OpenAI director is configured; otherwise use modular preflight/run planning.
- `--provider-mode openai`: require the upstream OpenAI director path.
- `--provider-mode modular`: allow agent-guided workflows with external generation providers or existing media.
- `--provider-mode external`: require user/agent supplied assets or provider outputs before final assembly.

Modular/external mode is intentionally additive. It does not remove Squad's storyboarding, recipe recommendation, product/UGC/no-face/music/carousel logic, or the upstream OpenAI-backed production path.

`storyboard` and `run` return a Runner `create_output` payload when a reviewable board, video, manifest, or receipt exists. Modular mode produces an orchestration plan; generation and assembly still happen through connected media providers and Runner video agents.

Production subprocesses run from the brief's directory so generated `.outputs/` and `squad-artifacts/` stay in the user's writable workspace rather than the installed app bundle.

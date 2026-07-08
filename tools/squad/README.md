# RunnerOS Squad

App-owned Squad video workflow fork.

This tool vendors the lightweight Squad source modules under `vendor/squad/` so RunnerOS agents can use Squad workflows without mutating `/Users/michaelb.williams/CAS4/Squad`.

## Commands

```bash
node bin/squad.mjs doctor --json
node bin/squad.mjs recipe --brief-file brief.json --json
node bin/squad.mjs storyboard --brief-file brief.json --json
node bin/squad.mjs preflight --brief-file brief.json --json
node bin/squad.mjs run --brief-file brief.json --approved --budget-cap-usd 1.00 --json
```

## Provider Modes

- `--provider-mode auto`: preserve normal Squad behavior when OpenAI is present; otherwise use modular preflight/run planning.
- `--provider-mode openai`: require the upstream OpenAI director path.
- `--provider-mode modular`: allow agent-guided workflows with external generation providers or existing media.
- `--provider-mode external`: require user/agent supplied assets or provider outputs before final assembly.

Modular/external mode is intentionally additive. It does not remove Squad's storyboarding, recipe recommendation, product/UGC/no-face/music/carousel logic, or the upstream OpenAI-backed production path.

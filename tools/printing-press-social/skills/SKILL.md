---
name: social-cli-harness
description: CLI-Anything-style root harness for routing agent social commands to platform-specific direct browser CLIs.
---

# Social CLI Harness

Use this skill when an agent needs to operate supported social platforms through deterministic commands.

## Always Use JSON

```bash
social registry --json
social doctor --json
social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
social post tiktok --profile creator01 --text "caption" --media video.mp4 --dry-run --json
social post x --profile artist01 --text "post text" --dry-run --json
social post youtube --profile channel01 --post-type short --text "Short title" --media short.mp4 --dry-run --json
```

## Platform Skills

Read the platform skill before live execution:

- `instagram-cli/skills/SKILL.md`
- `tiktok-cli/skills/SKILL.md`
- `x-cli/skills/SKILL.md`
- `youtube-cli/skills/SKILL.md`

## Safety Rules

- New profiles default to `require-confirm`; live actions need exact approval and `--confirm yes`.
- Run `social doctor --json` before using a freshly installed harness.
- Run `social doctor --live --json` after profile login to verify sessions.
- Default to `runner-cdp` inside RunnerOS. Treat dry-run JSON as the action contract and execute with Runner browser/CDP tools.
- Treat `browserPlan.accountVerification` as mandatory before the final submit button.
- Use `social assets --asset-root <dir> --platform <platform> --json` and `social content --content-root <dir> --json` before selecting files from campaign folders.
- Use `--asset-root` / `--content-root` with relative `--media` and `--text-file` values so the action records the exact resolved source paths.
- Use valid media paths in dry-runs; dry-run validates obvious impossible inputs.
- Do not operate browser sessions directly when a `social` command exists.

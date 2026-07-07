---
name: social-instagram
description: Agent-native Instagram CLI harness for deterministic direct browser profile, dry-run, and posting commands.
---

# Social Instagram

Use this skill when an agent needs to operate Instagram through deterministic commands instead of controlling the browser itself.

Use `social` when the root package is installed. Use `instagram-social` when only the standalone Instagram package is installed.

## Required Pattern

Always dry-run before live execution:

```bash
social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
```

Then execute live only after exact user approval. Default `runner-cdp` returns a plan for Runner browser tools; direct CLI live execution needs a configured fallback engine.

```bash
social post instagram --profile artist01 --text "caption" --media image.jpg --engine playwright --confirm yes --json
```

## Profile Setup

```bash
social profile add instagram --profile artist01 --handle @artist01 --json
social profile set-policy instagram --profile artist01 --confirm-policy require-confirm --json
social profile login instagram --profile artist01
social profile status instagram --profile artist01 --live --json
```

## Comments And DMs

```bash
social comment instagram --profile artist01 --url "https://www.instagram.com/p/..." --text "comment" --dry-run --json
social dm instagram --profile artist01 --to username --text "message" --dry-run --json
```

## Notes

- Current bundled implementation defaults to Runner browser/CDP plans; Playwright is an optional standalone fallback.
- CloakBrowser is optional local-only because its binary cannot be bundled into a sellable product without extra licensing.
- Browser harness/CDP should be the long-term clean engine.
- New profiles default to `require-confirm`.
- Live profiles need `--handle` or `--account-url` so the visible browser account can be verified.
- Use `--confirm yes` only for the exact approved live action.
- Live Instagram posts require media.
- JSON output is the stable contract for agents.

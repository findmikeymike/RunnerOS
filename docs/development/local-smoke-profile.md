---
status: current
owner: agent
last_verified: 2026-07-05
source_of_truth: true
---

# Local Smoke Profile

Purpose: let the app owner run real-key, real-tool smoke tests without shipping private artist data or credentials.

## Files

- `.env.local` at repo root: real keys. Ignored by git. Electron dev loads it.
- `smoke/local/artist-context.md`: real artist/team context. Ignored by git.
- `smoke/local/campaign-context.md`: real campaign context. Ignored by git.
- `smoke/templates/`: safe starter templates. Tracked.

## Setup

```bash
mkdir -p smoke/local
cp smoke/templates/env.local.example .env.local
cp smoke/templates/artist-context.md smoke/local/artist-context.md
cp smoke/templates/campaign-context.md smoke/local/campaign-context.md
bun run smoke:profile:check
```

Fill only the services you want to smoke. Do not paste keys into chat, docs, session notes, or app fixtures.

## Smoke Order

1. Run `bun run smoke:profile:check`.
2. Launch dev app with `bun run electron:dev`.
3. Confirm Settings/providers show expected keys or connected status.
4. Run one plain HNIC chat smoke.
5. Run one Content Genius/campaign smoke using `smoke/local/campaign-context.md`.
6. Run one tool-specific smoke per filled provider.
7. Save only pass/fail notes in docs; never save key values or private artist details.

## Agent Rule

Future agents may read `smoke/local/*.md` only when explicitly doing local smoke setup or real-provider smoke testing. They must never commit those files or quote private content into tracked docs.

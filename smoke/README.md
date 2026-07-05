# Smoke Profile

Use this folder for real local smoke testing without shipping private data.

- `templates/` is tracked and safe to commit.
- `local/` is ignored and can hold real artist/campaign notes.
- `.env.local` at the repo root is ignored and can hold real keys.

Start:

```bash
mkdir -p smoke/local
cp smoke/templates/env.local.example .env.local
cp smoke/templates/artist-context.md smoke/local/artist-context.md
cp smoke/templates/campaign-context.md smoke/local/campaign-context.md
bun run smoke:profile:check
```

Then fill `.env.local` plus the two local context files.

Future agents should read [docs/development/local-smoke-profile.md](../docs/development/local-smoke-profile.md) before running real provider smokes.

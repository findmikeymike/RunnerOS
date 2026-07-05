# Smoke Profile

Use this folder for real local smoke testing without shipping private data or keys.

- `templates/` is tracked and safe to commit.
- `local/` is ignored and can hold real artist/campaign/service smoke notes.
- Keys are entered through the app UI and persist outside the repo in RunnerOS credential storage.

Start:

```bash
mkdir -p smoke/local
cp smoke/templates/artist-context.md smoke/local/artist-context.md
cp smoke/templates/campaign-context.md smoke/local/campaign-context.md
cp smoke/templates/service-profile.md smoke/local/service-profile.md
bun run smoke:profile:check
```

Then fill the local context/checklist files and add keys through the app UI.

Future agents should read [docs/development/local-smoke-profile.md](../docs/development/local-smoke-profile.md) before running real provider smokes.

---
status: current
owner: agent
last_verified: 2026-07-05
source_of_truth: true
---

# Local Smoke Profile

Use this when you need real artist/campaign context and service keys for a genuine smoke test without shipping private data.

## Rule

```text
Private smoke data lives in .local-smoke/.
Demo templates live in scripts/smoke/templates/demo/.
Generated workspace state is disposable.
Git must stay clean except intentional code/docs changes.
```

`.local-smoke/` and `*.local.env` are gitignored.

## Setup

```bash
mkdir -p .local-smoke/profile-real
cp scripts/smoke/templates/demo/artist-context.json .local-smoke/profile-real/
cp scripts/smoke/templates/demo/campaign-context.json .local-smoke/profile-real/
cp scripts/smoke/templates/demo/seed-smoke-work-products.json .local-smoke/profile-real/
cp scripts/smoke/templates/demo/services.env.example .local-smoke/profile-real/services.env
```

Edit the `.local-smoke/profile-real/*` files with real local data.

Do not put secrets inside context JSON. Put keys only in `services.env`.

## Load

Point `--workspace-root` at the disposable workspace root you want to seed.

```bash
/Users/michaelb.williams/.bun/bin/bun scripts/smoke/load-local-smoke-profile.ts \
  --profile .local-smoke/profile-real \
  --workspace-root /tmp/runneros-smoke-workspace \
  --workspace-id local-smoke
```

Safe demo run:

```bash
/Users/michaelb.williams/.bun/bin/bun scripts/smoke/load-local-smoke-profile.ts \
  --profile scripts/smoke/templates/demo \
  --workspace-root /tmp/runneros-demo-smoke \
  --workspace-id demo-artist-hq
```

## What It Seeds

- Artist context docs: profile, branding, voice, Spotify, calendar, network, community.
- Campaign context docs: mission brief, release board, campaign worker context.
- Work Products: HQ recent, campaign recent, campaign approval-needed.

The loader creates Outputs through the real Output manifest system, so HQ/campaign Work Product widgets, approval updates, and `output-index` can be smoke-tested honestly.

## Smoke Checklist

1. Load profile into a disposable workspace root.
2. Start the app against that workspace.
3. Open Artist HQ.
4. Verify Work Products shows pending + recent items.
5. Open Campaign home.
6. Verify campaign Work Products show campaign items.
7. Open the pending item drawer.
8. Approve it, then inspect `outputs/<id>/output.json`.
9. Reload State of Play and verify pending approvals route correctly.
10. Confirm `git status --short` does not show private `.local-smoke` data.

## Hard No

- Do not commit `.local-smoke/`.
- Do not commit real API keys.
- Do not paste `services.env` into docs, issues, commits, or chat.
- Do not seed private data into a production workspace for smoke tests.

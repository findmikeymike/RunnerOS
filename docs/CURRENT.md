---
status: active
owner: agent
last_verified: 2026-07-09
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-07-09
- Active worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`
- Branch: `codex/creator-social-integration`
- State: active app tree for Creator Command / HQ / Campaign work.
- Remote state: local branch is ahead of `origin/codex/creator-social-integration`; do not assume origin has every local upgrade until pushed.

## Recently Completed

- Added Art Director classic album-cover reference library.
- Expanded Art Director with image-generation routing, Midjourney-killer model matrix, prompt anatomy, and stronger cover-reference remix guidance.
- Added official TryPost MCP source wiring and Setup Concierge guidance.
- Moved HQ `Vault` out of the top-level sidebar and into `Brain`.
- Swapped HQ `Brain` nav icon to the actual brain icon.
- Added and tuned the subtle divider between HQ `Chat` and `Brain`.
- Regenerated `docs/system-map/`.

## Current HQ Nav Shape

- Top-level HQ nav keeps the main work surfaces.
- `Brain` contains:
  - `Profile`
  - `Voice`
  - `Intel Docs`
  - `Branding`
  - `Vault`
- Vault remains the file/asset store for images, audio, docs, demos, moodboards, and references.

## Verification State

Passed:

```bash
/Users/michaelb.williams/.bun/bin/bun run typecheck:electron
/Users/michaelb.williams/.bun/bin/bun run docs:system-map
```

## Notes For Next Agent

- Work in `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`.
- Preserve the local commit stack unless Michael asks to squash/rebase.
- Push only when it is okay to publish all local commits ahead of origin.
- Art Director upgrades live in `packages/shared/src/skills/bundled/artist-art-direction/`.
- HQ nav wiring lives in:
  - `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
  - `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`
- Regenerate `docs/system-map/` after starter-agent, source, skill, or launch-surface changes.

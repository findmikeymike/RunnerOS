---
status: current
owner: agent
last_verified: 2026-07-08
source_of_truth: true
---

# Spotify Fix

Make the Spotify Analyst and Spotify Playlist Creator agents fully functional and reliable in packaged builds, not just in a dev monorepo checkout.

## Current Repo State

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/creator-command-center`
- Branch: `codex/creator-command-center`
- Verified 2026-07-08: none of the issues below are handled yet.

## Summary

- **Spotify Analyst** works only in a dev monorepo. Its flagship public-snapshot command fails two different ways in a packaged app.
- **Spotify Playlist Creator** can build and gate a plan, but can never actually create a playlist end to end — there is no Spotify write actuator anywhere in the system.

The analyst fix is small, safe, and high value. The playlister fix is a product decision (add real Spotify user-OAuth write tooling, or reposition as plan-only).

## Findings

### A1 (blocker) — Analyst snapshot path is dev-only

- Agent prompt tells the worker to run:
  `bun "$CRAFT_APP_ROOT/packages/shared/src/skills/bundled/spotify-analytics-snapshot/scripts/api-snapshot.ts" --workspace "$CRAFT_WORKSPACE_PATH"`
  at `packages/shared/src/agent-definitions/starter-templates.ts:1577`.
- `packages/shared/src/skills/bundled/**` is **not shipped** in the packaged app. `apps/electron/electron-builder.yml` `files` includes only `dist/**` plus four specific interceptor `.ts` files, and no build step copies skill scripts into the package.
- Result: in a shipped RunnerOS the file does not exist → file-not-found.

### A2 (blocker) — `api-snapshot.ts` cross-package import breaks once materialized

- `packages/shared/src/skills/bundled/spotify-analytics-snapshot/scripts/api-snapshot.ts:4`:
  `import { loadContextDoc, upsertContextDoc } from '../../../../workspace-context/index.ts';`
- It is the only Spotify script with a cross-package relative import (the other four use node builtins only).
- Bundled skills materialize to `~/.agents/skills/<slug>/scripts/…` (see `packages/shared/src/skills/storage.ts`, `GLOBAL_AGENT_SKILLS_DIR`). At that location the relative path resolves to `~/.agents/workspace-context/index.ts`, which does not exist → import crash.
- So even if A1 is fixed by pointing at the materialized copy, the script still fails on import. It only resolves when run from the monorepo source tree.

### A3 — Three conflicting invocation conventions for the same scripts

- agent prompt + `api-snapshot` SKILL: `$CRAFT_APP_ROOT/packages/shared/src/skills/bundled/...` (dev source)
- `delta-brief` / `snapshot` SKILL: `npx tsx skills/spotify-analytics-snapshot/scripts/...` (workspace-relative, and `npx tsx` needs network + an unbundled `tsx`)
- `build-plan` markdown: `bun packages/shared/src/skills/bundled/spotify-playlist-curator/scripts/apply-plan.ts` (bare relative)
- None reliably points at the materialized skill dir run with the bundled Bun.

### P1 (blocker for "create") — No Spotify write actuator exists

- `spotify-playlist-curator/scripts/apply-plan.ts` is explicit: it does NOT touch Spotify; it defers creation to "the approved Spotify MCP/API/OAuth tool."
- There is no such tool. Verified 2026-07-08: zero matches for `playlist-modify` / `SPOTIFY_OAUTH` / `SPOTIFY_REFRESH` / `createPlaylist` / `users/*/playlists`, and `0` references to spotify in `packages/shared/src/sources/builtin-sources.ts` (no builtin Spotify source).
- The only Spotify auth in the app is the analyst's client-credentials flow (read-only, no user context), which cannot create playlists (requires user OAuth with `playlist-modify-public/private`).
- Result: approve → create never completes; the agent always falls through to "return the payload, say what setup is missing." The greeting/outputs over-promise a "receipt."

## What is correct today (do not regress)

- Analyst API logic is sound and honest: public API = followers/popularity/genres only, no fabricated streams/cities, avoids Nov-2024-deprecated endpoints (`/artists/{id}` + `/top-tracks` with client-credentials still work), every metric carries a snapshot date, S4A path correctly requires a real browser capture.
- Playlist planner is solid and portable (node builtins only): seeded deterministic PRNG, no-back-to-back-same-artist logic, even feature-slot distribution, `--our-ratio` clamp, anti-"artist-bait" theme guard, `--apply --confirm` double gate before emitting the write checklist.

## Fix Plan

### Phase 1 — Analyst reliability (small, do first)

1. Make `api-snapshot.ts` self-contained: drop the `workspace-context` import. Write only the snapshot JSON, and let the agent write the `artist-spotify-snapshot` context doc via its normal context tooling (the prompt already provides the exact payload shape). This removes A2.
2. Repoint the agent prompt and the `spotify-analytics-snapshot` / `spotify-anomaly-watch` SKILLs to the materialized skill path run with the bundled Bun (e.g. `~/.agents/skills/spotify-analytics-snapshot/scripts/api-snapshot.ts`), and drop `npx tsx`. This removes A1/A3.
3. Regenerate `packages/shared/src/skills/bundled.generated.ts`.
4. Run `packages/shared/src/skills/__tests__/starter-templates.test.ts` and the analytics-snapshot script tests; add a smoke test that runs the materialized script layout (no monorepo-relative import).

### Phase 2 — Playlister actuator (product decision)

Pick one:

- **(a) Make it real:** add a Spotify user-OAuth source + a small self-contained `create-playlist` actuator (mirror the self-contained Shopify CLI pattern: direct API calls, approval-gated, receipts). Then approve → create works end to end.
- **(b) Reposition as plan-only:** update the agent greeting/outputs so it no longer promises a "creation payload or receipt," only a plan + setup-ready checklist.

## Acceptance

- Analyst public snapshot runs in a packaged build (or a packaged-layout smoke) with no monorepo-relative dependency and no dev-only path.
- All three invocation conventions collapse to one materialized-skill + bundled-Bun form.
- Playlister either creates a playlist end to end after approval (2a) or no longer claims it can (2b).

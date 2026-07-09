---
status: proposed
owner: agent
last_verified: 2026-07-08
source_of_truth: false
---

# Spotify Browser Agents Spec

Rebuild the two Spotify agents to operate through **reused, logged-in browser sessions** in the same "socials" connector system the post-agent uses — **no Spotify Web API, no OAuth, no app registration**. This deletes the API/quota-approval dependency entirely.

Worktree: `.worktrees/progress/creator-command-center/.worktrees/agent-work-continued` (branch `codex/agent-work-continued`, based on the PR #9 integration branch that already contains the post-agent connector infra).

## Decision

Spotify becomes a **new platform in `tools/printing-press-social`** (a `spotify-cli`), reusing the proven connector model rather than a parallel system:
- `action-safety.mjs` — require-confirm default, per-profile lock, idempotency ledger, account-verification gate, `buildProfileBrowserSession` partition.
- `profile-json.mjs` / `profile-verification.mjs` — profile storage, status, identity verification.
- The dispatcher's `catalog`/`doctor`/account-set grouping (data-driven off `registry.json`).

One Spotify account = one profile with its own persistent Electron partition (`persist:social-spotify-<id>`), one login covering **both** surfaces:
- `open.spotify.com` (web player) — playlist create + add tracks.
- `artists.spotify.com` (Spotify for Artists) — private stats capture + feature-on-artist-page.

## Grounded architecture (how the post-agent model actually works)

- **CLI = planner/gatekeeper, RunnerOS browser tools = actuator.** Under the default `runner-cdp` engine, an action's dry-run emits a full result: `{ action, browserPlan }`, where `browserPlan` carries `sessionPath`, `browserSession` (partition/instanceId), `accountVerification` (expected handle/url + identity probe + evidence requirements), and ordered `steps`. `social execute --action-file <dry-run.json> --expected-action-id <id> --confirm yes` re-validates the dry-run shape, checks the browserPlan session/partition/verification still match the current profile, then (runner-cdp) returns a **delegated** instruction telling the agent's native browser tools to open the partition, verify the visible account, and run the steps. Evidence: `tools/printing-press-social/src/social.mjs:392-535`.
- **Account verification is mandatory before any live submit** (`action-safety.mjs:assertLiveReady` + `buildBrowserPlan.accountVerification`). Prevents posting to the wrong logged-in account — critical for multi-account.
- **Settings connector** (`SocialAccountsSettingsPage.tsx` + `settings.ts`) stores accounts, opens/reuses a per-profile browser partition (`socialBrowserPartition`), and drives login/verification. This is the "socials connectors in app settings" surface.

## Spotify verbs (`spotify-cli`)

- `profile add|list|status|update|delete|login` — reuse profile-json/verification verbatim (handle = artist name / profile URL for identity match).
- `snapshot` (read) — analyst: emit a browserPlan that navigates the S4A session and captures private stats; normalize the captured JSON into a snapshot doc. Public Web API stays an *optional* light supplement (followers/popularity) only if `SPOTIFY_CLIENT_ID/SECRET` present.
- `playlist create` (write) — plan → dry-run browserPlan for `open.spotify.com` (create playlist, set name/description/visibility, add track URIs in order) → approval → execute (delegated) → verify → receipt.
- `playlist feature` (write) — plan → dry-run browserPlan for `artists.spotify.com` (feature/Artist Pick the created playlist on the artist profile) → approval → execute → receipt.

## Integration touch-list (what must change)

New:
- `tools/printing-press-social/spotify-cli/` — `src/cli.mjs`, `skills/SKILL.md`, `HARNESS.md`, `README.md`, `test/spotify-cli.test.mjs`.

Edit (shared — covered by the post-agent's 63 tests, so re-run them):
- `registry.json` — add `spotify` platform + verbs (`profile`, `snapshot`, `playlist`).
- `src/social.mjs` — extend `resolvePlatform`, `assertActionShape` (platform allowlist + verb allowlist for `snapshot`/`playlist`), and the `execute` replay (`buildLiveReplayArgs`) for the new verbs.
- `apps/electron/src/main/handlers/settings.ts` — add `spotify` to `SOCIAL_PLATFORMS`, `socialLoginUrl` (open.spotify.com), login-detection + account-url regexes (spotify.com / artists.spotify.com).
- `apps/electron/src/renderer/pages/settings/SocialAccountsSettingsPage.tsx` — add `spotify` to `PLATFORMS` + `SocialPlatform` type + hint copy.

Agents + skills:
- Rewrite `spotify-analyst` and `spotify-playlist-creator` prompts (`packages/shared/src/agent-definitions/starter-templates.ts`) to browser-session workflows using `spotify-cli`; drop the dev-only `$CRAFT_APP_ROOT/...api-snapshot.ts` invocation.
- Replace/rewrite skills: `spotify-analytics-snapshot` (browser S4A capture, not the API script) and `spotify-playlist-curator` (browser create + feature). Fixes the two `spotify-fix.md` backlog blockers (dev-only path + cross-package import) by removing the standalone-script approach.
- Regenerate `packages/shared/src/skills/bundled.generated.ts` and the system map.

Bundling: `electron-builder.yml` already ships `tools/printing-press-social/**`, so `spotify-cli` ships automatically. No new binary.

## Phasing

- **Layer A** — `spotify-cli` profile mgmt + registry + dispatcher/settings platform wiring + `doctor`/`catalog` show Spotify. (Connector works; login + verify a Spotify account.)
- **Layer B** — `snapshot` (S4A browser capture → normalized snapshot + Artist HQ context). Retires the broken API script.
- **Layer C** — `playlist create` (open.spotify) then `playlist feature` (S4A), both dry-run → approval → delegated execute → receipt.

## Open decisions (confirm before build)

1. **Spotify as a new platform in printing-press-social** (this doc) vs a standalone tool that only borrows `action-safety`. Recommended: new platform (reuses connector UI + account-sets + verification for free).
2. **Feature-on-artist-page (Layer C `playlist feature`)** in v1, or ship create-only first and add feature next? (S4A feature UI is the least-documented selector surface.)
3. **Public Web API supplement** kept as optional (followers/popularity when client creds exist) or dropped entirely for a pure-browser analyst?

## Acceptance

- A Spotify account connects/logs-in/verifies through the same Social Accounts settings surface and appears in `social catalog` account-sets.
- Analyst produces a snapshot from the S4A session with no dev-only path and no cross-package import; runs in a packaged build.
- Playlist Creator creates a playlist end to end (browser), approval-gated, with a receipt; optional feature step surfaces it on the artist page.
- Post-agent's existing 63 tests still pass after the shared-dispatcher/settings edits.

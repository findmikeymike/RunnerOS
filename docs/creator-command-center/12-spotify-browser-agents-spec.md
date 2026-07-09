---
status: implemented
owner: agent
last_verified: 2026-07-09
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

- **CLI = planner/gatekeeper, RunnerOS browser tools = actuator.** Under the default `runner-cdp` engine, an action's dry-run emits `{ action, browserPlan, approvalDigest }`. `browserPlan` carries the partition, account-verification contract, and ordered steps. Spotify execute requires the exact action id and digest, revalidates the current profile/session contract, then returns a **delegated** instruction for Runner's native browser tools. Delegation is not completion; completion is recorded only after fresh identity evidence and the observed playlist URL pass `playlist spotify receipt`.
- **Account verification is mandatory before any live submit** (`action-safety.mjs:assertLiveReady` + `buildBrowserPlan.accountVerification`). Prevents posting to the wrong logged-in account — critical for multi-account.
- **Settings connector** (`SocialAccountsSettingsPage.tsx` + `settings.ts`) stores accounts, opens/reuses a per-profile browser partition (`socialBrowserPartition`), and drives login/verification. This is the "socials connectors in app settings" surface.

## Spotify verbs (`spotify-cli`)

- `profile add|list|status|update|delete|login` — reuse profile-json/verification verbatim (handle = artist name / profile URL for identity match).
- `snapshot` (read) — analyst: emit a browserPlan that navigates the S4A session and captures private stats; normalize a workspace capture file into an immutable snapshot doc. The v1 agent uses no Spotify API credentials.
- `playlist create` (write) — plan → dry-run browserPlan for `open.spotify.com` (create playlist, set name/description/visibility, add track URIs in order) → approval → execute (delegated) → verify → receipt.
- `playlist feature` is deferred. V1 stops after creating the playlist and returning its observed Spotify URL.

## Integration touch-list (what must change)

New:
- `tools/printing-press-social/spotify-cli/` — `src/cli.mjs`, `skills/SKILL.md`, `HARNESS.md`, `README.md`, `test/spotify-cli.test.mjs`.

Edit (shared — covered by the post-agent's 63 tests, so re-run them):
- `registry.json` — add `spotify` platform + verbs (`profile`, `snapshot`, `playlist`).
- `src/social.mjs` — extend routing and the guarded `execute` action contract for `spotify` + `playlist-create`; exact dry-run action id, content digest, profile identity, browser partition, and payload remain bound through approval.
- `apps/electron/src/main/handlers/settings.ts` — add `spotify` to `SOCIAL_PLATFORMS`, open Spotify for Artists for login, and use conservative authenticated-surface/account-url detection across spotify.com.
- `apps/electron/src/renderer/pages/settings/SocialAccountsSettingsPage.tsx` — add `spotify` to `PLATFORMS` + `SocialPlatform` type + hint copy.

Agents + skills:
- Rewrite `spotify-analyst` and `spotify-playlist-creator` prompts (`packages/shared/src/agent-definitions/starter-templates.ts`) to browser-session workflows using `spotify-cli`; drop the dev-only `$CRAFT_APP_ROOT/...api-snapshot.ts` invocation.
- Replace/rewrite skills: `spotify-analytics-snapshot` (browser S4A capture, not the API script) and `playlist-builder` (evidence-tagged playlist strategy). Fixes the two `spotify-fix.md` backlog blockers by removing the dev-only API snapshot path.
- Regenerate `packages/shared/src/skills/bundled.generated.ts` and the system map.

Bundling: `electron-builder.yml` already ships `tools/printing-press-social/**`, so `spotify-cli` ships automatically. No new binary.

## Phasing

- **Layer A** — `spotify-cli` profile mgmt + registry + dispatcher/settings platform wiring + `doctor`/`catalog` show Spotify. (Connector works; login + verify a Spotify account.)
- **Layer B** — `snapshot` (S4A browser capture → normalized snapshot + Artist HQ context). Retires the broken API script.
- **Layer C** — `playlist create` (open.spotify) through dry-run → exact action approval → guarded delegated execute → observed URL receipt. Artist-profile featuring remains deferred.

## Decisions

1. Spotify is a platform in Printing Press Social so it shares account sets, verification, permissions, and browser partitions.
2. V1 ships playlist creation only; feature-on-artist-page is deferred.
3. V1 is pure browser capture; the retired public API script is not part of the workflow.

## Acceptance

- A Spotify account connects/logs-in/verifies through the same Social Accounts settings surface and appears in `social catalog` account-sets.
- Analyst produces a snapshot from the S4A session with no dev-only path and no cross-package import; runs in a packaged build.
- Playlist Creator binds approval to the exact dry-run action id + content digest, delegates only after guarded execute, and records completion only through a durable observed-URL receipt with fresh account verification.
- Source permissions allow read/status/dry-run commands but refuse direct playlist confirmation.
- Snapshot output stays inside the workspace, validates captured shapes, and refuses overwrite.
- Printing Press Social packaging, source/catalog, Spotify CLI, root execute, HQ parser/sync, delta, and Electron checks pass before integration.

## Live Validation Boundary

- Automated contract, packaging, typecheck, and simulated browser-evidence tests are implemented.
- A real logged-in Spotify for Artists + web-player smoke is still required before calling the browser selectors production-validated. No Spotify profile/session is available in this worktree's local test state.

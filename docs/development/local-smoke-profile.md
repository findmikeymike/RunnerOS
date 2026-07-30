---
status: current
owner: agent
last_verified: 2026-07-05
source_of_truth: true
---

# Local Smoke Profile

Purpose: let the app owner run real-key, real-tool smoke tests without shipping private artist data or credentials.

## Files

- App UI credential storage: real keys. Stored outside the repo in encrypted RunnerOS credential storage.
- `smoke/local/artist-context.md`: real artist/team context. Ignored by git.
- `smoke/local/campaign-context.md`: real campaign context. Ignored by git.
- `smoke/local/service-profile.md`: non-secret checklist of connected services/accounts. Ignored by git.
- `smoke/templates/`: safe starter templates. Tracked.

## Setup

```bash
mkdir -p smoke/local
cp smoke/templates/artist-context.md smoke/local/artist-context.md
cp smoke/templates/campaign-context.md smoke/local/campaign-context.md
cp smoke/templates/service-profile.md smoke/local/service-profile.md
bun run smoke:profile:check
```

Fill local context/checklist files only. Add keys through Settings/provider/source connection flows in the app. Do not paste keys into chat, docs, session notes, smoke files, or app fixtures.

App-entered credentials persist across relaunch because the credential manager writes to `~/.craft-agent/credentials.enc`, not the workspace or repo. A clean sellable build stays clean because these credentials are machine-local and are not bundled.

## Smoke Order

1. Run `bun run smoke:profile:check`.
2. Launch dev app with `bun run electron:dev`.
3. Add/check keys and OAuth accounts in the app UI.
4. Confirm Settings/providers show expected connected status.
5. Run one plain HNIC chat smoke.
6. Run one Content Genius/campaign smoke using `smoke/local/campaign-context.md`.
7. Run one tool-specific smoke per app-configured provider.
8. Save only pass/fail notes in docs; never save key values or private artist details.

## Artist HQ Home Integration Smoke

1. Open HQ Home and confirm the header `Next` value matches the nearest Calendar/Scheduled Work item, falling back to State of Play when the week is empty.
2. Confirm `This Week`, `Workers`, and `Projects` show only persisted events, work, enabled automations, and campaign-scoped workspaces; empty columns must say they are empty rather than showing sample tasks.
3. Add or edit an HQ goal in Workspace Context, refresh State of Play, and confirm the goal appears in the Home card with a working `Manage` route.
4. Activate Spotify Pulse and Intel Pulse once. Confirm each creates one weekly Monday automation in local time, uses safe permission mode, and appears in Workers without duplicate definitions/runs.
5. Restart RunnerOS and confirm the same automations, campaign cards, goals, and live work remain visible. Public posts, sends, spending, deletes, and external account mutations must still stop for exact approval.

## Agent Rule

Future agents may read `smoke/local/*.md` only when explicitly doing local smoke setup or real-provider smoke testing. They must never commit those files or quote private content into tracked docs.

Future agents must not ask the user to put real keys in `.env.local` unless debugging the environment fallback specifically. The normal smoke lane is app UI credentials.

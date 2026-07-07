# Handoff: Creator Command Center

## Current Worktree

- Path: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/creator-command-center`
- Branch: `codex/creator-command-center`
- Product direction: RunnerOS / Artist OS local creator command center.
- Current push: paid-ads specialist workers, Meta/Google/Spotify ads operator safety, ad-library creative intelligence, and live smoke readiness.
- Last verified: 2026-07-07.

## Read First

1. `docs/CURRENT.md` - live branch/status notes.
2. `docs/README.md` - docs routing map.
3. `docs/backlog/paid-ads-execution-prep.md` - paid ads implementation prep and current ads-tooling map.
4. `docs/backlog/paid-ads-browser-cli-operator.md` - longer paid-ads backlog/spec history.
5. `docs/system-map/` - generated map of workers, skills, sources, and launch surfaces.
6. `tools/ads-operator/README.md` - local ads operator commands and safety boundary.

## Recent Work To Preserve

- Added public ad-library intelligence for music ads:
  - Skill: `ad-library-intel`.
  - CLI support: `tools/ads-operator/bin/ads-operator.mjs ad-library-plan`.
  - CLI support: `tools/ads-operator/bin/ads-operator.mjs ad-library-analyze`.
  - Public Meta Ad Library and TikTok Creative Center research should look for high-performing formats/hooks, not only close sound-alike artists.
- Split paid-ads work into three specialists:
  - `ads-strategist`: budget, audience, territory, platform, and testing strategy.
  - `ad-creative-agent`: ad-library scouting, angles, hooks, copy, format tests, and asset needs.
  - `ads-agent`: Meta/Google/Spotify account inspection, exports, draft setup plans, approval packets, and execution handoff.
- Ad Creative Agent now has:
  - Skills: `artist-ad-dna`, `ad-library-intel`, `ads-creative-development`, `ad-creative`, `artist-campaign-angle-builder`.
  - Card subtext: "Researches and finds high-performing artist ads, then helps craft creative, hooks, copy, and variants for paid campaigns."
  - No account-operation tools by design; it researches public ads and produces creative packets.
- Ads Agent now uses:
  - Skills: `meta-ads`, `google-ads`, `paid-ads-browser-operator`.
  - Sources: `meta-ads`, `google-ads`, `ads-operator`.
  - Browser/export/setup fallback for Meta when API/MCP access is missing or blocked.
  - Spotify Ads V1 browser mode for Spotify Ads Manager / Spotify Ad Studio. Spotify for Artists is audience/song/city intel only, not campaign creation.
  - Approval packets before any spend or live account mutation.
- `tools/ads-operator` supports read-only normalization, audit, campaign-plan, setup-plan, ad-library plan/analyze, packet creation, and receipts. It does not publish, pause, enable, delete, change budgets/bids/targets/creative/keywords/conversions/billing, upload assets, or apply recommendations.
- Chat view autoscroll was adjusted so a newly streaming assistant reply can stay pinned near the top instead of forcing the user to the bottom.
- ChatGPT search retry was hardened to avoid unsupported `web_search_preview` failures.
- Startup agent metadata migration now includes `ads-strategist` and `ad-creative-agent`, so existing installs receive the new ads specialist skills.
- Global installed Ad Creative Agent at `/Users/michaelb.williams/.agents/agents/ad-creative-agent/AGENT.md` was updated and the Codex catalog was regenerated.

## Current Runtime State

- Electron dev app was relaunched from this worktree on 2026-07-07.
- Startup log confirmed: `[agent-definitions] Updated ads specialist research metadata`.
- Active workspace observed: `/Users/michaelb.williams/.craft-agent/workspaces/trading`.
- Ad Creative Agent setup should show `ad-library-intel` in Skills and no bundled Tools.
- "No bundled tools" on Ad Creative Agent is intentional; account tools belong to Ads Agent.

## Verified Commands

```bash
/Users/michaelb.williams/.bun/bin/bun test packages/shared/src/agent-definitions/storage.test.ts
/Users/michaelb.williams/.bun/bin/bun test packages/shared/src/agent-definitions/storage.test.ts packages/shared/src/skills/__tests__/starter-templates.test.ts packages/pi-agent-server/src/tools/search/providers/chatgpt.test.ts packages/pi-agent-server/src/tools/search/create-search-tool.test.ts
/Users/michaelb.williams/.bun/bin/bun run typecheck:shared
(cd packages/pi-agent-server && /Users/michaelb.williams/.bun/bin/bun run typecheck)
(cd apps/electron && /Users/michaelb.williams/.bun/bin/bun run typecheck)
git diff --check
python3 /Users/michaelb.williams/.codex/scripts/rebuild_codex_catalog.py
```

## Smoke Status

- App launches and the ads specialist migration runs.
- Ad Creative Agent wiring is ready for a smoke prompt using `Watching Tornado Videos on YouTube`.
- Prior Ads Strategist live smoke proved direct Meta Ad Library URLs were attempted, but browser research can run long and Meta pages may return sparse/blocked content.
- Use Ad Creative Agent for hook/format scouting first; then Ads Strategist consumes that creative packet for budget/audience/territory strategy; then Ads Agent drafts/operates account-side work.

## Next Best Actions

1. Smoke Ad Creative Agent with a campaign prompt for `Watching Tornado Videos on YouTube`.
2. Confirm it uses `ad-library-intel` first and returns a compact creative packet instead of looping in browser research.
3. If it over-researches, tighten `ad-library-intel` with a time/sample cap and force a partial packet after first usable examples.
4. Then smoke Ads Strategist consuming that packet for `$400` Meta budget/audience/territory planning.
5. Then smoke Ads Agent with an approved strategy/creative handoff and verify it stops at draft/setup-plan/approval packet.

## Watchouts

- Do not give Ad Creative Agent Ads Manager or account mutation tools.
- Do not ask users for passwords, cookies, 2FA codes, or recovery codes.
- Public ad libraries do not expose CTR, CPA, ROAS, exact reach, or spend; use visible creative patterns and longevity only as weak evidence.
- Meta/Google/Spotify account actions are external business actions. Stop before mutation and require explicit approval naming account, action, and spend impact.
- If Meta Ad Library blocks automation, ask for screenshots/captured examples or continue manually in browser.

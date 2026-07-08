# Handoff: Creator Command Center

## Current Worktree

- Path: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/creator-command-center`
- Branch: `codex/creator-command-center`
- Product direction: RunnerOS / Artist OS local creator command center.
- Current push: paid-ads specialist workers, Meta/Google/Spotify ads operator safety, ad-library creative intelligence, single lyric-video production, Vault song transcription, packaged local media runtimes, and live smoke readiness.
- Last verified: 2026-07-08.

## Read First

1. `docs/CURRENT.md` - live branch/status notes.
2. `docs/README.md` - docs routing map.
3. `docs/backlog/paid-ads-execution-prep.md` - paid ads implementation prep and current ads-tooling map.
4. `docs/backlog/paid-ads-browser-cli-operator.md` - longer paid-ads backlog/spec history.
5. `docs/system-map/` - generated map of workers, skills, sources, and launch surfaces.
6. `tools/ads-operator/README.md` - local ads operator commands and safety boundary.
7. `tools/genesis-lyric/README.md` - local single lyric-video commands and Genesis fork boundary.
8. `tools/lyrics-transcriber/README.md` - local Whisper/FFmpeg transcription wrapper and packaging requirements.
9. `docs/backlog/tool-licensing-packaging-audit.md` - release gate for bundled/downloaded local runtimes.
10. `docs/backlog/windows-version.md` - Windows runtime parity backlog.

## Recent Work To Preserve

- Added public ad-library intelligence for music ads:
  - Skill: `ad-library-intel`.
  - CLI support: `tools/ads-operator/bin/ads-operator.mjs ad-library-plan`.
  - CLI support: `tools/ads-operator/bin/ads-operator.mjs ad-library-analyze`.
  - Public Meta Ad Library and TikTok Creative Center research should look for high-performing formats/hooks, not only close sound-alike artists.
- Split paid-ads work into three specialists:
  - Ad Creative (`ad-creative-agent`): ad-library scouting, angles, hooks, copy, format tests, and asset needs.
  - Ad Strategy (`ads-strategist`): budget, audience, territory, platform, and testing strategy.
  - Ad Runner (`ads-agent`): Meta/Google/Spotify account inspection, exports, draft setup plans, approval packets, and execution handoff.
- Ad Creative now has:
  - Skills: `artist-ad-dna`, `ad-library-intel`, `ads-creative-development`, `ad-creative`, `artist-campaign-angle-builder`.
  - Card subtext: "Researches and finds high-performing artist ads, then helps craft creative, hooks, copy, and variants for paid campaigns."
  - No account-operation tools by design; it researches public ads and produces creative packets.
- Ad Runner now uses:
  - Skills: `meta-ads`, `google-ads`, `paid-ads-browser-operator`.
  - Sources: `meta-ads`, `google-ads`, `ads-operator`.
  - Browser/export/setup fallback for Meta when API/MCP access is missing or blocked.
  - Spotify Ads V1 browser mode for Spotify Ads Manager / Spotify Ad Studio. Spotify for Artists is audience/song/city intel only, not campaign creation.
  - Approval packets before any spend or live account mutation.
- `tools/ads-operator` supports read-only normalization, audit, campaign-plan, setup-plan, ad-library plan/analyze, packet creation, and receipts. It does not publish, pause, enable, delete, change budgets/bids/targets/creative/keywords/conversions/billing, upload assets, or apply recommendations.
- Added lightweight Genesis lyric-video production:
  - Tool/source: `tools/genesis-lyric` / `genesis-lyric`.
  - Skill: `lyric-video-genesis`.
  - Starter worker: Lyric Video (`lyric-video-agent`).
  - Scope: one song/one clip from audio, lyrics, and an existing or generated visual asset.
  - Boundary: original Genesis at `/Users/michaelb.williams/Cascade Windsurf 3/Genesis` was not modified; the 20-day/batch campaign system, portal/API workers, uploads, and outputs were not ported.
- Added Vault lyrics transcription:
  - Tool/source: `tools/lyrics-transcriber` / `lyrics-transcriber`.
  - Engine: `whisper.cpp` CLI plus FFmpeg conversion.
  - Vault audio assets can be transcribed into review-needed timed lyrics, then approved as canonical lyrics for agents.
  - Lyric Video defaults to approved Vault lyrics and master audio when available.
- Added Mac arm64 packaged transcription runtime:
  - Bundled `tools/lyrics-transcriber/bin/darwin/arm64/whisper-cli`.
  - Bundled LGPL-safe `tools/lyrics-transcriber/bin/darwin/arm64/ffmpeg`.
  - Added sibling provenance files and third-party notices.
  - Electron dist scripts now gate on app-owned binaries instead of silently relying on PATH/Homebrew.
- Windows/Linux packaged transcription is intentionally blocked until platform binaries and provenance exist.
- Chat view autoscroll was adjusted so a newly streaming assistant reply can stay pinned near the top instead of forcing the user to the bottom.
- ChatGPT search retry was hardened to avoid unsupported `web_search_preview` failures.
- Startup agent metadata migration now includes `ads-strategist` and `ad-creative-agent`, so existing installs receive the new ads specialist skills.
- Global installed Ad Creative at `/Users/michaelb.williams/.agents/agents/ad-creative-agent/AGENT.md` was updated and the Codex catalog was regenerated.

## Current Runtime State

- Electron dev app was relaunched from this worktree on 2026-07-07.
- Startup log confirmed: `[agent-definitions] Updated ads specialist research metadata`.
- Active workspace observed: `/Users/michaelb.williams/.craft-agent/workspaces/trading`.
- Ad Creative setup should show `ad-library-intel` in Skills and no bundled Tools.
- "No bundled tools" on Ad Creative is intentional; account tools belong to Ad Runner.
- Lyric Video setup should show `lyric-video-genesis` in Skills and `genesis-lyric` in Sources/Tools.
- Vault audio should expose transcription/review flow for master/demo audio.
- Packaged-mode transcription on Mac arm64 should use bundled binaries under `tools/lyrics-transcriber/bin/darwin/arm64`, not system PATH.

## Verified Commands

```bash
/Users/michaelb.williams/.bun/bin/bun test packages/shared/src/agent-definitions/storage.test.ts
/Users/michaelb.williams/.bun/bin/bun test packages/shared/src/agent-definitions/storage.test.ts packages/shared/src/skills/__tests__/starter-templates.test.ts packages/pi-agent-server/src/tools/search/providers/chatgpt.test.ts packages/pi-agent-server/src/tools/search/create-search-tool.test.ts
/Users/michaelb.williams/.bun/bin/bun run typecheck:shared
(cd packages/pi-agent-server && /Users/michaelb.williams/.bun/bin/bun run typecheck)
(cd apps/electron && /Users/michaelb.williams/.bun/bin/bun run typecheck)
node tools/genesis-lyric/bin/genesis-lyric.mjs doctor --json
node --test tools/genesis-lyric/bin/genesis-lyric.test.mjs
node --test tools/lyrics-transcriber/bin/lyrics-transcriber.test.mjs
RUNNEROS_REQUIRE_PACKAGED_LYRICS_RUNTIME=1 node tools/lyrics-transcriber/bin/lyrics-transcriber.mjs doctor --json
RUNNEROS_REQUIRE_PACKAGED_LYRICS_RUNTIME=1 node tools/lyrics-transcriber/bin/lyrics-transcriber.mjs transcribe --audio-file /opt/homebrew/Cellar/whisper-cpp/1.9.1/share/whisper-cpp/jfk.wav --out-dir /tmp/runneros-packaged-runtime-smoke --model base.en --json
bun run scripts/prepare-lyrics-runtime.ts gate --platform darwin --arch arm64
bun test packages/shared/src/mission-assets/storage.test.ts apps/electron/src/renderer/lib/campaign-worker-context.test.ts apps/electron/src/renderer/lib/release-board.test.ts apps/electron/src/shared/__tests__/ipc-channels.test.ts packages/shared/src/protocol/__tests__/routing.test.ts apps/electron/src/main/handlers/__tests__/registration.test.ts apps/electron/src/main/handlers/__tests__/registration-profiles.test.ts
git diff --check
python3 /Users/michaelb.williams/.codex/scripts/rebuild_codex_catalog.py
```

## Smoke Status

- App launches and the ads specialist migration runs.
- Ad Creative wiring is ready for a smoke prompt using `Watching Tornado Videos on YouTube`.
- Lyric Video CLI smoke can render a synthetic image + audio + lyrics into `final.mp4` with `render-report.json`.
- Lyrics Transcriber packaged Mac arm64 smoke passes for WAV, MP3, and M4A inputs through bundled Whisper/FFmpeg.
- Windows lyrics runtime gate fails by design until `win32/x64` `whisper-cli.exe`, `ffmpeg.exe`, and provenance files are added and tested on Windows.
- Prior Ad Strategy live smoke proved direct Meta Ad Library URLs were attempted, but browser research can run long and Meta pages may return sparse/blocked content.
- Use Ad Creative for hook/format scouting first; then Ad Strategy consumes that creative packet for budget/audience/territory strategy; then Ad Runner drafts/operates account-side work.

## Next Best Actions

1. Smoke Ad Creative with a campaign prompt for `Watching Tornado Videos on YouTube`.
2. Confirm it uses `ad-library-intel` first and returns a compact creative packet instead of looping in browser research.
3. If it over-researches, tighten `ad-library-intel` with a time/sample cap and force a partial packet after first usable examples.
4. Then smoke Ad Strategy consuming that packet for `$400` Meta budget/audience/territory planning.
5. Then smoke Ad Runner with an approved strategy/creative handoff and verify it stops at draft/setup-plan/approval packet.
6. Smoke Lyric Video with real song audio/lyrics plus either user footage, artwork, or a generated still/video asset.
7. Smoke Vault audio transcription from the app UI, approve corrected lyrics, then verify Lyric Video sees the approved lyrics without the user repeating them.
8. Build/smoke a packaged Mac app with no Homebrew/PATH assumptions.
9. Add Windows x64 lyrics runtime binaries/provenance and verify on real Windows or Windows CI.

## Watchouts

- Do not give Ad Creative Ads Manager or account mutation tools.
- Do not ask users for passwords, cookies, 2FA codes, or recovery codes.
- Public ad libraries do not expose CTR, CPA, ROAS, exact reach, or spend; use visible creative patterns and longevity only as weak evidence.
- Meta/Google/Spotify account actions are external business actions. Stop before mutation and require explicit approval naming account, action, and spend impact.
- If Meta Ad Library blocks automation, ask for screenshots/captured examples or continue manually in browser.
- `genesis-lyric` does not generate images/video by itself; create visuals through the appropriate media-generation/video tool first, then pass the asset path into the lyric render brief.
- `lyrics-transcriber` machine output must remain review-needed until the user approves corrected lyrics.
- Do not claim Windows packaged transcription is ready; the gate currently blocks it intentionally.

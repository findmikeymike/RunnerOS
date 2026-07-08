---
status: active
owner: agent
last_verified: 2026-07-08
source_of_truth: true
---

# Current Status

## Snapshot

- Date: 2026-07-08
- Branch: `codex/creator-command-center`
- Current goal: make paid-ads workers, single-song video helpers, and Vault lyrics transcription useful for artist campaigns without blocking on platform API approval or user-installed media tools.
- Overall state: Ads specialist agents, ad-library intelligence, local ads operator, Genesis lyric-video tooling, Vault transcription wiring, and Mac arm64 packaged transcription runtime are wired and ready for focused smoke testing.

## Recently Completed

- Added `ad-library-intel` for public Meta Ad Library / TikTok Creative Center research and music-ad pattern extraction.
- Added `tools/ads-operator` commands for ad-library planning/analyze, CSV import, audits, campaign plans, setup plans, approval packets, and receipts.
- Split paid-ads responsibilities:
  - Ad Creative (`ad-creative-agent`): public ad research, hooks, copy, creative angles, video formats, asset needs.
  - Ad Strategy (`ads-strategist`): budget, audience, territory, platform, and test plan.
  - Ad Runner (`ads-agent`): account inspection/export/draft setup/approval packets for Meta, Google, and Spotify.
- Updated Ad Creative with `ad-library-intel` and new card subtext:
  - "Researches and finds high-performing artist ads, then helps craft creative, hooks, copy, and variants for paid campaigns."
- Fixed startup migration so stale installed `ads-strategist` and `ad-creative-agent` metadata receives new skills.
- Updated Ad Runner to use `meta-ads`, `google-ads`, and `paid-ads-browser-operator` skills plus `meta-ads`, `google-ads`, and `ads-operator` sources.
- Added Spotify Ads browser mode: Ad Runner can guide logged-in Spotify Ads Manager / Spotify Ad Studio setup, while Spotify for Artists is used only for audience/song/city intel.
- Made Meta account work practical without API approval: use `ads-operator --platform meta`, browser dashboard/export/setup guidance, and explicit approval packets.
- Added Lyric Video (`lyric-video-agent`) for single lyric clips from song audio, lyrics, and an existing or generated visual asset.
- Added `lyric-video-genesis` skill and `genesis-lyric` built-in source/tool at `tools/genesis-lyric`.
- Ported the needed Genesis source/docs for one-off FFmpeg lyric renders plus the real Genesis Creative Director prompt/vocabulary/knowledge assets and Motion Director compiler for no-spend storyboard planning. Original Genesis is untouched and its batch/campaign/portal/provider runtime is not part of RunnerOS.
- Added Vault lyrics transcription:
  - `tools/lyrics-transcriber` wraps `whisper.cpp` and FFmpeg.
  - Campaign Vault can transcribe master/demo audio into review-needed timed lyrics.
  - Approved lyric edits become canonical callable lyrics for agents.
  - Lyric Video prefers approved Vault lyrics and master audio unless the user supplies another file.
- Added packaged Mac arm64 transcription runtime:
  - Bundled `whisper-cli` and LGPL-safe `ffmpeg` under `tools/lyrics-transcriber/bin/darwin/arm64`.
  - Added provenance files and `THIRD_PARTY_NOTICES.md`.
  - Electron dist scripts now fail if packaged runtime binaries/provenance are missing.
- Added Windows backlog coverage for missing `win32/x64` lyrics runtime binaries and required smoke gates.
- Hardened ChatGPT search retry after unsupported `web_search_preview` failures.
- Adjusted chat autoscroll so long agent replies do not force the user to the bottom while trying to read from the top.
- Regenerated Codex catalog after installed agent changes.

## In Progress

- Live smoke testing the paid-ads chain, Vault transcription, and video workers on campaign example: `Watching Tornado Videos on YouTube`.
- Current next smoke targets: Ad Creative should return a compact creative packet; Vault transcription should produce review-needed lyrics from real audio; Lyric Video should render one real song clip from approved lyrics/audio and a visual.

## Next Actions

1. Smoke Ad Creative with the campaign prompt for `Watching Tornado Videos on YouTube`.
2. Verify it researches broad winning music-ad vehicles/hooks, not only huge similar artists.
3. If browser research loops too long, add a hard cap to `ad-library-intel` and force a best-effort packet.
4. Smoke Ad Strategy with a `$400` Meta campaign ask and Ad Creative packet input.
5. Smoke Ad Runner last with approved strategy/creative inputs; it must stop at setup-plan/draft/approval packet before live mutation.
6. Smoke Lyric Video with real song audio/lyrics and user footage, artwork, or a generated still/video path.
7. Smoke Vault audio transcription from the app UI, approve corrected lyrics, then verify Lyric Video sees the approved lyrics.
8. Build/smoke packaged Mac app with no Homebrew/PATH assumptions.
9. Add Windows x64 lyrics runtime binaries/provenance and verify on Windows or Windows CI.
10. Regenerate `docs/system-map/` after any starter-agent, source, skill, or launch-surface change.

## Verification State

- Passed:

```bash
/Users/michaelb.williams/.bun/bin/bun test packages/shared/src/agent-definitions/storage.test.ts
/Users/michaelb.williams/.bun/bin/bun test packages/shared/src/agent-definitions/storage.test.ts packages/shared/src/skills/__tests__/starter-templates.test.ts packages/pi-agent-server/src/tools/search/providers/chatgpt.test.ts packages/pi-agent-server/src/tools/search/create-search-tool.test.ts
/Users/michaelb.williams/.bun/bin/bun run typecheck:shared
(cd packages/pi-agent-server && /Users/michaelb.williams/.bun/bin/bun run typecheck)
(cd apps/electron && /Users/michaelb.williams/.bun/bin/bun run typecheck)
node tools/genesis-lyric/bin/genesis-lyric.mjs doctor --json
node tools/genesis-lyric/bin/genesis-lyric.mjs storyboard --brief-file <brief.json> --json
node --test tools/genesis-lyric/bin/genesis-lyric.test.mjs
node --test tools/lyrics-transcriber/bin/lyrics-transcriber.test.mjs
RUNNEROS_REQUIRE_PACKAGED_LYRICS_RUNTIME=1 node tools/lyrics-transcriber/bin/lyrics-transcriber.mjs doctor --json
RUNNEROS_REQUIRE_PACKAGED_LYRICS_RUNTIME=1 node tools/lyrics-transcriber/bin/lyrics-transcriber.mjs transcribe --audio-file /opt/homebrew/Cellar/whisper-cpp/1.9.1/share/whisper-cpp/jfk.wav --out-dir /tmp/runneros-packaged-runtime-smoke --model base.en --json
bun run scripts/prepare-lyrics-runtime.ts gate --platform darwin --arch arm64
bun test packages/shared/src/mission-assets/storage.test.ts apps/electron/src/renderer/lib/campaign-worker-context.test.ts apps/electron/src/renderer/lib/release-board.test.ts apps/electron/src/shared/__tests__/ipc-channels.test.ts packages/shared/src/protocol/__tests__/routing.test.ts apps/electron/src/main/handlers/__tests__/registration.test.ts apps/electron/src/main/handlers/__tests__/registration-profiles.test.ts
git diff --check
python3 /Users/michaelb.williams/.codex/scripts/rebuild_codex_catalog.py
```

- Electron dev app relaunched from this worktree.
- Startup log confirmed ads specialist migration ran.
- Ad Creative setup now shows `ad-library-intel` in Skills and no bundled account Tools.
- Genesis Lyric CLI doctor, unit tests, and synthetic FFmpeg render smoke passed.
- Lyrics Transcriber unit tests, packaged doctor, packaged WAV transcription, and MP3/M4A conversion smoke passed on Mac arm64.
- `bun run scripts/prepare-lyrics-runtime.ts gate --platform win32 --arch x64` fails by design until Windows binaries/provenance are added.

## Known Limits

- Public Meta Ad Library does not expose CTR, CPA, ROAS, exact reach, or spend.
- TikTok Creative Center / public pages may vary by region, availability, and automation blocking.
- Meta/Google/Spotify account operations require connected accounts or browser-guided user sessions.
- No agent should publish, spend, pause, enable, delete, change budget/bids/targeting/creative/keywords/conversions/billing, upload assets, or apply recommendations without explicit approval naming account, action, and spend impact.
- `genesis-lyric` now has a no-spend `storyboard` command for Genesis-style cinematic shot/image/motion planning before media generation. It uses vendored Creative Director doctrine/assets plus Motion Director modules, caps long lyric anchors/prompts, and still assembles lyric clips only from supplied media; use media-generation/raw video tools to create the visual asset, then pass it back as `image_file` or `video_file`.
- `lyrics-transcriber` machine transcripts are not final lyrics; keep them review-needed until the user approves corrected lyrics.
- Mac arm64 bundled transcription is real. Windows/Linux packaged transcription is not ready yet and should stay blocked until platform binaries/provenance pass smoke tests.

## Notes For Next Agent

- Start from `HANDOFF.md`, this file, `docs/backlog/paid-ads-execution-prep.md`, and `tools/ads-operator/README.md`.
- Do not re-add account tools to Ad Creative. It is a creative/research worker.
- Ad Runner is the account operator and approval-packet owner.
- For lyric videos, start from `tools/genesis-lyric/README.md`; do not touch the original Genesis checkout unless explicitly asked.
- For transcription, start from `tools/lyrics-transcriber/README.md` and `docs/backlog/tool-licensing-packaging-audit.md`.

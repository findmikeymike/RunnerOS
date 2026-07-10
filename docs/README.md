---
status: current
owner: agent
last_verified: 2026-07-10
source_of_truth: true
---

# Docs Map

Start here when you need project context without reading the whole repo.

## Read First

1. [CURRENT.md](./CURRENT.md) - live branch/status notes.
2. [../HANDOFF.md](../HANDOFF.md) - zero-context takeover brief for the current build.
3. [creator-command-center/13-scheduled-work-composer-execution-spec.md](./creator-command-center/13-scheduled-work-composer-execution-spec.md) - current Scheduled Work product/runtime contract.
4. [system-map](./system-map/) - generated map of workers, skills, sources, Scheduled Work, launch surfaces, and approval boundaries.
5. [creator-command-center](./creator-command-center/) - Artist HQ / campaign workspace specs.
6. [user](./user/) - concise user-facing guides for surfaces, advanced abilities, and service keys.
7. [backlog/tool-licensing-packaging-audit.md](./backlog/tool-licensing-packaging-audit.md) - release gate for bundled/downloaded local runtimes.
8. [backlog/windows-version.md](./backlog/windows-version.md) - Windows parity/runtime backlog.

Current active work:

- HQ and Campaign calendars share a progressive Event/Job composer while keeping global and campaign ownership separate.
- Campaign Scheduled Work is implemented for Event, Agent Task, Workflow Run, Social Publish, and Review / Approval, with backend-owned writes and durable completion tracking.
- Automations can queue the same typed work from schedule/file/webhook/URL/message triggers; standalone background agent/workflow runs may hide their Calendar shell.
- HNIC alone has the `schedule_work` tool for confirmed Calendar or Automation agent/workflow work.
- Scheduled social publishing has a guarded native executor after exact approval, with account/payload/media verification and durable receipts.
- Social Publisher supports bounded authorized inbound comment/DM replies using Artist Voice; direct or scheduled engagement mandates do not cover cold DMs, posts, account changes, or sensitive conversations.
- Campaign release dates appear on Calendar as green `Release day` highlights.
- College Radio and Spotify Playlist Creator are default-visible in both Artist HQ and Campaign workers.
- College Radio produces verified Outreach packets; Outreach Agent owns approval-gated Gmail delivery.
- Paid-ads worker chain is active: Ad Creative (`ad-creative-agent`) -> Ad Strategy (`ads-strategist`) -> Ad Runner (`ads-agent`).
- Ad Creative owns public ad-library scouting, hooks, copy, creative angles, and format tests.
- Ad Strategy owns budget, audience, territory, platform, and test planning.
- Ad Runner owns Meta/Google/Spotify account inspection, browser/export setup, draft setup plans, approval packets, and account-side handoff.
- `tools/ads-operator` is the local read-only paid-ads helper for imports, audits, ad-library plans/analyze, campaign/setup plans, packets, and receipts.
- `tools/genesis-lyric` is the local single-song lyric-video renderer/storyboard helper.
- `tools/lyrics-transcriber` is the local Whisper/FFmpeg wrapper for Vault song transcription and timed lyric review.
- Mac arm64 transcription has bundled app-owned binaries; Windows/Linux runtime parity is tracked in backlog and intentionally blocked until verified.
- Active Creator Command specs: [HQ State Of Play / Proactive Routing](./creator-command-center/09-hq-state-of-play-proactive-routing.md), [Work Products / Output Architecture](./creator-command-center/10-work-products-output-architecture-spec.md), [Outputs, Finals, And Asset Promotion](./creator-command-center/11-outputs-finals-asset-promotion-spec.md), [Campaign Calendar And Scheduled Jobs](./creator-command-center/12-campaign-calendar-scheduled-jobs-spec.md), and [Scheduled Work Composer And Execution](./creator-command-center/13-scheduled-work-composer-execution-spec.md).

## Main Areas

- [specs](./specs/) - standalone specs that do not belong to a larger feature folder.
- [backlog](./backlog/) - accepted future work, deferred integrations, and cleanup ideas.
- [audits](./audits/) - security, runtime, and technical debt reports.
- [development](./development/) - local commands, CLI docs, setup-adjacent references.
- [development/local-smoke-profile.md](./development/local-smoke-profile.md) - local-only real-key smoke setup that keeps private data out of the app and repo.
- [development/vetted.md](./development/vetted.md) - release smoke ledger for agents that pass real app testing.
- [system-map](./system-map/) - generated map of workers, skills, sources, launch surfaces, and approval boundaries.
- [user](./user/) - general-user docs for learning the product without reading implementation specs.
- [pitch](./pitch/) - draft positioning, landing-page, ad, and launch-message material for Artist OS Desktop.
- [archive](./archive/) - historical docs that should not guide current decisions.

## Feature Docs

Feature folders stay in place to avoid breaking existing links:

- `agent-messaging/`
- `commerce/`
- `creator-command-center/`
- `creator-skills/`
- `deep-research/`
- `global-sources/`
- `llm-connections/`
- `memory/`
- `messaging-gateway/`
- `project-spaces/`
- `pulses/`
- `pitch/`
- `skill-recipes/`
- `tts-agent/`
- `user/`
- `video-studio/`
- `visual-agent-os/`
- `workflows/`
- `zero-secrets/`

## Where New Docs Go

- New active feature spec: `docs/<feature>/`.
- Cross-feature standalone spec: `docs/specs/`.
- Future work or deferred idea: `docs/backlog/`.
- Audit or review report: `docs/audits/<YYYY-MM-DD>/`.
- Local command/setup reference: `docs/development/`.
- Superseded historical doc: `docs/archive/<YYYY-MM-DD>/`.

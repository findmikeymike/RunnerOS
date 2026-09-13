# Artist profile enrichment

**Product promise:** one click gives Artist Manager a sourced understanding of the artist's career, without rewriting the artist's identity or collecting Spotify analytics twice.

This is a specification, not an implemented feature. Baseline: Artist OS main `f25bbf48c`, inspected September 12–13, 2026. Compiled in `.worktrees/active/profile-enrichment-spec`, branch `codex/profile-enrichment-spec`. Scope authority is the conversation decisions recorded in [source decisions](source-decisions.md). Graph and implementation status live only in [plan.json](plan.json).

## Settled scope

- Existing Profile remains artist-owned: brand, themes, goals, story, preferences, boundaries.
- Existing Spotify Pulse remains responsible for analytics and growth. No second scrape, metrics store, account connection, or refresh loop.
- Existing Deep Research owns a focused enrichment pass; browser/search are retrieval tools.
- Existing Spotify profile field is an identity link, not proof of login. Website and optional press links help identify the exact artist. Artists without Spotify can use an official website or another public artist page.
- A separate **Career & public context** section sits beneath the existing Profile form. It holds sourced career highlights, press, collaborations, live history, and public associations. It does not contain inferred branding or speculative opportunities presented as facts.
- Clicking **Enrich my profile** starts research and publication without plan approval or batch acceptance. **Refresh research**, **Correct**, and **Remove** preserve user control.

## Packet

- [Specification](specification.md): product behavior and acceptance IDs.
- [Architecture](architecture.md): verified code map and proposed storage, RPC, run, and context contracts.
- [Roadmap](roadmap.md): three phases, dependency backbone, ownership.
- [Readiness](readiness.md): actual prerequisites and provider limits.
- [State](state.md): resume capsule and review evidence.

Phase P1 has executable packets. P2/P3 are fully scoped outlines; expand their packets against the P1 implementation before execution. No implementation is authorized merely by this planning request. A later instruction to build authorizes ordinary local implementation and tests across this scope without repeated phase permission requests. Review gates are engineering checks, not new user dialogs. Existing app restart/external-action limits still apply.

No user setup is needed to finish this spec. For eventual live acceptance, select one intended artist and its public seed links, and use an already configured research-capable model/source. Missing browser Spotify login does not block this feature. No new provider subscription is required by the design.

**Resume:** read this file, architecture.md, state.md, then run `python3 /Users/michaelb.williams/.codex/skills/build-specs/scripts/check_plan.py docs/creator-command-center/todo/51-artist-profile-enrichment/plan.json --ready` from the verified Artist OS checkout. Re-anchor Git and expand only the next phase. Do not treat a plan linter pass as implemented or live-verified behavior.

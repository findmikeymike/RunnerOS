# Artist profile enrichment

**Product promise:** one click gives Artist Manager a sourced understanding of the artist's career, without rewriting the artist's identity or collecting Spotify analytics twice.

This packet began as the implementation specification at Artist OS main `f25bbf48c` and now documents the V1 implementation built from `ef20d879f`. Scope authority is the conversation decisions recorded in [source decisions](source-decisions.md); current implementation evidence is in [evidence/implementation.md](evidence/implementation.md).

## Settled scope

- Existing Profile remains artist-owned: brand, themes, goals, story, preferences, boundaries.
- Existing Spotify Pulse remains responsible for analytics and growth. No second scrape, metrics store, account connection, or refresh loop.
- Existing Deep Research owns a focused enrichment pass; browser/search are retrieval tools.
- Existing Spotify profile field is an identity link, not proof of login. Website and optional press links help identify the exact artist. Artists without Spotify can use an official website or another public artist page.
- A separate **Career & public context** section sits beneath the existing Profile form. It holds sourced career highlights, press, collaborations, live history, and public associations. It does not contain inferred branding or speculative opportunities presented as facts.
- Clicking **Enrich my profile** starts research and publication without plan approval or batch acceptance. **Refresh research**, **Correct**, and **Remove** preserve user control.
- HQ represents one artist. Changing an established research identity requires the explicit **Clear context** action; there is no automatic artist-switch/archive system. Clear removes career findings from agent context, leaves a fact-free invalidation marker for old chats, and does not alter Profile, Branding, Voice, or growth data. Standalone reports already in Outputs remain available.

## Packet

- [Specification](specification.md): product behavior and acceptance IDs.
- [Architecture](architecture.md): verified code map and implemented storage, RPC, run, and context contracts.
- [Roadmap](roadmap.md): three phases, dependency backbone, ownership.
- [Readiness](readiness.md): actual prerequisites and provider limits.
- [State](state.md): resume capsule and review evidence.

The implementation and review fixes are complete in code; plan files remain as historical execution records. Canonical UI and real-source smoke acceptance still require the user's separate restart approval. Existing app restart/external-action limits still apply.

No user setup is needed to finish this spec. For eventual live acceptance, select one intended artist and its public seed links, and use an already configured research-capable model/source. Missing browser Spotify login does not block this feature. No new provider subscription is required by the design.

**Resume:** read this file, architecture.md, state.md, and evidence/implementation.md from the verified Artist OS checkout. Re-anchor Git before follow-up work. Do not treat passing automated checks as live-verified UI behavior.

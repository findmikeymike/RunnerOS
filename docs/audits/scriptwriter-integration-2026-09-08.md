# Scriptwriter integration — 2026-09-08

Scriptwriter is an HQ/campaign starter with two shared chat-header modes:

- YouTube: `artist-script-dna` then `youtube-camera-script`.
- Reels & TikTok: `artist-script-dna` then `reels-tiktok-script`.

All three supplied skill packages and their references ship in the protected bundled skill library. The persona directs `use_skill` invocation in that order at chat start and after format changes. As with other focus recipes, execution of those instructions remains model-directed; registration alone is not proof of a provider invoking them.

Campaign launch and on-demand context retrieval now read Scriptwriter's authorized Artist Profile, Voice and Branding directly from the unique HQ workspace. HQ identity supersedes campaign copies; the campaign brief stays local. Disabled, private and custom routing remain effective. Only the exact former default Artist Voice audience gains Scriptwriter access. World context in Artist Branding is included; unrelated custom HQ documents are not automatically inherited.

Scriptwriter uses existing agent memory across both modes and workspaces. Its instructions require recall before follow-ups and explicit saving of approved continuity decisions as a compact reference index: canonical script Output, series/episode, reusable callbacks, unresolved setups, retired details and scope. Full scripts remain Outputs. Proposed ideas do not become approved identity, and approval is distinct from publication. Session summaries are not treated as verbatim scripts.

Content Genius's idea mode is now “Ideas & Concepts.” An exact-text startup migration adds the Scriptwriter handoff to existing default personas while preserving custom wording.

Validation covers real focus-RPC context retrieval, HQ source provenance and routing, saved-agent parsing, bundled reference availability, startup migration, and repeated format switching without clearing chat history. Live provider invocation, approved memory writes and recall in a subsequent real chat still require an app smoke after canonical relaunch.

Fresh verification: `bun run test` completed successfully with 9,219 passes, zero failures and 10 skips across the main and isolated runs (`/tmp/scriptwriter-full-suite.log`). Electron and server-core typechecks passed. Canonical Artist OS main and renderer builds passed; neither a restart nor a commit was performed for this integration.

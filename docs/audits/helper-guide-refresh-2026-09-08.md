# Helper / Setup Concierge refresh — 2026-09-08

Base: canonical main `296618103`, including the agent-focus rollout. Implementation on `codex/helper-refresh`.

## Changes

Setup Concierge remains the app helper; Artist Manager owns artist priorities and specialist coordination. The helper now uses current `list_agents`, `list_skills`, and `list_sources` results with narrow searches, including dormant entries before declaring a capability missing. Existing active-agent context stays in place. It does not preload every worker's skills or treat installed/connected/funded/working as equivalent.

The inline `artist-os-guide` starter skill has a compact core plus `references/features.md`, loaded only for the relevant help topic. Both Setup Concierge and Artist Manager can use it. No external Codex skill installation was changed.

Source-checked topics include HQ/campaign/Lab navigation, Essentials versus Release Kit, Workers/Manage workers versus Library, in-chat focus and bounded capability expansion, chat history and Send update, Industry/Your World Signals, voice calls versus the Voice identity document, retained campaign files/memories, Outputs/Vault/Past Releases, website building versus publication, workflow inputs and Needs you, schedules, browser profiles, and account setup. The guide directs unfamiliar or newly added capability questions to the live catalog rather than freezing a complete worker roster.

The core helper prompt and guide together are approximately 1,096 words versus 1,353 in the prior captured versions; the separate feature reference is approximately 1,222 words and is not a mandatory startup read. These are text word counts, not measured model tokens or total session context.

## Evidence sources

- Navigation: `AppShell.tsx`, `WorkspaceRail.tsx`, `WorkPageTabs.tsx`, `AgentLibraryDialog.tsx`, `TopBar.tsx`.
- Focus: `ChatAgentTaskModeBar.tsx`, current agent/task-mode definitions, `list_agents` tool contract.
- Signals: `SignalsTracksPanel.tsx`, briefing/insight/handoff components.
- Cleanup: `CampaignCleanupDialog.tsx`, main campaign-cleanup handler, shared campaign-cleanup storage.
- Steering: actual Claude implementation and composer; updates are not a one-update-per-answer sequencer.
- Websites: current Site Builder and Website Agent definitions.
- Voice/accounts: Artist Manager voice components and current account-help/action routes.
- Tracked work: workflow input/run dialogs, automation work composer, HQ attention view.

## Safe upgrades

`migrateHelperGuide` upgrades only exact verified shipped prompt/skill versions. Current and older default profile variants were compared read-only against source history. Custom prompt text, frontmatter bytes, metadata, activation, skill contents, and references are preserved. Missing reference files are seeded through the existing required-skill mechanism. The helper migration runs after the existing Monid and legacy normalizers. No original user profile was edited during development.

## Verification

Focused agent/skill tests passed (261 tests). Independent rival review passed 51 helper/skill tests and found no concrete blocking issues. Full verification results follow after completion.

No app restart, live provider call, or production package replacement is part of this refresh. Source and automated evidence do not certify a currently running session or external account. The existing development launch/profile must remain intact when a restart is authorized.

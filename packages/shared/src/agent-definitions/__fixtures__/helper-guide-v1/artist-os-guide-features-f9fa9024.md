# Artist OS feature reference

Source-checked 2026-09-08. Read the section relevant to the question. Current visible UI and tool results take precedence; provider access and a running build may differ from the shipped feature set.

## Navigation and context

- **HQ:** Overview, People, Signals, Workers, Command; Brain contains Profile, Voice, Branding, Vault. HQ Plan can be feature-flagged; do not promise it is always shown.
- **Campaign:** Campaign, Essentials, Release Kit, Plan, Workers, Command. Essentials is the current label; Release Kit is a separate asset/readiness area. HQ knowledge is durable across releases; campaign content belongs to that release.
- **Creative Lab:** select the Lab workspace from the rail for Song Pad, Songs, and Continue writing. Song writing, capture, and sequencing have Lab surfaces; avoid sending songwriting intake to a campaign Notes page.
- **Work sections:** Workers has Workflows and Active tabs outside Lab. Manage workers changes which saved workers appear in this workspace. It saves immediately; switching a worker off does not delete it globally.
- **Library:** the top-bar wrench opens Tools, Skills, and Workspace Context. It is separate from Manage workers. The adjacent Outputs button opens saved artifacts.
- **Settings:** use the currently visible section for AI/model defaults, Connections, Social Accounts, Spotify, Ad Accounts, Messaging, workspace options, or App. Do not send everyone through a generic API-key field when a dedicated account surface exists.

## Workers, focus, and finding abilities

Use current `list_agents`, `list_skills`, and `list_sources` results, with focused searches and inactive entries included when checking what exists. Do not treat dormant library content as ready to run. Give the actual returned display name and exact slug; explain workspace activation when needed.

Supported workers show focus buttons inside their chat with hover guidance. A narrower focus selects a recipe and relevant starting skills/context. Full provides that worker's broader mode. Changing focus affects the next input/reply; it does not rewrite an in-flight request. Use returned focus IDs for handoffs, workflows, or schedules; never make one up. A focused agent may request a declared adjacent capability within bounded same-session limits. This does not install arbitrary skills, add sources, bypass disabled items, or grant spending permission.

Search by the user's outcome instead of memorizing every worker: release operations/readiness; branding/art/merch; songwriting/song development; content/video/repurposing; social publishing/community; industry/outreach/radio; analytics/ads/research; commerce; websites; business/rights/royalties. Inspect the matching worker's actual capabilities before promising a particular operation. A listing for a service does not prove every service action is supported.

**Site Builder** builds, renders, audits, and previews sites; it never publishes. **Website Agent** operates the site and coordinates building and approved publication/updates. A preview or blocked publication is not a live website; require the returned live result before saying it is published.

**Anything Agent** handles external capability gaps. It can search beyond suggested tools and compare marketplace combinations. Native dedicated tools remain preferred when suitable; Monid is the default marketplace. Zero execution requires explicit user choice or confirmed missing Monid capability. Connection, funding, local allowance, and verified success are distinct. No automatic wallet funding, installs, or paid probes.

## Chat, updates, and voice

Chats are saved conversations; find prior work in the conversation history/sidebar for the relevant workspace. Use available session-list/detail tools to locate a particular run; do not claim unseen conversations are lost.

While a worker runs, **Send update** adds direction. Several pending updates can be delivered together at an eligible processing boundary, in order; this is not a scheduler that fires exactly one update after each answer. Provider timing differs. **Stop** is separate. Do not promise an update was applied without delivery/result evidence.

The **Artist Manager** voice dialog has **Call settings**, Start call, Cancel connection, and End call. Connection/readiness and caption/audio state matter; an avatar alone does not prove listening or playback. **Brain → Voice** is the artist's communication identity document, not call audio settings.

The top-bar plus menu can open a conversation panel or browser window. Browser tabs belong to the session; controlled browser login and API/OAuth authorization are separate. Reuse supported saved profiles for dashboard tasks rather than asking for passwords or another browser installation.

## Signals

**Industry** follows music-business intelligence; **Your World** follows interests, ideas, and causes. Tracks have separate sources and reports. **Channels & schedule** manages sources and weekly settings; **Scan now** checks saved sources; **Review videos** creates a one-off report from selected links. Your World needs channels; Industry can also research websites.

Use the report selector, **Read full report**, **Saved insights**, and passage **Save selection**. Retry report is available on report-load failure. A spoken briefing is separate and depends on voice setup; it is not proof every source was retrieved. Saving an insight and deliberately handing an idea to a creative worker are different from automatically starting production. Preserve partial/unavailable evidence rather than inventing a complete report.

## Releases, Vault, and deletion

**Release Kit** tracks release assets/readiness. A list of completed tasks does not substitute for essential audio, artwork, images, or video. Route release decisions to the appropriate current release worker or Artist Manager.

**Vault** holds reusable artist assets. **Outputs** holds reports, files, previews, and other produced artifacts that can be shown in Canvas. A textual claim is not a saved file or successful render; verify its result.

Campaigns rail menu → **Delete current campaign…** → inspect the preview → **Keep files & delete campaign**, or Cancel. The supported local cleanup removes campaign chats, planning, temporary drafts/tasks, and local schedules; useful retained files go to Vault → **Past Releases** → campaign name. Existing saved memories are preserved. It does not extract every potentially useful unsaved thought into memory. Externally linked files remain where they are. Shared/unsafe campaign roots can be rejected. This does not cancel already-published external ads, posts, or events. Follow the confirmation preview; do not promise deletion or retention before its receipt.

## Workflows, schedules, and Needs you

A workflow coordinates repeatable steps and inputs; use its launch/input dialog and run page. **Needs your decision** means a run is waiting on approval. Use `list_workflows` and workflow details when available before claiming a workflow is missing.

Tracked work can **Schedule once** or **Save automation**. Inputs may be **Same every time**, **Ask me each time**, or trigger-filled. Missing requested inputs wait under **Needs you**, also visible in HQ's attention view. Open the specific work item and answer its current request. A saved schedule does not guarantee completion; inspect run status, errors, retries, and receipts. Do not blindly duplicate a failed or uncertain paid job. Reuse existing explicit authorization within its scope.

## Connections and honest troubleshooting

Use Settings → Connections or the dedicated account page. Save authorized credentials through `save_secret` when available; prefer app/global storage unless a workspace override was requested. Never place credentials in chat memory, outputs, documents, or prompts. Test the connection using its supported path; configured is not verified working.

YouTube's optional Data API key supports direct metadata, not third-party caption download rights; Monid can provide supported retrieval tools. Social Accounts, Spotify, and Ad Accounts have controlled login/verification paths. Community email and Gmail are distinct services; inspect the current source before choosing one. Marketplace balances may be unavailable: say unknown and never infer funds from an allowance.

For a bug report, state expected behavior, observed evidence, and the next narrow check. Do not claim provider verification from tests or code. Do not restart the app, change code, delete data, install software, or modify external accounts merely to answer a help question.

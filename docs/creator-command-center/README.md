---
status: current
owner: agent
last_verified: 2026-09-04
source_of_truth: true
---

# Creator Command Center Specs

Core Artist HQ and campaign workspace specs live here.

- [01 Mission Intake Operator Drawer](./01-mission-intake-operator-drawer-spec.md)
- [02 Mission Assets](./02-mission-assets-spec.md)
- [03 Google Workspace Context Sync](./03-google-workspace-context-sync-spec.md)
- [04 HQ Homebase Architecture](./04-hq-homebase-architecture-spec.md)
- [05 Team Access Without A Server](./05-team-access-without-a-server-spec.md)
- [06 Team Mode Shared Storage Architecture](./06-team-mode-shared-storage-architecture-spec.md)
- [07 Artist Vault Architecture](./07-artist-vault-architecture-spec.md)
- [08 Shared Intel Context Router](./08-shared-intel-context-router-spec.md)
- [09 HQ State Of Play / Proactive Routing](./09-hq-state-of-play-proactive-routing.md)
- [10 Work Products / Output Architecture](./10-work-products-output-architecture-spec.md)
- [11 Outputs, Finals, And Asset Promotion](./11-outputs-finals-asset-promotion-spec.md)
- [12 Campaign Calendar And Scheduled Jobs](./12-campaign-calendar-scheduled-jobs-spec.md)
- [13 Scheduled Work Composer And Execution](./13-scheduled-work-composer-execution-spec.md)
- [14 State Of Play Opportunity Engine](./14-state-of-play-opportunity-engine-spec.md)
- [15 Artist OS Runtime Isolation Plan](./15-artist-os-runtime-isolation-plan.md)
- [16 Lab Workspace](./16-lab-workspace-spec.md)
- [17 Lab Worker Routing Foundation](./17-lab-worker-routing-foundation-spec.md)
- [18 Lab Integration Hardening](./18-lab-integration-hardening-spec.md)
- [19 Artist Manager Brief And Context Architecture](./19-artist-manager-brief-context-architecture-spec.md)
- [20 Artist Timeline / Unified Calendar](./20-artist-timeline-unified-calendar-spec.md)
- [21 Bounded Goal Continuation Driver](./21-bounded-goal-continuation-driver-spec.md)
- [22 Chat-Native Goal Mode](./22-chat-native-goal-mode-spec.md)
- [23 Release Kit, Outputs, And Artist Vault](./23-release-kit-architecture-spec.md)
- [24 Session Task List And Delegation Return Path](./24-session-task-list-spec.md)
- [25 Release Kit Asset Use And Social Scheduling Surface](./25-release-kit-asset-use-social-scheduling-spec.md)
- [26 Agent-Bound Messaging](./26-agent-bound-messaging-spec.md)
- [27 In-App Artist OS User Guide](./27-in-app-user-guide-spec.md)
- [28 Track Intelligence: Lyrics, Timing, And Musical Metadata](./28-track-intelligence-spec.md)
- [29 X Editorial System](./29-x-editorial-system-spec.md)
- [30 Release Manager And Essentials Execution](./30-release-manager-essentials-execution-spec.md)
- [31 Catalog And Royalty Reconciliation](./31-catalog-royalty-reconciliation-spec.md) — agent and skill shipped; import, reconciliation, and filing slices remain
- [32 Computer Use Provider Strategy](./32-computer-use-provider-strategy-spec.md)
- [33 Automations: Input-Aware Setup And The One List](./33-automations-input-aware-setup-spec.md)
- [35 Guided Social Variant Sets](./35-social-video-repurposing-spec.md)
- [37 Model Fallback Chain](./37-model-fallback-chain-spec.md)
- [39 Artist Website: Managed Site, Website Agent, And Site Builder](./39-artist-website-agent-spec.md) — builder, publishing, and Website Agent implemented; live acceptance remains
- [40 Artist HQ Legal & Deals Agent](./40-music-legal-agent-spec.md)

## Not Yet Built

Specs written but with no implementation in the tree. They live in
[`todo/`](./todo/) so this index only lists work that exists.

- [36 Capability Evolution Engine](./todo/36-capability-evolution-engine-spec.md)
- [42 Campaign Release Path And Manager Orchestration](./todo/42-campaign-release-path-orchestration-spec.md) — date-aware Essentials path, approved campaign packets, and Artist Manager guidance over existing workers
- [43 Approved Branding Amendments](./todo/43-approved-branding-amendments-spec.md) — approved, append-only Branding additions from durable agent Outputs without replacing artist-written context
- [44 State-Aware First-Use Guide](./todo/44-state-aware-first-use-guide-spec.md) — optional first-use setup inside the existing question-mark Guide, completed from real app state instead of page visits
- [45 HQ / Campaign Scope Clarity](./todo/45-hq-campaign-scope-clarity-spec.md) — one rule for shared work, timeline inside campaigns, channel-collision warnings

Implementation and live acceptance tracking (spec files retained at their existing paths):

- [38 Community Email Engine And The Community Agent](./todo/38-community-email-engine-spec.md) — sending, imports, approvals, and Community Agent implemented; live send/unsubscribe acceptance remains
- [41 The Autonomous Website And Community Loop](./todo/41-autonomous-website-and-community-loop-spec.md) — publishing, capture, cadence, and routine implemented; live acceptance remains

When one ships, move it back up into the numbered list above.

Current V1 implementation notes:

- State of Play V2 is specified as a phased opportunity engine; V1 remains the shipped implementation until each phase is verified.

- Campaign Release Kit is the approved-canon layer above Campaign Assets and Outputs. Promotion copies and hashes exact uploads, Campaign Assets, HQ Vault assets, or Output files; legacy campaign Final pointers migrate on first load.
- All Artist OS agents receive the same Vault/Assets/Outputs/Release Kit contract and trusted lookup/promotion tools. Private or agent-disabled Vault assets remain unavailable.
- Campaign Scheduled Work now has a guided composer, backend-owned atomic mutations, durable agent/workflow completion polling, review decisions, attention states, and approval-blocked social work.
- College Radio and Spotify Playlist Creator are default HQ/Campaign workers; College Radio hands verified email work to Outreach Agent.
- Artist HQ Home now derives `Next`, `This Week`, `Workers`, and `Projects` from State of Play, Calendar, Scheduled Work, Automations, and campaign workspace data instead of sample cards. State of Play also renders live HQ goals and refreshes when its derived snapshot is missing or older than 12 hours.
- Weekly Spotify Snapshot and YouTube Intel Pulse remain opt-in. When activated they run Mondays at 9:00 AM and 10:00 AM local time, respectively. Their read/research work uses safe permission mode; any later public post, send, spend, delete, or external account mutation still requires exact approval.
- Creative Lab is implemented on `codex/lab-integration-hardening` with explicit workspace purpose, canonical song/project persistence, Lab-only tools, user-controlled starter workers, and bounded Prosody support. Automated integration gates pass; manual Electron and packaged/offline smoke remain.

Add new Creator Command Center specs here unless they clearly belong in another feature folder.

---
status: current
owner: agent
last_verified: 2026-07-09
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

Current V1 implementation notes:

- State of Play V2 is specified as a phased opportunity engine; V1 remains the shipped implementation until each phase is verified.

- Outputs -> Finals is wired through UI list/detail actions and the `promote_output_to_final` session tool. Finals are pointers stored in workspace context; campaign promotion uses the active campaign workspace id.
- Campaign Scheduled Work now has a guided composer, backend-owned atomic mutations, durable agent/workflow completion polling, review decisions, attention states, and approval-blocked social work.
- College Radio and Spotify Playlist Creator are default HQ/Campaign workers; College Radio hands verified email work to Outreach Agent.
- Artist HQ Home now derives `Next`, `This Week`, `Workers`, and `Projects` from State of Play, Calendar, Scheduled Work, Automations, and campaign workspace data instead of sample cards. State of Play also renders live HQ goals and refreshes when its derived snapshot is missing or older than 12 hours.
- Weekly Spotify Snapshot and YouTube Intel Pulse remain opt-in. When activated they run Mondays at 9:00 AM and 10:00 AM local time, respectively. Their read/research work uses safe permission mode; any later public post, send, spend, delete, or external account mutation still requires exact approval.

Add new Creator Command Center specs here unless they clearly belong in another feature folder.

---
status: current
owner: agent
last_verified: 2026-07-06
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

Current V1 implementation note: Outputs -> Finals is wired through UI list/detail actions and the `promote_output_to_final` session tool. Finals are pointers stored in workspace context; campaign promotion should use the active campaign workspace id automatically.

Add new Creator Command Center specs here unless they clearly belong in another feature folder.

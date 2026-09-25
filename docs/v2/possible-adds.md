---
status: proposal
owner: unassigned
last_verified: 2026-09-25
source_of_truth: true
---

# V2 Possible Adds

Companion to [Artist OS V2 Feature Ideas](../backlog/artist-os-v2-feature-ideas.md) and the [V2 index](./README.md). These are candidates for evaluation, not approved scope, implementation claims, or release promises. Preserve the main V2 plan's priorities.

Initial shortlist comes from reviewing Hermes Agent's August–September 2026 releases. Upstream release descriptions establish inspiration, not Artist OS compatibility or quality. Audit our existing capabilities before proposing new systems; adapt useful mechanisms into current agents, skills, and surfaces.

## 1. Verified evidence in Lab discoveries

**Artist value:** Explore interesting stories without mistaking a compelling invention for history.

**Proposed fit:** Extend Lab research and discovery cards with clear distinctions between documented fact, interpretation, and songwriting possibilities. Verify quoted passages against retrieved source text and link claims to supporting evidence. Report contradictions and unverified claims rather than hiding uncertainty.

**Reuse:** Existing Lab research, source references, discovery modal, and research agents. No new research agent or separate dashboard.

**First evaluation:** Audit current citation checks, then test historical rituals and cultural stories against real sources. Measure citation correctness, quotation accuracy, latency, and extra model cost. Classic-song analysis must respect quotation limits.

**Upstream:** [Hermes August 3: grounded citations and fact-checking](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3).

## 2. Recurring research with continuity

**Artist value:** Research develops promising directions and brings back new findings instead of repeating yesterday's briefing.

**Proposed fit:** Optional inspiration or opportunity scans retain bounded per-job notes, previously reported sources, artist selections, and unresolved questions. Compare source fingerprints before synthesis; skip unnecessary model calls and suppress repeated findings. Notify only when something useful changes.

**Reuse:** Existing automations, research workflows, Outputs, and [V2 intelligence/proactivity work](./intelligence-proactivity-and-learning.md). Keep job memory scoped to the artist, campaign, and task; do not create a competing Brain.

**First evaluation:** Run several editions on a controlled source set. Verify deduplication, continuity, reset/edit controls, source failure handling, and cost ceilings. Opt in explicitly; existing parked background-work proposals remain parked.

**Upstream:** [Hermes August 31: cron memory, notepads, continuity, and change detection](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.31).

## 3. Capture a Spark from anywhere

**Artist value:** Save a lyric or idea while producing in Ableton without losing the creative moment.

**Proposed fit:** A global shortcut opens a small capture window for text or explicit dictation. Save to existing Sparks or a selected song, acknowledge the save, and return focus to the previous app. Wake-word activation could later share this path but is not required.

**Reuse:** Existing Capture a Spark, Pad/song storage, and local dictation. One canonical saved record, not another inbox.

**First evaluation:** Verify existing quick-capture coverage, shortcut conflicts, focus restoration, correct song/workspace targeting, and durable saves across app restart. Test alongside a DAW and audio-device changes.

**Upstream:** [Hermes August 3: global-hotkey quick entry](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3).

## 4. Connection health before work fails

**Artist value:** Learn that a connection needs attention before a scheduled task depends on it.

**Proposed fit:** Surface actionable health in existing Connected Services and affected scheduled tasks, with a direct reconnect action. Distinguish expired authorization, missing permissions, temporary provider outages, and unknown status. Use safe, bounded checks; do not refresh everything continuously or promise that a successful check guarantees a later action.

**Reuse:** Existing connector status, credentials, scheduling, and notifications. Assess actual gaps before adding another health service.

**First evaluation:** Exercise expired credentials, revoked scopes, offline providers, concurrent refreshes, and recovery. Ensure secrets stay redacted and repeated failures do not spam the artist.

**Priority:** Highest practical reliability value in this shortlist. This entry remains V2; separately reproduced V1 defects still belong in the release backlog.

**Upstream:** [Hermes August 31: background MCP health and reauthentication prompts](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.31).

## 5. Simpler everyday UI, advanced controls on demand

**Artist value:** Friends beta-testing Artist OS can find artist actions without learning provider and execution terminology first.

**Proposed fit:** Test progressive disclosure within existing pages. Keep common tasks visible and reveal advanced configuration when relevant. A global Simple/Advanced switch is only one option, not the chosen design.

**Reuse:** Existing navigation, settings, and component system. Avoid duplicate layouts or hiding permissions, costs, errors, and recovery controls.

**First evaluation:** Observe beta users completing core tasks. Identify actual confusion, prototype the smallest disclosure change, and compare task completion and discoverability before a broad redesign.

**Upstream:** [Hermes September 24: Simple/Advanced desktop interface](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24).

## Related candidate: wake-word chat input

Already captured separately: [Wake-word chat input](./wake-word-chat-input.md). Keep its integration approach, licensing checks, and acceptance criteria there rather than duplicating the proposal.

## Suggested evaluation order

1. Audit connection-health coverage for concrete reliability gaps.
2. Evaluate verified Lab evidence and quick capture as focused V2 improvements.
3. Build recurring research only once evidence quality and continuity controls are dependable.
4. Let beta observations determine interface simplification.

Before promoting any candidate, record the current-code gap, bounded scope, canonical data owner, cost/privacy behavior, dependency and model licenses if borrowing code, and a representative live acceptance test. No implementation is authorized by inclusion in this document.

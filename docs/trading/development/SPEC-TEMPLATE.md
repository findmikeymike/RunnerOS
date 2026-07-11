---
status: static
owner: team
last_verified: 2026-07-11
source_of_truth: true
---

# Feature Spec Template

Copy to `docs/specs/<capability>/<slug>.md`. Remove instructional text, but keep the sections. A spec describes one coherent, testable capability.

```markdown
---
status: draft | approved | active | implemented | verified | superseded
owner:
last_verified: YYYY-MM-DD
source_of_truth: true
spec_id: TG-<area>-<number>
target_phase:
depends_on: []
---

# Capability Name

## Decision Summary
One paragraph: what will exist after this spec and why this shape was chosen.

## User Outcome
As a [user], I can [do/observe] so that [value].

## Scope
- Included behavior.

## Non-Goals
- Explicit exclusions that prevent scope creep.

## Current Reality
- What is implemented and verified now.
- Existing code/contracts reused.
- Assumptions marked as assumptions.

## Experience / Runtime Flow
Numbered happy path from trigger to visible/stored result.

## System Boundaries
| Component | Owns | Must not own |
|---|---|---|

## Contracts
### Inputs
Field, type, units, required/optional, validity, provenance.

### Outputs / Artifacts
Schema, producer/version, timestamps, confidence/quality, citations, storage.

### Commands and Events
Names, correlation/causation IDs, idempotency, ordering, retry semantics.

### Errors
Typed code, retryability, user message, diagnostics, safe fallback.

### Concrete Examples
At least one valid and one invalid/degraded payload.

## Time and Market Semantics
Timezone, exchange calendar, session, replay clock, event/receive time, ordering,
duplicates, gaps, lateness, rollover, corporate actions, precision, units.

## State Model
States, transitions, owner, persistence, cancellation, expiry, recovery.

## Agent Behavior
Evidence supplied, tools allowed, output schema, abstention rules, confidence,
invalidation, communication targets, memory written, forbidden actions.

## UI States
Loading, success, empty, stale, partial, degraded, canceled, failed, incompatible.
Include accessibility and user control where relevant.

## Security and Safety
Permissions, secrets, account data, trust boundaries, approvals, rate/position limits,
idempotency, audit, kill switch, and impossible actions for this phase.

## Observability and Receipts
Trace IDs, structured logs, metrics, health, versions, artifact/run receipt.

## Evaluation Plan
Fixtures, labels, baselines, metrics, temporal-leak checks, calibration, regression.

## Acceptance Criteria
- [ ] Observable, binary statement with evidence source.

## Verification Commands
| Command/action | Proves | Expected result |
|---|---|---|

## Rollout and Reversal
Feature flag/mode, migration, compatibility window, rollback, cleanup.

## Risks and Edge Cases
Rank highest-consequence and highest-likelihood first.

## Open Questions
Only unresolved choices. Mark owner and decision deadline/gate.

## Implementation Plan
Small ordered slices, each independently testable.

## Evidence Log
Date, commit, commands, fixture/artifact IDs, result, remaining gaps.
```

## Status Discipline

- `draft`: incomplete or unresolved.
- `approved`: shape accepted; implementation may start.
- `active`: currently being built.
- `implemented`: code exists; runtime verification may remain.
- `verified`: acceptance evidence is recorded.
- `superseded`: retained only for history and linked to replacement.

Never change a spec to make a failing implementation appear compliant. Record the discovered constraint, decide explicitly, and update the ADR if the architecture changes.

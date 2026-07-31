---
status: current
owner: team
last_verified: 2026-07-31
source_of_truth: true
---

# Trade God Docs

This is the routing table for humans and agents. Read only what the current job requires.

## Two-Minute Start

1. Read `CURRENT.md` for the live goal, truth, blockers, and next action.
2. Read `architecture/OVERVIEW.md` for system boundaries and dependency rules.
3. Read the active spec named in `CURRENT.md` before changing code.
4. Read `architecture/DECISIONS.md` before reversing an architectural choice.
5. Use `development/VERIFICATION.md` before claiming work is complete.

## Canonical Documents

| Document | Role | Changes when |
|---|---|---|
| `CURRENT.md` | Single heartbeat of active work | Every meaningful implementation session |
| `HANDOFF.md` | Zero-context takeover brief | Ownership changes or work pauses |
| `product/PRD.md` | Product intent, users, scope, principles | Product direction changes |
| `product/ROADMAP.md` | Outcome-based build sequence | A phase is accepted or reprioritized |
| `architecture/OVERVIEW.md` | Stable boundaries and data flow | Architecture materially changes |
| `architecture/DECISIONS.md` | Accepted/rejected decisions | A consequential choice is made |
| `development/BUILD-METHOD.md` | How work is decomposed and shipped | Team workflow changes |
| `development/SPEC-TEMPLATE.md` | Contract for a build-ready feature spec | Spec quality bar changes |
| `development/VERIFICATION.md` | Evidence and release gates | Runtime/test strategy changes |
| `operations/DOC-GOVERNANCE.md` | Freshness, ownership, archiving rules | Documentation policy changes |

## Active Design Specifications

- `specs/execution/unified-broker-entry-gateway.md` — implemented execution
  foundation for certified API/browser entry, protection, and reconciliation.
  Real connections remain disabled until external paper certification; it
  grants no consequential execution authority.
- `specs/execution/discord-trade-followup-management.md` — implemented package
  foundation for exact Discord follow-up resolution, durable compound trade
  management, and crash recovery. Donor push, desktop runtime wiring, and real
  paper mutation remain external gates.

## Supporting Vision Library

These project-local documents are deep reference material:

- `vision/PRODUCT-VISION.md` — complete product vision and system thesis.
- `agents/AGENT-CORE.md` — universal agent anatomy and build checklist.
- `agents/ORDER-FLOW-AGENT.md` — full specialist-agent example.
- `integrations/OPEN-SOURCE-HARVEST.md` — audited open-source harvest and integration map.
- `research/ORDER-FLOW-SPECIALIST-RESEARCH.md` — primary-source doctrine behind the first specialist runtime.

They inform the system but do not replace the active spec or current status.

## Authority Order

When documents conflict:

1. Accepted ADR plus implemented contract and passing verification.
2. Active, approved feature spec.
3. `CURRENT.md` for build state only.
4. Architecture overview.
5. PRD and roadmap.
6. Long-form vision/reference documents.

Code is evidence of current behavior, not automatic proof of intended behavior. A mismatch between code and an accepted spec must be surfaced, not silently rationalized.

## Where New Documents Go

- Product requirement or user outcome: `product/`
- Long-form product/system vision: `vision/`
- Universal or specialist agent blueprint: `agents/`
- Donor project audit or integration harvest plan: `integrations/`
- Cross-system boundary or durable choice: `architecture/`
- Build procedure, spec, test, or command guide: `development/`
- Runbook, incident, release, security operation: `operations/`
- One feature: `specs/<capability>/<slug>.md`
- Superseded material: `archive/YYYY-MM-DD/`

Do not create files named `final`, `latest`, `new`, or `v2`. Update the canonical document or create a dated ADR/archive record.

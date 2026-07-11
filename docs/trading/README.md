---
status: current
owner: team
last_verified: 2026-07-11
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

## Supporting Vision Library

The root-level documents are deep reference material:

- `../01-overview-vision.md` — complete product vision.
- `../02-agent-example-order-flow.md` — full Order Flow Agent example.
- `../03-agent-core.md` — universal agent anatomy and checklist.
- `../Integrations.md` — open-source harvest and integration map.

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
- Cross-system boundary or durable choice: `architecture/`
- Build procedure, spec, test, or command guide: `development/`
- Runbook, incident, release, security operation: `operations/`
- One feature: `specs/<capability>/<slug>.md`
- Superseded material: `archive/YYYY-MM-DD/`

Do not create files named `final`, `latest`, `new`, or `v2`. Update the canonical document or create a dated ADR/archive record.

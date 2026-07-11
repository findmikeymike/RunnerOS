---
status: current
owner: team
last_verified: 2026-07-11
source_of_truth: true
---

# Documentation Governance

## Purpose

Docs exist to reduce agent ambiguity and preserve decisions, not to maximize page count.

## Freshness Classes

- `active`: changes during current work (`CURRENT.md`, `HANDOFF.md`, active specs).
- `current`: verified and authoritative architecture/process.
- `static`: stable template, policy, or product reference.
- `draft`: proposed and not yet authoritative.
- `stale`: accuracy is doubtful; do not use without verification.
- `archived`: historical and superseded.

## Update Triggers

Update docs when:

- a phase/capability starts or closes;
- a contract or state owner changes;
- an ADR is accepted/superseded;
- runtime verification changes confidence;
- a provider, broker, license, or external assumption changes;
- a major failure reveals a missing invariant;
- work is handed to another agent.

## Session Closure Checklist

1. Update the active spec evidence log.
2. Update `CURRENT.md` with verified truth and the next smallest action.
3. Add/supersede ADRs if a durable decision changed.
4. Update `HANDOFF.md` when another agent could not resume safely from `CURRENT.md` alone.
5. Archive superseded docs; do not delete history.

## Archive Policy

Move obsolete documents to `docs/archive/YYYY-MM-DD/`. Add:

```markdown
> Archived YYYY-MM-DD. Reason: ... Superseded by: ...
```

Maintain an archive index when the first item is archived. Do not archive legal, license, security, product, or release decisions without clear supersession.

## Agent Reading Budget

An agent should not load every document. Route by task:

- New task: README, CURRENT, active spec.
- Architecture change: plus OVERVIEW and DECISIONS.
- Agent specialist: plus Agent Core and its domain spec.
- Integration/port: plus Integrations and relevant donor evidence.
- Release/execution: plus verification and safety runbooks.

## Truth Rules

- Separate desired, implemented, verified, and production-safe.
- Date all external research and volatile assumptions.
- Link claims to files, commits, fixtures, artifacts, or receipts.
- Never silently resolve a doc/code conflict.
- One document owns each kind of truth; other docs link to it.

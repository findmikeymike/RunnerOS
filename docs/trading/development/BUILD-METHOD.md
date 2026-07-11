---
status: current
owner: team
last_verified: 2026-07-11
source_of_truth: true
---

# Build Method

## The Unit of Progress

The unit of progress is a verified vertical slice, not a folder, agent persona, mock screen, or copied repository.

Each slice should cross the minimum real path:

`input -> deterministic capability -> contract -> agent/workflow -> user-visible output -> stored evidence -> verification`

## Work Sequence

1. Name the user outcome and non-goals.
2. Identify state owners and trust boundaries.
3. Write input/output/error contracts and examples.
4. Create a fixed fixture and controllable clock.
5. Implement deterministic capability without UI or LLM dependency.
6. Expose it through the typed client and control-plane bridge.
7. Add the smallest agent interpretation required.
8. Render an inspectable result and explicit failures.
9. Add evaluation, regression, and failure-injection tests.
10. Update `CURRENT.md`, ADRs, verification proof, and handoff.

## Spec Readiness Gate

A spec is build-ready only when it has:

- one concrete user outcome;
- scope and non-goals;
- owned boundaries and state;
- typed inputs, outputs, errors, events, and examples;
- provenance/time/version semantics;
- success, empty, degraded, stale, canceled, and failed states;
- security/permission implications;
- observability and receipts;
- test fixtures and acceptance criteria;
- rollout, migration, and rollback path;
- unresolved questions that do not make implementation ambiguous.

## Sizing Rule

A phase should be small enough that one agent can explain the entire runtime path and verify it end-to-end. Split work by stable boundaries, not arbitrary frontend/backend labels.

Good parallel seams:

- contract and fixture design;
- deterministic engine implementation;
- client/control-plane adapter;
- UI adapter;
- evaluation/failure harness.

Merge through contracts and fixtures. Do not allow parallel branches to invent incompatible types.

## Agent Work Packet

Every assigned task should contain:

```text
Goal:
Exact worktree/branch:
Files/boundary owned:
Required reading:
Inputs and contracts:
Deliverables:
Non-goals:
Acceptance commands:
Runtime proof required:
Docs to update:
Known risks:
```

## Definition of Done

- Behavior works through the real boundary, not only a unit test or mock.
- Contracts validate success and failure examples.
- Determinism/temporal integrity is proven where applicable.
- Errors are actionable and visible.
- Logs/traces do not expose secrets or sensitive account data.
- Tests cover the feature's highest-risk paths.
- Runtime proof is captured.
- `CURRENT.md`, relevant ADR/spec, and handoff reflect reality.
- Unrelated dirty work remains untouched.

## Anti-Patterns

- Creating all future packages and empty folders up front.
- Building many agents before one specialist is evaluated.
- Letting prompts substitute for domain engines.
- Designing the final dashboard before observing real workflows.
- Copying donor architectures and data models wholesale.
- Treating vector memory as market truth.
- Adding retries to non-idempotent actions.
- Calling paper/live behavior complete without reconciliation and failure tests.

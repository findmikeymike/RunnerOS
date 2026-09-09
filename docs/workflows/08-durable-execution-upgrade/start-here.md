# Workflow hardening upgrade — start here

**Read [the specification](specification.md) first.** It is the full product and engineering contract: current gaps, execution identity, journal schema, model/tool recovery, approvals, children, scheduling, migrations and crash tests.

This packet specifies an upgrade beneath existing Artist OS workflows. It does not replace the product, claim DBOS powers the main runner, or certify arbitrary external actions as exactly once.

- Repository: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`.
- Baseline: `8ce9f5c11782caa3c46713df8a9b7150513c95eb`.
- Revision: r2. Current state: P-01 isolated architecture proof accepted; production integration not started.
- Authority: latest user request → authorized specification → current code evidence. Old recovery behavior remains in effect until an implementation ships.
- First phase: **P-01, prove the recovery architecture.** Its three tasks have executable packets. Later phases are outlined and must be expanded against fresh code before implementation.
- No account setup or external actions are needed for P-01. Live certification later needs a prepared safe target and any authorization not already granted.

## Packet map

| Read | Purpose |
| --- | --- |
| [Specification](specification.md) | Requirements and technical/behavioral contracts |
| [Roadmap](roadmap.md) | Six phases, integration points, ownership and exit outcomes |
| [Readiness](readiness.md) | Setup, available capabilities and human-only actions |
| [Plan graph](plan.json) | Authoritative task IDs, dependencies, coverage and status |
| [Build state](state.md) | Resume context and evidence pointers |
| [First task](tasks/T-01.md) | Current-path inventory and executable boundary contract |

## Resume instruction

The user-authorized first group (P-01) is complete, including rival review and fixes. Read state.md and the engine ADR before the next group. Next is P-02 entry review and expansion of T-04/T-05 against actual source. The prototype is synthetic-only and must not be imported as a production engine. Existing schedules and product execution retain their previous behavior.

Validate the graph with:

```bash
python3 /Users/michaelb.williams/.codex/skills/build-specs/scripts/check_plan.py \
  docs/workflows/08-durable-execution-upgrade/plan.json --ready
```

Run from the canonical repository. The checker validates planning structure only; it does not run tests or prove implementation readiness, authorization or durability.

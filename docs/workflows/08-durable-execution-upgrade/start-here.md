# Workflow hardening upgrade — start here

**Read [the specification](specification.md) first.** It is the full product and engineering contract: current gaps, execution identity, journal schema, model/tool recovery, approvals, children, scheduling, migrations and crash tests.

This packet specifies an upgrade beneath existing Artist OS workflows. It does not replace the product, claim DBOS powers the main runner, or certify arbitrary external actions as exactly once.

- Repository: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`.
- Foundation baseline: `32d4b000c`; current main has advanced. Verify Git before edits.
- Revision: r10. P-01/P-02 internal foundations and earlier P-03 slices are implemented; the P-03 internal implementation pass is complete; live exit gates remain open.
- Authority: latest user request → specification → current code/evidence. Specs and structural plan validity do not prove shipped behavior.
- Current entry: [Build state](state.md), [normal-engine integration slices](normal-engine-integration.md).
- The durable host is opt-in; normal manual Start supports explicitly marked local-read workflows. Other workflow classes remain on the existing engine. Do not restart the user's app without permission.

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

Read state.md for the current integration boundary and unresolved proof. Historical evidence remains historical. New operations and children must preserve the journal's ownership, permission, budget and cancellation fences before any live adapter is enabled.

Validate the graph with:

```bash
python3 /Users/michaelb.williams/.codex/skills/build-specs/scripts/check_plan.py \
  docs/workflows/08-durable-execution-upgrade/plan.json --ready
```

Run from the canonical repository. The checker validates planning structure only; it does not run tests or prove implementation readiness, authorization or durability.

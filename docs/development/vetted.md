---
status: current
owner: agent
last_verified: 2026-07-06
source_of_truth: true
---

# Vetted Agents

Use this as the release smoke ledger for agents that have been tested in the real app with real or template-loaded credentials.

An agent is not vetted because it exists, appears in Workers, or has a prompt. It is vetted only after it completes a realistic user job without broken UI, missing tools, bad routing, or scary false errors.

## Vetted List

| Agent | Workspace | Test job | Required services | Result | Date | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| _None yet_ |  |  |  |  |  | Add agents here only after live smoke passes. |

## Pass Standard

- Shows in the correct HQ/campaign worker surface.
- Uses the right skills/tools without rereading the same skill every turn.
- Finds needed context from HQ, campaign, files, or saved settings.
- Uses saved service keys correctly when the job needs them.
- Produces or updates the expected app artifact, setting, output, task, or answer.
- Fails cleanly when blocked, with a clear user-facing reason and no misleading red error.
- Leaves no duplicate agents, broken labels, stale loading state, or hidden background run.

## Entry Format

When an agent passes, replace the placeholder row with:

| Agent | Workspace | Test job | Required services | Result | Date | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Art Director | Campaign | Generate single cover concept and publish output to Canvas | OpenAI, FAL/Wavespeed/Replicate if used | Passed | 2026-07-06 | Verified visual self-review and no text backing box. |

## Failed Or Partial Tests

Do not add failed agents to the vetted list. Put blockers in `docs/CURRENT.md` or the active handoff until fixed, then retest and add here.

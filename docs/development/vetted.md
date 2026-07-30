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
| Industry Hunter | Campaign | Find outreach-ready industry target from artist/release context and prepare handoff for outreach | Zero for LinkedIn/email enrichment when profile URLs are available | Passed | 2026-07-06 | Verified campaign worker path, target-list output, Zero availability, and no missing-tool blocker after relaunch. |
| Outreach Agent | Campaign | Use LinkedIn/profile target context to enrich contact route, prepare personalized outreach, and create private Gmail drafts when connected | Zero; Gmail optional for private drafts and approved send | Passed | 2026-07-30 | Verified Zero-backed research path is available; Gmail draft creation is private/reversible while send remains exact-approval gated. |
| Comms Agent | Artist HQ / Campaign | Draft approval-gated artist outreach using Profile, Voice, Branding, Intel, and recipient-specific context | None required; Gmail optional for approved send | Passed | 2026-07-06 | Verified draft-first behavior and updated skill guardrails for hook, recipient bridge, missing facts, and approval checklist. |

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

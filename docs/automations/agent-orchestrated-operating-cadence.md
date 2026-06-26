# Agent-Orchestrated Operating Cadence

## Goal

Let trusted agents design and install an operating cadence for a workspace:
scheduled heartbeats, file drops, webhooks, URL polls, and inbound messages that
start the right workflow or agent handoff.

## What This Enables

- "Every weekday at 7am, run Daily Company Brief."
- "When a CSV lands in `/inbox/ad-reports`, run Campaign Health Check."
- "When a webhook arrives from a form, run Support Triage."
- "When a message arrives, route it to a workflow instead of one loose prompt."

## Approval Boundary

Agents may draft and request these automations, but creation still goes through
the blocked `create_automation` tool. The user must approve the full draft
before it is saved.

Default runtime permission is `ask`. External writes, sending, publishing,
budget changes, and production mutations remain approval-gated by the sessions
or tools that perform them.

## Model

Existing trigger types stay unchanged:

- `SchedulerTick`
- `FileWatch`
- `WebhookReceive`
- `PollUrl`
- `MessageReceive`

Existing action types stay valid:

- `prompt`
- `webhook`
- `pulse`

New action type:

```json
{
  "type": "workflow",
  "workflowSlug": "daily-company-brief",
  "triggerInputs": {
    "company_context": "$CRAFT_EVENT_DATA",
    "time_horizon": "today"
  }
}
```

`triggerInputs` supports `$CRAFT_*` expansion so trigger payloads can feed
workflow inputs.

## Pack Role

Packs can declare recommended automations, but pack install must not silently
enable them until the pack installer has an explicit automation approval flow.
For now, packs install the agents/skills/sources/workflows and teach the
orchestrator what cadence to propose.

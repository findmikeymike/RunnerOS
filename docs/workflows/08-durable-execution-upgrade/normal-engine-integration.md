# Normal-engine integration slices

2026-09-09. Canonical main verified at `16bc96c66` before these changes. The workspace-switcher commit belongs to separate work and is preserved. No app restart or provider call is part of this slice.

The durable engine is intended to underlie normal workflows. Internal certification is not evidence that normal Start already uses it. The application is still being built; compatibility here means preserving existing working execution while each replacement is proven.

## Slice 1: admission, history and recovery boundary

Implemented in source:

- Trusted workflow admission acknowledges the persisted run before waiting for its model. Completion remains owned and observed by the host; shutdown fences admissions and drains execution.
- With the existing optional host enabled, normal GET/LIST project certified workflow records directly from the encrypted journal. No second authoritative `run.json` is created. Standalone/internal children are excluded.
- Stable authenticated principal checks filter history and protect direct reads. All journal IDs suppress colliding legacy entries, including hidden records. Storage/auth failures never trigger legacy fallback.
- A journal run without an active worker appears interrupted rather than falsely running. Normal detail controls pause/resume/stop the saved identity using versioned commands. Legacy rerun/delete cannot target it.
- Background polling uses journal versions. Lost control replies retain command identity. Successful history removal remains authoritative across later loading/errors and cannot resurrect mount-time cached data.
- The journal does not yet record wall-clock completion timestamps; projections omit them instead of inventing durations.

Review and evidence: cold rival found a hidden-ID collision and stale cached visibility. Both received targeted fixes and regression coverage. See the implementation tests in `durable-workflow-runs.test.ts`, `durable-workflow-host.test.ts`, `durable-read-runner.test.ts`, `workflow-runs-durable.test.ts`, and `durable-workflow-run.test.ts`. Final fresh checks are recorded in build state.

Slice 1 alone did **not** route normal START through the durable engine; slice 2 below adds that routing for explicit local-read workflows. It does not make agent tool get-run, scheduled polling, Signals, or arbitrary tools durable. Desktop visual/restart acceptance for the new controls remains untested; the earlier live smoke predates these changes.

## Slice 2: normal manual execution (implemented, bounded)

Normal RPC Start now supplies its authenticated transport actor to shared `WorkflowRunner.start`. After the optional desktop host opens, SessionManager installs the durable router and shared admission checks. A workflow must explicitly declare `execution: durable-local-read`; ordinary unmarked workflows keep their current execution. Unknown engine names fail parsing. Marked workflows cannot silently fall back if the host or required capability is unavailable.

The supported shape is one literal manual step, `outputs: {mode: none}`, no trigger inputs/templates, no retries/task modes/structured output. The existing agent resolver supplies its complete composed prompt and the normal workspace/account/model defaults. Current certification requires safe permission, thinking off, no declared or inherited skills/sources/specialist tools, local Pi with an API key, and no alternate working directory. A missing capability is an error for marked workflows, not an instruction to remove that capability.

Each run freezes eight model-request reservations, 4,096 maximum output tokens per request, and a ten-minute absolute deadline. `model-requests` counts attempts; it is **not a dollar spending cap** and does not mean the model is free. Lost responses retain their reservations. This budget type cannot admit external effects or children. No provider pricing is invented.

All starts and legacy reruns share a pending-admission lock and check for existing unfinished durable work. This includes automatic/agent callers and older legacy run IDs. A saved paused/interrupted/approval-wait run must be continued or stopped before starting the workflow again. Marked automatic/agent entrypoints are rejected until their own integration is implemented.

Configuration example in the existing workflow Markdown editor (replace `local-reader` with a real configured safe/off Pi agent with no unsupported capabilities):

```yaml
---
name: Read workspace notes
description: Summarize local notes without changing files.
execution: durable-local-read
trigger:
  type: manual
outputs:
  mode: none
steps:
  - id: read-notes
    agent: local-reader
    input: Read the local notes in this workspace and summarize them. Do not modify files.
---
```

Normal Start, GET/LIST and pause/reopen/resume are covered together through registered RPC handlers, preserving the same saved identity and cached model result. A separate isolated process also exercises the actual default Pi factory and native read with synthetic credentials and a loopback provider, without live account spending. The user's app has not been rebuilt/restarted or live-smoked for this slice; full-provider and packaged-release proof remain separate.

## Slice 3: scheduled occurrences

Before enabling automatic entrypoints, bind a deterministic occurrence identity to durable admission and reconcile it after restart. Current scheduled-work start and run-ID storage are separate writes; a crash between them can duplicate work. Prove kill-between-writes recovery before routing schedules.

Further slices extend multi-step execution, output publishing, source/tool capabilities and child delegation with their own effect/reconciliation proofs. None inherit certification merely by calling the shared start function.

## Follow-up review corrections

Cancellation status alone is no longer enough to admit another run: legacy ownership and durable worker lifetime stay guarded until cleanup finishes. History discovery runs independently of already-known active work, including remount, focus/reconnect and uncertain Start replies. Detail and approval requests retain stable ownership across polling revisions, recover from transient failures, and reject stale replies after decisions or route changes. Fresh tests and remaining desktop verification limits are recorded in build state.

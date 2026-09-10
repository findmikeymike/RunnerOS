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

The initial supported workflow definition was one literal step with a manual trigger, `outputs: {mode: none}`, no trigger inputs/templates, no retries/task modes/structured output. The existing agent resolver supplies its complete composed prompt and the normal workspace/account/model defaults. Current certification requires safe permission, thinking off, no declared or inherited skills/sources/specialist tools, local Pi with an API key, and no alternate working directory. A missing capability is an error for marked workflows, not an instruction to remove that capability.

Each run freezes eight model-request reservations, 4,096 maximum output tokens per request, and a ten-minute absolute deadline. `model-requests` counts attempts; it is **not a dollar spending cap** and does not mean the model is free. Lost responses retain their reservations. This budget type cannot admit external effects or children. No provider pricing is invented.

All starts and legacy reruns share a pending-admission lock and check for existing unfinished durable work. This includes automatic/agent callers and older legacy run IDs. A saved paused/interrupted/approval-wait run must be continued or stopped before starting the workflow again. Tracked Scheduled Work admission is added in slice 3 below. Other automatic/agent entrypoints remain rejected until their own integration is implemented.

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

## Slice 3: tracked scheduled occurrences (implemented, bounded)

Scheduled Work can now start the same explicitly marked local-read definitions through the durable engine. The existing activation and scheduled-definition checks still apply. This does not certify arbitrary cron/agent callers, multi-step workflows, sources, or effects.

The scheduler first persists a work-attempt ID. Workspace, order, and that attempt determine the durable run ID; the admission command also binds the workflow slug and scheduled definition digest. Recovery looks up that exact identity, even if the response was lost before Scheduled Work stored the returned run ID. It never starts a replacement, automatically resumes interrupted work, or resets its deadline/request budget. Changed identities and current ownership failures reject rather than falling back to legacy storage.

Scheduled work polls authorized journal projections and retains interrupted/paused runs for an explicit Resume in Recent Runs. Late replies cannot settle or attach to a newer attempt. Actual worker ownership holds the background lane through cancellation cleanup, even if the saved status is already terminal.

On startup, scans wait until the enabled protected journal opens. If opening fails, or saved recovery storage exists while the development host flag is disabled, tracked schedules stay paused with an explanatory notice. This intentionally pauses the whole tracked schedule queue because unreadable storage cannot prove which work is unfinished; ordinary manual workflows remain available. Profiles with no recovery storage and no enabled host retain existing scheduling behavior.

The real SIGKILL test kills a child after journal admission but before the scheduler saves the returned ID. A fresh process reconnects the same persisted attempt/run, with one original dispatch and unchanged deadline/budget. Tests use synthetic storage protection and an injected backend; no real account or desktop restart is part of this proof.

## Slice 4: sequential multi-step local reads (implemented, bounded)

Manual and tracked Scheduled Work now accept one to eight read-only steps. Each agent's complete system prompt is resolved before admission; every agent must meet the existing safe/off/no-skills/no-sources restrictions and use the same model and connection. Different agents are supported; different transports, parallel branches, conditional steps, retries, task modes, structured outputs and publishing remain unsupported. Unsupported later agents reject the entire run before any dispatch.

A single journal/run owns the sequence. Admitted step IDs, templates and agent prompts are frozen. Each step records its resolved prompt identity, global turn range and final text output. Finishing the last step and succeeding the run happen in one transaction. Resume skips completed steps; an interrupted step replays its own cached responses with turn offsets preserving tool and approval identity. Saved history keeps completed step outputs visible even if a later step pauses or fails.

Only references to earlier complete text outputs are accepted: `{{steps.read.output}}` and `{{steps.read.output | escape}}`. Unknown, malformed, self and future references reject before admission. There is no trigger-variable expansion in this slice.

The whole sequence retains the same shared eight-model-request cap, 4,096 output-token maximum per request, and ten-minute absolute deadline. These are not reset per step or after restart; exhausting the shared allowance can stop the sequence. No per-step dollar cost is claimed.

Example step sequence inside an otherwise supported workflow:

```yaml
steps:
  - id: read
    agent: local-reader
    input: Read the local release notes and identify the main facts.
  - id: summarize
    agent: local-reader
    input: |
      Summarize these findings for the artist:
      <findings>{{steps.read.output | escape}}</findings>
```

A process-kill test stops execution after the first step is committed and before the second dispatch. Reopening performs no automatic execution; explicit Resume executes only the second step using the first saved output and unchanged budget/deadline. A separate real default-Pi test executes both steps with native file reads against a loopback synthetic provider, proving actual SDK boundary and tool-ID mapping. No desktop relaunch or real provider account was used.

## Slice 5: durable final text Outputs (implemented, bounded)

Manual and tracked scheduled local-read workflows may now publish the final step's text as a local report or document. This supersedes slice 4's publishing exclusion for this contract only. Existing opt-in and read-only agent restrictions remain. No external publishing or general write tool is enabled.

```yaml
outputs:
  mode: final-step
  kind: report
  title: Release research
```

Title and optional summary must be literal strings. Kind may be report or document (default document). An explicit primary must reference the final step's output; file, media, external-link and explicit-tool contracts are rejected before admission.

Final model completion saves the text and pending publication together. The trusted host rechecks current local ownership, workspace identity and files.write permission, stages a complete bundle privately, then atomically publishes it with a stable run-derived ID. Only a journal receipt makes the run succeeded and exposes its final Output ID in run history. The ordinary Outputs list sees the complete bundle after rename, including the short pre-receipt crash window. Successful receipt triggers Outputs/HQ refresh.

Publication failures pause with saved text and an explicit Resume path. Publication recovery needs no provider credentials or additional model requests, and remains available past the model deadline. Late subprocess/teardown failures preserve pending text. Current permission and workspace checks still apply. Cancellation fences writes; completed model work cannot receive steering. Exact existing bundles are reused; changed or partial bundles are rejected rather than overwritten. Separate same-title runs have distinct slugs.

The SIGKILL proof stops after the bundle is saved but before its receipt. Explicit Resume keeps one bundle and one model execution, preserving file bytes and modification times. This does not certify out-of-band deletion before the receipt, external services, packaged Electron, or desktop UI recovery. Model execution remains read-only; the publication writer is host-owned.

## Slice 6: workspace filesystem source context (implemented, bounded)

Supported agents can now declare/select enabled local sources with explicit `local.format: filesystem` and an existing directory inside the workspace. Required sources, selected optional sources and inherited defaults are validated before admission. Missing, disabled, external, API, MCP, generic local/CLI sources, or linked paths below the workspace root fail closed. Workspace-root aliases are normalized. Other agent restrictions remain unchanged.

The composed prompt includes frozen source names, paths and guide text. A saved descriptor pins configuration, guide and directory identity. All steps' descriptors are checked before new execution and again after asynchronous tool authorization; changes pause the run. Restore the original configuration to Resume, or cancel and start a new run with changed sources. Final text already awaiting publication remains independently recoverable.

This activates no connectors or command tools: the backend still receives an empty enabled-source list and uses only the existing Read/Grep/Find/Ls tools. Saved tool results retain normal journal replay. Source files themselves are not snapshotted: a fresh read can observe current file content. Source containment validates this source contract, not a new global filesystem sandbox for all native reads.

## Slice 7: frozen workflow inputs (implemented, bounded)

Durable manual and tracked scheduled runs accept declared string, number and boolean inputs using the existing required/default, finite-number, integer, min/max and maxFrom rules. Declaration names must be unique simple identifiers; prototype names and runner controls (`permission_mode`, `enabled_source_slugs`) are rejected. Ordinary undeclared business fields are dropped, matching normal normalization. Missing optional values remain absent in history and expand to empty text in a prompt. Explicit blank/null optional values do not refill defaults during repeated scheduled staging.

```yaml
trigger:
  type: manual
  inputs:
    - name: release
      type: string
      required: true
steps:
  - id: research
    agent: local-reader
    input: Review the workspace notes for {{trigger.release | escape}}.
```

The journal freezes normalized values and untrusted-field annotations alongside the original templates. Single and multiple steps resolve those saved values with prior step outputs in one pass: template-looking text inside a supplied value is not executed as another template. Untrusted fields retain the existing escaped data wrapper. Authorized run history shows the saved inputs. A known scheduled occurrence returns its saved run before considering edited input values/defaults; a resumed run keeps its original values and budget.

Output titles, `run.*` references, nested output paths, permission overrides, source overrides and new automatic entrypoints remain unsupported. This adds workflow data, not new tool authority. Earlier slice statements excluding trigger variables describe those earlier boundaries.

Further slices extend remote source/tool capabilities, mixed transports and child delegation with their own effect/reconciliation proofs. None inherit certification merely by calling the shared start function.

## Follow-up review corrections

Cancellation status alone is no longer enough to admit another run: legacy ownership and durable worker lifetime stay guarded until cleanup finishes. History discovery runs independently of already-known active work, including remount, focus/reconnect and uncertain Start replies. Detail and approval requests retain stable ownership across polling revisions, recover from transient failures, and reject stale replies after decisions or route changes. Fresh tests and remaining desktop verification limits are recorded in build state.

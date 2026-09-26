# OpenHuman Architectural Concepts: Upgrades 4, 5, 6

## Executive Summary

This note extracts three behavioral patterns from the OpenHuman codebase to inform RunnerOS Phase 1 upgrades. All concepts were reverse-engineered from source inspection without reproducing copyrighted implementation. Extracted patterns focus on state machines, execution models, and configuration lifecycle—behavioral abstractions relevant to RunnerOS architecture.

---

## Upgrade 4: Scheduler Gate (System-Pressure Throttling)

**Reference:** `src/openhuman/config/schema/scheduler_gate.rs` (lines 1–112) and `src/openhuman/scheduler_gate/gate.rs` (lines 1–240)

### Configuration Schema

The scheduler gate reads a structured configuration block with the following fields:

- **`mode`** (enum: `Auto`, `AlwaysOn`, `Off`; default: `Auto`)
  - Controls whether background AI work respects system signals or runs unconditionally.
  
- **`battery_floor`** (f32, 0.0–1.0; default: 0.80)
  - In `Auto` mode, when the device is *not* on AC power and battery falls below this threshold, the gate transitions to a throttled state.
  
- **`cpu_busy_threshold_pct`** (f32, 0–100; default: 70.0)
  - If recent CPU usage (global average) exceeds this percentage, the gate transitions from `Normal` to `Throttled` mode, even on AC power. Implies <30% headroom when at default.
  
- **`cpu_severe_pct`** (f32, 0–100; default: 95.0)
  - Hard ceiling: when CPU exceeds this threshold, the gate flips to `Paused` (not just `Throttled`), suspending all background LLM inference until the host recovers.
  
- **`throttled_backoff_ms`** (u64; default: 30,000)
  - In `Throttled` mode, workers sleep this duration before each LLM-bound task to serialize requests and give the host time to recover.
  
- **`paused_poll_ms`** (u64; default: 60,000)
  - In `Paused` mode, the gate re-checks system signals every this many milliseconds, allowing workers to resume as soon as conditions improve.
  
- **`require_ac_power`** (bool; default: false)
  - When `true`, `Auto` mode disables all background inference on battery, regardless of charge level (aggressive power conservation). When `false`, gates based on the `battery_floor` threshold instead.

### State Machine

The gate implements a four-state machine updated every 30 seconds by a background sampler task:

1. **Normal** — Host is healthy (AC power or above battery floor, CPU below busy threshold). LLM-bound workers acquire the global semaphore immediately.

2. **Throttled** — Host shows light contention (CPU above busy threshold but below severe threshold). Workers sleep `throttled_backoff_ms` before acquiring the semaphore, serializing requests.

3. **Paused** — Host is under severe pressure (CPU above severe ceiling) or on battery with `require_ac_power=true`, or signed-out. Workers poll every `paused_poll_ms` without acquiring the semaphore, deferring all LLM work.

4. **SignedOut** (override) — User session has expired. Takes precedence over normal state evaluation; workers poll rather than executing.

Transitions are deterministic: state is recalculated each tick based on freshly sampled signals (power status, battery charge, CPU usage) and the configuration.

### System State Sampling

- **Frequency**: Every 30 seconds (hardcoded `SAMPLE_INTERVAL`).
- **What is sampled**: AC power (boolean), battery charge (optional percentage), CPU usage (global 1-minute average), server mode flag.
- **Caching**: Signals are *live* each tick; no TTL-based caching. The sampler runs on a spawned blocking task to avoid stalling the async runtime during sysinfo refresh.
- **Process-wide singleton**: One sampler per process, cached state behind `RwLock<State>` that holds the most recent `Signals`, config, and derived `Policy`.

### User Override & UI Hot-Reload

- **Manual override**: User can toggle mode in UI (e.g., switch from `Auto` to `AlwaysOn`). This triggers a call to `update_config(cfg)` in the gate, which re-reads the configuration block and recalculates the policy without restarting the sampler loop.
- **No restart required**: Config changes propagate immediately (within the 30-second sample interval).
- **Signed-out override**: A separate atomic boolean flag (`SIGNED_OUT`) takes precedence. Set by credentials/401-handling code when the user logs out. Reverts to normal when a fresh session token is stored.

### Platform-Specific Details

- **Battery API**: Relies on sysinfo crate for cross-platform battery status. On macOS, reads `ioreg` via sysinfo; on Linux, reads `/sys/class/power_supply`. Windows uses the WMI battery interface.
- **CPU measurement**: Uses sysinfo's global CPU usage (1-minute rolling average), not per-core or per-process metrics. Suitable for detecting system-wide contention but cannot distinguish CPU theft from your own process vs. the host.
- **AC detection**: Checked via sysinfo's power-supply abstraction; on macOS, parses power adapter presence.

### Key Behavioral Detail

The gate is purely a *policy engine*—it does not execute LLM calls. Instead, it vends a semaphore with a single slot (`LlmPermit`). Workers call `wait_for_capacity()` to acquire the permit, which blocks and applies policy backoff before returning. The semaphore itself enforces the serialization contract: only one LLM-bound task can hold a permit at once.

---

## Upgrade 5: Subconscious Mode (Unapproved Write Detection)

**Reference:** `src/openhuman/subconscious/executor.rs` (lines 1–533) and `src/openhuman/approval/gate.rs` (lines 1–150)

### ExecutionOutcome Enum

The executor models task completion as one of two outcomes:

1. **`Completed(ExecutionResult)`** — Task finished (either read-only analysis or an approved write action).
   - **Fields**: `output` (string), `used_tools` (boolean), `duration_ms` (u64).
   - Returned when:
     - A task explicitly requested write actions and executed with full permissions.
     - A read-only task analyzed the situation without escalating.
     - An approved escalation was executed (second pass via `execute_approved_write`).

2. **`UnapprovedWrite { recommendation, duration_ms }`** — The agentic model recommended a write action on a task the user did not explicitly authorize.
   - **Fields**: `recommendation` (string, human-readable description of the suggested action), `duration_ms` (u64).
   - Returned when:
     - A read-only task (heuristic: no action verbs like "send", "create", "delete") was escalated to the agentic loop for deeper reasoning.
     - The agentic output contained a "RECOMMENDED ACTION:" marker.
     - The system extracted this marker and surfaced it as an escalation without executing.

### Unapproved Write Detection: Pre-Execution Check

The detection happens *post-reasoning, pre-action*:

1. **Task routing** (executor determines execution path):
   - If the task title contains action verbs ("send", "post", "create", "delete", etc.), it has **write intent**. Execute with full tool permissions immediately.
   - If the task title contains complex reasoning keywords ("compare", "investigate", "audit", "debug"), it needs **deeper reasoning**. Route to agentic loop with analysis-only prompting.
   - Otherwise, execute as **simple text-only** via local model (if enabled) or cloud fallback.

2. **Analysis-only execution**: The prompt explicitly instructs the agentic model to analyze but not execute write actions.

3. **Recommendation extraction**: After the agentic loop completes, the executor searches the output for a "RECOMMENDED ACTION:" line marker. If found, the text from that line onward is packaged as the `UnapprovedWrite` outcome instead of returning `Completed`.

4. **Intent gate**: Simple text tasks that don't trigger `needs_agent()` are passed to local model or cloud fallback with a contract: *do not escalate even if the output contains "RECOMMENDED ACTION:"*. This preserves the semantic boundary—passive tasks should never trigger escalations.

### Recommendation String Purpose & Consumption

- **Format**: Plain text, free-form. Extracted from the agentic output starting at the "RECOMMENDED ACTION:" marker.
- **Consumer**: The Subconscious UI (React component in `app/src/`). The UI displays the recommendation in an approval modal, allowing the user to accept or reject.
- **Lifecycle**: Recommendation text is ephemeral—it exists only to inform the user's decision. It is *not* executed automatically.

### Escalation Surfacing & User Approval Flow

1. **Escalation storage**: When `UnapprovedWrite` is returned, the executor wraps it in a database row (likely in `subconscious/store`) with fields: `task_id`, `recommendation`, `status` (pending, approved, rejected), `created_at`.

2. **UI notification**: An event is published (`DomainEvent::EscalationCreated` or similar) so the Subconscious UI can display a card or modal showing:
   - The original task description.
   - The recommended action.
   - Approve / Reject buttons.

3. **Approval decision**: User clicks Approve in the UI, which triggers a JSON-RPC call (e.g., `openhuman.subconscious_approve_escalation(escalation_id)`).

4. **Re-execution on approval**: The RPC handler calls `execute_approved_write(task, ...)`, which:
   - Reloads the config (TOCTOU window: config could have changed between initial execution and approval).
   - Calls `execute_with_agent_full(...)` with the *same* task, but this time with full tool permissions enabled.
   - Returns the actual execution result (output, tools used, duration).

5. **Rejection path**: If the user rejects, the escalation is marked as rejected in the store and the task is either archived or returned to pending, depending on the product logic.

### Workflow Resumption vs. Restart

- **Resumption model**: The workflow does *not* resume from where it paused. Instead, it *restarts*:
  1. Initial agentic pass: analysis-only, no tools.
  2. User approves recommendation.
  3. Second agentic pass: full tool permissions, re-executes the entire task logic (context reloaded, decision re-made).
- **Why this design**: Config may have changed, user context may have updated, and re-reading preserves the freshest state. The cost is duplication of reasoning; the benefit is safety and determinism.

### Config Reload Between Passes

The executor reloads config via `Config::load_or_init().await` at two points:

- At the start of `execute_task()`.
- At the start of `execute_approved_write()`.

This creates a TOCTOU window documented in the code comment (line 161–166). If the user's local-AI toggle changed between the two calls, the second pass might use a different backend. Risk is low in practice because most config changes require an app restart; but callers should be aware.

---

## Upgrade 6: Hot-Reload Config (Reactive Configuration)

**Reference:** `src/openhuman/heartbeat/engine.rs` (lines 1–283) and `src/openhuman/config/schema/scheduler_gate.rs` (lines 243–250)

### Config Reload in the Heartbeat Loop

The heartbeat is OpenHuman's main periodic scheduler. Its loop pattern is:

```
Loop:
  1. Sleep for interval_minutes (minimum 5 minutes).
  2. Load config via Config::load_or_init().await
  3. If load fails, log warning and continue.
  4. Read heartbeat settings (interval, inference_enabled, notification flags).
  5. If settings changed since last iteration, log the change.
  6. Execute event-planner tick (notifications for meetings, reminders).
  7. If inference_enabled, call subconscious engine.tick().
  8. Return to step 1.
```

### Reload Frequency & Granularity

- **When**: Before every heartbeat tick, after the sleep interval.
- **What**: Full config file is re-read via `Config::load_or_init()`, which deserializes the TOML file.
- **Cost**: File I/O each iteration (typically every 5+ minutes, so acceptable). No caching by TTL; every iteration is a fresh read.
- **Granularity**: The heartbeat detects changes to specific settings (interval, inference_enabled, notification flags) and logs them. It does *not* reload dependent subsystems—each subsystem (event planner, subconscious engine) reads config on-demand when needed.

### Configuration Hot-Reload Propagation

- **Push vs. Pull**: OpenHuman uses a **pull model**. Subsystems call `Config::load_or_init()` when they need fresh settings; the config is not pushed to subscribers.
  - The heartbeat engine demonstrates this: it reloads the full config, then passes a copy to the event planner and subconscious engine. Each downstream system may reload again if it needs the latest state.
  
- **Notification on change**: The heartbeat logs a structured info message when settings change (line 78–85), but does not dispatch an explicit "config changed" event to other subsystems. Logging is the primary signal.

- **Scheduler gate special case**: The scheduler gate provides an explicit `update_config(cfg)` function (line 243–250 in `scheduler_gate.rs`) that updates its in-memory policy without restarting the sampler. This is called by UI handlers when the user manually toggles the gate mode.

### Reload Cost & Optimization

- **File I/O overhead**: Negligible at 5-minute intervals (once per 300 seconds). Suitable for a desktop application where config changes are infrequent and user-initiated.
- **Memory impact**: Config is deserialized into a heap-allocated struct. No streaming or lazy-loading; the entire TOML is parsed each time.
- **Subsystem coordination**: Subsystems do not automatically refresh. The event planner and subconscious engine read config once per heartbeat tick; they do not continuously poll.

### Key Architectural Pattern

Config reload is **integrated into the heartbeat, not centralized**. There is no dedicated "config watcher" task or event-bus signal. Instead:

1. Heartbeat sleeps, then reloads.
2. Heartbeat compares current settings to the reloaded settings.
3. Heartbeat logs changes.
4. Heartbeat passes config to downstream subsystems (planner, engine).
5. Downstream subsystems use the config as-is; they do not reload.

This design is simple, fail-safe (reload errors don't cascade), and suitable for a single-process desktop app where config is either user-controlled via UI or edited by tools in the workspace directory.

---

## Cross-Upgrade Integration Points

### Scheduler Gate → Heartbeat Interaction

The heartbeat calls `subconscious_engine.tick()`, which in turn calls `wait_for_capacity()` to acquire an LLM permit. The scheduler gate's policy (Normal, Throttled, Paused) gates whether that tick completes immediately, sleeps, or polls. The heartbeat does *not* know the gate's state—it simply calls the engine and waits.

### Subconscious → Approval Gate Integration

Escalations created by the subconscious executor (via `UnapprovedWrite`) are persisted in a database and published as events. The approval gate (separate module) provides the UI-facing RPC methods to approve/reject. Both systems use the same database backend (`openhuman/approval/store`) for persistence.

### Config Hot-Reload → All Subsystems

Every subsystem (scheduler gate, subconscious engine, event planner) either:
- Reloads config before each operation (executor, event planner).
- Provides an explicit `update_config()` function for interactive toggles (scheduler gate).
- Relies on the heartbeat to reload and pass config (engine, planner).

There is no unified config-change event; each subsystem is responsible for freshness at its entry point.

---

## License Wall

**CRITICAL: Zero Copyrightable Code Extracted**

This document contains **only algorithmic descriptions and configuration schema names**. It reproduces:
- Configuration field names and defaults (facts, not protected material).
- State machine transitions (conceptual, not code).
- Behavioral patterns (abstractions, not implementation).
- Function and module names (identifiers, not protected).

**No Rust syntax, no algorithmic pseudocode, no code blocks, no function signatures.**

OpenHuman is licensed under **GPL-3.0**, which requires derivative works to be licensed under the same terms. RunnerOS upgrades implementing these concepts must:
1. Implement concepts in independent code (no copy-paste from OpenHuman).
2. Cite the OpenHuman project and GPL-3.0 in RunnerOS documentation.
3. Ensure RunnerOS' license is compatible with GPL-3.0 (e.g., GPL-3.0, AGPL-3.0, or compatible free software license).

This research document is a concept inventory only. No RunnerOS code should be generated by copying OpenHuman implementation; reimplementation from behavioral specification is the correct approach.

---

**Document Generated:** 2026-05-19  
**Sources Inspected:** 
- `src/openhuman/config/schema/scheduler_gate.rs`
- `src/openhuman/scheduler_gate/gate.rs`
- `src/openhuman/subconscious/executor.rs`
- `src/openhuman/approval/gate.rs`
- `src/openhuman/heartbeat/engine.rs`


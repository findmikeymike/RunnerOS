# Hermes Subagent Isolation Research

## Overview
Hermes (`delegate_tool.py`) implements subagent isolation through four orthogonal mechanisms: a blocked-tools allowlist, per-thread approval callbacks, spawn-depth limits, and credential isolation. This note extracts the pattern for RunnerOS Phase 1 Upgrade 2 (subagent hardening).

## Key Findings

### 1. DELEGATE_BLOCKED_TOOLS Allowlist
**Location:** `delegate_tool.py:35-41`

```python
DELEGATE_BLOCKED_TOOLS = frozenset(
    [
        "delegate_task",      # no recursive delegation
        "clarify",            # no user interaction
        "memory",             # no writes to shared MEMORY.md
        "send_message",       # no cross-platform side effects
        "execute_code",       # children should reason step-by-step, not write scripts
    ]
)
```

**Rationale per tool:**
- `delegate_task` — Prevents fork bombs; depth is gated separately (see § 5)
- `clarify` — Blocks subagents from requesting user input (would deadlock parent TUI)
- `memory` — Prevents subagents from modifying shared persistent state
- `send_message` — No cross-session/platform side effects (Slack, Discord, email)
- `execute_code` — Forces explicit tool-by-tool reasoning; discourages script-writing shortcuts

**RunnerOS delta:** RunnerOS `spawn-session-tool.ts` has no blocklist yet. Should port all five tools verbatim; the rationale applies identically to the TypeScript runtime.

### 2. Per-Thread Approval Callback Initialization
**Location:** `delegate_tool.py:1492-1500`

```typescript
_timeout_executor = ThreadPoolExecutor(
    max_workers=1,
    initializer=_set_subagent_approval_cb,
    initargs=(_get_subagent_approval_callback(),),
)
```

**Pattern:**
- Python's `ThreadPoolExecutor(initializer=..., initargs=(...))` injects a callback into each worker thread before task execution.
- The callback is retrieved from `_get_subagent_approval_callback()`, which reads `delegation.subagent_auto_approve` config.
- Callback is stored in `threading.local()` (thread-local storage) in `terminal_tool.py:237`.

**TypeScript equivalent:** Use `AsyncLocalStorage` from Node.js `async_hooks`. Each subagent spawn wraps the run in `asyncLocalStorage.run(approvalCallback, ...)`. A context object carries the callback through async call chains (unlike thread-local, which doesn't traverse async boundaries by default).

### 3. Approval Callback Implementations
**Location:** `delegate_tool.py:73-97`

**Auto-deny (safe default):**
```python
def _subagent_auto_deny(command: str, description: str, **kwargs) -> str:
    logger.warning("Subagent auto-denied dangerous command: %s (%s). "
                   "Set delegation.subagent_auto_approve: true to allow.",
                   command, description)
    return "deny"
```

User-facing response: `"deny"`. The subagent sees a refusal it can handle gracefully; never calls `input()` (which would deadlock parent).

**Auto-approve (opt-in):**
```python
def _subagent_auto_approve(command: str, description: str, **kwargs) -> str:
    logger.warning("Subagent auto-approved dangerous command: %s (%s)",
                   command, description)
    return "once"
```

User-facing response: `"once"`. Dangerous command is approved for a single execution, audit-logged.

### 4. Config Key: `delegation.subagent_auto_approve`
**Location:** `delegate_tool.py:103-112`

```python
def _get_subagent_approval_callback():
    cfg = _load_config()  # Reads config.yaml
    val = cfg.get("subagent_auto_approve", False)
    if is_truthy_value(val):
        return _subagent_auto_approve
    return _subagent_auto_deny
```

Config resolution: `config.yaml` > default `False`. No env-var override. The callback choice is made once per delegation call and propagated via initializer args, not queried repeatedly.

**RunnerOS mapping:** Use `settings.json` under a new `delegation.subagent_auto_approve` boolean. Migrate at spawn time; pass the resolved callback into the AsyncLocalStorage context.

### 5. Fork-Bomb Protection: Spawn Depth Limits
**Location:** `delegate_tool.py:131-138, 394-430`

```python
MAX_DEPTH = 1  # flat by default: parent (0) -> child (1); grandchild rejected
_MIN_SPAWN_DEPTH = 1
_MAX_SPAWN_DEPTH_CAP = 3

def _get_max_spawn_depth() -> int:
    cfg = _load_config()
    val = cfg.get("max_spawn_depth")
    if val is None:
        return MAX_DEPTH
    clamped = max(_MIN_SPAWN_DEPTH, min(_MAX_SPAWN_DEPTH_CAP, val))
    if clamped != ival:
        logger.warning("delegation.max_spawn_depth=%d out of range [%d, %d]; clamping to %d", ...)
    return clamped
```

**Mechanism:**
- `depth 0` = parent agent
- `max_spawn_depth = N` means agents at depths 0..N-1 can spawn; depth N is leaf floor
- Default 1 enforces flat hierarchy (parent spawns children; children cannot spawn)
- Clamped to [1, 3] to prevent runaway nesting

**Enforcement:** `delegate_tool.py:616` checks `if child_depth + 1 >= max_spawn_depth`.

**RunnerOS mapping:** Import the depth counter pattern into spawn logic. Store `_delegate_depth` on each subagent context; increment on spawn; reject if depth >= max. Default to 1 (flat); expose `delegation.max_spawn_depth` config knob.

### 6. Async/Sync Boundary: Threading Model
**Location:** `terminal_tool.py:237, 257-264` (thread-local) vs. `delegate_tool.py:1492-1500` (ThreadPoolExecutor)

**Python pattern:**
```python
_callback_tls = threading.local()  # Per-thread slot

def set_approval_callback(cb):
    _callback_tls.approval = cb

def _get_approval_callback():
    return getattr(_callback_tls, "approval", None)
```

Worker threads inherit the callback via `initializer=_set_subagent_approval_cb, initargs=(cb,)`.

**TypeScript gotcha:** Node.js `threading.local()` equivalent is `AsyncLocalStorage`. However:
- `AsyncLocalStorage` propagates through async call chains (`Promise`-based).
- Does NOT propagate across `Worker` threads (which is isolating but more explicit).
- Does propagate across `setImmediate` / `process.nextTick`.

**Recommendation for RunnerOS:**
- Use `AsyncLocalStorage<ApprovalCallback>` if subagents run in the main thread's async context.
- If subagents spawn as Worker threads (for true CPU isolation), pass the callback explicitly in the worker init message instead of relying on AsyncLocalStorage.

### 7. Test Coverage
**Location:** `tests/tools/test_delegate.py` (main), `test_delegate_toolset_scope.py`, `test_delegate_composite_toolsets.py`

**Core test cases:**
- `test_depth_limit()` — rejects spawn at depth >= max_spawn_depth
- `test_strip_blocked_tools()` — verifies blocklist is applied (delegate_task, clarify, memory, send_message, execute_code removed)
- `test_single_task_mode()` — spawns one subagent, captures result
- `test_batch_mode()` — spawns N subagents in parallel, collects results
- `test_requested_toolsets_intersected_with_parent()` — subagent toolsets must be subset of parent toolsets
- `test_empty_intersection_yields_empty_toolsets()` — if subagent requests tools parent doesn't have, empty set is used

**RunnerOS migration:** Mirror these tests in `packages/shared/src/agent/__tests__/spawn-session-isolation.test.ts`.

## RunnerOS Current State
**File:** `packages/shared/src/agent/spawn-session-tool.ts`

Current implementation:
- Defines `spawn_session` tool (SDK-provided tool shape).
- Accepts `prompt`, `model`, `llmConnection`, etc.
- **Missing:** No blocklist enforcement, no approval callback wiring, no depth limits.

## Delta / Action Items

1. **Create `spawn-session-isolation.ts`** (new file):
   - Export `SpawnSessionBlockedTools` constant (frozen set: delegate_task, clarify, memory, send_message, execute_code)
   - Implement `getSubagentApprovalCallback(config)` that reads `delegation.subagent_auto_approve`
   - Implement `subagentAutoDeny()` and `subagentAutoApprove()` callbacks
   - Export `ApprovalCallbackContext` type for AsyncLocalStorage
   - Implement `stripBlockedTools(toolset)` filter

2. **Update spawn-session-tool.ts**:
   - Wrap spawned session initialization in AsyncLocalStorage context
   - Pass approval callback to new subagent
   - Enforce depth limits before spawn

3. **Add config schema** to `src/config/`:
   - `delegation.subagent_auto_approve` (boolean, default false)
   - `delegation.max_spawn_depth` (integer, clamped [1, 3], default 1)

4. **Tests**: Mirror Hermes test cases in a new `__tests__/spawn-session-isolation.test.ts`.

## References
- **Hermes delegate_tool.py:** lines 35–41 (blocklist), 73–97 (callbacks), 103–112 (config), 131–138 (depth), 1492–1500 (ThreadPoolExecutor init)
- **Hermes terminal_tool.py:** lines 237, 257–264 (threading.local pattern)
- **Hermes tests:** `tests/tools/test_delegate.py` (test_depth_limit, test_strip_blocked_tools, test_single_task_mode, test_batch_mode)

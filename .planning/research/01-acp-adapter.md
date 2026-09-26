# Hermes ACP Adapter: Technical Research

## Overview

The Hermes ACP (Agent Client Protocol) adapter is a Python implementation that wraps the Hermes AIAgent and exposes it to ACP clients (e.g., Zed editor) via stdio JSON-RPC transport. The architecture separates concerns into five core modules: server lifecycle, session persistence, event bridging, tool-call mapping, and permission negotiation.

## Transport & Message Framing

**Mechanism**: Stdio-only JSON-RPC (server.py:257, entry.py:15)
- Main entry point calls `asyncio.run(acp.run_agent(agent, use_unstable_protocol=True))`
- Agent inherits from `acp.Agent` (server.py:445)
- All JSON frames go to stdout; human-readable logs route to stderr (entry.py:75-88)
- No WebSocket support; stdio is the sole transport

**Key detail**: Session.py lines 112-120 define `_acp_stderr_print()` to redirect AIAgent's incidental output away from stdout, preserving the protocol-only JSON-RPC stream.

## Session Lifecycle

**States**: create → load/resume → run (prompt) → save → (optionally fork/close)

**Persistence**: SQLite SessionDB at `~/.hermes/state.db` (session.py:415-421)
- `create_session(cwd)` → new UUID + AIAgent, stored in memory + DB (session.py:210-229)
- `get_session(session_id)` → checks memory first; restores from DB if missing (session.py:231-242)
- `fork_session(session_id)` → deep-copy history to new session (session.py:253-281)
- `remove_session()` → delete from memory and DB (session.py:244-251)
- `save_session()` → called after prompt completion to flush in-memory state (session.py:388-398)

**Threading model** (critical for TS port): Each SessionState holds a `threading.Lock` (session.py:181, 224) and `threading.Event` for cancellation (session.py:222). The AIAgent runs in a worker thread (executor with max_workers=4, server.py:84) while the asyncio event loop lives on the main thread. Session state is accessed safely via the lock.

## Event Bridging (Threading Subtlety)

**Problem**: AIAgent runs synchronously in a worker thread; ACP updates (coroutines) live on the main asyncio loop.

**Solution**: `safe_schedule_threadsafe()` (events.py:96-107)
- Worker thread callbacks invoke `asyncio.run_coroutine_threadsafe(conn.session_update(...), loop)`
- Future waits up to 5s for response; logs failures but continues (fire-and-forget semantics)
- Never blocks the agent thread on client acknowledgment

**Callback factories** (events.py):
- `make_tool_progress_cb()` → emits `ToolCallStart` on `event_type=="tool.started"` (lines 134-182)
- `make_step_cb()` → pops tool IDs from FIFO queues per tool name; emits `ToolCallProgress` on completion (lines 223-259)
- `make_thinking_cb()` → streams thinking text (lines 189-202)
- `make_message_cb()` → streams agent response text (lines 266-279)

**Plan updates**: `_build_plan_update_from_todo_result()` (events.py:39-84) translates todo tool results into ACP's native plan entries, mapping todo statuses to {pending, in_progress, completed}.

## Tool-Call Wire Format

**Hermes → ACP mapping** (tools.py:21-56)
- `read_file` → "read" kind
- `write_file`, `patch` → "edit" kind
- `terminal`, `process`, `execute_code` → "execute" kind
- Default → "other" kind

**ToolCallStart structure** (tools.py:1083-1308):
```python
build_tool_start(tool_call_id, tool_name, arguments, edit_diff=None)
  → ToolCallStart(
      id=tool_call_id,
      title=build_tool_title(...),  # "read: <path>", "terminal: <cmd>", etc.
      kind=get_tool_kind(...),
      content=[...],  # structured (diff blocks, text blocks, etc.)
      locations=[ToolCallLocation(path, line)]  # for file operations
    )
```

**ToolCallProgress on completion** (tools.py:1315-1340):
```python
build_tool_complete(tool_call_id, tool_name, result, function_args, snapshot)
  → status="failed" or "completed"
  → content: formatted output (varies by tool: read_file shows fenced text, search_files shows match list, etc.)
```

**Key detail**: Tools in `_POLISHED_TOOLS` (lines 59-78) get special formatting; others fall back to JSON parsing (tools.py:819-869).

## Permission Negotiation

**Two flows**: dangerous-command approval (permissions.py) and file-edit approval (edit_approval.py).

### Dangerous Command Approval (permissions.py)

**Callback** (permissions.py:107-168):
- `make_approval_callback(request_permission_fn, loop, session_id, timeout=60s)` returns sync callback
- Takes `command`, `description`, optional `allow_permanent` kwarg
- Builds ACP `PermissionOption` list (allow_once, allow_session, allow_always, deny, etc.)
- Schedules `conn.request_permission(session_id, tool_call, options)` on main loop via `safe_schedule_threadsafe()`
- Waits up to 60s for response; auto-denies on timeout (line 156)
- Maps `AllowedOutcome.option_id` back to Hermes strings: "once", "session", "always", "deny" (lines 21-27)

**Timeout behavior**: No special default action; timeout = denial (line 155-157).

### File-Edit Approval (edit_approval.py)

**Pre-execution check** (edit_approval.py:181-209):
- Called from tool dispatcher before write_file or patch execution
- Builds `EditProposal` (path, old_text, new_text) from arguments (lines 130-137)
- If requester bound, invokes it; blocks execution if denied (line 209 returns error JSON)

**Auto-approval policy** (edit_approval.py:148-178):
- Policy strings: "ask", "workspace_session", "session"
- "ask" → always prompt (unless sensitive path like .env, .ssh, id_rsa)
- "workspace_session" → auto-approve if file is in cwd or /tmp
- "session" → auto-approve all (except sensitive)
- Sensitive paths always prompt, regardless of policy (line 156)

**Requester** (edit_approval.py:234-286):
- `make_acp_edit_approval_requester(request_permission_fn, loop, session_id, timeout=60s, auto_approve_getter=None)`
- If auto_approve_getter returns (policy, cwd), checks policy first; if approved, logs and returns True (line 251)
- Otherwise schedules `conn.request_permission()` with PermissionOption "allow_once" / "deny" (line 261)
- Waits up to 60s; auto-denies on timeout (line 276)

## Non-Obvious Patterns

### 1. **ContextVar for Edit Approval** (edit_approval.py:37-69)
`_EDIT_APPROVAL_REQUESTER: ContextVar` is thread-safe and session-scoped. Set/reset via `set_edit_approval_requester()` / `reset_edit_approval_requester()`. This isolates CLI/gateway/ACP sessions so only ACP sessions get the guard (edit_approval.py docstring, lines 5-6).

### 2. **FIFO Tool-Call ID Tracking** (events.py:118, 147-154)
Tool call IDs are tracked in a `Dict[str, Deque[str]]` keyed by tool name. Duplicate parallel calls to the same tool get unique IDs but complete in FIFO order (events.py:237-242). This handles tools that are called multiple times in one turn.

### 3. **threading.local in Python → ContextVar in TS**
Any use of `threading.local` (e.g., for editor-specific state) must map to AsyncLocal or ContextVar in TypeScript. The Hermes codebase uses ContextVar for edit approval; watch for similar patterns.

### 4. **WSL Path Translation** (session.py:29-70)
Windows paths like `E:\Projects` from ACP clients are converted to `/mnt/e/projects` when Hermes runs in WSL. This happens transparently in `_translate_acp_cwd()`. The TS port must preserve this if targeting WSL.

### 5. **Tool Result Parsing Leniency** (tools.py:187-202, 205-240)
`_json_loads_maybe()` extracts the first valid JSON object even if human hints follow (e.g., `{...}\n[Hint: truncated]`). Hermes tools often append explanatory text after structured output; the adapter silently strips it (line 199-200).

### 6. **Session Restoration on Restart** (session.py:476-548)
When editor reconnects, `get_session()` restores a session from DB including full conversation history, model, provider, base_url, api_mode. All are stored as JSON in `model_config` column (lines 504-512). Ensure your DB schema supports this.

## Port Mapping: Python → TypeScript

| File | Purpose | TS Mapping |
|------|---------|-----------|
| `server.py` | ACP Agent class, session/model state, command dispatch | `server.ts` – export `HermesACPAgent` class |
| `session.py` | SessionManager, persistence, fork/restore logic | `session.ts` – export `SessionManager` + `SessionState` interface |
| `events.py` | Callback factories for tool/step/thinking/message | `events.ts` – export callback factories |
| `tools.py` | Tool kind mapping, title/content builders, result formatting | `tools.ts` – export mapping + builders; consider breaking out result formatters into separate module |
| `permissions.py` | Dangerous-command approval callback | `permissions.ts` – export `makeApprovalCallback` |
| `edit_approval.py` | Edit proposal + auto-approval policy logic | `edit_approval.ts` – export requester factory + policy check |
| `auth.py` | Provider detection, auth method advertisement | Keep in `server.ts` or separate `auth.ts` |
| `entry.py` | CLI entry, logging setup, env loading | Not needed in TS (handled by RunnerOS harness); keep minimal wrapper if needed |
| `__init__.py` | Package marker | N/A |
| `__main__.py` | CLI bridge | N/A in TS |

### Language-Specific Rethinking

1. **SQLite SessionDB** → Use Drizzle/Prisma or similar; ensure schema matches `model_config` JSON storage.
2. **ThreadPoolExecutor** → Use Node worker threads or async queue; AIAgent (Python CLI) will be spawned as subprocess, so no direct threading needed.
3. **asyncio.run_coroutine_threadsafe()** → Subprocess communication (stdio or IPC); use `child_process.send()` or queue-based message passing.
4. **threading.Lock + Event** → Use Mutex or AsyncLock for session access; events map to conditions.
5. **ContextVar** → Use AsyncLocal or cls-style context if available; ensure edit approval is isolated per session.
6. **logging to stderr** → Ensure all non-JSON output goes to stderr; TS harness should enforce this.

## References by Line

- **Transport**: entry.py:257, server.py:445, entry.py:75-88
- **Session lifecycle**: session.py:210-281, 400-421
- **Threading model**: session.py:181, 224, server.py:84, events.py:96-107
- **Event callbacks**: events.py:114-260
- **Tool format**: tools.py:1083-1340
- **Permissions**: permissions.py:107-168, edit_approval.py:148-286
- **ContextVar**: edit_approval.py:37-69
- **FIFO tracking**: events.py:147-154, 237-242
- **Path translation**: session.py:29-70
- **Result parsing**: tools.py:187-202
- **Restoration**: session.py:476-548

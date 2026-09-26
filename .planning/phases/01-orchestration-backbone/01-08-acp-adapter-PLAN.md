---
phase: 01-orchestration-backbone
plan: 08
type: tdd
wave: 5
depends_on: []
files_modified:
  - packages/shared/src/protocol/acp/types.ts
  - packages/shared/src/protocol/acp/session.ts
  - packages/shared/src/protocol/acp/events.ts
  - packages/shared/src/protocol/acp/tools.ts
  - packages/shared/src/protocol/acp/permissions.ts
  - packages/shared/src/protocol/acp/server.ts
  - packages/shared/src/protocol/acp/index.ts
  - packages/shared/src/protocol/acp/__tests__/server.test.ts
  - packages/shared/src/protocol/acp/__tests__/session-restore.test.ts
  - packages/shared/src/agent/spawn-session-tool.ts
  - packages/shared/src/automations/handlers/acp-spawn-handler.ts
  - packages/shared/src/automations/handlers/index.ts
autonomous: true
requirements: [R8]
must_haves:
  truths:
    - "ACP server runs over stdio JSON-RPC (NOT WebSocket — explicitly out of scope this phase)"
    - "All JSON-RPC frames go to stdout; logs go to stderr"
    - "An ACP client test harness can open a session and receive tool-call + permission notifications"
    - "Sessions persisted in SQLite alongside existing session storage; restart restores in-flight sessions"
    - "spawn-session-tool gains acpEndpoint option; when set, delegates to remote agent and returns its result"
    - "Absent acpEndpoint: spawn-session behavior is identical to today"
    - "automations 'acp-spawn' handler registered"
    - "Edit-approval uses AsyncLocalStorage (ContextVar-equivalent) for per-session isolation"
    - "safeScheduleAcross helper bridges worker-thread agent callbacks → main-loop ACP server"
    - "Permission negotiation: 60s default approval timeout; sensitive paths (.env, .ssh, id_rsa) always prompt regardless of policy"
    - "Tool kind mapping: read_file → 'read', write_file/patch → 'edit', terminal/process/execute_code → 'execute', default → 'other'"
  artifacts:
    - path: "packages/shared/src/protocol/acp/server.ts"
      provides: "stdio JSON-RPC ACP server; HermesACPAgent-equivalent class"
    - path: "packages/shared/src/protocol/acp/session.ts"
      provides: "SessionManager + SQLite persistence + fork/restore"
    - path: "packages/shared/src/protocol/acp/events.ts"
      provides: "Callback factories + safeScheduleAcross"
    - path: "packages/shared/src/protocol/acp/tools.ts"
      provides: "Tool kind mapping + ToolCallStart/Progress builders"
    - path: "packages/shared/src/protocol/acp/permissions.ts"
      provides: "Approval callback factory + edit-approval ContextVar"
    - path: "packages/shared/src/protocol/acp/types.ts"
      provides: "ACP message types (request/response/notification)"
    - path: "packages/shared/src/protocol/acp/index.ts"
      provides: "Public surface"
  key_links:
    - from: "packages/shared/src/agent/spawn-session-tool.ts"
      to: "packages/shared/src/protocol/acp/index.ts"
      via: "acpEndpoint option routes spawn through ACP client instead of local agent"
      pattern: "acpEndpoint"
    - from: "packages/shared/src/automations/handlers/acp-spawn-handler.ts"
      to: "packages/shared/src/protocol/acp/index.ts"
      via: "register acp-spawn action type"
      pattern: "acp-spawn"
---

<objective>
Port Hermes (MIT) ACP adapter (Python `hermes_acp/` package) to TypeScript. RunnerOS becomes an ACP server (stdio JSON-RPC only — WebSocket deferred) so external clients like Zed can use RunnerOS as their agent, AND RunnerOS workflows can delegate to remote ACP agents via `spawn-session-tool({ acpEndpoint })`.

Purpose: Cross-vendor agent orchestration. Workflows can delegate to Zed, Cursor, Claude Desktop, or any ACP-compliant remote agent.

License: Hermes MIT — credited.

Scope: stdio JSON-RPC only. WebSocket explicitly OUT.

This is the biggest plan in the phase. Two tasks are sized at the upper limit of the context budget; if any task balloons, split it further before executing.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-orchestration-backbone/01-SPEC.md
@.planning/research/01-acp-adapter.md
@packages/shared/src/agent/spawn-session-tool.ts
@packages/shared/src/automations/handlers/

<interfaces>
Per research/01-acp-adapter.md:

Transport: stdio. JSON-RPC frames on stdout. Logs on stderr. Use `@modelcontextprotocol/sdk`-style JSON-RPC framing OR roll a minimal stdio JSON-RPC. (Check if RunnerOS already has a JSON-RPC framing util in packages/shared/src/protocol/ — if so, reuse it.)

Session lifecycle: create → load/resume → run(prompt) → save → fork/close.

SQLite session table (mirror Hermes schema):
```sql
CREATE TABLE IF NOT EXISTS acp_sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  history_json TEXT NOT NULL,
  model_config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Tool kind mapping (tools.py:21-56):
- read_file → "read"
- write_file, patch → "edit"
- terminal, process, execute_code → "execute"
- default → "other"

Permission options: allow_once, allow_session, allow_always, deny.

60s default approval timeout; timeout=deny.

Sensitive paths: .env, .ssh, id_rsa — always prompt regardless of auto-approval policy.

AsyncLocalStorage for edit-approval requester (replaces Python ContextVar).

safeScheduleAcross: bridges worker-thread agent callbacks → main-thread ACP server. Implement as a simple message-passing helper (postMessage from Worker, or async queue if not using Worker threads — the simpler choice given Bun/Node interop).

FIFO tool-call ID tracking: Map<toolName, string[]> (queue of pending IDs).

WSL path translation (session.py:29-70) — out of scope for this plan; revisit if Windows users complain.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — server lifecycle + session persistence tests</name>
  <files>packages/shared/src/protocol/acp/__tests__/server.test.ts, packages/shared/src/protocol/acp/__tests__/session-restore.test.ts</files>
  <behavior>
    server.test.ts:
    - Server reads JSON-RPC frames from stdin, writes responses to stdout
    - Client sends `initialize` → receives auth-method advertisement
    - Client sends `session/new` → receives session_id
    - Client sends `session/prompt` with text → receives streaming tool-call notifications
    - Logs never appear on stdout (only JSON frames)

    session-restore.test.ts:
    - Create session, send prompt, kill server mid-flight
    - Restart server with same SQLite file
    - Same session_id can be resumed; conversation history intact

    permissions.test (in server.test.ts):
    - Tool call to write a sensitive path (.env) always triggers permission request even with allow_session set
    - 60s approval timeout → auto-deny
    - allow_once option grants permission for a single call

    tools.test (in server.test.ts):
    - read_file tool call → kind="read"
    - write_file → kind="edit"
    - terminal → kind="execute"
    - unknown_tool → kind="other"
    - FIFO id tracking: two parallel terminal calls get distinct ids and complete in order
  </behavior>
  <action>Create both test files. Build a minimal test harness that spawns the server as a subprocess via child_process.spawn (or in-process via direct module instantiation) and sends JSON-RPC frames over stdio. Run — must fail (modules missing).</action>
  <verify>
    <automated>bun test packages/shared/src/protocol/acp/__tests__/ 2>&1 | grep -q "fail\|cannot find"</automated>
  </verify>
  <done>RED.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement ACP core (types, session, events, tools, permissions, server)</name>
  <files>packages/shared/src/protocol/acp/types.ts, packages/shared/src/protocol/acp/session.ts, packages/shared/src/protocol/acp/events.ts, packages/shared/src/protocol/acp/tools.ts, packages/shared/src/protocol/acp/permissions.ts, packages/shared/src/protocol/acp/server.ts, packages/shared/src/protocol/acp/index.ts</files>
  <action>
    1. **types.ts** — JSON-RPC + ACP message shapes:
       - JsonRpcRequest, JsonRpcResponse, JsonRpcNotification
       - SessionId, ToolCallId, ToolKind = "read" | "edit" | "execute" | "other"
       - ToolCallStart, ToolCallProgress, PermissionOption, PermissionRequest, PermissionResponse
       - EditProposal { path, oldText, newText }
       - AgentPrompt, SessionUpdate

    2. **session.ts** — SessionManager:
       - Constructor takes SQLite Database (bun:sqlite). Schema migration on init.
       - `createSession(cwd): SessionState`
       - `getSession(id): SessionState | null` (memory first, restore from DB if missing)
       - `forkSession(id): SessionState` (deep-copy history to new id)
       - `removeSession(id)` (mem + DB)
       - `saveSession(state)` (flush to DB)
       - In-memory map keyed by session id. Per-session `Mutex` (use `async-mutex` npm or simple Promise-chain). Per-session cancellation signal via AbortController.

    3. **events.ts** — Callback factories:
       - `safeScheduleAcross<T>(fn: () => Promise<T>, timeoutMs = 5000): Promise<T | null>` — runs fn on the main event loop via `setImmediate`; logs + swallows errors (fire-and-forget if caller doesn't await).
       - `makeToolProgressCb(conn, sessionId)` — on tool.started event, sends ToolCallStart notification
       - `makeStepCb(conn, sessionId)` — pops tool IDs FIFO from `Map<string, string[]>`, sends ToolCallProgress
       - `makeThinkingCb(conn, sessionId)` — streams thinking text via session_update
       - `makeMessageCb(conn, sessionId)` — streams agent message text
       - Plan-update translation from todo tool: `buildPlanUpdateFromTodoResult`

    4. **tools.ts** — Tool kind mapping + builders:
       - `getToolKind(name): ToolKind` — read_file→read, write_file/patch→edit, terminal/process/execute_code→execute, default→other
       - `buildToolStart(id, name, args, editDiff?)` — returns ToolCallStart
       - `buildToolComplete(id, name, result, args, snapshot)` — returns ToolCallProgress with status completed/failed
       - `buildToolTitle(name, args)` — "read: /path", "terminal: $cmd", etc.
       - `jsonLoadsMaybe(s): unknown` — extract first valid JSON object even if trailing text (matches Hermes leniency)

    5. **permissions.ts** — Approval flows:
       - `makeApprovalCallback(requestPermissionFn, sessionId, timeoutMs = 60_000)` — returns sync-ish callback for dangerous commands. Internally uses safeScheduleAcross + Promise.race(approval, timeout). Timeout = deny.
       - `editApprovalStorage = new AsyncLocalStorage<EditApprovalRequester>()` — session-scoped requester.
       - `setEditApprovalRequester(req, fn)` / `resetEditApprovalRequester()` helpers.
       - `makeAcpEditApprovalRequester(requestPermissionFn, sessionId, timeoutMs = 60_000, autoApprovePolicy)` — pre-execution check; sensitive paths (`.env`, `.ssh`, `id_rsa`) always prompt regardless of policy.
       - `isSensitivePath(path): boolean` — matches the three named patterns.
       - Permission options: allow_once, allow_session, allow_always, deny.

    6. **server.ts** — HermesACPAgent-equivalent class:
       - `class RunnerOSACPAgent` with methods for each ACP RPC: `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/fork`.
       - JSON-RPC framing: line-delimited JSON over stdin/stdout (or LSP-style Content-Length headers if the ACP spec requires — check Zed's ACP spec; default to line-delimited for simplicity, document the choice).
       - All `console.log` MUST be redirected: implement `acpStderrPrint(msg)` and override the logger in this module's scope so incidental output never leaks to stdout. Wrap `console.log` to route to stderr inside the server scope.
       - SQLite-backed SessionManager from session.ts.
       - On each prompt: spawn the AIAgent equivalent (call into existing RunnerOS agent runner) in a worker thread or async-detached context; wire callbacks via events.ts; safeScheduleAcross to bridge.
       - Auth advertisement: detect available providers (anthropic, openai, etc.) at startup; respond to `initialize` with the list.

    7. **index.ts** — Public re-exports.

    8. Header comment in every file: "Ported from Hermes hermes_acp/ (MIT). See research/01-acp-adapter.md."

    9. Run unit tests — must pass.
  </action>
  <verify>
    <automated>bun test packages/shared/src/protocol/acp/__tests__/server.test.ts packages/shared/src/protocol/acp/__tests__/session-restore.test.ts && bun run typecheck:all</automated>
  </verify>
  <done>ACP server passes test harness; session restore works across restart; tool kind + permission tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire acpEndpoint into spawn-session-tool + acp-spawn handler</name>
  <files>packages/shared/src/agent/spawn-session-tool.ts, packages/shared/src/automations/handlers/acp-spawn-handler.ts, packages/shared/src/automations/handlers/index.ts, packages/shared/src/protocol/acp/__tests__/server.test.ts</files>
  <behavior>
    - spawn-session-tool accepts new optional `acpEndpoint?: string` (path to a remote ACP server binary or "host:port" — for stdio we'll treat the endpoint as a subprocess command line)
    - When acpEndpoint set: spawn the remote ACP agent as a subprocess, open a session via JSON-RPC over stdio, send the prompt, stream tool calls back to the parent, return the final result
    - When acpEndpoint absent: behavior unchanged (existing local spawn path)
    - The acp-spawn automation handler routes "acp-spawn" action type to this same client path
    - Test: workflow with acpEndpoint set runs against a mock ACP server (the test harness server we built in task 1) and gets back a result
    - Test: workflow without acpEndpoint hits the existing spawn path (no regression)
  </behavior>
  <action>
    1. In `spawn-session-tool.ts`: add `acpEndpoint?: string` to the spawn config. Branch: if set, instantiate an ACP client (new minimal client module in `packages/shared/src/protocol/acp/client.ts` if needed — or inline a small client into spawn-session-tool, but the cleaner choice is `client.ts`). The client spawns the endpoint command as a child subprocess, exchanges JSON-RPC frames, and yields tool-call events to the caller.
    2. Create `packages/shared/src/protocol/acp/client.ts` (if not folded into server.ts):
       - `class ACPClient { open(endpoint: string): Promise<void>; createSession(cwd): Promise<SessionId>; prompt(sessionId, text): AsyncIterable<SessionUpdate>; close(): Promise<void> }`
    3. Create `packages/shared/src/automations/handlers/acp-spawn-handler.ts`: register an automation action type that takes `{ acpEndpoint, prompt, cwd }` config and calls ACPClient.
    4. Register in `handlers/index.ts` under action type "acp-spawn".
    5. Add integration test: spin up the RunnerOSACPAgent (server) on a stdio pipe pair (in-process); have ACPClient connect to it; send prompt; assert events flow.
    6. Validate fully: `bun test && bun run typecheck:all && bun run lint`.
  </action>
  <verify>
    <automated>bun test packages/shared/src/protocol/acp/ packages/shared/src/agent/ packages/shared/src/automations/ && bun run typecheck:all && bun run lint</automated>
  </verify>
  <done>spawn-session-tool with acpEndpoint delegates to remote; acp-spawn handler registered; end-to-end test green.</done>
</task>

</tasks>

<verification>
- stdio JSON-RPC framing correct
- All logs on stderr; only JSON frames on stdout
- Session restore across restart works (SQLite-backed)
- Tool kind mapping per Hermes table
- Sensitive-path edit approval always prompts
- 60s permission timeout = deny
- AsyncLocalStorage isolates edit-approval per session
- spawn-session-tool acpEndpoint delegates correctly
- acp-spawn handler registered
- Existing spawn behavior unchanged when acpEndpoint absent
</verification>

<success_criteria>
A simulated Zed client (test harness) connects to the RunnerOS ACP stdio server, opens a session, sends a prompt, and receives tool-call notifications. A RunnerOS workflow with `acpEndpoint` set delegates to a remote ACP agent and returns its result. SQLite-restore survives server restart.
</success_criteria>

<output>
After completion, create `.planning/phases/01-orchestration-backbone/01-08-SUMMARY.md`.
</output>

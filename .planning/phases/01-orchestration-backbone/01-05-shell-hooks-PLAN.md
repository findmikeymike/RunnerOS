---
phase: 01-orchestration-backbone
plan: 05
type: tdd
wave: 3
depends_on: []
files_modified:
  - packages/shared/src/automations/hooks/types.ts
  - packages/shared/src/automations/hooks/allowlist-store.ts
  - packages/shared/src/automations/hooks/consent.ts
  - packages/shared/src/automations/hooks/shell-hook-runner.ts
  - packages/shared/src/automations/hooks/__tests__/shell-hook-runner.test.ts
  - packages/shared/src/automations/handlers/shell-hook-handler.ts
  - packages/shared/src/automations/handlers/index.ts
autonomous: true
requirements: [R6]
must_haves:
  truths:
    - "shell-hook-runner spawns commands via child_process.spawn with shell:false (NEVER shell:true)"
    - "Command argv is built via shlex-equivalent parser (no shell interpreter involved)"
    - "First registration of an unknown command triggers a consent prompt at TTY"
    - "Second registration of same command + mtime hash is silent (allowlisted)"
    - "Non-TTY caller without accept_hooks=true is rejected"
    - "Hook stdin receives standardized JSON {hook_event_name, tool_name, tool_input, session_id, cwd, extra}"
    - "Hook returning {decision: 'block', reason: '...'} halts the tool call and surfaces reason"
    - "Hook returning {action: 'block', message: '...'} is normalized to the same internal shape"
    - "Hook returning {context: '...'} injects context for pre_llm_call events"
    - "Allowlist stored at ~/.runneros/shell-hooks-allowlist.json with cross-process file lock"
    - "Default timeout 60s, max clamped at 300s, override per-hook"
    - "shell-hook handler registered in automations handler registry"
  artifacts:
    - path: "packages/shared/src/automations/hooks/types.ts"
      provides: "HookEvent, HookResponse, HookSpec types"
    - path: "packages/shared/src/automations/hooks/allowlist-store.ts"
      provides: "Allowlist read/write with mtime hash + flock"
    - path: "packages/shared/src/automations/hooks/consent.ts"
      provides: "First-use approval gate (TTY prompt + accept_hooks bypass)"
    - path: "packages/shared/src/automations/hooks/shell-hook-runner.ts"
      provides: "shlex.split-equivalent + spawn + JSON stdin/stdout + timeout"
    - path: "packages/shared/src/automations/handlers/shell-hook-handler.ts"
      provides: "Handler registered with automations registry"
  key_links:
    - from: "packages/shared/src/automations/handlers/index.ts"
      to: "packages/shared/src/automations/handlers/shell-hook-handler.ts"
      via: "register shell-hook action handler"
      pattern: "shell-hook"
---

<objective>
Port Hermes (MIT) shell hook system from `agent/shell_hooks.py` to TypeScript. Polyglot extension: users drop in Python/bash/anything-with-an-interpreter as JSON stdin/stdout hook scripts. Compatible with Claude Code canonical (`{decision, reason}`) AND Hermes canonical (`{action, message}`) response shapes plus `{context}` injection.

Purpose: Unlock user customization without forcing TypeScript handlers. Bash/Python hooks for blocking dangerous commands, injecting context, validating tool calls.

License: Hermes MIT — credit (already added in plan 01).

Safety: shell:false ALWAYS. shlex-equivalent argv parsing. First-use consent gate via allowlist.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-orchestration-backbone/01-SPEC.md
@.planning/research/03-hooks-prompt-cron.md
@packages/shared/src/automations/handlers/

<interfaces>
Per research/03-hooks-prompt-cron.md (Hermes shell_hooks.py):

stdin shape:
```
{
  "hook_event_name": "pre_tool_call" | "post_tool_call" | "pre_llm_call" | ...,
  "tool_name": string,
  "tool_input": object,
  "session_id": string,
  "cwd": string,
  "extra": object
}
```

stdout shapes (accept both, normalize to internal):
- Claude Code: `{"decision": "block" | "allow", "reason"?: string}`
- Hermes: `{"action": "block" | "allow", "message"?: string}`
- Context inject: `{"context": "..."}`

Internal normalized shape:
```ts
type HookResponse =
  | { action: "block"; message?: string }
  | { action: "allow"; message?: string }
  | { context: string };
```

Allowlist file: ~/.runneros/shell-hooks-allowlist.json
Each entry: { event, command, registeredAt, scriptMtimeHash }

shlex equivalent: use `shell-quote` npm package's `parse` function, OR implement minimal POSIX-style splitter (whitespace + quoted segments). Cross-platform: shell-quote works on Win.

Timeouts: DEFAULT_TIMEOUT_SECONDS=60, MAX_TIMEOUT_SECONDS=300.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — types + allowlist + consent tests</name>
  <files>packages/shared/src/automations/hooks/__tests__/shell-hook-runner.test.ts</files>
  <behavior>
    - HookResponse normalization: {decision:"block", reason:"x"} → {action:"block", message:"x"}
    - HookResponse normalization: {action:"block", message:"y"} unchanged
    - HookResponse normalization: {context:"z"} → {context:"z"}
    - Invalid stdout (not JSON, or unknown shape) → treated as allow + warning logged
    - Allowlist round-trip: write entry, read back; mtime hash matches
    - First-use TTY: prompt shown, user types "y", entry written
    - First-use non-TTY + accept_hooks=false → throws/rejects
    - First-use non-TTY + accept_hooks=true → silently approves and writes entry
    - Second use of allowlisted command with same mtime hash → silent (no prompt)
    - Second use with mtime mismatch → re-prompt (script changed)
    - shlex parse: 'echo "hello world"' → ["echo", "hello world"]; never invokes a shell
    - Runner: spawn echo, send JSON stdin, capture {action:"allow"} stdout, return normalized
    - Runner: timeout 100ms on a sleep-1s hook → returns timeout response, child killed
    - Runner: hook exits non-zero → captured as warning, treated as allow (don't break the workflow on hook bugs)
    - Runner: shell:true is NEVER used (assertion via spying on spawn options)
  </behavior>
  <action>Create the test file. Use `os.tmpdir()` for allowlist isolation. Mock TTY via `process.stdin.isTTY` override or a TTY-detector injection. Use real `spawn` with `node -e "..."` or `bash -c` fixtures (where bash available — fall back to `node -e` for cross-platform). Run — must fail (modules missing).</action>
  <verify>
    <automated>bun test packages/shared/src/automations/hooks/__tests__/shell-hook-runner.test.ts 2>&1 | grep -q "fail\|cannot find module"</automated>
  </verify>
  <done>RED state.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement types, allowlist-store, consent, shell-hook-runner</name>
  <files>packages/shared/src/automations/hooks/types.ts, packages/shared/src/automations/hooks/allowlist-store.ts, packages/shared/src/automations/hooks/consent.ts, packages/shared/src/automations/hooks/shell-hook-runner.ts, package.json</files>
  <action>
    1. Add deps: `bun add shell-quote proper-lockfile` (proper-lockfile for cross-platform file lock; shell-quote for shlex parse).

    2. Create `types.ts`:
       ```ts
       export interface HookEvent { hook_event_name: string; tool_name?: string; tool_input?: unknown; session_id: string; cwd: string; extra?: unknown }
       export type HookResponse =
         | { action: "block"; message?: string }
         | { action: "allow"; message?: string }
         | { context: string };
       export interface HookSpec { command: string; event: string; timeoutMs?: number }
       export interface AllowlistEntry { event: string; command: string; registeredAt: number; scriptMtimeHash: string }
       ```

    3. Create `allowlist-store.ts`:
       - `getAllowlistPath()` → `~/.runneros/shell-hooks-allowlist.json`
       - `readAllowlist(): Promise<AllowlistEntry[]>` (with proper-lockfile shared lock)
       - `addAllowlistEntry(entry)` (exclusive lock)
       - `findEntry(event, command, mtimeHash): AllowlistEntry | null`
       - `computeScriptMtimeHash(commandArgv0): Promise<string>` — fs.stat on the executable path, hash mtime + size
       - Auto-create ~/.runneros/ directory if missing

    4. Create `consent.ts`:
       - `requestConsent(spec, opts: { acceptHooks?: boolean; isTTY?: boolean }): Promise<boolean>`
       - If existing allowlist entry matches command + mtime → return true silently
       - If not TTY and !acceptHooks → throw `HookConsentRequired` (typed error)
       - If not TTY and acceptHooks → auto-approve, write entry
       - If TTY → prompt `[shell-hook] Allow '${command}' for event '${event}'? [y/N]`, read stdin line, "y"/"yes" → approve + write

    5. Create `shell-hook-runner.ts`:
       - `runShellHook(spec: HookSpec, payload: HookEvent, opts): Promise<HookResponse>`
       - Step 1: `parse` command via `shell-quote` → argv array (strings only — reject substitution tokens like $VAR, `cmd`, etc. for safety)
       - Step 2: Call `requestConsent` (throws or returns true)
       - Step 3: `spawn(argv[0], argv.slice(1), { shell: false, stdio: ['pipe','pipe','pipe'] })` — explicit `shell: false`
       - Step 4: Write JSON payload to child.stdin, end()
       - Step 5: Collect stdout, with timeout (default 60s, clamped to [1, 300]s)
       - Step 6: Parse stdout JSON; normalize Claude Code shape → Hermes shape; if unparseable, log + return `{action:"allow"}`
       - Step 7: On timeout: kill child, log, return `{action: "allow", message: "hook timeout"}` (fail-open on infra errors; fail-closed only on explicit block decisions)

    6. Header comment: ported from Hermes (MIT) per research/03.

    7. Run tests — pass.
  </action>
  <verify>
    <automated>bun test packages/shared/src/automations/hooks/__tests__/shell-hook-runner.test.ts && bun run typecheck:all</automated>
  </verify>
  <done>All 4 hook modules green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Register shell-hook handler in automations registry</name>
  <files>packages/shared/src/automations/handlers/shell-hook-handler.ts, packages/shared/src/automations/handlers/index.ts, packages/shared/src/automations/hooks/__tests__/shell-hook-runner.test.ts</files>
  <behavior>
    - Automation DSL with action type "shell-hook" routes to shell-hook-handler
    - Handler takes hook spec from action config, builds HookEvent payload from automation context, calls runShellHook
    - On {action: "block"} → automation step aborts with the message visible to caller
    - On {action: "allow"} → automation step proceeds
    - On {context} → context is attached to next step's prompt assembly
  </behavior>
  <action>
    1. Read `packages/shared/src/automations/handlers/index.ts` to understand the handler-registration pattern (mirroring prompt-handler.ts, webhook-handler.ts, event-log-handler.ts).
    2. Create `shell-hook-handler.ts` following the same shape: export a handler that receives the automation action config + execution context, builds the HookEvent, calls runShellHook, returns the normalized outcome.
    3. Register in handlers/index.ts under action type "shell-hook".
    4. Add integration test asserting the handler is wired and routes correctly.
    5. Run full validation.
  </action>
  <verify>
    <automated>bun test packages/shared/src/automations/ && bun run typecheck:all && bun run lint</automated>
  </verify>
  <done>shell-hook action handler registered and integration-tested.</done>
</task>

</tasks>

<verification>
- shell:false enforced (assert via spawn-spy)
- shlex parsing rejects shell metacharacters in argv0
- Consent + allowlist round-trip
- Both response shapes normalized
- Context injection works
</verification>

<success_criteria>
A user can drop a `~/.runneros/hooks/check.sh` script, reference it in an automation as `action: shell-hook, command: ~/.runneros/hooks/check.sh, event: pre_tool_call`. First run prompts for consent, subsequent runs are silent. Script returning `{"decision":"block","reason":"forbidden"}` halts the tool call.
</success_criteria>

<output>
After completion, create `.planning/phases/01-orchestration-backbone/01-05-SUMMARY.md`.
</output>

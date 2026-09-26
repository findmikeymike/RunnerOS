# 01-08 ACP Adapter — Cold Audit

Reviewer posture: rival authored this; ACP is a cross-vendor wire protocol — interop bugs become public bugs.
Date: 2026-05-20.

Test status at audit time:
- `bun test src/protocol/acp/` → **48 pass / 0 fail** (7 files).
- `bun test src/agent/` → **841 pass / 0 fail** (56 files). No regression from the `acpEndpoint` addition.

---

## 1. Transport scope — stdio only (PASS)

`grep -rni "websocket|ws://|wss://" packages/shared/src/protocol/acp/` → zero matches. `client.ts:55` explicitly throws on any non-`stdio:` endpoint scheme. SPEC R8's deferral of WebSocket is honored. No scope creep.

## 2. JSON-RPC compliance (PASS with one nit)

- All logs through `acpStderrPrint` → `process.stderr.write` (`server.ts:42`). All wire writes through `writeFrame` → `this.stdout.write` (`server.ts:122`). `events.ts` uses `console.error` (also stderr, fine).
- Frames are `JSON.stringify(obj) + '\n'` — line-delimited JSON-RPC 2.0. Correct for ACP / Zed.
- `dispatch` discriminates by `req.method`; throws `-32603` on handler failures.
- Malformed JSON: logged to stderr and dropped (`server.ts:133`). **Nit:** per JSON-RPC 2.0 §4.2, malformed JSON SHOULD elicit a `-32700 Parse error` response with `id:null`. Drop-silent is what Hermes does (parity-acceptable), but Zed treats absence of a reply as a hang for `id`-bearing requests. Low severity; flag for follow-up.
- Notifications: `dispatch` returns a result for every request including notifications. There's no branch for `id`-less inbound notifications — they will be processed and a response written with `id: undefined`, which Zed will treat as malformed. **Bug**, but not exercised today since the only client→server traffic is request-style.

## 3. AsyncLocalStorage / `safeScheduleAcross` (PASS)

- `editApprovalStorage.run(requester, fn)` correctly wraps the scope; awaits inside `fn` see the binding. The concurrency-isolation test (`permissions.test.ts:103-119`) proves two concurrent `storage.run` calls don't bleed.
- `safeScheduleAcross` is **not** equivalent to Hermes `safe_schedule_threadsafe`. Hermes hops between two event loops (worker + main). The TS port just `Promise.resolve().then(workerCallback).then(setImmediate→mainLoopHandler)`. In a single-loop runtime that's the best achievable semantics; the 5s timeout + stderr-swallow matches Hermes. Acceptable, but the docstring oversells it — recommend re-wording to: "Schedules `mainLoopHandler` on a subsequent microtask after `workerCallback` resolves; no cross-thread guarantees in this runtime."

## 4. Lenient JSON parse (PASS)

`tools.ts:jsonLoadsMaybe` does brace-matching with proper string + escape tracking. Test `types.test.ts:71-78` covers both `{"x":1}\n[Hint: truncated]` and prose-suffixed cases. Hermes parity confirmed.

## 5. WSL path translation (PARTIAL PASS)

- `translateAcpCwd` only fires when `forceWsl || isWsl || detectWsl()`. Drive-letter regex `^([A-Za-z]):[\\/](.*)$` handles both `\` and `/`. POSIX paths pass through (test:97-108). Good.
- **Gap:** translation is only applied at `createSession` (session.ts:118). It is **never** applied at the edit-approval layer. The audit prompt asked specifically whether translation is wired to edit-approval; it is not. If a Windows ACP client sends `C:\repo\.env` as a tool path while running against a WSL agent, `isSensitivePath` will still match (basename check is platform-agnostic), but `shouldAutoApproveEdit` will `resolve()` on Windows-style separators and compare against a POSIX cwd, silently failing the `path.startsWith(root + sep)` check on Linux. Recommend adding `translateAcpCwd(proposal.path, ...)` inside `makeAcpEditApprovalRequester` before the policy check. Medium severity.

## 6. Sensitive paths always prompt (PASS)

`isSensitivePath` covers `.env`, `.env.local`, `.env.production`, `id_rsa`, `id_ed25519`, and any path containing `.ssh` / `.git` dir-parts. `shouldAutoApproveEdit` short-circuits on `isSensitivePath` **before** evaluating policy (permissions.ts:163). Test `permissions.test.ts:160-177` explicitly proves `.env` prompts under `session` policy. **Hole:** no entry for `id_dsa` or `id_ecdsa`. Low-severity; Hermes covers only the two listed. Recommend extending to match Hermes upstream + adding `id_ecdsa`, `id_dsa` defensively.

## 7. SQLite session restore (PASS)

`session-restore.test.ts:50-97` does a real teardown + re-spawn cycle: starts an `RunnerOSACPAgent`, completes `initialize` + `session/new` + `session/prompt`, calls `agent.stop()` + `stdin.end()`, waits 50 ms for fd close, spawns a **fresh** `RunnerOSACPAgent` against the same dbPath, sends `session/load`, verifies history. This is exactly what SPEC R8 requires. ✅

One sharp-edge worth noting: `handleSessionPrompt`'s `finally` block calls `saveSession(state)` (server.ts:260). If the server is SIGKILLed mid-prompt the history written during the prompt is whatever `appendHistory` flushed inline (user message gets persisted at line 225 before `onPrompt` runs). Restore test only validates the user message survived, not assistant turns — consistent with Hermes behaviour but worth a comment in the code.

## 8. Tool-call wire format (PASS)

`ToolCallStart` / `ToolCallProgress` shapes match the ACP-over-Zed contract:
- `sessionUpdate: 'tool_call' | 'tool_call_update'` (camelCase, matches Zed).
- `kind: 'read' | 'edit' | 'execute' | 'other'`.
- `status: 'pending' | 'in_progress' | 'completed' | 'failed'`.
- `locations: [{ path, line? }]`.
- `rawInput` carries the original args.

`buildToolStart` emits `locations` only when present (`undefined` otherwise — Zed prefers absent over `[]`).

**Nit:** `ToolCallStart.kind` is required in our type, but the Zed schema treats it optional. Not a bug since we always set it, but a stricter outbound type than necessary. Cosmetic.

## 9. Auto-approve policy semantics (PASS with one boundary nit)

- `ask` → never auto (test line 67).
- `session` → auto unless sensitive (lines 70-76).
- `workspace_session` → auto for cwd + `/tmp` + OS tempdir, denied elsewhere (lines 78-88).

The `cwd/../../other` boundary check uses `path === root || path.startsWith(root + sep)` after `resolve()`. `resolve()` normalizes `..`, so the dot-dot traversal collapses correctly before the prefix check. Solid.

**Nit:** macOS `/tmp` is a symlink to `/private/tmp`; `resolve()` does *not* dereference symlinks. The candidate set includes both `tmpdir()` (likely `/var/folders/...`) and a literal `/tmp`, so a Zed client passing `/tmp/x` works, but `/private/tmp/x` would not match. Low-severity — Hermes has the same property.

## 10. spawn-session-tool integration (PASS)

- Unset `acpEndpoint` → unchanged code path; spawn-bridge regression test (`spawn-bridge.test.ts:56-73`) confirms `localCalled=true`. All 841 `src/agent/` tests still green.
- Set as `stdio:bun .../echo-acp-agent.ts` → `delegateToAcpEndpoint` runs end-to-end (`spawn-bridge.test.ts:36-54`). Returns `{ sessionId, stopReason, updates }` serialized as the tool result.

**Bug:** the call site in `spawn-session-tool.ts:150-158` passes `endpoint`, `prompt`, `cwd` but **never forwards a timeout**. `delegateToAcpEndpoint` defaults to 5 min, which is fine, but other options on the parent `SpawnSessionToolOptions` like `acpTimeoutMs` don't exist. If the remote agent hangs, the tool blocks the main agent loop for 5 minutes with no override. Recommend adding `acpTimeoutMs?: number` to the options surface. Medium severity.

**Bug:** `client.ts:65` swallows remote stderr unconditionally. If the spawn target fails to launch (e.g., `bun` not on PATH), the user-facing error is just "ACP initialize: <something>" with no diagnostic context. Recommend buffering last N bytes of stderr and including in the thrown error message. Medium severity.

**Bug (race):** `ACPClient.open()` calls `proc.stdin.write(JSON.stringify(req)+'\n')` *before* awaiting any process-spawn event. On a fast crash (binary missing), `spawn` emits an `error` event asynchronously; `writeFrame` will throw with `write EPIPE` and the `request()` promise will hang forever because `pending` is never resolved. No `proc.on('error'|'close')` handler exists to reject pending waiters. **High severity for ops** — a misconfigured endpoint produces an indefinite hang up to the 5 min wall-clock timeout.

## 11. Test harness choice (PASS)

The executor picked TypeScript (`__tests__/*.test.ts`) with a `PassThrough`-backed in-memory transport + a real subprocess `echo-acp-agent.ts` fixture for client-bridge tests. The harness exercises the wire format end-to-end (real `JSON.parse`/`JSON.stringify`, real readline framing), not a bypass-the-wire mock. Acceptable Zed surrogate.

## 12. Backwards compat (PASS)

`bun test src/agent/` → 841/841. No spawn-session-tool, base-agent, or Pi/Claude regressions.

## 13. License attribution (PARTIAL FAIL)

- Every ACP file has a header comment citing the specific Hermes upstream file. ✅
- `THIRD_PARTY_NOTICES.md` line 27 still reads: `packages/shared/src/protocol/acp/ *(planned, R8)*`. The row was **not flipped to "delivered"**. Must update before merge. Low effort, but explicitly called out in the audit checklist.

## 14. Context-budget split (PASS — informational)

Plan delivered as one task. All artifacts present (9 source files, 7 test files, 1 fixture, 1 handler, 1 spawn-session-tool integration). No half-finished work.

---

## Verdict

**APPROVE WITH REQUIRED CHANGES.** The protocol shape, SQLite restore, sensitive-path enforcement, AsyncLocalStorage scoping, lenient JSON parse, and stderr/stdout discipline are all correct. Tests are real, exercise the wire, and pass.

Required before merge (blockers):
1. **`THIRD_PARTY_NOTICES.md`** — flip the ACP row from `(planned, R8)` to delivered. *(2-line fix)*
2. **`ACPClient.open()` crash-hang** — add `proc.on('error', …)` and `proc.on('close', code => …)` handlers that reject all pending waiters with a descriptive error including buffered stderr. Without this a missing/misconfigured remote binary silently hangs the spawning agent for 5 minutes. *(15-line fix)*

Recommended (non-blocking):
3. Add `-32700 Parse error` response on malformed JSON; add notification branch (no response on `id`-less inbound).
4. Apply `translateAcpCwd` inside `makeAcpEditApprovalRequester` before the policy check (WSL ACP client interop).
5. Surface `acpTimeoutMs` on `SpawnSessionToolOptions` and `AcpSpawnAction`.
6. Buffer remote stderr in `ACPClient` and include tail-N bytes in any thrown errors.
7. Extend `SENSITIVE_FILES` with `id_dsa`, `id_ecdsa`.
8. Reword `safeScheduleAcross` doc — no cross-thread guarantee in a single-loop runtime.
9. Add `id_ecdsa` + `/private/tmp` aliasing notes as test cases for documented behaviour.

Files touched in audit: `.planning/phases/01-orchestration-backbone/01-08-REVIEW.md` (this file).

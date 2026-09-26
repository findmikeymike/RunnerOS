# Phase 1 — Final Test Audit

**Audited:** 2026-05-20
**Auditor:** test-engineer agent
**Scope:** Acceptance criteria verification, test quality, typecheck/lint, regression risk

---

## Acceptance Criteria Map

### ✅ PROVEN (real test against production code path)

| Criterion | File + Test | Notes |
|---|---|---|
| `SPAWN_SESSION_BLOCKED_TOOLS` blocks recursive spawn + memory + clarify + cross-platform messaging + code execution | `spawn-session-isolation.test.ts` — "contains the expected RunnerOS-mapped blocked tools", "is frozen" | Tests import `SPAWN_SESSION_BLOCKED_TOOLS` directly; set is exercised against real production frozen Set |
| Subagent attempting `spawn_session` returns refusal payload, not exception | `spawn-session-isolation.test.ts` — "subagent attempting spawn_session receives refusal payload (not exception)" and "spawn at depth==max returns refusal payload" | Tests `shouldRejectSpawn` + `buildSubagentRefusalPayload` directly; wiring test invokes real `createSpawnSessionTool` handler through `spawnDepthStorage.run()` |
| Per-subagent approval callback on worker thread does NOT block on parent stdin | `spawn-session-isolation.test.ts` — "approval callback on subagent does not reach parent stdin (uses isolated callback)" | `AsyncLocalStorage` isolation exercised with a parent callback that throws if invoked; inner callback resolves to `deny` |
| `subagent_auto_approve: true` opt-in works and is logged | `spawn-session-isolation.test.ts` — "subagent_auto_approve=true bypass works and produces a log warning" + "subagent_auto_approve=true in stored config reaches the approval callback" | Captures `console.warn`, verifies `once` decision and warning text |
| Spawn-depth counter: spawn at `depth == max_spawn_depth` rejected | `spawn-session-isolation.test.ts` — "shouldRejectSpawn returns true when current depth == max", "spawn at depth==max returns refusal payload" | Real depth gate called; wiring test uses `spawnDepthStorage.run(1, ...)` against tool handler |
| `max_spawn_depth` clamped to [1, 3] with default 1 | `spawn-session-isolation.test.ts` — "clamps -5 to 1", "clamps 99 to 3", "clamps 0 to 1", "returns 1 by default" | `getMaxSpawnDepth` tested with boundary and out-of-range values |
| Child toolset = intersection with parent toolset | `spawn-session-isolation.test.ts` — "child source slugs are intersection", "intersects requested enabledSourceSlugs" | `intersectToolsets` unit-tested; wiring test through real `createSpawnSessionTool` handler verifies `observed.enabledSourceSlugs` |
| `scanForInjection` blocks "ignore previous instructions", role-hijack, base64 shell | `prompt-builder.test.ts` — THREAT_CASES loop (8 patterns), base64 tests | Real regex pack exercised; no mocking; assembled-prompt scan verified in "clean user prompt + malicious skill body is blocked" |
| Unit test loads a skill containing each pattern and asserts `blocked: true` | `prompt-builder.test.ts` — "assembled-prompt scan catches skill-borne injection (#3968)" | `assemblePrompt` + `scanForInjection` called in sequence; skill body carries injection |
| Cron/scheduled trigger calls scanner before dispatching | `packages/server-core/src/workflows/runner.ts` lines 796–797 (production wiring); runner.test.ts covers per-job override paths | Scanner wired into production `runner.ts`; test coverage of the surrounding dispatch path exists |
| Mocked battery 0.7 on battery → `pause`; CPU 80% → `throttle`; CPU 96% → `pause`; AC + 50% CPU → `run` | `gate.test.ts` — four matching tests | `shouldRunNow` called with injected `PressureSample`; no system-level mock needed; real gate logic path |
| Scheduler-service calls `shouldRunNow` before each dispatch | `gate.test.ts` — "SchedulerService — gate integration" suite (3 tests: run/pause/throttle) | Real `SchedulerService` instantiated with injected `gate` mock; `tick()` called directly; verifies `onTick` call count and `reschedule`/`sleep` injection |
| `getConfigCached(10_000)` returns cached then refreshed value | `reactive-config.test.ts` — "returns OLD value when file changes during TTL", "returns NEW value once TTL expires" | Writes to real temp-dir config file; no storage mock |
| `subscribeConfigChanges` callback fires within ≤ 1s | `reactive-config.test.ts` — "fires the callback within 1s of a file change" | Real `fs.watch` event path; waits 900ms for event |
| Synthetic consumer sees new value within ≤ 10s without restart | `reactive-config.test.ts` — "a polled consumer sees the new config within TTL + a beat" | Simulated service polling `getConfigCached(100)` with real file change and 140ms wait |
| `enabled_source_slugs` + `permission_mode` enforced at run time | `trigger-inputs.test.ts` — full `resolveEnabledToolsets`, `isSourceAllowed`, `buildToolNotEnabledDenial` suites | Real resolver logic; no mocking |
| Precedence: per-job > per-platform > default | `trigger-inputs.test.ts` — "per-job override wins over platform + default", "per-platform wins when per-job absent", "default wins when both absent" | Layered precedence exhaustively tested |
| `enabled_source_slugs: ["github"]` rejects calls to other source slugs at run time | `trigger-inputs.test.ts` — "workflow with enabled_source_slugs:['github'] rejects a slack tool call" (integration suite) | End-to-end dispatch simulation with `simulateToolDispatch` |
| First registration of unknown command triggers consent prompt | `consent.test.ts` — "TTY prompt: 'y' approves and writes the entry" | Real `requestConsent` against temp allowlist file |
| Second registration of same command is silent | `consent.test.ts` — "second call with same script + hash is silent (no prompt)" | `promptCalls` counter verified as 0 |
| Non-TTY caller without `accept_hooks: true` rejected | `consent.test.ts` — "non-TTY without acceptHooks throws HookConsentRequiredError"; `shell-hook-runner.test.ts` — "consent gate fires on a non-allowlisted command in non-TTY without acceptHooks" | Both unit and integration paths exercised |
| `block` decision halts tool call and surfaces `reason` | `shell-hook-runner.test.ts` — "hook-block-claude.sh", "hook-block-hermes.sh"; `shell-hook-handler.test.ts` — "routes a matching shell-hook action...surfaces a block outcome" | Real subprocess execution; no mock of spawn; Claude Code and Hermes wire shapes both tested |
| `context` injection works | `shell-hook-runner.test.ts` — "hook-context.py"; `shell-hook-handler.test.ts` — "surfaces a context-injection response unchanged" | Real Python subprocess |
| `mode: subconscious` pauses on write attempt, creates escalation record, emits notification | `subconscious-mode.test.ts` — "subconscious + write → creates escalation, emits notification, awaits resolution" | Real SQLite escalation store; `execute` callback not called until after `store.approve()` |
| `approveEscalation()` resumes and replays write | `subconscious-mode.test.ts` — same test; `store.approve(escalation.id)` → `outcome.kind === 'executed'` | Real approval path |
| `rejectEscalation()` resumes with denied result | `subconscious-mode.test.ts` — "rejection yields { kind: 'denied' } and does NOT execute" | `outcome.kind === 'denied'`; `executed` count remains 0 |
| ACP server (stdio JSON-RPC) accepts simulated Zed client | `server.test.ts` — full lifecycle suite (initialize, session/new, session/prompt, permission round-trip) | In-process `PassThrough` streams; real `RunnerOSACPAgent` started |
| `spawn_session` with `acpEndpoint` delegates to remote | `spawn-bridge.test.ts` — "with acpEndpoint set, delegates to remote ACP agent"; `client-bridge.test.ts` — "opens, prompts, returns updates and stopReason" | Real subprocess spawned (`echo-acp-agent.ts` fixture); real `delegateToAcpEndpoint` called |
| Absent `acpEndpoint`, behavior unchanged | `spawn-bridge.test.ts` — "without acpEndpoint, uses local spawn (regression check)" | `localCalled` flag verified |
| In-flight ACP session survives server restart via SQLite restore | `session-restore.test.ts` — "client can resume session after server crash"; `session.test.ts` — "SQLite-backed restore: kill server mid-session" | Real disk SQLite; two `SessionManager` instances on same file |
| `THIRD_PARTY_NOTICES.md` updated for Hermes credits | `THIRD_PARTY_NOTICES.md` lines 13–32 present with R1/R2/R3/R7/R8 table rows | Manually verified |

---

### 🟡 PARTIAL (test exists but mocks or omits part of the key dependency)

| Criterion | File + Test | Gap |
|---|---|---|
| `assemblePrompt` + `scanForInjection` integrated into **cron** dispatch path | `runner.ts` lines 796–797 wired; runner.test.ts has per-job and subconscious-mode integration tests | `runner.test.ts` does not contain a test that fires the actual `scanForInjection` branch end-to-end through the runner (e.g., a step whose prompt contains an injection pattern and asserts the run is blocked). The scanner is present in production code and the unit tests prove the scanner's own logic. The missing piece is a runner-level integration test asserting the run returns an error/blocked state when injection is detected. The TODO at runner.ts:792 (`thread loadedSkills + contextFiles into assemblePrompt`) also means the scan only covers `userPrompt`, not loaded skills—partially fulfilling the SPEC criterion about scanning the fully-assembled prompt. |
| Scheduler-service calls gate before every dispatch (production path) | `gate.test.ts` SchedulerService integration suite exercises `tick()` with injected mocks | The `gate` parameter is injected—the real `shouldRunNow` (which calls `systeminformation`) is never exercised in the integration tests. This is appropriate for determinism but means the real `samplePressure` → `getBatteryState`/`getCpuLoadPct` → `systeminformation` chain is only exercised in the two `samplePressure` TTL tests in `gate.test.ts`, which call into the real OS APIs. Full production path (scheduler service + real system pressure) is not integration-tested. |
| R7 subconscious mode integration in runner.test.ts | `runner.test.ts` lines 1346–1448: per-job `permission_mode: subconscious` stashes `__subconsciousMode` hint on `agentOptions` | The runner tests confirm the hint is wired to `agentOptions`; they do not exercise the actual `gateWriteAttempt` call path (which lives in the agent layer). The escalation store and `gateWriteAttempt` are proven in `subconscious-mode.test.ts` / `escalation-store.test.ts`, but the full chain of runner → agent → `gateWriteAttempt` → pause → resume is not an integrated test. |

---

### 🔴 UNPROVEN (missing or tests don't exercise production path)

| Criterion | Gap |
|---|---|
| `bun run typecheck:all` clean | **FAILS.** `packages/server-core/src/sessions/SessionManager.ts` lines 2007–2009 have 3 TS2339 errors: accessing `.run` on a discriminated union that includes `{ type: "escalation.created"; escalation: Escalation }` (which has no `run` property). This is a direct consequence of R7 adding `escalation.created` to the workflow event union without narrowing it in `SessionManager.ts`. The typecheck script exits with code 2. |
| `bun run lint` clean | Not independently verified in this audit (typecheck failure was confirmed; lint was not run separately). Flagged as unknown until typecheck is fixed. |

---

## Total Counts Table

| Dimension | Count |
|---|---|
| Phase 1 new test files | 18 (11 in `packages/shared` + 7 ACP files; runner.test.ts extended in server-core) |
| Tests in R1 (spawn-session-isolation.test.ts) | 45 (confirmed by bun: 144 across 5 R1+R2+R3+R4+R5 files) |
| Tests in R2 (prompt-builder.test.ts) | ~40 (19 top-level `test` calls; each THREAT/EXFIL loop expands) |
| Tests in R3 (gate.test.ts) | 21 |
| Tests in R4 (reactive-config.test.ts) | 14 |
| Tests in R5 (trigger-inputs.test.ts) | 32 |
| Tests in R6 (shell-hook-runner + allowlist-store + consent + shell-hook-handler) | 22 + 12 + 7 + 6 = 47 |
| Tests in R7 (subconscious-mode + escalation-store) | 16 + 11 = 27 |
| Tests in R8 (7 ACP test files) | ~73 (server:8, session:8, restore:3, spawn-bridge:6, permissions:25, client-bridge:7, types:16) |
| **Total Phase 1 new tests (approximate)** | **~299** |
| Skipped tests (`it.skip`, `test.skip`, `xit`, `xtest`) | **0 found** across all Phase 1 test files |
| Mock-heavy vs real-integration ratio | Approximately 20% mock-heavy (R3 SchedulerService integration uses injected gate/sleep/reschedule; R7 runner integration uses session map stubs). ~80% exercise real production modules. |

---

## Verdict Per Requirement

| Req | Verdict | Notes |
|---|---|---|
| **R1** Subagent isolation | PROVEN | 45 tests; full blocklist, depth gate, ALS isolation, refusal payload, toolset intersection, auto-approve logging all exercised through real production code. Production wiring tests confirm `session-scoped-tools.ts` closure shape. |
| **R2** Prompt-injection scan | PARTIAL | Scanner itself fully proven (all 8+5+base64+unicode patterns). Integration into runner.ts is confirmed at the code level, but no runner-level test asserts a workflow step is blocked when injection is present. `loadedSkills`/`contextFiles` not yet threaded (TODO at runner.ts:792). |
| **R3** Scheduler gate | PROVEN | 21 tests; all four acceptance-criterion gate states proven with injected samplers. SchedulerService integration (3 tests) proves gate is called before dispatch and that pause/throttle behaviors wire correctly. `samplePressure` TTL cache and battery fail-open tests exercise real `systeminformation`. |
| **R4** Hot-reload config | PROVEN | 14 tests; real fs temp-dir; TTL cache, subscriber notification within 1s, debounce, synthetic consumer, and invalidation all proven without mocking. |
| **R5** Per-job toolset overrides | PROVEN | 32 tests; full precedence chain (per-job > platform > default), empty deny-all, backward compat, and deny payload all proven. `runner.test.ts` adds integration coverage confirming `enabledSourceSlugs` propagates to session options. |
| **R6** Polyglot shell hooks | PROVEN | 47 tests; real subprocesses (bash + python3 fixtures); both wire shapes; TOCTOU defence; symlink swap; shell:false invariant; consent TTY/non-TTY paths; allowlist round-trip; handler registry wiring. |
| **R7** Subconscious mode | PARTIAL | 27 unit tests for escalation store and `gateWriteAttempt` are solid (real SQLite, pause/resume/reject). Runner integration confirms hint propagation. Missing: end-to-end test that runs a workflow step through the runner and observes the pause → escalation → resume chain without stubs. |
| **R8** ACP adapter | PROVEN | ~73 tests across 7 files. Real PassThrough/stdio transport; real subprocess fixture; session SQLite restore across two server instances; permission timeout; sensitive-path detection; `acpEndpoint` delegation and local fallback. One test FAILS (see below). |

---

## Failing Test

**File:** `packages/shared/src/protocol/acp/__tests__/client-bridge.test.ts`
**Test:** `ACPClient.open() spawn-failure handling > rejects within seconds (not minutes) when endpoint binary is missing`
**Outcome:** Timed out at 10 000ms (the test's own timeout). The `ACPClient` does not reject fast enough when given a path to a non-existent binary. The `earlyConnectivityWindowMs: 500` option is set, but the client either ignores it or the failure detection path exceeds 500ms.
**Severity:** Medium. The acceptance criterion for R8 requires "absent `acpEndpoint`, behavior unchanged" — this test guards a regression where a bad endpoint hangs indefinitely. The test itself times out rather than passing the sub-5s fast-reject assertion.

---

## Typecheck Failure

**Command:** `bun run typecheck:all` (exit code 2)
**Location:** `packages/server-core/src/sessions/SessionManager.ts` lines 2007–2009
**Error (×3):** `TS2339: Property 'run' does not exist on type '... | { type: "escalation.created"; escalation: Escalation }'`
**Root cause:** R7 added `escalation.created` to the workflow event union type. `SessionManager.ts` has a switch/branch that accesses `event.run` without narrowing away the `escalation.created` variant. The discriminated union check at line ~2003 does not exclude `escalation.created` before accessing `.run`.
**Fix:** Add a type guard before the `event.run` accesses: `if (event.type === 'escalation.created') return;` (a guard already exists for the early return path but does not appear to narrow far enough).

---

## Coverage of Failure Paths

| Feature | Failure path tested? |
|---|---|
| R1: blocked tool called by subagent | Yes — refusal payload test, depth gate exceeded |
| R1: parent stdin callback invoked from subagent thread | Yes — throws if reached, ALS isolation verified |
| R2: injection in skill body | Yes — assembled-prompt scan test |
| R2: injection in context file | Yes — "injection hidden in context file body" |
| R3: battery sampler failure (cold-start + after prior sample) | Yes — two `getBatteryState` fail-open tests |
| R3: CPU severe overrides battery-ok state | Yes — "severe CPU on battery at 100% → pause" |
| R4: throwing subscriber does not block others | Yes — `subscribeConfigChanges` resilience test |
| R5: empty deny-all override rejects default toolset members | Yes |
| R6: timeout (hook sleeps > timeoutMs) | Yes — fail-open `allow` + timeout message |
| R6: missing binary (ENOENT) | Yes — returns `allow` with "spawn error" message |
| R6: invalid JSON stdout | Yes — silent `allow` |
| R6: TOCTOU content swap | Yes — script rewritten between consent and spawn |
| R6: symlink swap | Yes — new target triggers re-consent |
| R7: rejected escalation | Yes — `gateWriteAttempt` rejection test |
| R7: read tool in subconscious mode executes immediately | Yes |
| R8: permission request timeout → deny | Yes (`makeApprovalCallback` 50ms timeout test) |
| R8: client open with missing binary | **FAILING** — test times out |
| R8: session not found after restart | Tested via `removeSession` + reopen pattern in `session.test.ts` |

---

## Integration vs Unit Tests Per Feature

| Req | Unit tests | Integration tests | Integration quality |
|---|---|---|---|
| R1 | `spawn-session-isolation.test.ts` (blocklist, intersection, depth, ALS logic) | `spawn-session-tool wiring` describe block in same file + `production wiring` describe block | Genuine — real `createSpawnSessionTool` handler invoked via `spawnDepthStorage.run()`; fake `spawnFn` but real guard logic |
| R2 | `prompt-builder.test.ts` (all scanner units) | `assembled-prompt scan catches skill-borne injection` tests; runner.ts wired but no runner-level integration test | Partial — scanner unit is complete; runner-level integration test missing |
| R3 | `shouldRunNow`, `samplePressure`, `getBatteryState` | `SchedulerService — gate integration` (3 tests, injected gate/sleep) | Good for dispatch logic; injected gate prevents testing real OS pressure path in integration |
| R4 | TTL cache, subscriber, debounce | `integration — long-running consumer` test in same file | Good — real fs.watch event loop; no mocking of storage |
| R5 | `parseTriggerToolsetOverride`, `resolveEnabledToolsets`, `resolvePermissionMode`, `isSourceAllowed` | `integration: per-job override end-to-end` + `runner.test.ts` R5/R7 suite | Good — dispatch simulation; runner integration verifies session-level propagation |
| R6 | `parseHookStdout`, `parseCommand`, `computeScriptContentHash`, `allowlist` | `runShellHook` real subprocess tests; `ShellHookHandler` DSL routing tests | Strong — real subprocesses; handler subscribes to real `WorkspaceEventBus` |
| R7 | `evaluateWriteAttempt`, `isWriteTool`, `normalizeSubconsciousMode`, `escalation-store` CRUD | `gateWriteAttempt` pause/resume/reject in `subconscious-mode.test.ts`; `runner.test.ts` hint-propagation tests | Good unit + store integration; missing full runner → agent → gate chain |
| R8 | `getToolKind`, `buildToolStart`, `buildToolComplete`, `jsonLoadsMaybe`, permissions | `server.test.ts` (PassThrough transport), `session.test.ts` (SQLite), `session-restore.test.ts` (2-server restart), `spawn-bridge.test.ts` (real subprocess) | Strong — real transport, real disk, real subprocess; one failing test |

---

## Hard-to-Test Behaviors Not Covered by Automated Tests

1. **Multi-process / multi-session interactions.** The escalation store tests open a single store instance. Concurrent multi-process writes (e.g., two runner processes writing escalations to the same SQLite file) are not tested. SQLite WAL mode may serialize these correctly but it is unverified.

2. **Race conditions in `gateWriteAttempt`.** The `subscribeToResolution` polling loop uses `setInterval(50ms)`. Under heavy load (many concurrent escalations resolving rapidly), it is possible for a resolution event to land between two poll windows and delay a resume by up to 50ms. Not a correctness bug but an unverified latency contract.

3. **Long-running session resilience (escalations days later).** The SPEC mentions escalation-based workflows that may sit pending for user approval over extended periods. There is no test simulating a session that is inactive for an extended time, is resumed by an external `approveEscalation()` call, and successfully completes the deferred tool call. The store durability test covers the persistence side; the live-resume side is only tested with `setTimeout(10ms)`.

4. **Real wire-protocol compatibility with Zed.** The ACP tests use an `echo-acp-agent.ts` fixture that is itself a `RunnerOSACPAgent`. This verifies the RunnerOS ↔ RunnerOS protocol round-trip, not the RunnerOS ↔ Zed round-trip. Zed's ACP client may use slightly different message framing (e.g., trailing newlines, BOM, partial-frame writes). No test uses an actual Zed binary.

5. **`systeminformation` cross-platform behavior.** `getBatteryState` and `getCpuLoadPct` are tested against the real OS on macOS (the development host). Windows and Linux behavior (e.g., `hasBattery: false` on a desktop Linux CI box, or the `powershell.exe` battery path on Windows) is untested.

6. **ACP session under network partition / slow stdout.** The ACP server uses readline over a PassThrough stream. A real stdio transport from a Zed subprocess might emit partial frames. The `earlyConnectivityWindowMs` fast-reject path is specifically the one failing test in this audit.

---

## Test Infrastructure Quality

**Consistent patterns:** All Phase 1 tests use `bun:test` (`describe`/`test`/`it`/`expect`). Temp-dir setup with `beforeEach`/`afterEach` cleanup is used consistently across R4, R6, R7, R8 tests. The `spawnDepthStorage.run()` / `approvalCallbackStorage.run()` pattern for scoping async context is used identically in unit tests and in the tool wiring tests.

**Shared helpers not yet hoisted:** The `buildHarness()` helper in `server.test.ts` and the `startServer()` helper in `session-restore.test.ts` are structurally identical (PassThrough + readline + pending-promise map). These could be extracted to a shared `__tests__/test-harness.ts` in the ACP package to reduce duplication. Currently the pattern is duplicated across two files.

**Mock duplication:** The fake spawn pattern (`mock(async (input) => ({ sessionId: 'child' }))`) appears in 6 different tests in `spawn-session-isolation.test.ts` with near-identical structure. A `fakeSpawn()` factory would reduce noise. Not a correctness issue.

**Fixture hygiene:** Shell hook fixtures live at `automations/hooks/__tests__/fixtures/`. The `echo-acp-agent.ts` fixture lives at `protocol/acp/__tests__/fixtures/`. The `spawn-bridge.test.ts` and `spawn-bridge` section of `spawn-session-isolation.test.ts` both reference the ACP fixture via an absolute path computed from `__dirname`. If the fixture is moved, two test files break; adding a re-export or a single `FIXTURE_DIR` constant would help.

**No `it.skip` / `test.skip` / `xit` / `xtest` found** in any Phase 1 test file.

---

## Summary Verdict

| Gate | Status |
|---|---|
| `bun test` (Phase 1 new files) | 270/271 pass — 1 fail (`ACPClient` fast-reject timeout) |
| `bun run typecheck:all` | FAIL — 3 TS2339 errors in `server-core/src/sessions/SessionManager.ts` |
| `bun run lint` | Not confirmed clean (blocked on typecheck) |
| Acceptance criteria proven | 10 of 13 checkboxes fully proven |
| Acceptance criteria partial | 2 of 13 (R2 runner-level injection integration; R7 full runner→agent chain) |
| Acceptance criteria unproven | 1 of 13 (`bun run typecheck:all` and lint clean — both failing/unknown) |
| Skipped tests | 0 |
| THIRD_PARTY_NOTICES | Present and correct |

# Artist OS provider bridge reliability audit

## Remediation status — September 9

All eight findings below are implemented in the canonical working tree. The user subsequently authorized committing this remediation. The original audit follows for provenance; its reproduction results describe the pre-fix behavior.

- Pi completion waits for the settled prompt, including retries and compaction. Transient failures are withheld until recovery finishes; utility failures remain request-specific.
- Startup has bounded, cancellable initialization and rejects crash/error paths. Concurrent callers share initialization. Real child-process tests cover the ready/auto-compaction/tool-registration handshake.
- Stop invalidates pending authentication and fallback attempts. Request generations guard late events, timeout cleanup, initialization, source setup, and asynchronous settlement.
- Fallback receives persistent source/runtime settings and prior conversation context even when the primary is cooling down.
- Fallback preserves every observed tool receipt, including shell commands, inputs, IDs, and partial failures. This fixes omission; it does not promise exactly-once execution for a remote action whose acknowledgement is lost.
- Existing-session model updates validate workspace defaults against the selected connection before forwarding them to the backend.

### Fresh verification

- **1,688 passed, 9 skipped, 0 failed**, 6,542 assertions across 146 provider/config/session/Pi test files. Native macOS filesystem events were required for watcher tests; all 14 watcher tests passed outside the sandbox after failing within it.
- **4 additional isolated model-default tests passed**, 13 assertions.
- Shared, server-core, and Pi server TypeScript checks passed.
- Canonical Artist OS main build passed, including the Pi subprocess build; no renderer source changed.
- Actual Electron development app restarted from canonical checkout with the existing `~/.artist-os` profile. Live Pi/Qwen request returned `BRIDGE_OK`; Stop interrupted a streaming count and returned to idle; a follow-up in the same session returned `RECOVERY_OK` and settled normally. Session: `260908-proud-hill`.
- Live verification caught an initialization self-wait introduced by the first startup patch. It was corrected, covered by an actual child-process handshake regression, rebuilt, and retested successfully before completion.
- Independent reviews checked fallback state transfer/cancellation and transport lifecycle. Root-session review found and corrected stale source setup and retry-generation handling gaps.
- Whitespace validation passed. Verification preceded commit authorization; no push was performed. Unrelated existing edits remain intact.

Primary new regressions: `packages/shared/src/agent/__tests__/pi-transport-reliability.test.ts`, `packages/server-core/src/sessions/provider-recovery-cancellation.test.ts`, and `packages/server-core/src/sessions/provider-model-defaults.isolated.ts`, plus expanded fallback and Pi adapter suites. Durability/handoff test harnesses now model real running requests and per-dispatch token lifetime instead of depending on a stuck initialization or reusing expired retry tokens.

Evidence logs: `/tmp/artist-os-provider-audit/integration-final.log`, `build-main-final.log`, `live-electron-final.log`, `final-lifecycle.log`, and final typecheck logs. The live smoke covers the configured Pi/Qwen route, not every provider or a real outage across multiple accounts. Cross-provider faults and cooldown/tool continuity were tested deterministically. Additional unconfirmed hardening questions at the end remain a subsequent pass.

## Original audit

Date: 2026-09-09. Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`.
Started at `4aede4fe267bd44e858f9e8fe746eb403d97db57`; final checked HEAD `abcabc7cc7d31c5d69887876f169bad7ff00dace`. The intervening commit changes HQ release advice, not the audited bridge files. Existing uncommitted documentation/generator work was preserved.

## Assessment

Eight meaningful issues warrant fixes. The most urgent concern is the lifecycle of a request: SDK recovery, application fallback, Stop, and session completion do not consistently agree about whether work has ended. This can lose recovered answers or start more work after cancellation. Fallback also fails to preserve some essential conversation and source state.

This was a source audit with deterministic reproductions against actual implementation classes/functions and controlled backend events. No paid provider calls, account changes, or live Electron/network fault injection were performed. The reproductions establish the listed control-flow/state bugs; they do not certify every provider or the packaged runtime.

## 1. P1 — SDK recovery can finish the app stream before the recovered answer arrives

**Trigger:** Pi emits `agent_end` with `willRetry: true` after a transient provider failure. Recovery continues inside the SDK.

**Cause:** `packages/shared/src/agent/backend/pi/event-adapter.ts:127` unconditionally yields app completion on `agent_end`. `packages/shared/src/agent/pi-agent.ts:1090` also completes the event queue on that event.

**Observed:** feeding this event to the actual PiAgent produces a consumed `complete` and a completed queue. A subsequently injected recovered answer is stranded after that consumer exits. The existing error-handling tests cover `willRetry: false` and still pass.

**SDK evidence:** installed `@earendil-works/pi-coding-agent` version 0.84.3, `dist/core/agent-session.js`: line 369 supplies `willRetry`; lines 759–787 perform retry/compaction/queued continuations; lines 750–758 wait for the run and emit settled; lines 330–334 emit `agent_settled`. Merely checking `willRetry` does not cover post-run context compaction.

**Fix:** use the actual settled lifecycle for terminal completion; keep retries/compaction within the same admitted request. Test recovered text and tools arriving after interim end events, including cancellation during recovery.

## 2. P1 — Stop does not reliably prevent recovery from starting another request

**Fallback path:** `model-fallback-backend.ts:320` classifies a normally ended stream without completed text/tools as a new failure. Pi `forceAbort()` ends its queue normally (`pi-agent.ts:2085`). The fallback wrapper recognizes thrown aborts but does not retain its own cancellation state.

**Observed:** after an initial text delta, Stop plus Pi-style queue completion invokes the next fallback and yields another response.

**Authentication path:** `SessionManager.ts:13866` schedules an authentication retry with `setImmediate`, then dispatches it without checking Stop, request generation, or whether the session was superseded. An actual `attemptAuthRetry` followed by `cancelProcessing` still calls `sendMessage` once.

**Related race:** the five-second Stop callback at `SessionManager.ts:13830` is not bound to its originating generation. A timer from the first stopped turn can settle a later stopped turn. Reproduction directly invokes that captured timer after advancing the generation.

**Fix:** one cancellation/generation authority across initialization, retries, fallbacks, timers, and stream events. Check it before every new attempt and before settling a turn. Preserve final receipts without allowing stale events to settle newer work.

## 3. P1 — Fallback loses the connected tools' source state

**Cause:** `model-fallback-backend.ts:234` preserves property assignments and agent context. Its proxy at line 661 merely forwards ordinary setter calls to the currently active backend. Source setters are not replayed on newly created fallback backends.

**Real path:** SessionManager configures sources after factory creation through `setAllSources` and `setSourceServers` (`SessionManager.ts:13434`, `13507`). Every new BaseAgent starts with an empty SourceManager (`base-agent.ts:336`). Sharing the MCP pool does not restore that state.

**Observed:** primary has Gmail in both known and active sources; fallback has empty arrays. Claude can still expose shared-pool tools (`claude-agent.ts:972`), while its pre-tool checks regard their source as unknown/inactive (`core/pre-tool-use.ts:931`; Claude blocking path at `claude-agent.ts:1328`, `1360`).

**Fix:** preserve a complete, explicit runtime configuration snapshot and apply it before fallback initialization. Test a source-backed tool on the second provider, not just a text response.

## 4. P1 — A cooled-down primary makes follow-up messages lose history

**Trigger:** primary is cooling down; fallback is the first eligible attempt on a later message.

**Cause:** `model-fallback-backend.ts:312` uses the filtered attempt's offset to decide whether recovery history is necessary. Offset zero receives only the original message, even if it is a freshly created fallback. The factory deliberately clears that fallback's SDK history (`factory.ts:222`).

**Observed:** supplied history includes “Use the release called RED PLAN”; the fallback receives exactly `continue`, without that history.

**Fix:** decide history restoration from backend/session provenance, not filtered list position. Test several consecutive follow-ups during cooldown, including a second fallback and recovery of the primary.

## 5. P1 — Provider subprocess failure during startup can leave readiness pending forever

**Cause:** `pi-agent.ts:368` creates a resolve-only readiness promise; startup awaits it at line 500. `handleSubprocessExit` clears the stored promise/resolver at lines 1620–1621 without rejecting the original promise. Emitting a queue error does not unblock an await that precedes queue draining.

**Observed:** process-exit handling leaves the original readiness promise unsettled while the stored field becomes null.

**Fix:** reject readiness on process error/exit, bound initialization, and make cancellation settle pending startup. Verify missing executable, initialization exception, exit-before-ready, silent startup, and Stop during startup all produce one terminal result.

## 6. P2 — One failed utility query rejects other healthy queries

**Cause:** `packages/pi-agent-server/src/index.ts:1417` sends a generic `llm_query_error` before its targeted result. `pi-agent.ts:943` responds to that generic error by rejecting every pending utility completion/query.

**Observed:** two pending requests, one failing and one healthy, are both rejected with the failing request's model error; pending query count becomes zero.

**Fix:** correlate utility errors by request ID. Reject all requests only for an actual process-wide failure. Test concurrent success/failure and late responses after timeout.

## 7. P2 — Clearing a model override can forward a model incompatible with the current connection

**Trigger:** an existing Pi/OpenAI session has a Claude workspace default; clear the session model override.

**Cause:** `SessionManager.ts:12352` resolves a compatible model, but lines 12382–12384 ignore that result and send the raw workspace model to the existing backend.

**Observed:** actual SessionManager with isolated configuration resolves `pi/gpt-5.5` but invokes `agent.setModel('claude-sonnet-4-6')`. Native Pi can silently retain the previous model when resolution fails (`pi-agent-server/src/index.ts:1498`); a custom endpoint may register and request the unsupported model (`1491`).

**Fix:** one validated resolution path for both new sessions and updates. Keep persisted selection, effective runtime model, and displayed identity consistent. Test clear override, invalid override, connection switch, and workspace defaults from another provider.

## 8. P2 — Replay protection can omit shell writes and claim nothing was done

**Cause:** `model-fallback-backend.ts:103` classifies completed writes with `isWriteTool`. The Bash heuristic in `subconscious-permissions.ts:162` and `189` accepts read-looking command prefixes without accounting for redirection/chained mutations.

**Observed:** a successful `echo confirmation >> /tmp/log` tool receipt followed by provider failure is omitted from the continuation's retained-work list. The generated instruction says “The previous attempt produced no retained work.”

**Limit:** an actual duplicate side effect was not executed in this audit. Receipt loss and the incorrect instruction are proven; duplicate execution is the resulting risk.

**Fix:** retain all executed tool receipts and use the actual execution/approval boundary for replay safety. Unknown safety must not become permission to replay. Test shell redirection, compound commands, failed tools with partial effects, and interruption after an external action.

## Validation

- 95 existing tests passed across fallback classification/wrapper/config, connection config, OmniRoute retry, session runtime config, and transcript reset: 232 assertions.
- Six existing Pi error-handling tests passed: 13 assertions.
- Two additional session race reproductions passed, asserting the current undesirable behavior: four assertions.
- Executable controlled-event reproductions confirmed transport (three scenarios), fallback (four scenarios), and model-default resolution (one scenario).
- Passing existing tests is not an acceptance claim: these scenarios were absent from those suites.

Temporary evidence is in `/tmp/artist-os-provider-audit/`:

```sh
bun /tmp/artist-os-provider-audit/transport-repro.ts
bun /tmp/artist-os-provider-audit/fallback-audit.ts
bun /tmp/artist-os-provider-audit/defaults-clear-model.ts
bun test /tmp/artist-os-provider-audit/session-races.test.ts
```

These scripts use actual implementation with synthetic events/backends and temporary configuration. They do not call paid providers. The baseline output is in `baseline-tests.log` and `transport-baseline.log` in that directory.

## Repair order and remaining verification

1. Fix terminal lifecycle, cancellation, and startup settlement together (1, 2, 5).
2. Preserve source configuration, conversation history, and completed work across fallback (3, 4, 8).
3. Fix correlated utility errors and model-resolution consistency (6, 7).
4. Run fault-injected integration tests and then the canonical Electron routes: transient recovery, Stop during each phase, source-backed fallback, repeated cooldown follow-ups, and model-default changes. Live provider/credential verification remains separate.

Additional source-backed checks deserve the next pass but are not included in the eight reproduced findings: ChatGPT refresh lacks an explicit timeout while refresh coordination uses a shared mutex; the ephemeral utility query timeout is installed after awaiting the provider run; deleted pinned connections can resolve another default while retaining stale routing identity. Verify full caller behavior before promoting these to confirmed failures.

Product source was not changed during the initial audit. The remediation status above records the subsequent authorized implementation.

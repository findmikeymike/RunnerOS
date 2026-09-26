# 01-03 Scheduler Gate — Cold Review

**Reviewer:** adversarial / 30-year-senior posture. Assume a rival wrote this.
**Verdict (TL;DR):** **FIX-AND-RESHIP** (small, mechanical fixes; nothing structural).

---

## License audit — first thing

Read `gate.ts` / `system-pressure.ts` line-by-line against
`.planning/research/upstream/openhuman/src/openhuman/scheduler_gate/{gate.rs,policy.rs,signals.rs}`.

| Surface | Upstream (Rust, GPL-3.0) | RunnerOS (TS) |
|---|---|---|
| Decision type | `enum Policy { Aggressive, Normal, Throttled, Paused { reason: PauseReason } }` | `'run' \| 'throttle' \| 'pause'` (string union) |
| Pause reason taxonomy | `PauseReason::{UserDisabled, OnBattery, CpuPressure, SignedOut, Unknown}` | none — no reason carried |
| Modes | `Off / AlwaysOn / Auto` (`Off` returns `Paused{UserDisabled}`) | `off / always_on / auto` (`off` returns `run` — different semantics, see 🟡 below) |
| Decision order | mode-match → `server_mode` short-circuit → clamp → `require_ac_power` → `cpu_severe` → battery+cpu → AND → Normal/Throttled | mode short-circuit → `cpu_severe` → `require_ac_power` → battery_floor → cpu_busy → run |
| Threshold semantics | upstream uses `>=` for cpu_severe and `<= cpu_busy_threshold` ⇒ above busy → Throttled | RunnerOS uses `>=` for both — matches spec, slightly different from upstream |
| Clamping of malformed config | yes (`f32.clamp(0,100)`, `0,1`) | **none** — see 🟡 below |
| `server_mode` field | yes | not modeled (out of scope for desktop RunnerOS — fine) |
| Signed-out override | yes (top-priority `Paused{SignedOut}`) | not modeled — RunnerOS handles auth elsewhere — fine |
| Sampling cadence | upstream runs a 30s background sampler with cached `Signals`; gate reads cached | RunnerOS calls `samplePressure()` on every gate tick (no cache) — see 🟡 below |
| Concurrency model | upstream gates an LLM semaphore (1 slot) and uses RAII `LlmPermit`; gate state in `Arc<RwLock<State>>` | RunnerOS has no semaphore, no permit, no shared state — pure function — entirely different model |
| Variable/symbol names | `decide`, `Signals`, `Policy`, `wait_for_capacity`, `LlmPermit`, `STATE`, `SIGNED_OUT` | `shouldRunNow`, `PressureSnapshot`, `GateDecision`, `resolveGatePolicy` — no overlap |

**Verdict:** ✅ Clean. The TS gate is a behavioral re-implementation; the structural skeleton (enum vs union, semaphore vs pure function, sampler thread vs per-tick call, decision-order details) is different. Field names and numeric defaults are carried over — those are facts/configuration, not copyrightable expression. The "concept re-implemented from prose" defense holds. THIRD_PARTY_NOTICES.md already credits OpenHuman + GPL-3.0 + research note.

One real concern: `samplePressure`'s comment says "concept-only re-implementation from OpenHuman (GPL-3.0)" — that's fine; the comment is correct. Just verify no PR reviewer panics at the OpenHuman mention. The notices file backs it up.

---

## ✅ What's solid

- **Acceptance coverage:** All five SPEC R3 bullets have a test:
  - 0.7 battery on battery → pause (line 19)
  - 80% CPU on AC → throttle (line 43)
  - 96% CPU → pause (line 51)
  - AC + 50% CPU → run (line 35)
  - scheduler-service calls gate before every dispatch (lines 152, 162, 178)
- **17/17 tests pass** (`bun test packages/shared/src/scheduler/`).
- **`bun run typecheck:all` is clean** — the 01-02 fixer's "pre-existing unrelated errors in gate.test.ts" claim does **not** reproduce. False alarm in the prior summary; flagging here so the trail is recorded.
- **Test isolation:** tests inject `sampler` via DI — production path uses `samplePressure` (default param), tests pass a synthetic sampler. Mock surface matches prod surface. Test #1 of the integration block also injects `gate`/`sleep`/`reschedule` cleanly — no real timers, no real systeminformation calls.
- **Severe-CPU priority correctness:** ordering is right and proven. Tests at line 51 (96% on AC → pause) and line 59 (99% CPU on battery + 100% charge → pause) cover both priority cases.
- **Throttle path:** test at line 178 asserts `sleep(throttle_backoff_ms)` then `onTick` is called — backoff semantics correct.
- **Pause path:** test at line 162 asserts `reschedule(paused_poll_ms)` is invoked with the configured value (12345 ms) — pause cadence correct.
- **Decision-change logging:** `lastDecision` tracks transitions; `scheduler-service.ts:129–134` emits a `console.log` only on transitions (no per-tick spam). Reasonable.
- **No `shell: true`, no eval, no fs writes in this slice — security surface is small.**
- **Header comments + THIRD_PARTY_NOTICES entry** both name the GPL upstream and assert no code copy. Defensible posture.

---

## 🔴 Blockers

**None.** Everything below is fixable in <30 min; nothing is structural.

---

## 🟡 Should-fix (ship-blocking only if you're picky)

### 🟡-1. `mode: "off"` semantics diverge from upstream — and from common sense

Upstream `Off` → `Paused{UserDisabled}` (user disabled the gate → do no work).
RunnerOS `off` → `run` (user disabled the gate → ignore all signals, run everything).

These are opposite semantics. The RunnerOS choice is defensible — "turn the gate *off*, i.e. don't gate" — and the test at gate.test.ts:75 codifies it. But you've now created a footgun: a user who sets `mode: "off"` to "stop background work" will get the opposite effect. **Pick one, document it once, and stop relying on the reader's intuition.** Recommend renaming `off` → `disabled` (the gate is disabled, scheduler runs unconditionally) and adding a JSDoc warning, OR flipping the semantic to match upstream.

### 🟡-2. No contradiction check between `mode: "off"` and `require_ac_power: true`

User config like `{ mode: "off", require_ac_power: true }` silently picks `run` and ignores `require_ac_power`. Add a `console.warn` (or, better, a zod schema validator) when both are present. Cost: 3 lines.

### 🟡-3. Sampler is called every tick — no caching, no debounce

`samplePressure()` makes two `systeminformation` calls per tick. `si.currentLoad()` reads `/proc/stat` (or platform equivalent) and can take **100–1000 ms** on the first call as it samples a window. The scheduler ticks every 60 s, so 2 calls/min is fine — but if anyone ever wires this into a 1 Hz heartbeat (or the throttle path causes re-ticks), this becomes a CPU drain on the very host you're trying to protect.

Upstream addresses this with a 30 s background sampler and cached `Signals`. RunnerOS should add a tiny TTL cache (10–15 s) in `system-pressure.ts`, or document explicitly that callers must not invoke `samplePressure` faster than the tick cadence. Defer if you must, but write it down.

### 🟡-4. Sampler "fail-open to run" is the wrong default for battery safety

`getCpuLoadPct()` returns `0` on error (→ never throttles). `getBatteryState()` returns `{onAC: true, hasBattery: false}` on error (→ never pauses for battery). The scheduler-service wrapper also defaults to `run` on `gate.throw`. That's three layers of fail-open.

**Argument for fail-open (current):** scheduler should never wedge itself silently on a libsysinfo glitch; user notices "nothing is running" much later than "throttling more than expected."

**Argument for fail-safe (battery):** the whole point of R3 is "don't drain battery." A laptop user on battery whose `si.battery()` throws because of a sandbox/permission issue (Linux containers, Windows non-admin) will now run unbounded background work and drain the battery — the exact failure mode the gate exists to prevent.

**My take:** keep the scheduler-service-level fail-open (so a bad sampler doesn't wedge the scheduler), but in `getBatteryState` change the error path to **preserve last-known state** instead of asserting AC. If no prior state, lean conservative (`hasBattery: true, onAC: false, chargePct: null`). That way a single transient throw doesn't flip the policy. This needs the TTL cache from 🟡-3 anyway.

### 🟡-5. `systeminformation` failure modes are unverified for our deploy targets

The package works cross-platform, but:

- **Linux containers** (no battery hardware): `si.battery()` returns `{ hasBattery: false }` — handled correctly, gate falls through to AC path. ✅
- **VMs with throttled CPU reporting:** `si.currentLoad()` returns the guest's view of CPU. If the VM is throttled by the host but the guest sees 30%, the gate won't throttle/pause. **Not fixable here** — VM is lying to us. Document.
- **Windows non-admin:** `si.battery()` reads WMI; non-admin can read battery in most cases. CPU load reads PerfMon counters — also non-admin readable. Should work, but **no integration test on Windows.** Risk is real but not this PR's problem.
- **First-call latency:** `si.currentLoad()` does an internal 200 ms sample on first call. The gate's first tick will block on this. Not a correctness bug; document.

None of these are blockers. They're "I want a paragraph in the SUMMARY" items.

### 🟡-6. Per-workflow override plumbing is a phantom feature

`resolveGatePolicy()` exists. `setGateConfig()` exists. But **no production call site merges workflow-level config into the gate.** SPEC R3 says "Per-workflow override via workspace config" — the *API* is there, the *wiring* is not. SPEC ambiguity: it's unclear whether this is gate-policy-per-workflow or just at the service level. The plan's `must_haves` don't lock per-workflow plumbing as an acceptance bullet.

This is functionally identical to the 01-01 B1 "phantom" concern: the surface area exists, no caller exercises it, no test forces a workflow to merge an override over the default. Either:

(a) wire it in this PR (find the dispatch site, merge workflow.gate into service.gate at run start), or
(b) explicitly scope it out of 01-03 in the SUMMARY and open a follow-up. Don't leave the unused `resolveGatePolicy` export pretending to be done.

### 🟡-7. `console.log` is the durability story for state transitions

Decision transitions log via `console.log`. In Electron main process, that's flushed to the dev console (lost on restart). No structured event, no metric, no event-bus publish. SPEC R3 doesn't *require* observability beyond logs, but if you ever want to debug "why was my workflow paused for 2 hours yesterday" you'll wish you had a structured trail.

Recommend: emit a `DomainEvent` (or whatever RunnerOS calls its event bus) on transition. Defer if scope-bound; write it down.

### 🟡-8. `Object.freeze(DEFAULT_GATE_CONFIG)` + cast lie

```ts
export const DEFAULT_GATE_CONFIG: GatePolicy = Object.freeze({ ... }) as GatePolicy;
```

`Object.freeze` returns `Readonly<T>`; the `as GatePolicy` cast strips that. Callers think they got a mutable `GatePolicy` and may try to mutate the singleton — which will silently no-op in non-strict mode or throw in strict. Either:

- Type as `Readonly<GatePolicy>` and update consumers, or
- Drop the freeze (defenders use `{ ...DEFAULT_GATE_CONFIG, override }` everywhere already).

Cosmetic. Won't ship-block.

---

## 🔵 Nits

- `paused_poll_ms` is defaulted to 60 000 ms — same as the alignment timer's normal tick. So "paused" effectively means "tick once more in 60 s and recheck" — which is identical to the normal cadence. The pause path provides no slowdown vs. the run path. Probably intentional (re-check at the same cadence) but it means `paused_poll_ms` is a knob with no effect at default config. Worth a comment.
- `cpu_busy_threshold_pct: 70` and `cpu_severe_pct: 95` — at default config there's a 25-pt window where we throttle. Fine, just call it out in the SUMMARY so the next reader knows the spread is intentional.
- `getBatteryState()` returns `onAC: true` when `hasBattery: false`. Then `samplePressure` repeats that field — redundant but harmless.
- Test file mixes the gate unit tests and the SchedulerService integration tests in one file. Fine for now; if the scheduler-service test surface grows, split into `scheduler-service.test.ts`.
- `// @ts-expect-error private invocation for unit test` x3 — fine, but if tick() becomes more complex, expose a `tickOnce()` helper for tests instead.
- `sample.ts` is `system-pressure.ts` — naming inconsistency with plan task 2 ("create `sample` export"). The plan called it `sample`; the actual export is `samplePressure`. Plan drift, not a bug.

---

## Verification evidence

```bash
$ bun test packages/shared/src/scheduler/
 17 pass, 0 fail, 25 expect() calls, 63 ms

$ bun run typecheck:all
... (all 8 packages clean, no errors)
```

The 01-02 fixer's claim of "pre-existing unrelated errors in `scheduler/__tests__/gate.test.ts`" is **not reproducible against the current tree.** Either it was fixed between then and now, or the fixer was looking at a transient bad state. Recording so the audit trail is clean: no test/typecheck regressions caused by this slice.

---

## Verdict

**FIX-AND-RESHIP.**

The license posture is clean (read the upstream Rust; the TS implementation has different structure, different decision order, different naming, different concurrency model — the only "copies" are the numeric defaults and field names, which are facts/configuration). Tests pass. Typecheck is green. The plan's acceptance criteria are met.

What stops a clean SHIP:

1. **🟡-1 `mode: "off"` semantic is a footgun** — either flip it to match upstream or rename to `disabled`.
2. **🟡-6 per-workflow override is a phantom feature** — wire it in or scope-out in the SUMMARY.
3. **🟡-3 + 🟡-4 sampler caching + fail-safe battery** — add a 10 s TTL cache and preserve last-known battery state on throw. Tiny diff, big robustness win.

The rest is nits and can ship as follow-ups.

If the next reviewer is less generous, items 🟡-1 and 🟡-6 alone would justify a request-changes. Fix those two, leave the rest as tracked follow-ups in the SUMMARY, and this ships.

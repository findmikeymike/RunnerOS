---
phase: 01-orchestration-backbone
plan: 03
type: tdd
wave: 2
depends_on: []
files_modified:
  - packages/shared/src/scheduler/system-pressure.ts
  - packages/shared/src/scheduler/gate.ts
  - packages/shared/src/scheduler/__tests__/gate.test.ts
  - packages/shared/src/scheduler/scheduler-service.ts
  - package.json
autonomous: true
requirements: [R3]
must_haves:
  truths:
    - "getBatteryState() returns {onAC: boolean; chargePct: number | null} via systeminformation"
    - "getCpuLoadPct() returns 0-100 average CPU load via systeminformation"
    - "shouldRunNow() returns 'pause' when on battery and charge < battery_floor (default 0.8)"
    - "shouldRunNow() returns 'throttle' when CPU > cpu_busy (70%) and CPU <= cpu_severe (95%)"
    - "shouldRunNow() returns 'pause' when CPU > cpu_severe (95%)"
    - "shouldRunNow() returns 'run' when AC power and CPU < 70%"
    - "scheduler-service calls shouldRunNow() before every dispatch tick"
    - "Defaults match SPEC: battery_floor=0.8, cpu_busy=70, cpu_severe=95, throttle_backoff=30000ms, paused_poll=60000ms"
  artifacts:
    - path: "packages/shared/src/scheduler/system-pressure.ts"
      provides: "Battery + CPU sampling via systeminformation"
      exports: ["getBatteryState", "getCpuLoadPct", "BatteryState"]
    - path: "packages/shared/src/scheduler/gate.ts"
      provides: "Policy decision: run | throttle | pause"
      exports: ["shouldRunNow", "GateDecision", "GateConfig", "DEFAULT_GATE_CONFIG"]
  key_links:
    - from: "packages/shared/src/scheduler/scheduler-service.ts"
      to: "packages/shared/src/scheduler/gate.ts"
      via: "await shouldRunNow() before each dispatch"
      pattern: "shouldRunNow"
---

<objective>
Implement battery/CPU-aware scheduler gate (OpenHuman concept R3, **re-implemented from spec — zero code copied from GPL upstream**). Decision returned to scheduler-service which sleeps `throttle_backoff` on throttle and `paused_poll` on pause.

Purpose: Stop RunnerOS from draining battery or starving the host when the user is on battery power or under CPU pressure.

License: OpenHuman is GPL-3.0 — concepts only, NO code copy. All field names, defaults, state machine described in research/04-openhuman-concepts.md.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-orchestration-backbone/01-SPEC.md
@.planning/research/04-openhuman-concepts.md
@packages/shared/src/scheduler/scheduler-service.ts

<interfaces>
Per SPEC §R3 defaults:
- battery_floor: 0.8
- cpu_busy: 70 (percent)
- cpu_severe: 95
- throttle_backoff_ms: 30000
- paused_poll_ms: 60000

Library: `systeminformation` (npm) — cross-platform macOS/Linux/Windows
  - si.battery() → { hasBattery, acConnected, percent, ... }
  - si.currentLoad() → { currentLoad: number (0-100) }

GateDecision = "run" | "throttle" | "pause"
GateConfig = { battery_floor: number; cpu_busy: number; cpu_severe: number; throttle_backoff_ms: number; paused_poll_ms: number; require_ac_power: boolean }
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — gate decision tests with mocked sysinfo</name>
  <files>packages/shared/src/scheduler/__tests__/gate.test.ts</files>
  <behavior>
    - battery=0.7 on battery → "pause"
    - battery=0.9 on battery → "run" (above floor, CPU low)
    - on AC power + CPU 50% → "run"
    - on AC power + CPU 80% → "throttle"
    - on AC power + CPU 96% → "pause"
    - require_ac_power=true + on battery (any %) → "pause"
    - Custom config override: battery_floor=0.5, battery=0.6 on battery → "run"
  </behavior>
  <action>
    Create `packages/shared/src/scheduler/__tests__/gate.test.ts`. Use dependency injection: `shouldRunNow(config, sampler)` where `sampler: () => Promise<{onAC: boolean; chargePct: number | null; cpuPct: number}>`. Tests pass a synthetic sampler — no real systeminformation call needed. Run — must fail (module missing).
  </action>
  <verify>
    <automated>bun test packages/shared/src/scheduler/__tests__/gate.test.ts 2>&1 | grep -q "fail\|cannot find module"</automated>
  </verify>
  <done>RED state confirmed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement system-pressure.ts and gate.ts</name>
  <files>packages/shared/src/scheduler/system-pressure.ts, packages/shared/src/scheduler/gate.ts, package.json</files>
  <action>
    1. Add `systeminformation` to dependencies: `bun add systeminformation` (verify it lands in packages/shared/package.json or root package.json per monorepo convention — check existing structure first).

    2. Create `packages/shared/src/scheduler/system-pressure.ts`:
       ```ts
       import si from "systeminformation";
       export interface BatteryState { onAC: boolean; chargePct: number | null; hasBattery: boolean }
       export async function getBatteryState(): Promise<BatteryState> {
         const b = await si.battery();
         return { onAC: b.acConnected, chargePct: b.hasBattery ? b.percent / 100 : null, hasBattery: b.hasBattery };
       }
       export async function getCpuLoadPct(): Promise<number> {
         const l = await si.currentLoad();
         return l.currentLoad;
       }
       export async function sample(): Promise<{onAC: boolean; chargePct: number | null; cpuPct: number}> {
         const [b, cpu] = await Promise.all([getBatteryState(), getCpuLoadPct()]);
         return { onAC: b.onAC || !b.hasBattery, chargePct: b.chargePct, cpuPct: cpu };
       }
       ```
       Note: if `hasBattery=false` (desktop), treat as onAC=true permanently.

    3. Create `packages/shared/src/scheduler/gate.ts`:
       ```ts
       export type GateDecision = "run" | "throttle" | "pause";
       export interface GateConfig {
         battery_floor: number;
         cpu_busy: number;
         cpu_severe: number;
         throttle_backoff_ms: number;
         paused_poll_ms: number;
         require_ac_power: boolean;
       }
       export const DEFAULT_GATE_CONFIG: GateConfig = {
         battery_floor: 0.8, cpu_busy: 70, cpu_severe: 95,
         throttle_backoff_ms: 30000, paused_poll_ms: 60000, require_ac_power: false
       };
       export async function shouldRunNow(
         config: GateConfig = DEFAULT_GATE_CONFIG,
         sampler: () => Promise<{onAC: boolean; chargePct: number | null; cpuPct: number}> = sample
       ): Promise<GateDecision> {
         const s = await sampler();
         if (!s.onAC && config.require_ac_power) return "pause";
         if (!s.onAC && s.chargePct !== null && s.chargePct < config.battery_floor) return "pause";
         if (s.cpuPct > config.cpu_severe) return "pause";
         if (s.cpuPct > config.cpu_busy) return "throttle";
         return "run";
       }
       ```

    4. Header comment in both files:
       ```
       // Re-implemented from behavioral spec in .planning/research/04-openhuman-concepts.md.
       // Concept inspired by OpenHuman (GPL-3.0); NO source code copied. See research note License Wall.
       ```

    5. Run tests — must pass.
  </action>
  <verify>
    <automated>bun test packages/shared/src/scheduler/__tests__/gate.test.ts && bun run typecheck:all</automated>
  </verify>
  <done>Gate decision table verified; module compiles.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire gate into scheduler-service dispatch loop</name>
  <files>packages/shared/src/scheduler/scheduler-service.ts, packages/shared/src/scheduler/__tests__/gate.test.ts</files>
  <behavior>
    - scheduler-service awaits shouldRunNow() before each dispatch
    - On "run" → dispatch as normal
    - On "throttle" → await sleep(throttle_backoff_ms), then dispatch (or re-check on next tick — pick per Hermes/spec: SPEC says "Workers sleep throttled_backoff_ms before each LLM-bound task to serialize requests")
    - On "pause" → skip dispatch, schedule next check at paused_poll_ms instead of normal cadence
  </behavior>
  <action>
    1. Read `packages/shared/src/scheduler/scheduler-service.ts`. Locate the dispatch tick.
    2. Wrap dispatch:
       ```ts
       const decision = await shouldRunNow(this.gateConfig);
       if (decision === "pause") {
         this.scheduleNextTick(this.gateConfig.paused_poll_ms);
         return;
       }
       if (decision === "throttle") {
         await sleep(this.gateConfig.throttle_backoff_ms);
       }
       // proceed with dispatch
       ```
    3. Add `gateConfig` field to scheduler-service config (defaults to DEFAULT_GATE_CONFIG, can be overridden per workflow per SPEC — use workflow-level override if present, else service-level).
    4. Add integration test mocking the gate and asserting dispatch is skipped/delayed/normal accordingly.
    5. `bun test packages/shared/src/scheduler/ && bun run typecheck:all && bun run lint`.
  </action>
  <verify>
    <automated>bun test packages/shared/src/scheduler/ && bun run typecheck:all && bun run lint</automated>
  </verify>
  <done>Scheduler-service respects gate decision; integration test green.</done>
</task>

</tasks>

<verification>
- All 6 decision-table cases pass
- systeminformation works on macOS, Linux, Windows (verified via lib docs)
- scheduler-service.ts dispatch wrapped
</verification>

<success_criteria>
On a battery laptop at 70% with the lid open and CPU low → gate returns "pause". On AC with CPU at 80% → gate returns "throttle".
</success_criteria>

<output>
After completion, create `.planning/phases/01-orchestration-backbone/01-03-SUMMARY.md`.
</output>

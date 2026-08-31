/**
 * Scheduler gate — battery + CPU pressure policy engine.
 *
 * Concept-only re-implementation from OpenHuman (GPL-3.0) — no source code copied.
 * Behavior derived from research note `.planning/research/04-openhuman-concepts.md`
 * (Upgrade 4 — Scheduler Gate). RunnerOS implements its own policy engine from the
 * behavioral spec; field names and defaults are facts taken from that note.
 *
 * Decision rules (priority order):
 *   1. mode == "disabled" or "always_on"     → run
 *   2. cpuPct >= cpu_severe_pct              → pause   (host is on fire)
 *   3. require_ac_power and on battery       → pause
 *   4. on battery and chargePct < battery_floor → pause
 *   5. cpuPct >= cpu_busy_threshold_pct      → throttle
 *   6. otherwise                             → run
 */

import { samplePressure, type PressureSnapshot } from './system-pressure.ts';

export type GateDecision = 'run' | 'throttle' | 'pause';
// `disabled` bypasses gating — system pressure is ignored, dispatches always run.
export type GateMode = 'auto' | 'always_on' | 'disabled';

export interface GatePolicy {
  /** Master switch. `auto` enforces the rules; `always_on` and `disabled` short-circuit to `run`. */
  mode: GateMode;
  /** Battery floor as a 0..1 fraction. Below this on battery → pause. */
  battery_floor: number;
  /** CPU percent above which we throttle. */
  cpu_busy_threshold_pct: number;
  /** CPU percent above which we pause entirely. */
  cpu_severe_pct: number;
  /** Sleep duration before each dispatch when throttled. */
  throttled_backoff_ms: number;
  /** Re-check cadence while paused. */
  paused_poll_ms: number;
  /** When true, any time we're on battery → pause regardless of charge. */
  require_ac_power: boolean;
}

export const DEFAULT_GATE_CONFIG: GatePolicy = Object.freeze({
  mode: 'auto',
  battery_floor: 0.8,
  cpu_busy_threshold_pct: 70,
  cpu_severe_pct: 95,
  throttled_backoff_ms: 30_000,
  paused_poll_ms: 60_000,
  require_ac_power: false,
}) as GatePolicy;

/** Re-export for callers (tests, scheduler-service) that build samplers. */
export type PressureSample = PressureSnapshot;

export type PressureSampler = () => Promise<PressureSnapshot>;

/**
 * Decide whether the scheduler should dispatch this tick.
 *
 * @param policy - Effective policy (workflow override merged over defaults).
 * @param sampler - Pressure sampler. Defaults to real systeminformation calls.
 */
export async function shouldRunNow(
  policy: GatePolicy = DEFAULT_GATE_CONFIG,
  sampler: PressureSampler = samplePressure
): Promise<GateDecision> {
  // Master switch short-circuits.
  if (policy.mode === 'disabled' || policy.mode === 'always_on') {
    return 'run';
  }

  const s = await sampler();

  // Severe CPU pressure always wins.
  if (s.cpuPct >= policy.cpu_severe_pct) {
    return 'pause';
  }

  // Battery checks only apply if the machine actually has a battery and is not on AC.
  const onBattery = s.hasBattery && !s.onAC;

  if (onBattery && policy.require_ac_power) {
    return 'pause';
  }

  if (onBattery && s.chargePct !== null && s.chargePct < policy.battery_floor) {
    return 'pause';
  }

  if (s.cpuPct >= policy.cpu_busy_threshold_pct) {
    return 'throttle';
  }

  return 'run';
}

/**
 * Merge a partial per-workflow override over the default gate policy.
 * Unspecified fields fall through to DEFAULT_GATE_CONFIG.
 */
// TODO(phase-1): production wiring — a workflow runner should call setGateConfig(resolveGatePolicy(workflow.gateOverride ?? {})) before each dispatch. No caller does this today; follow-up in workflow integration.
export function resolveGatePolicy(override?: Partial<GatePolicy> | null): GatePolicy {
  if (!override) return { ...DEFAULT_GATE_CONFIG };
  return { ...DEFAULT_GATE_CONFIG, ...override };
}

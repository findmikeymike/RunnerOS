/**
 * System pressure samplers — battery state and CPU load.
 *
 * Concept-only re-implementation from OpenHuman (GPL-3.0) — no source code copied.
 * Behavior derived from research note `.planning/research/04-openhuman-concepts.md`
 * (Upgrade 4 — Scheduler Gate). RunnerOS uses the cross-platform `systeminformation`
 * npm package to read battery + global CPU load on macOS, Linux, and Windows.
 */

import si from 'systeminformation';

export interface BatteryState {
  /** True when the machine reports AC power connected (or no battery is present). */
  onAC: boolean;
  /** Battery charge as a 0..1 fraction. Null when no battery is present. */
  chargePct: number | null;
  /** False on desktops / VMs with no battery. */
  hasBattery: boolean;
}

export interface PressureSnapshot {
  onAC: boolean;
  chargePct: number | null;
  hasBattery: boolean;
  /** Global CPU load in percent, 0..100. */
  cpuPct: number;
}

/**
 * Last-known battery snapshot. On sampler failure we return this rather than
 * fail-open-to-AC, because guessing the battery is fine when it isn't can
 * silently drain a laptop. Asymmetric with CPU (see `getCpuLoadPct`): a CPU
 * read failure on a healthy system is usually transient and bursting the
 * scheduler briefly is the cheaper failure mode; a battery misread can keep
 * us running until the device dies.
 */
let lastKnownBattery: BatteryState | null = null;

/**
 * Sample battery state. Gracefully degrades on systems without a battery
 * (desktop, VM, container) by reporting `hasBattery: false` and `onAC: true`.
 * On sampler failure, returns the last successful snapshot (preserves last
 * known state) and only falls back to desktop-on-AC if we've never sampled
 * successfully.
 */
export async function getBatteryState(): Promise<BatteryState> {
  try {
    const b = await si.battery();
    let state: BatteryState;
    if (!b.hasBattery) {
      state = { onAC: true, chargePct: null, hasBattery: false };
    } else {
      // si.battery returns percent on 0..100; normalise to 0..1.
      const chargePct =
        typeof b.percent === 'number' && Number.isFinite(b.percent)
          ? Math.max(0, Math.min(1, b.percent / 100))
          : null;
      state = {
        onAC: Boolean(b.acConnected),
        chargePct,
        hasBattery: true,
      };
    }
    lastKnownBattery = state;
    return state;
  } catch {
    // Preserve last known battery state rather than guessing AC — a wrong
    // "you're plugged in" answer can drain the device. Only on cold-start
    // failure (no prior sample) do we fall back to desktop-on-AC.
    if (lastKnownBattery) return lastKnownBattery;
    return { onAC: true, chargePct: null, hasBattery: false };
  }
}

/** Test helper: reset the last-known battery cache between cases. */
export function __resetBatteryCache(): void {
  lastKnownBattery = null;
}

/**
 * Sample current global CPU load (0..100). Returns 0 on failure so the gate
 * fails open to `"run"` rather than wedging the scheduler.
 */
export async function getCpuLoadPct(): Promise<number> {
  try {
    const load = await si.currentLoad();
    const v = load?.currentLoad;
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v));
  } catch {
    return 0;
  }
}

/**
 * TTL for the public `samplePressure` reader. Concurrent / sub-second-cadence
 * callers within this window all see the same snapshot, avoiding repeated
 * `systeminformation` round-trips.
 */
export const PRESSURE_SAMPLE_TTL_MS = 5_000;

let cachedSnapshot: PressureSnapshot | null = null;
let cachedAt = 0;
let inflight: Promise<PressureSnapshot> | null = null;

async function readPressureNow(): Promise<PressureSnapshot> {
  const [battery, cpuPct] = await Promise.all([getBatteryState(), getCpuLoadPct()]);
  return {
    onAC: battery.onAC,
    chargePct: battery.chargePct,
    hasBattery: battery.hasBattery,
    cpuPct,
  };
}

/**
 * Composite sample for the gate: battery + CPU in one round-trip.
 * Cached for `PRESSURE_SAMPLE_TTL_MS` so sub-second-cadence callers don't
 * hammer `systeminformation`. Concurrent reads within the TTL share the
 * same in-flight promise / cached snapshot.
 */
export async function samplePressure(): Promise<PressureSnapshot> {
  const now = Date.now();
  if (cachedSnapshot && now - cachedAt < PRESSURE_SAMPLE_TTL_MS) {
    return cachedSnapshot;
  }
  if (inflight) return inflight;
  inflight = readPressureNow()
    .then((snap) => {
      cachedSnapshot = snap;
      cachedAt = Date.now();
      return snap;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test helper: clear the TTL cache so successive reads re-sample. */
export function __resetPressureCache(): void {
  cachedSnapshot = null;
  cachedAt = 0;
  inflight = null;
}

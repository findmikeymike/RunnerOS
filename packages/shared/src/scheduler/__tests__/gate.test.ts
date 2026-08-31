/**
 * Tests for the scheduler gate decision engine.
 * Concept-only re-implementation from OpenHuman (GPL-3.0) — no source code copied.
 * Behavior derived from research note `.planning/research/04-openhuman-concepts.md`.
 */
import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import {
  shouldRunNow,
  DEFAULT_GATE_CONFIG,
  type GatePolicy,
  type PressureSample,
} from '../gate.ts';

function sampler(s: PressureSample): () => Promise<PressureSample> {
  return async () => s;
}

describe('shouldRunNow — gate decisions', () => {
  test('on battery below floor (0.7 < 0.8) → pause', async () => {
    const decision = await shouldRunNow(
      DEFAULT_GATE_CONFIG,
      sampler({ onAC: false, chargePct: 0.7, hasBattery: true, cpuPct: 10 })
    );
    expect(decision).toBe('pause');
  });

  test('on battery above floor (0.9) + low CPU → run', async () => {
    const decision = await shouldRunNow(
      DEFAULT_GATE_CONFIG,
      sampler({ onAC: false, chargePct: 0.9, hasBattery: true, cpuPct: 10 })
    );
    expect(decision).toBe('run');
  });

  test('AC + 50% CPU → run', async () => {
    const decision = await shouldRunNow(
      DEFAULT_GATE_CONFIG,
      sampler({ onAC: true, chargePct: 1.0, hasBattery: true, cpuPct: 50 })
    );
    expect(decision).toBe('run');
  });

  test('AC + 80% CPU → throttle', async () => {
    const decision = await shouldRunNow(
      DEFAULT_GATE_CONFIG,
      sampler({ onAC: true, chargePct: 1.0, hasBattery: true, cpuPct: 80 })
    );
    expect(decision).toBe('throttle');
  });

  test('AC + 96% CPU → pause (severe overrides)', async () => {
    const decision = await shouldRunNow(
      DEFAULT_GATE_CONFIG,
      sampler({ onAC: true, chargePct: 1.0, hasBattery: true, cpuPct: 96 })
    );
    expect(decision).toBe('pause');
  });

  test('severe CPU on battery at 100% → pause (severe wins regardless of battery)', async () => {
    const decision = await shouldRunNow(
      DEFAULT_GATE_CONFIG,
      sampler({ onAC: false, chargePct: 1.0, hasBattery: true, cpuPct: 99 })
    );
    expect(decision).toBe('pause');
  });

  test('require_ac_power=true + on battery at 100% → pause', async () => {
    const decision = await shouldRunNow(
      { ...DEFAULT_GATE_CONFIG, require_ac_power: true },
      sampler({ onAC: false, chargePct: 1.0, hasBattery: true, cpuPct: 10 })
    );
    expect(decision).toBe('pause');
  });

  test('mode: disabled → always run regardless of pressure', async () => {
    const decision = await shouldRunNow(
      { ...DEFAULT_GATE_CONFIG, mode: 'disabled' },
      sampler({ onAC: false, chargePct: 0.05, hasBattery: true, cpuPct: 99 })
    );
    expect(decision).toBe('run');
  });

  test('mode: always_on → always run regardless of pressure', async () => {
    const decision = await shouldRunNow(
      { ...DEFAULT_GATE_CONFIG, mode: 'always_on' },
      sampler({ onAC: false, chargePct: 0.1, hasBattery: true, cpuPct: 99 })
    );
    expect(decision).toBe('run');
  });

  test('desktop (no battery) treated as AC → run', async () => {
    const decision = await shouldRunNow(
      DEFAULT_GATE_CONFIG,
      sampler({ onAC: true, chargePct: null, hasBattery: false, cpuPct: 30 })
    );
    expect(decision).toBe('run');
  });

  test('desktop (no battery) + require_ac_power=true → run (no battery = AC)', async () => {
    const decision = await shouldRunNow(
      { ...DEFAULT_GATE_CONFIG, require_ac_power: true },
      sampler({ onAC: true, chargePct: null, hasBattery: false, cpuPct: 30 })
    );
    expect(decision).toBe('run');
  });

  test('per-workflow override: battery_floor=0.5, battery=0.6 → run', async () => {
    const decision = await shouldRunNow(
      { ...DEFAULT_GATE_CONFIG, battery_floor: 0.5 },
      sampler({ onAC: false, chargePct: 0.6, hasBattery: true, cpuPct: 10 })
    );
    expect(decision).toBe('run');
  });

  test('per-workflow override: cpu_busy_threshold_pct=50, cpu=60 → throttle', async () => {
    const decision = await shouldRunNow(
      { ...DEFAULT_GATE_CONFIG, cpu_busy_threshold_pct: 50 },
      sampler({ onAC: true, chargePct: 1.0, hasBattery: true, cpuPct: 60 })
    );
    expect(decision).toBe('throttle');
  });

  test('default config exposes documented defaults', () => {
    expect(DEFAULT_GATE_CONFIG.battery_floor).toBe(0.8);
    expect(DEFAULT_GATE_CONFIG.cpu_busy_threshold_pct).toBe(70);
    expect(DEFAULT_GATE_CONFIG.cpu_severe_pct).toBe(95);
    expect(DEFAULT_GATE_CONFIG.throttled_backoff_ms).toBe(30_000);
    expect(DEFAULT_GATE_CONFIG.paused_poll_ms).toBe(60_000);
    expect(DEFAULT_GATE_CONFIG.require_ac_power).toBe(false);
    expect(DEFAULT_GATE_CONFIG.mode).toBe('auto');
  });
});

describe('samplePressure — TTL cache', () => {
  test('two reads within TTL return the same snapshot object', async () => {
    const sp = await import('../system-pressure.ts');
    sp.__resetPressureCache();
    const a = await sp.samplePressure();
    const b = await sp.samplePressure();
    expect(b).toBe(a); // same object reference from cache
  });

  test('reads spanning TTL produce distinct samples', async () => {
    const sp = await import('../system-pressure.ts');
    sp.__resetPressureCache();
    const a = await sp.samplePressure();
    // Force the cache to expire by jumping Date.now past the TTL.
    const realNow = Date.now;
    Date.now = () => realNow() + sp.PRESSURE_SAMPLE_TTL_MS + 1;
    try {
      const b = await sp.samplePressure();
      expect(b).not.toBe(a); // freshly sampled object, not the cached one
    } finally {
      Date.now = realNow;
      sp.__resetPressureCache();
    }
  });
});

describe('getBatteryState — fail-open preserves last known state', () => {
  test('on sampler failure after a successful read, returns the cached state', async () => {
    const sp = await import('../system-pressure.ts');
    sp.__resetBatteryCache();
    // Prime the cache with a real successful read.
    const primed = await sp.getBatteryState();

    // Now monkey-patch si.battery to throw and confirm we get the cached value.
    const si = (await import('systeminformation')).default;
    const realBattery = si.battery;
    si.battery = async () => {
      throw new Error('simulated battery sampler failure');
    };
    try {
      const after = await sp.getBatteryState();
      expect(after).toEqual(primed);
    } finally {
      si.battery = realBattery;
      sp.__resetBatteryCache();
    }
  });

  test('cold-start failure (no prior sample) falls back to desktop-on-AC', async () => {
    const sp = await import('../system-pressure.ts');
    sp.__resetBatteryCache();
    const si = (await import('systeminformation')).default;
    const realBattery = si.battery;
    si.battery = async () => {
      throw new Error('cold-start failure');
    };
    try {
      const state = await sp.getBatteryState();
      expect(state).toEqual({ onAC: true, chargePct: null, hasBattery: false });
    } finally {
      si.battery = realBattery;
      sp.__resetBatteryCache();
    }
  });
});

describe('SchedulerService — gate integration', () => {
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  beforeEach(() => {
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  });
  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  test('decision=run → onTick is called', async () => {
    const { SchedulerService } = await import('../scheduler-service.ts');
    const onTick = mock(async () => {});
    const gate = mock(async () => 'run' as const);
    const svc = new SchedulerService(onTick, { gate });
    // @ts-expect-error private invocation for unit test
    await svc.tick();
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  test('decision=pause → onTick NOT called, paused_poll_ms scheduled', async () => {
    const { SchedulerService } = await import('../scheduler-service.ts');
    const onTick = mock(async () => {});
    const gate = mock(async () => 'pause' as const);
    const reschedule = mock((_ms: number) => {});
    const svc = new SchedulerService(onTick, {
      gate,
      reschedule,
      gateConfig: { ...DEFAULT_GATE_CONFIG, paused_poll_ms: 12345 },
    });
    // @ts-expect-error private invocation for unit test
    await svc.tick();
    expect(onTick).not.toHaveBeenCalled();
    expect(reschedule).toHaveBeenCalledWith(12345);
  });

  test('decision=throttle → onTick called after backoff', async () => {
    const { SchedulerService } = await import('../scheduler-service.ts');
    const onTick = mock(async () => {});
    const gate = mock(async () => 'throttle' as const);
    const sleep = mock(async (_ms: number) => {});
    const svc = new SchedulerService(onTick, {
      gate,
      sleep,
      gateConfig: { ...DEFAULT_GATE_CONFIG, throttled_backoff_ms: 555 },
    });
    // @ts-expect-error private invocation for unit test
    await svc.tick();
    expect(sleep).toHaveBeenCalledWith(555);
    expect(onTick).toHaveBeenCalledTimes(1);
  });
});

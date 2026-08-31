/**
 * SchedulerService - Emits SchedulerTick events every minute
 *
 * Aligned to minute boundaries for consistent timing.
 * Automations can subscribe using cron expressions in automations.json.
 *
 * Battery + CPU pressure gating (R3) is wired in via `shouldRunNow()` from
 * `./gate.ts`. The gate is concept-only re-implementation from OpenHuman
 * (GPL-3.0) — no source code copied. See `.planning/research/04-openhuman-concepts.md`.
 */

import {
  shouldRunNow,
  resolveGatePolicy,
  DEFAULT_GATE_CONFIG,
  type GateDecision,
  type GatePolicy,
} from './gate.ts';

export interface SchedulerTickPayload {
  /** ISO 8601 UTC timestamp */
  timestamp: string;
  /** HH:MM in local time */
  localTime: string;
  /** Hour (0-23) */
  hour: number;
  /** Minute (0-59) */
  minute: number;
  /** Day of week (0-6, Sunday = 0) */
  dayOfWeek: number;
  /** Day name abbreviation (Sun, Mon, Tue, etc.) */
  dayName: string;
  /**
   * Epoch ms of the last tick when the gap since it exceeded a normal
   * interval — i.e. the process was suspended (laptop sleep) or blocked.
   * Consumers use it to evaluate schedules that came due while we were not
   * running. Absent on ordinary ticks.
   */
  catchUpFromMs?: number;
  /** True when this tick is a single wake/start catch-up execution. */
  catchUp?: boolean;
}

/**
 * A gap larger than this between ticks means real time advanced without us —
 * macOS suspends timers on sleep. Two intervals of slack keeps ordinary timer
 * jitter from being mistaken for a suspend.
 */
const SUSPEND_GAP_THRESHOLD_MS = 120_000;

export interface SchedulerServiceOptions {
  /** Effective gate policy. Workflow-level overrides should be merged in by the caller. */
  gateConfig?: GatePolicy;
  /** Override the gate decision function. Used by tests; defaults to real `shouldRunNow`. */
  gate?: (policy: GatePolicy) => Promise<GateDecision>;
  /** Sleep helper, swappable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called when the gate returns `pause`. Implementations may use this to
   * reschedule the next tick on the `paused_poll_ms` cadence instead of the
   * normal minute alignment.
   */
  reschedule?: (ms: number) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private alignmentTimer: NodeJS.Timeout | null = null;
  private pausedTimer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private lastTickMs: number | null = null;
  private onTick: (payload: SchedulerTickPayload) => Promise<void>;
  private gateConfig: GatePolicy;
  private gate: (policy: GatePolicy) => Promise<GateDecision>;
  private sleep: (ms: number) => Promise<void>;
  private reschedule?: (ms: number) => void;
  private lastDecision: GateDecision | null = null;

  constructor(
    onTick: (payload: SchedulerTickPayload) => Promise<void>,
    options: SchedulerServiceOptions = {}
  ) {
    this.onTick = onTick;
    this.gateConfig = resolveGatePolicy(options.gateConfig ?? DEFAULT_GATE_CONFIG);
    this.gate = options.gate ?? ((policy) => shouldRunNow(policy));
    this.sleep = options.sleep ?? defaultSleep;
    this.reschedule = options.reschedule;
  }

  /** Replace the effective gate policy at runtime (e.g. on config hot-reload). */
  setGateConfig(policy: Partial<GatePolicy> | GatePolicy): void {
    this.gateConfig = resolveGatePolicy(policy);
  }

  start(): void {
    if (this.timer || this.alignmentTimer) return;

    // Align to next minute boundary for consistent timing
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    this.alignmentTimer = setTimeout(() => {
      this.alignmentTimer = null;
      void this.tick();
      this.timer = setInterval(() => void this.tick(), 60_000);
    }, msUntilNextMinute);
  }

  stop(): void {
    if (this.alignmentTimer) {
      clearTimeout(this.alignmentTimer);
      this.alignmentTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pausedTimer) {
      clearTimeout(this.pausedTimer);
      this.pausedTimer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.isTicking) {
      console.warn('[SchedulerService] Previous tick still running, skipping');
      return;
    }
    this.isTicking = true;

    try {
      // Pressure gate runs before any dispatch work.
      let decision: GateDecision;
      try {
        decision = await this.gate(this.gateConfig);
      } catch (err) {
        // Fail open: if the sampler itself blows up, run normally so the
        // scheduler never wedges silently. Log for observability.
        console.error('[SchedulerService] Gate sampling failed; defaulting to run', err);
        decision = 'run';
      }

      if (decision !== this.lastDecision) {
        console.log(
          `[SchedulerService] Gate decision: ${this.lastDecision ?? 'initial'} -> ${decision}`
        );
        this.lastDecision = decision;
      }

      if (decision === 'pause') {
        const ms = this.gateConfig.paused_poll_ms;
        if (this.reschedule) {
          this.reschedule(ms);
        } else if (this.timer) {
          // Defer the next tick to paused_poll_ms instead of the normal 60s cadence.
          if (this.pausedTimer) clearTimeout(this.pausedTimer);
          this.pausedTimer = setTimeout(() => {
            this.pausedTimer = null;
            void this.tick();
          }, ms);
        }
        return;
      }

      if (decision === 'throttle') {
        await this.sleep(this.gateConfig.throttled_backoff_ms);
      }

      const now = new Date();
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      const previousTickMs = this.lastTickMs;
      this.lastTickMs = now.getTime();
      const suspendedSinceMs = previousTickMs !== null
        && now.getTime() - previousTickMs > SUSPEND_GAP_THRESHOLD_MS
        ? previousTickMs
        : undefined;

      const payload: SchedulerTickPayload = {
        timestamp: now.toISOString(),
        localTime: now.toTimeString().slice(0, 5), // HH:MM
        hour: now.getHours(),
        minute: now.getMinutes(),
        dayOfWeek: now.getDay(),
        dayName: days[now.getDay()]!, // getDay() always returns 0-6
        ...(suspendedSinceMs !== undefined ? { catchUpFromMs: suspendedSinceMs } : {}),
      };

      if (suspendedSinceMs !== undefined) {
        console.log(
          `[SchedulerService] Detected a ${Math.round((now.getTime() - suspendedSinceMs) / 60_000)}m gap; replaying schedules due since ${new Date(suspendedSinceMs).toISOString()}`,
        );
      }

      console.log('[SchedulerService] TICK at', payload.localTime, 'UTC:', payload.timestamp);

      await this.onTick(payload);
      console.log('[SchedulerService] TICK callback completed');
    } catch (error) {
      console.error('[SchedulerService] Tick failed:', error);
    } finally {
      this.isTicking = false;
    }
  }
}

/**
 * SchedulerService - Emits SchedulerTick events every minute
 *
 * Aligned to minute boundaries for consistent timing.
 * Automations can subscribe using cron expressions in automations.json.
 */

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

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private alignmentTimer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private lastTickMs: number | null = null;
  private onTick: (payload: SchedulerTickPayload) => Promise<void>;

  constructor(onTick: (payload: SchedulerTickPayload) => Promise<void>) {
    this.onTick = onTick;
  }

  start(): void {
    if (this.timer || this.alignmentTimer) return;

    // Align to next minute boundary for consistent timing
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    this.alignmentTimer = setTimeout(() => {
      this.alignmentTimer = null;
      this.tick();
      this.timer = setInterval(() => this.tick(), 60_000);
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
  }

  private async tick(): Promise<void> {
    if (this.isTicking) {
      console.warn('[SchedulerService] Previous tick still running, skipping');
      return;
    }
    this.isTicking = true;

    try {
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

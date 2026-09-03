import { describe, expect, it } from 'bun:test';
import { dailyWindowMatchedInRange, dailyWindowMatchesAt, nextDailyWindowRuns, scheduledMinuteForDailyWindow } from './daily-window.ts';

const window = { start: '15:00', end: '17:00' };

describe('daily schedule window', () => {
  it('chooses one stable minute inside the window and varies across dates', () => {
    const first = scheduledMinuteForDailyWindow('comments', '2026-09-03', window);
    const same = scheduledMinuteForDailyWindow('comments', '2026-09-03', window);
    const next = scheduledMinuteForDailyWindow('comments', '2026-09-04', window);
    expect(first).toBe(same);
    expect(first).toBeGreaterThanOrEqual(15 * 60);
    expect(first).toBeLessThanOrEqual(17 * 60);
    expect(next).not.toBe(first);
  });

  it('matches only the selected local minute', () => {
    const selected = scheduledMinuteForDailyWindow('comments', '2026-09-03', window)!;
    const hour = Math.floor(selected / 60);
    const minute = selected % 60;
    const at = Date.UTC(2026, 8, 3, hour, minute);
    expect(dailyWindowMatchesAt('comments', window, at, 'UTC')).toBe(true);
    expect(dailyWindowMatchesAt('comments', window, at + 60_000, 'UTC')).toBe(false);
  });

  it('catches up one missed selected minute without replaying the opening boundary', () => {
    const selected = scheduledMinuteForDailyWindow('comments', '2026-09-03', window)!;
    const at = Date.UTC(2026, 8, 3, Math.floor(selected / 60), selected % 60);
    expect(dailyWindowMatchedInRange('comments', window, at - 60_000, at + 60_000, 'UTC')).toBe(true);
    expect(dailyWindowMatchedInRange('comments', window, at, at + 60_000, 'UTC')).toBe(false);
  });

  it('returns the same future minute the runtime will execute', () => {
    const from = Date.UTC(2026, 8, 3, 14, 59);
    const runs = nextDailyWindowRuns('comments', window, 2, 'UTC', from);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => dailyWindowMatchesAt('comments', window, run.getTime(), 'UTC'))).toBe(true);
    expect(runs[0]!.getTime()).toBeGreaterThan(from);
  });

  it('rejects invalid and overnight windows', () => {
    expect(scheduledMinuteForDailyWindow('comments', '2026-09-03', { start: '17:00', end: '15:00' })).toBeNull();
    expect(scheduledMinuteForDailyWindow('comments', '2026-09-03', { start: 'nope', end: '17:00' })).toBeNull();
  });
});

/**
 * Suspend catch-up: a scheduler tick that follows a sleep/restart must still
 * fire the schedules that came due while the process was not running.
 *
 * Before this, `matchesCron` only ever asked about the current minute, so the
 * canonical failure — lid closed at 08:55 Friday, opened at 10:15 — silently
 * skipped the 09:00 Friday automation with no error anywhere.
 */
import { describe, expect, it } from 'bun:test';
import type { AutomationMatcher } from './types.ts';
import { matcherMatches } from './utils.ts';

const FRIDAY_0855 = new Date(2026, 1, 13, 8, 55, 0).getTime();
const FRIDAY_0900 = new Date(2026, 1, 13, 9, 0, 0).getTime();
const FRIDAY_1015 = new Date(2026, 1, 13, 10, 15, 0).getTime();

function weeklyMatcher(cron: string): AutomationMatcher {
  return { id: 'weekly-pulse', cron } as AutomationMatcher;
}

/** Shape emitted by AutomationSystem.fireSchedulerTick. */
function tick(atMs: number, catchUpFromMs?: number): Record<string, unknown> {
  const at = new Date(atMs);
  return {
    workspaceId: 'hq',
    timestamp: atMs,
    localTime: at.toTimeString().slice(0, 5),
    utcTime: at.toISOString(),
    ...(catchUpFromMs !== undefined ? { catchUpFromMs } : {}),
  };
}

describe('scheduler suspend catch-up', () => {
  it('fires a schedule missed during the suspend gap', () => {
    const matched = matcherMatches(
      weeklyMatcher('0 9 * * 5'),
      'SchedulerTick',
      tick(FRIDAY_1015, FRIDAY_0855),
    );
    expect(matched).toBe(true);
  });

  it('does not fire that schedule on an ordinary tick at the same moment', () => {
    // Same 10:15 tick, no suspend detected: 09:00 is simply not due now.
    const matched = matcherMatches(
      weeklyMatcher('0 9 * * 5'),
      'SchedulerTick',
      tick(FRIDAY_1015),
    );
    expect(matched).toBe(false);
  });

  it('does not fire a schedule that was not due inside the gap', () => {
    const matched = matcherMatches(
      weeklyMatcher('0 9 * * 1'),
      'SchedulerTick',
      tick(FRIDAY_1015, FRIDAY_0855),
    );
    expect(matched).toBe(false);
  });

  it('does not replay an occurrence the previous tick already handled', () => {
    // Window opens exactly at 09:00, so that occurrence belongs to the tick
    // that already ran — replaying it would double-fire.
    const matched = matcherMatches(
      weeklyMatcher('0 9 * * 5'),
      'SchedulerTick',
      tick(FRIDAY_1015, FRIDAY_0900),
    );
    expect(matched).toBe(false);
  });

  it('ignores a catch-up window on a matcher with no cron', () => {
    const matched = matcherMatches(
      { id: 'no-cron' } as AutomationMatcher,
      'SchedulerTick',
      tick(FRIDAY_1015, FRIDAY_0855),
    );
    expect(matched).toBe(false);
  });

  it('still respects a disabled matcher during catch-up', () => {
    const matched = matcherMatches(
      { id: 'weekly-pulse', cron: '0 9 * * 5', enabled: false } as AutomationMatcher,
      'SchedulerTick',
      tick(FRIDAY_1015, FRIDAY_0855),
    );
    expect(matched).toBe(false);
  });
});

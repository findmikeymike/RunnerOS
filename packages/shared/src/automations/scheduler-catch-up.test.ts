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

  it('suppresses a matcher until its durable snooze expires', () => {
    const snoozed = weeklyMatcher('0 9 * * 5');
    snoozed.snoozedUntil = new Date(FRIDAY_1015 + 60_000).toISOString();
    expect(matcherMatches(snoozed, 'SchedulerTick', tick(FRIDAY_1015, FRIDAY_0855))).toBe(false);

    snoozed.snoozedUntil = new Date(FRIDAY_0855 + 60_000).toISOString();
    expect(matcherMatches(snoozed, 'SchedulerTick', tick(FRIDAY_1015, FRIDAY_0855))).toBe(true);
  });

  it('does not catch up an occurrence that happened while snoozed', () => {
    const snoozed = weeklyMatcher('0 9 * * 5');
    snoozed.snoozedUntil = new Date(FRIDAY_0900 + 30 * 60_000).toISOString();
    expect(matcherMatches(snoozed, 'SchedulerTick', tick(FRIDAY_1015, FRIDAY_0855))).toBe(false);
  });

  it('fires a varied daily window at exactly one deterministic minute and catches it up once', () => {
    const matcher = {
      id: 'daily-comments',
      cron: '* 15-17 * * *',
      timezone: 'UTC',
      dailyWindow: { start: '15:00', end: '17:00' },
    } as AutomationMatcher;
    const matches: number[] = [];
    for (let minute = 15 * 60; minute <= 17 * 60; minute += 1) {
      const at = Date.UTC(2026, 8, 3, Math.floor(minute / 60), minute % 60);
      if (matcherMatches(matcher, 'SchedulerTick', tick(at))) matches.push(at);
    }
    expect(matches).toHaveLength(1);
    expect(matcherMatches(matcher, 'SchedulerTick', tick(matches[0]! + 60_000, matches[0]! - 60_000))).toBe(true);
    expect(matcherMatches(matcher, 'SchedulerTick', tick(matches[0]! + 60_000, matches[0]!))).toBe(false);
  });
});

/**
 * Tests for cron-matcher.ts
 */

import { describe, it, expect, afterEach, jest, spyOn } from 'bun:test';
import { cronMatchedInWindow, matchesCron } from './cron-matcher.ts';

describe('cronMatchedInWindow (suspend catch-up)', () => {
  // The failure this exists to prevent: lid closed 08:55 Friday, opened 10:15.
  // The 09:00 Friday pulse must still be recognized as due.
  const friday0855 = new Date(2026, 1, 13, 8, 55, 0).getTime();
  const friday1015 = new Date(2026, 1, 13, 10, 15, 0).getTime();

  it('detects a schedule that came due inside the missed window', () => {
    expect(cronMatchedInWindow('0 9 * * 5', friday0855, friday1015)).toBe(true);
  });

  it('ignores a schedule that was not due inside the window', () => {
    expect(cronMatchedInWindow('0 9 * * 1', friday0855, friday1015)).toBe(false);
  });

  it('excludes the window start so an already-handled tick cannot refire', () => {
    const friday0900 = new Date(2026, 1, 13, 9, 0, 0).getTime();
    // Starting exactly at the occurrence: it belongs to the previous tick.
    expect(cronMatchedInWindow('0 9 * * 5', friday0900, friday1015)).toBe(false);
  });

  it('includes an occurrence landing exactly on the window end', () => {
    const friday0900 = new Date(2026, 1, 13, 9, 0, 0).getTime();
    expect(cronMatchedInWindow('0 9 * * 5', friday0855, friday0900)).toBe(true);
  });

  it('rejects empty, inverted, and non-finite windows', () => {
    expect(cronMatchedInWindow('* * * * *', friday1015, friday0855)).toBe(false);
    expect(cronMatchedInWindow('* * * * *', friday0855, friday0855)).toBe(false);
    expect(cronMatchedInWindow('* * * * *', Number.NaN, friday1015)).toBe(false);
  });

  it('returns false for a malformed expression instead of throwing', () => {
    expect(cronMatchedInWindow('not a cron', friday0855, friday1015)).toBe(false);
  });
});

describe('cron-matcher', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should match wildcard cron (every minute)', () => {
    // '* * * * *' matches every minute
    expect(matchesCron('* * * * *')).toBe(true);
  });

  it('should match when current minute matches exactly', () => {
    // Set time to 09:30:15 on Feb 10, 2026
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 9, 30, 15));
    expect(matchesCron('30 9 * * *')).toBe(true);
  });

  it('should not match when minute does not match', () => {
    // Set time to 09:31:00
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 9, 31, 0));
    expect(matchesCron('30 9 * * *')).toBe(false);
  });

  it('should match at the start of the minute (00 seconds)', () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 14, 0, 0));
    expect(matchesCron('0 14 * * *')).toBe(true);
  });

  it('should match at 59 seconds within the minute', () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 14, 0, 59));
    expect(matchesCron('0 14 * * *')).toBe(true);
  });

  it('should not match at the next minute boundary', () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 14, 1, 0));
    expect(matchesCron('0 14 * * *')).toBe(false);
  });

  it('should match day-of-month and month fields', () => {
    // Feb 9 at 16:15
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 9, 16, 15, 0));
    expect(matchesCron('15 16 9 2 *')).toBe(true);
  });

  it('should not match wrong day-of-month', () => {
    // Feb 10 at 16:15 — day doesn't match
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 16, 15, 0));
    expect(matchesCron('15 16 9 2 *')).toBe(false);
  });

  it('should match with timezone conversion', () => {
    // Simulate 16:15 in Europe/Budapest (UTC+1 in winter)
    // That's 15:15 UTC
    jest.useFakeTimers(); jest.setSystemTime(new Date('2026-02-09T15:15:30Z'));
    expect(matchesCron('15 16 * * *', 'Europe/Budapest')).toBe(true);
  });

  it('should not match with explicit UTC timezone when time is wrong', () => {
    // 15:15 UTC — should not match 16:15 UTC
    jest.useFakeTimers(); jest.setSystemTime(new Date('2026-02-09T15:15:30Z'));
    expect(matchesCron('15 16 * * *', 'UTC')).toBe(false);
  });

  it('should match day-of-week', () => {
    // Feb 10, 2026 is a Tuesday (day 2)
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 12, 0, 0));
    expect(matchesCron('0 12 * * 2')).toBe(true);
  });

  it('should not match wrong day-of-week', () => {
    // Feb 10, 2026 is a Tuesday — should not match Wednesday (day 3)
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 12, 0, 0));
    expect(matchesCron('0 12 * * 3')).toBe(false);
  });

  it('should return false for invalid cron expression', () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    expect(matchesCron('invalid cron')).toBe(false);
    errorSpy.mockRestore();
  });

  it('should match every 5 minutes pattern', () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 10, 15, 0));
    expect(matchesCron('*/5 * * * *')).toBe(true);
  });

  it('should not match between 5-minute intervals', () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 1, 10, 10, 13, 0));
    expect(matchesCron('*/5 * * * *')).toBe(false);
  });
});

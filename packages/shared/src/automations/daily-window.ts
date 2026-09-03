export interface DailyScheduleWindow {
  /** Inclusive local start time in HH:mm format. */
  start: string;
  /** Inclusive local end time in HH:mm format. Must be on the same day. */
  end: string;
}

interface LocalMinute {
  dateKey: string;
  minuteOfDay: number;
}

const MINUTE_MS = 60_000;
const MAX_CATCH_UP_MS = 8 * 24 * 60 * MINUTE_MS;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function scheduledMinuteForDailyWindow(
  identity: string,
  dateKey: string,
  window: DailyScheduleWindow,
): number | null {
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  if (start === null || end === null || end < start) return null;
  return start + (stableHash(`${identity}:${dateKey}`) % (end - start + 1));
}

export function dailyWindowMatchesAt(
  identity: string,
  window: DailyScheduleWindow,
  atMs: number,
  timezone?: string,
): boolean {
  const local = localMinuteAt(atMs, timezone);
  if (!local) return false;
  return scheduledMinuteForDailyWindow(identity, local.dateKey, window) === local.minuteOfDay;
}

export function dailyWindowMatchedInRange(
  identity: string,
  window: DailyScheduleWindow,
  fromExclusiveMs: number,
  toInclusiveMs: number,
  timezone?: string,
): boolean {
  if (!Number.isFinite(fromExclusiveMs) || !Number.isFinite(toInclusiveMs) || toInclusiveMs <= fromExclusiveMs) return false;
  const floor = Math.max(fromExclusiveMs, toInclusiveMs - MAX_CATCH_UP_MS);
  let cursor = Math.floor(floor / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const end = Math.floor(toInclusiveMs / MINUTE_MS) * MINUTE_MS;
  for (; cursor <= end; cursor += MINUTE_MS) {
    if (dailyWindowMatchesAt(identity, window, cursor, timezone)) return true;
  }
  return false;
}

export function nextDailyWindowRuns(
  identity: string,
  window: DailyScheduleWindow,
  count: number,
  timezone?: string,
  fromMs = Date.now(),
): Date[] {
  if (!Number.isFinite(fromMs) || !Number.isInteger(count) || count <= 0) return [];
  const runs: Date[] = [];
  let cursor = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const end = cursor + (count + 2) * 25 * 60 * MINUTE_MS;
  for (; cursor <= end && runs.length < count; cursor += MINUTE_MS) {
    if (dailyWindowMatchesAt(identity, window, cursor, timezone)) runs.push(new Date(cursor));
  }
  return runs;
}

function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function localMinuteAt(atMs: number, timezone?: string): LocalMinute | null {
  try {
    const timeZone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let formatter = formatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        hourCycle: 'h23',
      });
      formatterCache.set(timeZone, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(new Date(atMs)).map((part) => [part.type, part.value]));
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    if (!parts.year || !parts.month || !parts.day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, minuteOfDay: hour * 60 + minute };
  } catch {
    return null;
  }
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

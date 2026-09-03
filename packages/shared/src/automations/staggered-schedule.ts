import { Cron } from 'croner'

export type AutomaticScheduleCadence = 'daily' | 'weekly' | 'monthly'

export const AUTOMATIC_SCHEDULE_PLACEMENT_UNAVAILABLE = 'AUTOMATIC_SCHEDULE_PLACEMENT_UNAVAILABLE'

export function automaticSchedulePlacementUnavailableError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${AUTOMATIC_SCHEDULE_PLACEMENT_UNAVAILABLE}: ${detail}`)
}

export function isAutomaticSchedulePlacementUnavailable(error: unknown): boolean {
  return String(error).includes(AUTOMATIC_SCHEDULE_PLACEMENT_UNAVAILABLE)
}

export interface ExistingAutomationSchedule {
  cron?: string
  enabled?: boolean
  timezone?: string
}

export interface AutomaticScheduleOptions {
  timezone?: string
  now?: Date
}

export interface AutomaticScheduleSuggestion {
  cadence: AutomaticScheduleCadence
  cron: string
  label: string
  dayOfWeek?: number
  dayOfMonth?: number
  hour: number
  minute: number
}

interface ScheduleSlot {
  dayOfWeek?: number
  dayOfMonth?: number
  hour: number
  minute: number
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const DAY_INDEX = new Map(DAY_NAMES.map((day, index) => [day.slice(0, 3), index]))

// A wide daytime window keeps automatic work useful without waking the user
// or compressing every background job into the first hour of the day.
const DAYTIME_SLOTS: Array<Pick<ScheduleSlot, 'hour' | 'minute'>> = Array.from(
  { length: 18 },
  (_, index) => ({
    hour: 9 + Math.floor(index / 2),
    minute: index % 2 === 0 ? 0 : 30,
  }),
)

export function suggestAutomaticSchedule(
  existing: ExistingAutomationSchedule[],
  cadence: AutomaticScheduleCadence,
  options: AutomaticScheduleOptions = {},
): AutomaticScheduleSuggestion {
  const timezone = options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const now = options.now ?? new Date()
  const occupancy = buildOccupancy(existing, timezone, now)
  const candidates: ScheduleSlot[] = cadence === 'daily'
    ? DAYTIME_SLOTS.map((time) => ({ ...time }))
    : cadence === 'weekly'
      ? DAYTIME_SLOTS.flatMap((time) => WEEKDAYS.map((dayOfWeek) => ({ ...time, dayOfWeek })))
      : DAYTIME_SLOTS.flatMap((time) => Array.from({ length: 28 }, (_, day) => ({ ...time, dayOfMonth: day + 1 })))

  const selected = candidates.reduce((best, candidate) => (
    slotLoad(candidate, cadence, occupancy) < slotLoad(best, cadence, occupancy)
      ? candidate
      : best
  ), candidates[0]!)

  return {
    cadence,
    cron: cadence === 'daily'
      ? `${selected.minute} ${selected.hour} * * *`
      : cadence === 'weekly'
        ? `${selected.minute} ${selected.hour} * * ${selected.dayOfWeek}`
        : `${selected.minute} ${selected.hour} ${selected.dayOfMonth} * *`,
    label: cadence === 'daily'
      ? `Every day at ${formatTime(selected.hour, selected.minute)}`
      : cadence === 'weekly'
        ? `${DAY_NAMES[selected.dayOfWeek!]} at ${formatTime(selected.hour, selected.minute)}`
        : `Monthly on day ${selected.dayOfMonth} at ${formatTime(selected.hour, selected.minute)}`,
    ...selected,
  }
}

function buildOccupancy(
  existing: ExistingAutomationSchedule[],
  targetTimezone: string,
  now: Date,
): { weekly: Map<string, number>; monthly: Map<string, number> } {
  const occupancy = {
    weekly: new Map<string, number>(),
    monthly: new Map<string, number>(),
  }
  const formatter = createSlotFormatter(targetTimezone)
  for (const schedule of existing) {
    if (schedule.enabled === false || !schedule.cron || !isPlaceableRecurringCron(schedule.cron)) continue
    for (const run of nextRuns(schedule.cron, schedule.timezone || targetTimezone, now, occurrenceLookahead(schedule.cron))) {
      const slot = formatSlot(run, formatter)
      if (!slot) continue
      const weeklyKey = slotKey(slot.dayOfWeek!, slot.hour, slot.minute)
      occupancy.weekly.set(weeklyKey, (occupancy.weekly.get(weeklyKey) ?? 0) + 1)
      const monthlyKey = slotKey(slot.dayOfMonth!, slot.hour, slot.minute)
      occupancy.monthly.set(monthlyKey, (occupancy.monthly.get(monthlyKey) ?? 0) + 1)
    }
  }
  return occupancy
}

function occurrenceLookahead(cron: string): number {
  const fields = cron.trim().split(/\s+/)
  if (fields[2] !== '*') return 14
  if (fields[4] !== '*') return 54
  return 42
}

function isPlaceableRecurringCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/)
  return fields.length === 5
    && /^\d+$/.test(fields[0]!)
    && /^\d+$/.test(fields[1]!)
    && fields[3] === '*'
    && (fields[2] === '*' || /^\d+$/.test(fields[2]!))
    && (fields[4] === '*' || /^\d+$/.test(fields[4]!))
    && !(fields[2] !== '*' && fields[4] !== '*')
}

function slotLoad(
  slot: ScheduleSlot,
  cadence: AutomaticScheduleCadence,
  occupancy: { weekly: Map<string, number>; monthly: Map<string, number> },
): number {
  if (cadence === 'monthly') {
    return occupancy.monthly.get(slotKey(slot.dayOfMonth!, slot.hour, slot.minute)) ?? 0
  }
  const days = cadence === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [slot.dayOfWeek!]
  return days.reduce(
    (total, dayOfWeek) => total + (occupancy.weekly.get(slotKey(dayOfWeek, slot.hour, slot.minute)) ?? 0),
    0,
  )
}

function nextRuns(cron: string, timezone: string, now: Date, count: number): Date[] {
  try {
    return new Cron(cron, { timezone, paused: true }).nextRuns(count, now)
  } catch {
    return []
  }
}

function createSlotFormatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
  }
}

function formatSlot(run: Date, formatter: Intl.DateTimeFormat): ScheduleSlot | null {
  const parts = Object.fromEntries(formatter.formatToParts(run).map((part) => [part.type, part.value]))
  const dayOfWeek = DAY_INDEX.get(parts.weekday ?? '')
  const dayOfMonth = Number(parts.day)
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  if (dayOfWeek === undefined || !Number.isInteger(dayOfMonth) || !Number.isInteger(hour) || !Number.isInteger(minute)) return null
  return { dayOfWeek, dayOfMonth, hour, minute }
}

function slotKey(dayOfWeek: number, hour: number, minute: number): string {
  return `${dayOfWeek}:${hour}:${minute}`
}

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

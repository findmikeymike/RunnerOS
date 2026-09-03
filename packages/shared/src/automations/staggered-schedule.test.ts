import { describe, expect, test } from 'bun:test'
import {
  automaticSchedulePlacementUnavailableError,
  isAutomaticSchedulePlacementUnavailable,
  suggestAutomaticSchedule,
} from './staggered-schedule'

describe('suggestAutomaticSchedule', () => {
  test('distinguishes occupancy failures from unrelated save errors after RPC wrapping', () => {
    const placementError = automaticSchedulePlacementUnavailableError(new Error('workspace unreadable'))
    const wrapped = new Error(`Error invoking remote method: ${placementError.message}`)

    expect(isAutomaticSchedulePlacementUnavailable(wrapped)).toBe(true)
    expect(isAutomaticSchedulePlacementUnavailable(new Error('Invalid automation: invalid timezone'))).toBe(false)
  })

  test('spreads weekly work across weekdays before reusing a day and time', () => {
    const existing = [1, 2, 3, 4].map((dayOfWeek) => ({ cron: `0 9 * * ${dayOfWeek}` }))

    expect(suggestAutomaticSchedule(existing, 'weekly')).toEqual({
      cadence: 'weekly',
      cron: '0 9 * * 5',
      label: 'Friday at 9:00 AM',
      dayOfWeek: 5,
      hour: 9,
      minute: 0,
    })
  })

  test('moves daily work to the next open daytime slot', () => {
    const existing = [
      { cron: '0 9 * * *' },
      { cron: '30 9 * * *' },
    ]

    expect(suggestAutomaticSchedule(existing, 'daily')).toMatchObject({
      cron: '0 10 * * *',
      label: 'Every day at 10:00 AM',
    })
  })

  test('spreads monthly work across safe calendar days before reusing a day and time', () => {
    const existing = [1, 2, 3].map((dayOfMonth) => ({ cron: `0 9 ${dayOfMonth} * *` }))

    expect(suggestAutomaticSchedule(existing, 'monthly', {
      now: new Date('2026-07-01T12:00:00.000Z'),
      timezone: 'America/Chicago',
    })).toEqual({
      cadence: 'monthly',
      cron: '0 9 4 * *',
      label: 'Monthly on day 4 at 9:00 AM',
      dayOfMonth: 4,
      hour: 9,
      minute: 0,
    })
  })

  test('limits automatic monthly placement to days present in every month', () => {
    const existing = Array.from({ length: 28 }, (_, index) => ({ cron: `0 9 ${index + 1} * *` }))
    const suggestion = suggestAutomaticSchedule(existing, 'monthly')

    expect(suggestion.dayOfMonth).toBe(1)
    expect(suggestion.cron).toBe('30 9 1 * *')
  })

  test('accounts for daily schedules when assigning weekly work', () => {
    expect(suggestAutomaticSchedule([{ cron: '0 9 * * *' }], 'weekly')).toMatchObject({
      cron: '30 9 * * 1',
      label: 'Monday at 9:30 AM',
    })
  })

  test('ignores disabled and complex schedules it cannot place precisely', () => {
    const suggestion = suggestAutomaticSchedule([
      { cron: '0 9 * * *', enabled: false },
      { cron: '*/10 * * * *' },
    ], 'daily')

    expect(suggestion.cron).toBe('0 9 * * *')
  })

  test('avoids the same real-world slot across different timezones', () => {
    const suggestion = suggestAutomaticSchedule([
      { cron: '0 10 * * 1', timezone: 'America/New_York' },
    ], 'weekly', {
      timezone: 'America/Chicago',
      now: new Date('2026-07-01T12:00:00.000Z'),
    })

    expect(suggestion).toMatchObject({
      cron: '0 9 * * 2',
      label: 'Tuesday at 9:00 AM',
    })
  })
})

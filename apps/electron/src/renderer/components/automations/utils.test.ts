import { describe, expect, test } from 'bun:test'
import { computeNextRuns, formatNextRun } from './utils'

describe('automation schedule display', () => {
  test('computes cron runs in the automation timezone', () => {
    const utc = computeNextRuns('0 9 * * *', 1, 'UTC')
    const newYork = computeNextRuns('0 9 * * *', 1, 'America/New_York')

    expect(utc).toHaveLength(1)
    expect(newYork).toHaveLength(1)
    expect(utc[0]?.getTime()).not.toBe(newYork[0]?.getTime())
  })

  test('formats the same instant in the displayed timezone', () => {
    const instant = new Date('2026-09-01T13:00:00.000Z')

    expect(formatNextRun(instant, false, 'UTC')).toContain('13:00')
    expect(formatNextRun(instant, false, 'America/New_York')).toContain('09:00')
  })
})

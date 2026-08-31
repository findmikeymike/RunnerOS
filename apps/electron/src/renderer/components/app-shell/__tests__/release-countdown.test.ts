import { describe, expect, test } from 'bun:test'
import { getReleaseCountdown } from '../release-countdown'

describe('release countdown', () => {
  test('counts local calendar days without daylight-saving drift', () => {
    const result = getReleaseCountdown('2026-09-12', '2026-08-01', new Date(2026, 7, 31, 23, 30))

    expect(result.daysUntil).toBe(12)
    expect(result.released).toBe(false)
    expect(result.releaseDay).toBe(false)
    expect(result.progress).toBeGreaterThan(0)
  })

  test('identifies release day and past releases', () => {
    const releaseDay = getReleaseCountdown('2026-08-31', undefined, new Date(2026, 7, 31, 8))
    const released = getReleaseCountdown('2026-08-28', undefined, new Date(2026, 7, 31, 8))

    expect(releaseDay).toMatchObject({ daysUntil: 0, releaseDay: true, released: false, progress: 1 })
    expect(released).toMatchObject({ daysUntil: -3, releaseDay: false, released: true, progress: 1 })
  })

  test('keeps a bounded progress value for distant future releases', () => {
    const result = getReleaseCountdown('2028-08-31', '2026-08-31', new Date(2026, 7, 31, 8))

    expect(result.daysUntil).toBe(731)
    expect(result.progress).toBe(0)
    expect(result.released).toBe(false)
    expect(result.releaseDay).toBe(false)
  })

  test('fails softly when onboarding has no valid release date', () => {
    expect(getReleaseCountdown(undefined, undefined, new Date(2026, 7, 31, 8))).toEqual({
      hasDate: false,
      daysUntil: null,
      progress: 0,
      released: false,
      releaseDay: false,
      dateLabel: 'Date not set',
    })
    expect(getReleaseCountdown('2026-02-31', undefined, new Date(2026, 0, 1)).hasDate).toBe(false)
  })
})

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Campaign calendar layout', () => {
  test('fills the remaining page height with six responsive week rows', () => {
    const page = readFileSync(join(import.meta.dir, '..', 'CampaignCalendarPage.tsx'), 'utf8')
    const monthGrid = readFileSync(join(import.meta.dir, '..', 'CalendarMonthGrid.tsx'), 'utf8')

    expect(page).toContain('flex min-h-[430px] flex-1 flex-col rounded-2xl')
    expect(monthGrid).toContain('flex min-h-0 flex-1 flex-col rounded-[16px]')
    expect(monthGrid).toContain('grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1')
  })
})

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Calendar page layout', () => {
  test('campaign calendar fills the remaining page height with six responsive week rows', () => {
    const page = readFileSync(join(import.meta.dir, '..', 'CampaignCalendarPage.tsx'), 'utf8')
    const monthGrid = readFileSync(join(import.meta.dir, '..', 'CalendarMonthGrid.tsx'), 'utf8')

    expect(page).toContain('flex min-h-[430px] flex-1 flex-col rounded-2xl')
    expect(monthGrid).toContain('flex min-h-0 flex-1 flex-col rounded-[16px]')
    expect(monthGrid).toContain('grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1')
  })

  test('HQ calendar passes the available page height through to the shared month grid', () => {
    const page = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(page).toContain('mx-auto flex min-h-full w-full max-w-[1600px] flex-col')
    expect(page).toContain('<HQCard className="flex min-h-[430px] flex-1 flex-col">')
    expect(page).toContain('<div className="flex min-h-0 flex-1 flex-col">')
  })
})

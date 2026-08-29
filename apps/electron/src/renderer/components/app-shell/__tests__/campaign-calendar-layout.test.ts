import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Calendar page layout', () => {
  test('campaign calendar fills the remaining page height with six responsive week rows', () => {
    const page = readFileSync(join(import.meta.dir, '..', 'CampaignCalendarPage.tsx'), 'utf8')
    const monthGrid = readFileSync(join(import.meta.dir, '..', 'CalendarMonthGrid.tsx'), 'utf8')

    expect(page).toContain('flex min-h-[430px] flex-1 flex-col rounded-2xl')
    expect(monthGrid).toContain('<div className="flex min-h-0 flex-1 flex-col">')
    expect(monthGrid).toContain('grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1')
  })

  test('HQ Plan uses a compact calendar above the board', () => {
    const page = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(page).toContain("tab === 'calendar' ? 'h-full min-h-0' : 'min-h-full'")
    expect(page).toContain('<HQCard className="flex min-h-0 flex-1 flex-col overflow-hidden border-white/[0.08] bg-[#0C0D0E] p-3">')
    expect(page).toContain('<div className="flex h-[400px] shrink-0 flex-col">')
    expect(page).toContain('<AgendaPage')
    expect(page).toContain('embedded')
    expect(page).toContain('id="plan-kanban" className="-mx-3 mt-4 min-h-[140px] flex-1 border-t')
    expect(page.indexOf('onClick={connectGoogleCalendar}')).toBeLessThan(page.indexOf('<HQCard className="flex min-h-0 flex-1'))
    expect(page.indexOf('onClick={syncGoogleCalendar}')).toBeLessThan(page.indexOf('<HQCard className="flex min-h-0 flex-1'))
  })

  test('shared calendar avoids a nested shell while keeping distinct day tiles', () => {
    const monthGrid = readFileSync(join(import.meta.dir, '..', 'CalendarMonthGrid.tsx'), 'utf8')

    expect(monthGrid).not.toContain('border border-white/[0.10] bg-[#232629]')
    expect(monthGrid).not.toContain('rounded-[16px]')
    expect(monthGrid).toContain('bg-[#0F0F10]')
    expect(monthGrid).toContain('bg-[#090A0B]')
    expect(monthGrid).toContain('border-[#f97316]/60')
    expect(monthGrid).toContain("compact ? 'min-h-[48px]' : 'min-h-[56px]'")
    expect(monthGrid).toContain("'text-[13px] font-medium'")
    expect(monthGrid).not.toContain('bg-[#342014]')
    expect(monthGrid).not.toContain('bg-[#111214]')
  })
})

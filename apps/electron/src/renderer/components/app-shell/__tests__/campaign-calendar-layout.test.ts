import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Calendar page layout', () => {
  test('campaign calendar fills the remaining page height with six responsive week rows', () => {
    const page = readFileSync(join(import.meta.dir, '..', 'CampaignCalendarPage.tsx'), 'utf8')
    const monthGrid = readFileSync(join(import.meta.dir, '..', 'CalendarMonthGrid.tsx'), 'utf8')

    expect(page).toContain('flex min-h-[430px] flex-1 flex-col rounded-2xl')
    expect(monthGrid).toContain("'flex min-h-0 flex-1 flex-col'")
    expect(monthGrid).toContain("'grid min-h-0 flex-1 grid-cols-7 grid-rows-6'")
  })

  test('workspace Calendar keeps its surface and adds the embedded task board beside it', () => {
    const page = readFileSync(join(import.meta.dir, '..', 'CampaignCalendarPage.tsx'), 'utf8')
    const main = readFileSync(join(import.meta.dir, '..', 'MainContentPanel.tsx'), 'utf8')

    expect(page).toContain('lg:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.85fr)]')
    expect(page).toContain('lg:h-full lg:min-h-0')
    expect(page).toContain('lg:overflow-hidden')
    expect(page).toContain('<CampaignCalendarSurface')
    expect(page).toContain('title="Plan"')
    expect(page).toContain('id="campaign-calendar-kanban"')
    expect(page).toContain('<AgendaPage')
    expect(page).toContain('embedded')
    expect(page).toContain('bg-[#17191B]')
    const agenda = readFileSync(join(import.meta.dir, '..', 'AgendaPage.tsx'), 'utf8')
    expect(agenda).toContain('tracking-[0.16em] text-white/50')
    expect(agenda).toContain('h-3.5 w-3.5 text-[#f97316]')
    expect(agenda).toContain('overflow-y-auto overscroll-contain')
    expect(agenda).toContain('cursor-grab p-1 text-white/30 transition-colors')
    expect(agenda).not.toContain("session.isProcessing ? 'text-orange-300' : 'text-white/24'")
    expect(agenda).not.toContain('group-hover:opacity-100')
    expect(agenda).toContain('<ContextMenuTrigger asChild>')
    expect(agenda).toContain('minWidth="min-w-0"')
    expect(agenda).toContain('variant="destructive"')
    expect(agenda).toContain('onDelete={() => void deleteAgendaSession(session, true)}')
    expect(agenda).toContain('onDeleteTask(session.id, skipConfirmation)')
    expect(main).toContain('onDeleteSession(sessionId, skipConfirmation)')
    expect(main).toContain('agendaSessions={workspaceSessions}')
    expect(main).toContain('onCreateAgendaTask={handleCreateAgendaTask}')
    expect(main).toContain('onDeleteAgendaTask={handleDeleteAgendaTask}')
    expect(main).toContain("networkWorkspaceId={artistHQWorkspace?.id || activeWorkspaceId || ''}")
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    expect(shell).toMatch(/id: "nav:calendar",\s+title: "Plan"/)
    expect(shell).toMatch(/if \(!isArtistHQWorkspace\) \{[\s\S]*?id: "nav:campaign"[\s\S]*?id: "nav:release-kit"[\s\S]*?id: "nav:calendar"[\s\S]*?id: "nav:work"/)
  })

  test('HQ Plan uses a wide calendar beside a compact task board', () => {
    const page = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(page).toContain("tab === 'calendar' ? 'h-full min-h-0' : 'min-h-full'")
    expect(page).toContain("'h-full bg-[#050505] text-foreground'")
    expect(page).toContain("tab === 'calendar' ? 'overflow-hidden' : 'overflow-y-auto'")
    expect(page).toContain('<HQCard className="flex min-h-0 flex-1 flex-col overflow-hidden border-white/[0.08] bg-[#050505] p-0">')
    expect(page).toContain('lg:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.85fr)]')
    expect(page).toContain('<div className="flex min-h-[430px] min-w-0 flex-col p-3 lg:min-h-0 lg:pr-4">')
    expect(page).toContain('appearance="paper"')
    expect(page).toContain('<AgendaPage')
    expect(page).toContain('embedded')
    expect(page).toContain('id="plan-kanban" className="min-h-[280px] overflow-hidden border-t')
    expect(page).toContain('bg-[#17191B]')
    expect(page).toContain('lg:border-l lg:border-t-0')
    expect(page.indexOf('onClick={connectGoogleCalendar}')).toBeLessThan(page.indexOf('<HQCard className="flex min-h-0 flex-1'))
    expect(page.indexOf('onClick={syncGoogleCalendar}')).toBeLessThan(page.indexOf('<HQCard className="flex min-h-0 flex-1'))
  })

  test('shared calendar avoids a nested shell while keeping distinct day tiles', () => {
    const monthGrid = readFileSync(join(import.meta.dir, '..', 'CalendarMonthGrid.tsx'), 'utf8')

    expect(monthGrid).not.toContain('border border-white/[0.10] bg-[#232629]')
    expect(monthGrid).not.toContain('rounded-[16px]')
    expect(monthGrid).toContain('bg-[#121314]')
    expect(monthGrid).toContain('bg-[#090A0B]')
    expect(monthGrid).toContain('border-[#f97316]/60')
    expect(monthGrid).toContain("compact ? 'min-h-[48px]' : 'min-h-[56px]'")
    expect(monthGrid).toContain("'text-[13px] font-medium'")
    expect(monthGrid).not.toContain('bg-[#342014]')
    expect(monthGrid).not.toContain('bg-[#111214]')
  })

  test('calendar day popovers toggle closed when the active day is clicked again', () => {
    const monthGrid = readFileSync(join(import.meta.dir, '..', 'CalendarMonthGrid.tsx'), 'utf8')

    expect(monthGrid).toContain('data-calendar-day-trigger')
    expect(monthGrid).toContain("closest('[data-calendar-day-menu], [data-calendar-day-trigger]')")
    expect(monthGrid).toContain('setMenu((current) => current?.date === date')
    expect(monthGrid).toContain('? null')
  })

  test('Plan can use a continuous soot calendar without changing the shared dark default', () => {
    const monthGrid = readFileSync(join(import.meta.dir, '..', 'CalendarMonthGrid.tsx'), 'utf8')

    expect(monthGrid).toContain("appearance = 'dark'")
    expect(monthGrid).toContain("appearance?: 'dark' | 'paper'")
    expect(monthGrid).toContain("paper && 'rounded-[12px] bg-[#17191B]")
    expect(monthGrid).toContain("bg-[#17191B]")
    expect(monthGrid).toContain("bg-[#202224]")
    expect(monthGrid).toContain("isToday")
    expect(monthGrid).toContain("radial-gradient(circle_at_100%_0%,rgba(249,115,22,0.13),transparent_62%)")
    expect(monthGrid).toContain("#090A0B] ring-1 ring-inset ring-[#f97316]")
    expect(monthGrid).not.toContain("bg-white ring-1 ring-inset ring-[#f97316]")
    expect(monthGrid).toContain("gap-0 overflow-hidden rounded-[9px] border border-white/[0.10]")
    expect(monthGrid).toContain("dayIndex % 7 !== 6 && 'border-r border-white/[0.10]'")
    expect(monthGrid).toContain("dayIndex < 35 && 'border-b border-white/[0.10]'")
    expect(monthGrid).toContain("bg-[#17191B] ring-1 ring-inset ring-[#f97316]")
    expect(monthGrid).not.toContain("paper ? 'rounded-[3px]'")
  })
})

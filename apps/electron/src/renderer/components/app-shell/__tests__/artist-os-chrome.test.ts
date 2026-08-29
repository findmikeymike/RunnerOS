import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Artist OS persistent shell chrome', () => {
  test('uses the thin ScriptOS-style sidebar and bottom-corner toggle', () => {
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    const openToggle = shell.indexOf('data-testid="sidebar-toggle-open"')
    const panelShell = shell.indexOf('=== OUTER LAYOUT: Unified Panel Stack')

    expect(openToggle).toBeGreaterThan(-1)
    expect(openToggle).toBeLessThan(panelShell)
    expect(shell).toContain('data-testid="sidebar-toggle-close"')
    expect(shell).toContain('pointer-events-auto absolute bottom-3 right-2 z-[80]')
    expect(shell).toContain('pointer-events-auto fixed bottom-3 left-2 z-[100]')
    expect(shell).toContain('usesWorkspaceHeader ? "px-3 pb-10 pt-10"')
    expect(shell).not.toContain('w-[56px]')
    expect(shell).not.toContain('<PanelLeftRounded')
  })

  test('keeps clickable traffic lights and the header divider permanently rendered', () => {
    const topBar = readFileSync(join(import.meta.dir, '..', 'TopBar.tsx'), 'utf8')
    const windowManager = readFileSync(
      join(import.meta.dir, '..', '..', '..', '..', 'main', 'window-manager.ts'),
      'utf8',
    )

    expect(topBar).toContain("RENDERER_PRODUCT_VARIANT === 'artist-os'")
    expect(topBar).toContain('data-testid="persistent-mac-window-controls"')
    expect(topBar).toContain('border-b border-white/10 bg-black text-white')
    expect(topBar).toContain('bg-[#ff5f57]')
    expect(topBar).toContain('bg-[#febc2e]')
    expect(topBar).toContain('bg-[#28c840]')
    expect(topBar).toContain('window.electronAPI.closeWindow()')
    expect(topBar).toContain('window.electronAPI.menuMinimize()')
    expect(topBar).toContain('window.electronAPI.menuMaximize()')
    expect(windowManager).toContain("RUNTIME_IDENTITY.variant === 'artist-os' ? false : visible")
    expect(windowManager).toContain("window.on('restore', keepArtistTrafficLightsStable)")
    expect(windowManager).toContain('managed.window.setWindowButtonVisibility(shouldShow)')
  })

  test('names the HQ and campaign agent front door Command', () => {
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')

    expect(shell).toMatch(/id: "nav:chat",\s+title: "Command",\s+label:[\s\S]*?icon: Sparkles/)
    expect(shell).toMatch(/id: "nav:work-chat",\s+title: "Command",\s+label:[\s\S]*?icon: Sparkles/)
  })

  test('keeps the black canvas scoped to Artist OS main content', () => {
    const panelSlot = readFileSync(join(import.meta.dir, '..', 'PanelSlot.tsx'), 'utf8')
    const styles = readFileSync(join(import.meta.dir, '..', '..', '..', 'index.css'), 'utf8')

    expect(panelSlot).toContain("RENDERER_PRODUCT_VARIANT === 'artist-os' && 'artist-os-main-canvas'")
    expect(styles).toContain('.artist-os-main-canvas {')
    expect(styles).toContain('background: #050505;')
    expect(styles).toContain('.artist-os-main-canvas .bg-\\[\\#050505\\]')
  })

  test('uses a black HQ hero with one orange glow on the right', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(hq).toContain('min-h-[250px]')
    expect(hq).toContain('bg-[radial-gradient(circle_at_100%_50%,rgba(249,115,22,0.26),transparent_48%),#050505]')
    expect(hq).toContain("orb1: 'bg-transparent'")
    expect(hq).toContain("orb2: 'bg-transparent'")
  })

  test('keeps Network on the compact Work page hero height', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(hq).toContain("const usesCompactSectionHeader = tab === 'network'")
    expect(hq).toContain("usesCompactSectionHeader ? 'min-h-[230px]' : 'min-h-[250px]'")
  })

  test('uses one direct Plan destination with a compact blue header and unified calendar board', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    const planItem = shell.slice(shell.indexOf('id: "nav:plan"'), shell.indexOf('id: "nav:people"'))
    const calendar = hq.indexOf('<ArtistCalendarView')
    const board = hq.indexOf('<AgendaPage', calendar)
    const planCardEnd = hq.indexOf('</HQCard>', board)

    expect(hq).toContain("{tab !== 'calendar' ? (")
    expect(hq).toContain('>Plan</h1>')
    expect(hq).toContain('min-h-[118px]')
    expect(hq).toContain('bg-[linear-gradient(105deg,#07090D_0%,#0A1020_58%,#102A55_100%)]')
    expect(hq).toContain('<ArtistCalendarView\n                compact')
    expect(board).toBeGreaterThan(calendar)
    expect(planCardEnd).toBeGreaterThan(board)
    expect(hq).toContain('embedded\n                  sessions={agendaSessions}')
    expect(hq).toContain('id="plan-kanban" className="-mx-3 mt-4 min-h-[140px] flex-1 border-t')
    expect(hq).not.toContain('planBoardOpen')
    expect(hq).toContain("tab === 'calendar' ? 'overflow-hidden' : 'overflow-y-auto'")
    const agenda = readFileSync(join(import.meta.dir, '..', 'AgendaPage.tsx'), 'utf8')
    expect(agenda).toContain('aria-label="Add task to To Do"')
    expect(agenda).toContain("embedded && 'min-h-0 flex-1 overflow-y-auto pr-0.5'")
    expect(agenda).toContain("? 'h-full min-h-0 overflow-hidden rounded-[14px] border border-white/[0.055] bg-[#0C0D0E] divide-y divide-white/[0.055] lg:divide-x lg:divide-y-0'")
    expect(agenda).toContain("? 'flex min-h-0 flex-col p-3'")
    expect(agenda).not.toContain('Nothing here.')
    expect(agenda).toContain('Delete task')
    expect(agenda).toContain('Discussion')
    expect(agenda).not.toContain('Open Thread')
    expect(planItem).toContain("onClick: () => handleArtistHQNavClick('calendar')")
    expect(planItem).not.toContain('expandable: true')
  })

  test('keeps HQ cards darker than soot but distinct from the black canvas', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(hq).toContain("bg-[#0C0D0E] p-4")
    expect(hq).toContain("bg-[#0F0F10] p-4")
  })

  test('places the quieter next move below Projects and uses vivid orange Pulse accents', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const projects = hq.indexOf('<SectionTitle icon={FolderKanban} title="Projects"')
    const nextMove = hq.indexOf('<StateOfPlayPanel')
    const workers = hq.indexOf('>Workers &amp; signals</span>')

    expect(projects).toBeGreaterThan(-1)
    expect(nextMove).toBeGreaterThan(projects)
    expect(workers).toBeGreaterThan(nextMove)
    expect(hq).toContain('text-sm font-medium tracking-tight text-white/88')
    expect(hq).toContain('text-[#f97316]')
  })

  test('shows Pulse cards directly and styles Workers and signals like the next-move row', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(hq).not.toContain('<span>More details</span>')
    expect(hq).toContain('<HQCard className="overflow-hidden p-0">')
    expect(hq).toContain('>Workers &amp; signals</span>')
    expect(hq).toContain('h-1.5 w-1.5 shrink-0 rounded-full bg-[#f97316]')
    expect(hq).toContain("active ? 'text-[#f97316]/85'")
    expect(hq).toContain('bottom-0 h-px bg-[#f97316]')
  })

  test('orders Spotify before Social and keeps Social focused on Instagram analytics', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const spotify = hq.indexOf('<SpotifyPulseCard')
    const social = hq.indexOf('<SocialPulseCard')
    const intel = hq.indexOf('<IntelPulseCard')

    expect(spotify).toBeGreaterThan(-1)
    expect(social).toBeGreaterThan(spotify)
    expect(intel).toBeGreaterThan(social)
    expect(hq).toContain('<SignalStat label="Followers"')
    expect(hq).toContain('<SignalStat label="Reach"')
    expect(hq).toContain('<SignalStat label="Interactions"')
    expect(hq).not.toContain('<SignalStat label="Profiles"')
    expect(hq).not.toContain('<SignalStat label="Account sets"')
  })
})

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

  test('uses the global compact page header for HQ', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const compactHeader = readFileSync(join(import.meta.dir, '..', 'CompactPageHeader.tsx'), 'utf8')

    expect(hq).toContain('<CompactPageHeader')
    expect(hq).toContain("const headerTone = tab === 'profile' || tab === 'branding' ? 'blue' : tab === 'voice' ? 'red' : 'orange'")
    expect(hq).toContain('dimBackgroundImage={SHOW_HQ_BANNER_FILTER}')
    expect(hq).toContain("borderless={tab === 'home'}")
    expect(hq).toContain("titleClassName={tab === 'home' ? 'text-[50px]' : undefined}")
    expect(hq).toContain("after:ring-2 after:ring-inset after:ring-[#050505]")
    expect(hq).not.toContain("!border-transparent")
    expect(compactHeader).toContain("!borderless && 'border'")
    expect(compactHeader).toContain('min-h-[154px]')
    expect(compactHeader).not.toContain('min-h-[118px]')
    expect(compactHeader).toContain('const GLOBAL_HERO_BACKGROUND')
    expect(compactHeader).toContain('radial-gradient(70% 54% at 50% 118%')
    expect(compactHeader).toContain('linear-gradient(90deg, #D90B16 0%, #F22409 20%, #FF5A00 50%')
    expect(compactHeader).not.toContain('globalHeroBackground')
    expect(compactHeader).not.toContain('<img src={resolvedBackgroundImage}')
    expect(compactHeader).toContain('rounded-[22px]')
    expect(compactHeader).not.toContain('rounded-full blur')
    expect(compactHeader).toContain('className="min-w-0 self-end"')
    expect(compactHeader).toContain("cn('mt-1 truncate text-[30px] font-medium tracking-tight text-white/92', titleClassName)")
  })

  test('uses one direct People destination and a shared compact Network/Community header', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const community = readFileSync(join(import.meta.dir, '..', 'CommunityPage.tsx'), 'utf8')
    const peopleHeader = readFileSync(join(import.meta.dir, '..', 'PeoplePageHeader.tsx'), 'utf8')
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    const peopleStart = shell.indexOf('id: "nav:people"')
    const peopleItem = shell.slice(peopleStart, shell.indexOf('id: "nav:work"', peopleStart))

    expect(peopleItem).toContain("onClick: () => handleArtistHQNavClick('network')")
    expect(peopleItem).not.toContain('expandable: true')
    expect(peopleItem).not.toContain('items: [')
    expect(hq).toMatch(/<PeoplePageHeader\s+activeView="network"/)
    expect(community).toContain('<PeoplePageHeader activeView="community"')
    expect(peopleHeader).toContain('<CompactPageHeader')
    expect(peopleHeader).toContain('tone="emerald"')
    expect(peopleHeader).toContain('role="tablist"')
    expect(peopleHeader).toContain("(['network', 'community'] as const)")
    expect(community).toContain('aria-label="Community actions"')
    expect(community).toContain('<StyledDropdownMenuContent align="end"')
    expect(community).toContain('Connect Gmail')
    expect(community).toContain('aria-expanded={addFanOpen}')
    expect(community).toContain('mt-3 rounded-2xl border border-white/[0.025] bg-[#0C0D0E] p-4')
    expect(community).toContain('bg-[#0C0D0E] p-4')
    expect(community).toContain('aria-expanded={emailQueueOpen}')
    expect(community).not.toContain('<MetricCard')
    expect(community).not.toContain('xl:grid-cols-[minmax(0,1fr)_340px]')
    expect(community).not.toContain('>Next Moves</h2>')
  })

  test('keeps the HQ Plan page available while hiding its navigation entry behind a flag', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    const planItem = shell.slice(shell.indexOf('id: "nav:plan"'), shell.indexOf('id: "nav:people"'))
    const calendar = hq.indexOf('<ArtistCalendarView')
    const board = hq.indexOf('<AgendaPage', calendar)
    const planCardEnd = hq.indexOf('</HQCard>', board)

    expect(hq).toContain("{tab !== 'calendar' && tab !== 'network' ? (")
    expect(hq).toContain('title="Plan"')
    expect(hq).toContain('title="Plan"\n            tone="orange"')
    expect(hq).toContain('<ArtistCalendarView\n                  compact')
    expect(board).toBeGreaterThan(calendar)
    expect(planCardEnd).toBeGreaterThan(board)
    expect(hq).toContain('embedded\n                    sessions={agendaSessions}')
    expect(hq).toContain('lg:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.85fr)]')
    expect(hq).toContain('id="plan-kanban" className="min-h-[280px] overflow-hidden border-t')
    expect(hq).toContain('lg:border-l lg:border-t-0')
    expect(hq).not.toContain('planBoardOpen')
    expect(hq).toContain("tab === 'calendar' ? 'overflow-hidden' : 'overflow-y-auto'")
    expect(shell).toContain('const SHOW_HQ_PLAN_NAV = false')
    expect(shell).toMatch(/if \(SHOW_HQ_PLAN_NAV\) \{\s+result\.push\(\{ id: 'nav:plan'/)
    expect(shell).toMatch(/\.\.\.\(\(SHOW_HQ_PLAN_NAV \? \[\{\s+id: "nav:plan"/)
    expect(shell).toMatch(/id: "nav:calendar",\s+title: "Plan"/)
    const agenda = readFileSync(join(import.meta.dir, '..', 'AgendaPage.tsx'), 'utf8')
    expect(agenda).toContain('aria-label="Add task to To Do"')
    expect(agenda).toContain("embedded && 'min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5'")
    expect(agenda).toContain("? 'h-full min-h-0 grid-rows-3 divide-y divide-white/[0.055]'")
    expect(agenda).toContain("? 'flex min-h-0 flex-col px-3 py-2.5'")
    expect(agenda).not.toContain('Nothing here.')
    expect(agenda).toContain('Delete task')
    expect(agenda).toContain('Discussion')
    expect(agenda).not.toContain('Open Thread')
    expect(planItem).toContain("onClick: () => handleArtistHQNavClick('calendar')")
    expect(planItem).not.toContain('expandable: true')
  })

  test('uses the unified compact gradient header for Workers, Workflows, and Automations', () => {
    const workers = readFileSync(join(import.meta.dir, '..', 'AgentsLaunchpad.tsx'), 'utf8')
    const workflows = readFileSync(join(import.meta.dir, '..', '..', '..', 'pages', 'WorkflowsListPage.tsx'), 'utf8')
    const automations = readFileSync(join(import.meta.dir, '..', 'MainContentPanel.tsx'), 'utf8')
    const compactHeader = readFileSync(join(import.meta.dir, '..', 'CompactPageHeader.tsx'), 'utf8')

    expect(workers).toContain('tone="orange"')
    expect(workflows).toContain('tone="violet"')
    expect(automations).toContain('tone="blue"')
    expect(compactHeader.split('border-orange-100/[0.12]').length - 1).toBe(5)
  })

  test('routes all major HQ and workspace page headers through the compact system', () => {
    const files = [
      'ArtistCommandCenterHome.tsx',
      'CampaignCalendarPage.tsx',
      'AgendaPage.tsx',
      'VaultPage.tsx',
      'LabWorkspaceHome.tsx',
      'LabSongsPage.tsx',
      'LabSequencePage.tsx',
    ]

    for (const file of files) {
      const source = readFileSync(join(import.meta.dir, '..', file), 'utf8')
      expect(source).toContain('<CompactPageHeader')
      expect(source).not.toContain('text-[56px]')
      expect(source).not.toContain('min-h-[230px]')
    }
  })

  test('creates an empty Lab song from the Songs page before opening the Pad', () => {
    const songs = readFileSync(join(import.meta.dir, '..', 'LabSongsPage.tsx'), 'utf8')

    expect(songs).toContain('createLabUiSong')
    expect(songs).toContain('placeholder="Song title"')
    expect(songs).toContain('placeholder="Tag (optional)"')
    expect(songs).toContain('Add to Songs')
    expect(songs).toContain('project: draftTag.trim() || \'Loose Singles\'')
    expect(songs).toContain('onClick={() => setAddSongOpen(true)}')
  })

  test('keeps HQ cards darker than soot but distinct from the black canvas', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(hq).toContain("bg-[#0C0D0E] p-4")
    expect(hq).toContain("bg-[#0F0F10] p-4")
  })

  test('places the quieter next move below the Release Horizon and uses vivid orange Pulse accents', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const releaseHorizon = hq.indexOf('<ReleaseHorizon')
    const nextMove = hq.indexOf('<StateOfPlayPanel')
    const workers = hq.indexOf('>Workers &amp; signals</span>')

    expect(releaseHorizon).toBeGreaterThan(-1)
    expect(nextMove).toBeGreaterThan(releaseHorizon)
    expect(workers).toBeGreaterThan(nextMove)
    expect(hq).toContain('text-sm font-medium tracking-tight text-white/88')
    expect(hq).toContain('text-[#f97316]')
  })

  test('places the Pulse stack directly below the HQ header', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(hq).not.toContain('<span>More details</span>')
    expect(hq).not.toContain('PIN_HQ_PULSES_TO_BOTTOM')
    expect(hq).not.toContain('className="flex min-h-[calc(100dvh-176px)] flex-col"')
    expect(hq).toContain('id="hq-home-operations" className="space-y-3"')
    expect(hq).toContain('<HQCard className="overflow-hidden p-0">')
    expect(hq).toContain('group relative flex h-[184px] flex-col rounded-[14px]')
    expect(hq).toContain('border border-white/[0.06] bg-[#0F0F10]')
    expect(hq).not.toContain('border border-[#f97316]/35')
    expect(hq).toContain('aria-label="Open Spotify Pulse analysis"')
    expect(hq).toContain('aria-label="Open Social Pulse analysis"')
    expect(hq).toContain('aria-label="Open Intel Pulse analysis"')
    expect(hq).toContain('<PulseDetailsDialog')
    expect(hq).not.toContain('mt-3 grid grid-cols-3 gap-2 rounded-[12px] bg-black/20 py-3')
    expect(hq).toContain('>Workers &amp; signals</span>')
    expect(hq).toContain('h-1.5 w-1.5 shrink-0 rounded-full bg-[#f97316]')
  })

  test('does not leave a former North Star spacer before HQ analytics', () => {
    const hq = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    // The profile schema lives in packages/shared now; the renderer lib module
    // is a re-export and no longer carries the field declarations.
    const profile = readFileSync(
      join(import.meta.dir, '..', '..', '..', '..', '..', '..', '..', 'packages', 'shared', 'src', 'artist-context', 'profile.ts'),
      'utf8',
    )
    const operations = hq.indexOf('id="hq-home-operations"')
    const spotify = hq.indexOf('<SpotifyPulseCard', operations)

    expect(operations).toBeGreaterThan(-1)
    expect(spotify).toBeGreaterThan(operations)
    expect(hq).not.toContain('min-h-[clamp(280px,42vh,420px)] flex-1 bg-[#050505]')
    expect(hq).not.toContain('<ArtistNorthStar')
    expect(hq).not.toContain('North Star</p>')
    expect(hq).not.toContain('What are you building toward?')
    expect(hq).toContain('Artist mission / North Star')
    expect(profile).toContain('mission?: string')
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

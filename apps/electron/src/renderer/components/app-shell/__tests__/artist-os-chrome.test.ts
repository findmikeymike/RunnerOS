import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Artist OS persistent shell chrome', () => {
  test('uses the thin ScriptOS-style sidebar and bottom-corner toggle', () => {
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    const styles = readFileSync(join(import.meta.dir, '..', '..', '..', 'index.css'), 'utf8')
    const openToggle = shell.indexOf('data-testid="sidebar-toggle-open"')
    const panelShell = shell.indexOf('=== OUTER LAYOUT: Unified Panel Stack')

    expect(openToggle).toBeGreaterThan(-1)
    expect(openToggle).toBeLessThan(panelShell)
    expect(shell).toContain('data-testid="sidebar-toggle-close"')
    expect(shell).toContain('pointer-events-auto absolute bottom-3 right-2 z-[80]')
    expect(shell).toContain('pointer-events-auto fixed bottom-3 left-2 z-[100]')
    expect(shell).toContain('usesWorkspaceHeader ? "px-3 pb-10 pt-10"')
    expect(shell).toContain('usesWorkspaceHeader && "artist-os-sidebar-glass"')
    expect(styles).toContain('.artist-os-sidebar-glass {')
    expect(styles).toContain('backdrop-filter: blur(28px) saturate(145%);')
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
    expect(workers).toContain('className="mb-4"')
    expect(workers).not.toContain('!min-h-[112px]')
    expect(workflows).toContain('tone="violet"')
    expect(automations).toContain('tone="blue"')
    expect(compactHeader.split('border-orange-100/[0.12]').length - 1).toBe(5)
  })

  test('makes the Workers directory chat-first without hiding worker descriptions', () => {
    const workers = readFileSync(join(import.meta.dir, '..', 'AgentsLaunchpad.tsx'), 'utf8')

    expect(workers).toContain('placeholder="Search workers by name or capability"')
    expect(workers).toContain("type WorkerDirectoryView = 'all' | 'recent' | 'favorites'")
    expect(workers).toContain('onClick={onStartChat}')
    expect(workers).toContain('aria-label={`Start chat with ${name}`}')
    expect(workers).toContain('aria-label={`Configure ${name}`}')
    expect(workers).toContain('{description}')
    expect(workers).toContain('space-y-6')
    expect(workers).toContain('group/category')
    expect(workers).toContain('text-white/72')
    expect(workers).not.toContain('<MessageSquare')
    expect(workers).not.toContain('onClick={() => setSelectedAgent(agent)}')
  })

  test('keeps Artist OS chat and notification text visible on black surfaces', () => {
    const input = readFileSync(join(import.meta.dir, '..', 'input', 'FreeFormInput.tsx'), 'utf8')
    const agentHeader = readFileSync(join(import.meta.dir, '..', 'ChatAgentHeader.tsx'), 'utf8')
    const bell = readFileSync(join(import.meta.dir, '..', '..', 'notifications', 'BellMenu.tsx'), 'utf8')
    const notification = readFileSync(join(import.meta.dir, '..', '..', 'notifications', 'NotificationItem.tsx'), 'utf8')

    expect(input).toContain("RENDERER_PRODUCT_VARIANT === 'artist-os' ? 'rgba(255, 255, 255, 0.92)' : undefined")
    expect(agentHeader).toContain('bg-[#111112]/95')
    expect(agentHeader).toContain('rgba(220,20,36,0.17)')
    expect(agentHeader).toContain('rgba(255,82,0,0.10)')
    expect(bell).toContain('className="w-[360px] p-0 !text-white"')
    expect(notification).toContain("'border-l-2 px-3 py-2 text-sm text-white'")
  })

  test('keeps weekly manager routing labels out of the Artist OS chat controls', () => {
    const badges = readFileSync(join(import.meta.dir, '..', 'ActiveOptionBadges.tsx'), 'utf8')

    expect(badges).toContain('ARTIST_OS_HIDDEN_CHAT_LABEL_IDS')
    expect(badges).toContain("'manager', 'artist-hq', 'weekly'")
    expect(badges).toContain("RENDERER_PRODUCT_VARIANT === 'artist-os'")
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

  test('shows the release countdown beside a compact readiness handoff on campaign overview', () => {
    const campaign = readFileSync(join(import.meta.dir, '..', 'ArtistCommandCenterHome.tsx'), 'utf8')
    const dial = readFileSync(join(import.meta.dir, '..', 'ReleaseCountdownDial.tsx'), 'utf8')

    expect(campaign).toContain('missionCampaignWindow(mission)')
    expect(campaign).toContain('releaseDate={campaignWindow.releaseDate}')
    expect(campaign).toContain('<ReleaseReadinessSummary')
    expect(campaign).toContain("navigate(routes.view.campaign('release-board'))")
    expect(campaign).toContain('md:grid-cols-[minmax(0,1fr)_116px]')
    expect(dial).toContain('h-[104px] w-[104px]')
    expect(dial).not.toContain('#2b2b2f')
    expect(dial).not.toContain('#242428')
  })

  test('closes the Release Kit audio versions menu when clicking outside it', () => {
    const releaseKit = readFileSync(join(import.meta.dir, '..', 'ReleaseKitPage.tsx'), 'utf8')

    expect(releaseKit).toContain("document.addEventListener('pointerdown', closeVersions)")
    expect(releaseKit).toContain('versions.contains(event.target)')
    expect(releaseKit).toContain('versions.open = false')
    expect(releaseKit).toContain('ref={versionsRef}')
  })

  test('gives Release Board assets and agent actions a dedicated campaign page', () => {
    const campaign = readFileSync(join(import.meta.dir, '..', 'ArtistCommandCenterHome.tsx'), 'utf8')
    const main = readFileSync(join(import.meta.dir, '..', 'MainContentPanel.tsx'), 'utf8')
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')

    expect(campaign).toContain('function ReleaseBoardWorkspace')
    expect(campaign).toContain('function ReleaseBoardBand')
    expect(campaign).toContain('function ReleaseBoardSection')
    expect(campaign).toContain('category.items.map((item)')
    expect(campaign).toContain('aria-label={`Cue ${action.targetName} for ${item.label}`}')
    expect(campaign).toContain('md:divide-x md:divide-y-0')
    expect(campaign).toContain("category.id === 'promotion' && 'md:grid-cols-2 lg:grid-cols-3'")
    expect(campaign).toContain('flex min-h-7 items-center')
    expect(campaign).toContain('<ReleaseBoardProgress board={releaseBoard} />')
    expect(campaign).toContain('max-w-[360px]')
    expect(campaign).toContain('{remaining} left')
    expect(campaign).toContain("backgroundColor: '#090909'")
    expect(campaign).toContain('rgba(255,77,0,0.018)')
    expect(campaign).toContain("'truncate text-[9px] font-normal'")
    expect(campaign).toContain('Open essentials')
    expect(main).toContain("navState.subpage === 'release-board'")
    expect(main).toContain('view="release-board"')
    expect(shell).toMatch(/id: "nav:release-board",\s+title: "Essentials"/)
    expect(campaign).not.toContain('function ReleaseBoardDialog')
    expect(campaign).not.toContain('selectedReleaseCategoryId')
  })

  test('visually rhymes Release Kit cards with Essentials without changing their layouts', () => {
    const releaseKit = readFileSync(join(import.meta.dir, '..', 'ReleaseKitPage.tsx'), 'utf8')

    expect(releaseKit).toContain("const RELEASE_KIT_SURFACE_CLASS = 'group/release-kit relative overflow-hidden rounded-2xl ring-1 ring-white/[0.055]'")
    expect(releaseKit).toContain("backgroundColor: '#090909'")
    expect(releaseKit).toContain('rgba(255,77,0,0.018)')
    expect(releaseKit).toContain('group-hover/release-kit:opacity-100')
    expect(releaseKit).toContain('text-[11px] font-medium text-white/90')
    expect(releaseKit).toContain("lg:grid-cols-[240px_minmax(0,1fr)]")
    expect(releaseKit).toContain('aspect-[9/16]')
  })

  test('creates an empty Lab song from the Songs page before opening the Pad', () => {
    const songs = readFileSync(join(import.meta.dir, '..', 'LabSongsPage.tsx'), 'utf8')

    expect(songs).toContain('createLabUiSong')
    expect(songs).toContain('placeholder="Song title"')
    expect(songs).toContain('placeholder="Tag (optional)"')
    expect(songs).toContain('Add to Songs')
    expect(songs).toContain('project: draftTag.trim() || \'Loose Singles\'')
    expect(songs).toContain('onClick={() => setAddSongOpen(true)}')
    expect(songs).toContain('deleteLabUiSong')
    expect(songs).toContain('Save changes')
  })

  test('keeps Spark capture available across the Lab with a searchable bank', () => {
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    const dock = readFileSync(join(import.meta.dir, '..', 'LabSparkDock.tsx'), 'utf8')

    expect(shell).toContain('<LabSparkDock workspaceId={activeWorkspaceId} attachToCurrentSong={labPadActive} />')
    expect(dock).toContain('Catch the spark')
    expect(dock).toContain('Open Spark Bank')
    expect(dock).toContain('filterLabSparks')
    expect(dock).toContain('Attached to ${activeSongTitle}')
    expect(dock).toContain('Edit spark')
    expect(dock).toContain('aria-label="Spark type"')
    expect(dock).toContain('aria-label="Spark tags"')
    expect(dock).toContain('Delete this Spark? This cannot be undone.')
  })

  test('connects Lab Home to the canonical Spark Bank and bounded songwriting team', () => {
    const home = readFileSync(join(import.meta.dir, '..', 'LabWorkspaceHome.tsx'), 'utf8')

    expect(home).toContain('loadLabUiSparks')
    expect(home).toContain('openLabSparkBank')
    expect(home).toContain('LAB_DEFAULT_WORKER_SLUGS')
    expect(home).toContain("routes.view.agents('reference-master')")
    expect(home).not.toContain('song.rememberText')
  })

  test('self-heals declared songwriting skills before a Pad worker launches', () => {
    const pad = readFileSync(join(import.meta.dir, '..', 'LabSongPadPage.tsx'), 'utf8')

    expect(pad).toContain('ensureAgentDeclaredSkillsEnabled')
    expect(pad).toMatch(/ensureAgentDeclaredSkillsEnabled\([\s\S]*?buildAgentCreateSessionOptions/)
  })

  test('explains Song Pad tools and avoids stacking its two writing panes', () => {
    const pad = readFileSync(join(import.meta.dir, '..', 'LabSongPadPage.tsx'), 'utf8')

    expect(pad).toContain('How Song Pad works')
    expect(pad).toContain('Find rhymes')
    expect(pad).toContain('Keep alternate lines')
    expect(pad).toContain('Move ideas into place')
    expect(pad).toContain('Ask a writing specialist')
    expect(pad).toContain('Catch sparks anywhere')
    expect(pad).toContain("const [compactPane, setCompactPane] = React.useState<SongPadPane>('rough')")
    expect(pad).toContain("compactPane === 'rough' ? 'flex' : 'hidden xl:flex'")
    expect(pad).toContain("compactPane === 'final' ? 'flex' : 'hidden xl:flex'")
  })

  test('lets writers delete extra sequence pages without deleting their songs', () => {
    const sequence = readFileSync(join(import.meta.dir, '..', 'LabSequencePage.tsx'), 'utf8')

    expect(sequence).toContain('removeLabSequencePage')
    expect(sequence).toContain('Songs stay in your library.')
    expect(sequence).toContain('Delete sequence page')
  })

  test('lets writers persist Focus and Status directly from the Songs list', () => {
    const songs = readFileSync(join(import.meta.dir, '..', 'LabSongsPage.tsx'), 'utf8')

    expect(songs).toContain('upsertLabUiSong')
    expect(songs).toContain('onSetFocused')
    expect(songs).toContain('onSetStatus')
    expect(songs).toContain('aria-pressed={song.focused}')
    expect(songs).toContain('Status for ${song.title}')
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

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ARTIST_GUIDE_CONNECTIONS,
  ARTIST_GUIDE_PRIMARY_TAB_IDS,
  ARTIST_GUIDE_TABS,
  ARTIST_GUIDE_UTILITY_TAB_IDS,
  defaultArtistGuideTab,
  deriveArtistGuideAiReadiness,
} from '../artist-guide-content'

describe('Artist OS guide content', () => {
  it('keeps four primary tabs and moves setup controls to a secondary row', () => {
    expect(ARTIST_GUIDE_PRIMARY_TAB_IDS).toEqual(['general', 'hq', 'campaigns', 'creative-lab'])
    expect(ARTIST_GUIDE_UTILITY_TAB_IDS).toEqual(['connections', 'top-bar'])
    expect(ARTIST_GUIDE_TABS.map((tab) => tab.id)).toEqual([
      'general',
      'hq',
      'campaigns',
      'creative-lab',
      'connections',
      'top-bar',
    ])
    for (const tab of ARTIST_GUIDE_TABS) {
      expect(tab.start.length).toBeLessThanOrEqual(6)
      expect(tab.destinations.length).toBeLessThanOrEqual(6)
      expect(tab.concepts.length).toBeLessThanOrEqual(6)
    }
  })

  it('documents every built-in service and the agent-assisted connection path', () => {
    const documentedConnectionIds = new Set(ARTIST_GUIDE_CONNECTIONS.map((connection) => connection.id))
    const settingsSource = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'pages', 'settings', 'SecretsSettingsPage.tsx'),
      'utf8',
    )
    const servicesBlock = settingsSource.slice(settingsSource.indexOf('export const SERVICES'))
    const builtInServiceIds = Array.from(servicesBlock.matchAll(/^\s+id: '([^']+)',/gm), (match) => match[1])
    for (const serviceId of builtInServiceIds) expect(documentedConnectionIds.has(serviceId), serviceId).toBe(true)

    const connectionsTab = ARTIST_GUIDE_TABS.find((tab) => tab.id === 'connections')
    const setupCopy = connectionsTab?.start.map((item) => item.body).join(' ') ?? ''
    expect(setupCopy).toContain('Connect [service]')
    expect(setupCopy).toContain('MCP')
    expect(setupCopy).toContain('REST API')
    expect(setupCopy).toContain('secure credential prompt')
  })

  it('uses contextual defaults for HQ, Campaigns, and Creative Lab', () => {
    expect(defaultArtistGuideTab('hq')).toBe('hq')
    expect(defaultArtistGuideTab('campaign')).toBe('campaigns')
    expect(defaultArtistGuideTab('lab')).toBe('creative-lab')
    expect(defaultArtistGuideTab('general')).toBe('general')
  })

  it('only reports AI ready from an authenticated connection', () => {
    expect(deriveArtistGuideAiReadiness([])).toBe('needs-setup')
    expect(deriveArtistGuideAiReadiness([{ isAuthenticated: false }])).toBe('check-setup')
    expect(deriveArtistGuideAiReadiness([
      { isAuthenticated: false },
      { isAuthenticated: true },
    ])).toBe('ready')
  })

  it('does not put peripheral documentation or shortcut links in guide content', () => {
    const copy = JSON.stringify(ARTIST_GUIDE_TABS).toLowerCase()
    expect(copy).not.toContain('keyboard shortcut')
    expect(copy).not.toContain('full documentation')
    expect(copy).not.toContain('all documentation')
  })

  it('keeps item ids unique and every action visibly labelled', () => {
    const itemIds = ARTIST_GUIDE_TABS.flatMap((tab) => [
      ...tab.start,
      ...tab.destinations,
      ...tab.concepts,
    ]).map((item) => item.id)
    expect(new Set(itemIds).size).toBe(itemIds.length)

    for (const tab of ARTIST_GUIDE_TABS) {
      for (const item of [...tab.start, ...tab.destinations]) {
        for (const action of item.actions ?? []) expect(action.label.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('Artist OS guide wiring', () => {
  it('replaces the Artist OS help dropdown while retaining the non-Artist docs menu', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'TopBar.tsx'), 'utf8')
    expect(source).toContain('onClick={onOpenUserGuide}')
    expect(source).toContain("RENDERER_PRODUCT_VARIANT === 'artist-os'")
    expect(source).toContain("getDocUrl('sources')")
  })

  it('mounts one dialog host and routes through typed guide actions', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    expect(source).toContain('<ArtistGuideDialog')
    expect(source).toContain('handleArtistGuideAction')
    expect(source).toContain("'campaign.essentials': routes.view.campaign('release-board')")
    expect(source).toContain("action === 'lab.pad'")
    expect(source).toContain('LAB_SPARK_BANK_OPEN_EVENT')
    expect(source).toContain("'settings.connections': 'secrets'")
    expect(source).toContain("'settings.messaging': 'messaging'")
    expect(source).toContain("action === 'workspace.context'")
    expect(source).toContain("action === 'app.tools'")
  })

  it('keeps the guide footer focused on Command', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistGuideDialog.tsx'), 'utf8')
    expect(source).toContain('Still stuck? Ask Command')
    expect(source).not.toContain('Keyboard shortcuts')
    expect(source).not.toContain('Full documentation')
  })

  it('keeps Connections and Top Bar in a quieter secondary navigation row', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistGuideDialog.tsx'), 'utf8')
    expect(source).toContain('grid-cols-4')
    expect(source).toContain('Setup & controls')
    expect(source).toContain('ARTIST_GUIDE_UTILITY_TAB_IDS')
    expect(source).toContain('ConnectionsCatalog')
  })
})

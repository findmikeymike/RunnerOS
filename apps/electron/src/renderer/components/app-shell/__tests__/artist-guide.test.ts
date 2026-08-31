import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ARTIST_GUIDE_TABS,
  defaultArtistGuideTab,
  deriveArtistGuideAiReadiness,
} from '../artist-guide-content'

describe('Artist OS guide content', () => {
  it('keeps the guide limited to the three essential tabs', () => {
    expect(ARTIST_GUIDE_TABS.map((tab) => tab.id)).toEqual(['general', 'hq', 'campaigns'])
    for (const tab of ARTIST_GUIDE_TABS) {
      expect(tab.start.length).toBeLessThanOrEqual(6)
      expect(tab.destinations.length).toBeLessThanOrEqual(6)
      expect(tab.concepts.length).toBeLessThanOrEqual(6)
    }
  })

  it('uses contextual defaults without treating Lab as a fourth guide tab', () => {
    expect(defaultArtistGuideTab('hq')).toBe('hq')
    expect(defaultArtistGuideTab('campaign')).toBe('campaigns')
    expect(defaultArtistGuideTab('lab')).toBe('general')
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
    expect(source).toContain("'settings.connections': 'secrets'")
  })

  it('keeps the guide footer focused on Command', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistGuideDialog.tsx'), 'utf8')
    expect(source).toContain('Still stuck? Ask Command')
    expect(source).not.toContain('Keyboard shortcuts')
    expect(source).not.toContain('Full documentation')
  })
})


import { describe, expect, test } from 'bun:test'
import { canPersistWorkspaceLocation, restoreWorkspaceLocation, workspaceLocation } from './workspace-location'

const origin = 'http://localhost:5173/'
describe('workspace page restoration', () => {
  test('HQ Signals → campaign Release Kit → HQ restores both exact pages', () => {
    const hq = new URL(`${origin}?ws=artist-hq&route=allSessions#artist-hq/signals`)
    const campaign = new URL(`${origin}?ws=release-one&route=campaign/release-kit`)
    const savedHq = workspaceLocation(hq.search, hq.hash)
    const savedCampaign = workspaceLocation(campaign.search, campaign.hash)
    expect(restoreWorkspaceLocation(hq.href, savedCampaign, 'release-one', 'campaign').searchParams.toString()).toBe(campaign.searchParams.toString())
    expect(restoreWorkspaceLocation(campaign.href, savedHq, 'artist-hq', 'hq').hash).toBe(hq.hash)
  })
  test('campaigns retain independent pages and panel layouts', () => {
    const first = '?ws=one&route=campaign/release-kit'
    const second = '?ws=two&route=campaign/calendar&panels=campaign/calendar:0.6000,agents:0.4000&fi=0'
    const two = restoreWorkspaceLocation(origin + first, second, 'two', 'campaign')
    expect(two.searchParams.get('route')).toBe('campaign/calendar')
    expect(two.searchParams.get('panels')).toBe('campaign/calendar:0.6000,agents:0.4000')
    expect(restoreWorkspaceLocation(two.href, first, 'one', 'campaign').searchParams.get('route')).toBe('campaign/release-kit')
  })
  test('old query-only state never borrows the outgoing HQ fragment', () => {
    const result = restoreWorkspaceLocation(origin + '?ws=hq&route=allSessions#artist-hq/signals', '?ws=release&route=campaign/calendar', 'release', 'campaign')
    expect(result.hash).toBe('')
    expect(result.searchParams.get('route')).toBe('campaign/calendar')
  })
  test('first visits open the right home with no old session or multi-panel state', () => {
    for (const [kind, expectedRoute, hash] of [['hq', 'allSessions', '#artist-hq/home'], ['campaign', 'campaign', ''], ['lab', 'lab', ''], ['general', 'allSessions', '']] as const) {
      const result = restoreWorkspaceLocation(origin + '?ws=old&route=allSessions/session/old&panels=agents:1#artist-hq/signals', '', 'new', kind)
      expect(result.searchParams.get('route')).toBe(expectedRoute)
      expect(result.hash).toBe(hash)
      expect(result.searchParams.has('panels')).toBe(false)
    }
  })
  test('old bootstrap workspace/session and focused-window flags cannot leak to destination', () => {
    const result = restoreWorkspaceLocation(origin, '?ws=old&workspaceId=old-id&sessionId=old-chat&focused=true&route=campaign/release-kit#artist-hq/signals', 'new', 'campaign')
    expect(result.searchParams.get('ws')).toBe('new')
    for (const key of ['workspaceId', 'sessionId', 'focused']) expect(result.searchParams.has(key)).toBe(false)
    expect(result.hash).toBe('')
  })
  test('only same-workspace locations can be saved during switching or back/forward', () => {
    const incoming = new URL(origin + '?ws=target&route=agents')
    expect(canPersistWorkspaceLocation(incoming, 'old', 'old')).toBe(false)
    expect(canPersistWorkspaceLocation(incoming, 'target', 'old')).toBe(false)
    expect(canPersistWorkspaceLocation(incoming, 'target', 'target')).toBe(true)
  })
  test('stored origin, file paths, and arbitrary hash-only values are not destinations', () => {
    for (const saved of ['https://elsewhere.invalid/?route=agents', 'file:///secret', '#artist-hq/signals']) {
      const result = restoreWorkspaceLocation(origin, saved, 'campaign', 'campaign')
      expect(result.origin).toBe(new URL(origin).origin)
      expect(result.searchParams.get('route')).toBe('campaign')
      expect(result.hash).toBe('')
    }
  })
})

test('an invalid saved route falls back to destination home instead of leaving outgoing panels', () => {
  const result = restoreWorkspaceLocation(origin + '?route=allSessions/session/old#artist-hq/signals', '?ws=old&route=removedPage', 'next', 'campaign')
  expect(result.searchParams.get('route')).toBe('campaign')
  expect(result.hash).toBe('')
})

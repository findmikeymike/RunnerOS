import { describe, expect, test } from 'bun:test'
import { managerHealthLabel, managerSourceSurface } from './ManagerKnowledgePanel'

describe('ManagerKnowledgePanel helpers', () => {
  test('routes canonical HQ and campaign sources to their real surfaces', () => {
    expect(managerSourceSurface('artist-profile')).toEqual({ kind: 'hq', tab: 'profile' })
    expect(managerSourceSurface('artist-spotify-snapshot')).toEqual({ kind: 'hq', tab: 'home' })
    expect(managerSourceSurface('campaign-1:mission-brief')).toEqual({ kind: 'campaign', workspaceId: 'campaign-1' })
    expect(managerSourceSurface('artist-vault')).toEqual({ kind: 'vault' })
    expect(managerSourceSurface('unknown-source')).toBeNull()
  })

  test('maps malformed and absent sources to user-facing health language', () => {
    expect(managerHealthLabel('fresh')).toBe('Fresh')
    expect(managerHealthLabel('stale')).toBe('Stale')
    expect(managerHealthLabel('partial')).toBe('Partial')
    expect(managerHealthLabel('malformed')).toBe('Unavailable')
    expect(managerHealthLabel('unavailable')).toBe('Missing')
  })
})

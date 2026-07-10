import { describe, expect, test } from 'bun:test'
import { findArtistHQWorkspace, findPrimaryCampaignWorkspace, isArtistHQWorkspace } from './artist-workspace'

describe('artist workspace helpers', () => {
  test('prefers persisted scope over a misleading workspace name', () => {
    const workspace = { id: 'campaign', name: 'Global HQ Launch', artistWorkspaceScope: 'campaign' as const }
    expect(isArtistHQWorkspace(workspace, [workspace])).toBe(false)
  })

  test('recognizes the global artist HQ workspace', () => {
    const workspaces = [
      { id: 'song-1', name: 'Night Drive' },
      { id: 'hq', name: 'M' },
    ]

    expect(isArtistHQWorkspace(workspaces[1], workspaces)).toBe(true)
    expect(findArtistHQWorkspace(workspaces)?.id).toBe('hq')
  })

  test('leaves normal campaign workspaces campaign-scoped', () => {
    const workspaces = [
      { id: 'song-1', name: 'Night Drive' },
      { id: 'song-2', name: 'Album Rollout' },
    ]

    expect(isArtistHQWorkspace(workspaces[0], workspaces)).toBe(false)
    expect(findArtistHQWorkspace(workspaces)).toBeUndefined()
  })

  test('selects the first non-HQ workspace as the primary campaign workspace', () => {
    const workspaces = [
      { id: 'hq', name: 'My Workspace' },
      { id: 'release', name: 'Current Release' },
      { id: 'next', name: 'Next Campaign' },
    ]

    expect(findPrimaryCampaignWorkspace(workspaces)?.id).toBe('release')
  })

  test('prefers campaign-like workspace names before the plain fallback', () => {
    const workspaces = [
      { id: 'hq', name: 'My Workspace' },
      { id: 'trading', name: 'Trading' },
      { id: 'single', name: 'Next Single Rollout' },
    ]

    expect(findPrimaryCampaignWorkspace(workspaces)?.id).toBe('single')
  })

  test('returns no campaign workspace when only HQ exists', () => {
    expect(findPrimaryCampaignWorkspace([{ id: 'hq', name: 'Artist HQ' }])).toBeUndefined()
  })
})

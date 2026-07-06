import { describe, expect, test } from 'bun:test'
import {
  findArtistHQWorkspace,
  findPrimaryCampaignWorkspace,
  findPrimaryLabWorkspace,
  isArtistHQWorkspace,
  isLabWorkspace,
} from './artist-workspace'

describe('artist workspace helpers', () => {
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

  test('recognizes lab workspaces without treating them as campaigns', () => {
    const workspaces = [
      { id: 'hq', name: 'Artist HQ' },
      { id: 'lab', name: 'Song Lab' },
      { id: 'release', name: 'Current Release' },
    ]

    expect(isLabWorkspace(workspaces[1], workspaces)).toBe(true)
    expect(findPrimaryLabWorkspace(workspaces)?.id).toBe('lab')
    expect(findPrimaryCampaignWorkspace(workspaces)?.id).toBe('release')
  })

  test('recognizes numbered creative lab workspace names and slugs', () => {
    const workspaces = [
      { id: 'hq', name: 'Artist HQ' },
      { id: 'lab1', name: 'Creative Lab1', slug: 'creative-lab1' },
      { id: 'release', name: 'Current Release' },
    ]

    expect(isLabWorkspace(workspaces[1], workspaces)).toBe(true)
    expect(findPrimaryLabWorkspace(workspaces)?.id).toBe('lab1')
    expect(findPrimaryCampaignWorkspace(workspaces)?.id).toBe('release')
  })

  test('falls back to no campaign when only HQ and Lab exist', () => {
    const workspaces = [
      { id: 'hq', name: 'Artist HQ' },
      { id: 'lab', name: 'Creative Lab' },
    ]

    expect(findPrimaryCampaignWorkspace(workspaces)).toBeUndefined()
  })

  test('returns no campaign workspace when only HQ exists', () => {
    expect(findPrimaryCampaignWorkspace([{ id: 'hq', name: 'Artist HQ' }])).toBeUndefined()
  })
})

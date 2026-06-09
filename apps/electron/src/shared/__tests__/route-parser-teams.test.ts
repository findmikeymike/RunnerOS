import { describe, expect, it } from 'bun:test'
import { buildCompoundRoute, parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'

describe('route-parser: teams routes', () => {
  it('parses teams list route', () => {
    const parsed = parseCompoundRoute('teams')

    expect(parsed).toEqual({
      navigator: 'teams',
      teamsKind: 'list',
      details: null,
    })
    expect(buildCompoundRoute(parsed!)).toBe('teams')
    expect(parseRouteToNavigationState('teams')).toEqual({
      navigator: 'teams',
      details: { type: 'list' },
    })
  })

  it('parses team detail route', () => {
    const parsed = parseCompoundRoute('teams/head-of-biz-team')

    expect(parsed).toEqual({
      navigator: 'teams',
      teamsKind: 'team',
      details: { type: 'team', id: 'head-of-biz-team' },
    })
    expect(buildCompoundRoute(parsed!)).toBe('teams/head-of-biz-team')
    expect(parseRouteToNavigationState('teams/head-of-biz-team')).toEqual({
      navigator: 'teams',
      details: { type: 'team', teamSlug: 'head-of-biz-team' },
    })
  })

  it('roundtrips team navigation keys', () => {
    const state = {
      navigator: 'teams' as const,
      details: { type: 'team' as const, teamSlug: 'engineering-ship-team' },
    }

    expect(getNavigationStateKey(state)).toBe('teams/engineering-ship-team')
    expect(parseNavigationStateKey('teams/engineering-ship-team')).toEqual(state)
  })
})

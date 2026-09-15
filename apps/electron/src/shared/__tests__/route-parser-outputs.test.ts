import { describe, expect, it } from 'bun:test'
import { routes } from '../routes'
import { buildCompoundRoute, buildRouteFromNavigationState, parseCompoundRoute, parseRoute, parseRouteToNavigationState } from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'

describe('Outputs library navigation', () => {
  it.each([
    ['outputs', undefined, undefined, undefined, undefined],
    ['outputs/legacy-id', undefined, undefined, undefined, 'legacy-id'],
    ['outputs/library', undefined, undefined, undefined, 'library'],
    ['outputs/library/all', 'all', undefined, undefined, undefined],
    ['outputs/library/workspace/hq', 'workspace', 'hq', undefined, undefined],
    ['outputs/library/all/output/campaign-1/cover', 'all', undefined, 'campaign-1', 'cover'],
    ['outputs/library/workspace/hq/output/campaign-1/cover', 'workspace', 'hq', 'campaign-1', 'cover'],
  ])('round trips %s through navigation and persisted keys', (route, scope, scopeWorkspace, owner, outputId) => {
    const state = parseRouteToNavigationState(route!)!
    expect(state).toMatchObject({ navigator: 'outputs' })
    if (state.navigator !== 'outputs') throw new Error('Expected Outputs')
    expect(state.outputScope as string | undefined).toBe(scope)
    expect(state.outputScopeWorkspaceId).toBe(scopeWorkspace)
    expect(state.outputWorkspaceId).toBe(owner)
    expect(state.outputId).toBe(outputId)
    expect(buildRouteFromNavigationState(state)).toBe(route)
    expect(getNavigationStateKey(state)).toBe(route)
    expect(buildRouteFromNavigationState(parseNavigationStateKey(route!)!)).toBe(route)
    expect(buildCompoundRoute(parseCompoundRoute(route!)!)).toBe(route)
  })

  it('preserves encoded owner and output ids independently from filter', () => {
    const route = routes.view.outputLibrary('workspace', 'HQ / home', { workspaceId: 'campaign/one', outputId: 'cover #2' })
    const state = parseRouteToNavigationState(route)!
    expect(state).toMatchObject({ outputScopeWorkspaceId: 'HQ / home', outputWorkspaceId: 'campaign/one', outputId: 'cover #2' })
    expect(buildRouteFromNavigationState(state)).toBe(route)
    expect(parseRoute(route)).toMatchObject({ name: 'output-info', id: 'cover #2', params: { outputScope: 'workspace', outputWorkspaceId: 'campaign/one' } })
  })

  it('closing selection keeps its library scope', () => {
    const selected = parseRouteToNavigationState(routes.view.outputLibrary('all', undefined, { workspaceId: 'campaign', outputId: 'cover' }))!
    expect(buildRouteFromNavigationState({ ...selected, outputId: undefined, outputWorkspaceId: undefined } as typeof selected)).toBe('outputs/library/all')
  })

  it.each(['outputs/library/workspace', 'outputs/library/all/output/id', 'outputs/library/all/output//id', 'outputs/library/all/output/ws/%ZZ', 'outputs/library/nope'])('rejects incomplete or malformed library route %s', (route) => {
    expect(parseCompoundRoute(route)).toBeNull()
    expect(parseNavigationStateKey(route)).toBeNull()
  })
})

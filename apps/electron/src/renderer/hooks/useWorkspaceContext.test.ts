import { describe, expect, test } from 'bun:test'
import { shouldRefreshWorkspaceContext } from './useWorkspaceContext'

describe('useWorkspaceContext refresh policy', () => {
  test('refreshes when hot reload resets the atom to loading even if the workspace key was cached', () => {
    expect(shouldRefreshWorkspaceContext({ docs: [], loading: true, error: null }, true)).toBe(true)
  })

  test('does not refetch a settled cached workspace only because it has no documents', () => {
    expect(shouldRefreshWorkspaceContext({ docs: [], loading: false, error: null }, true)).toBe(false)
  })

  test('refreshes a workspace that has never loaded', () => {
    expect(shouldRefreshWorkspaceContext({ docs: [], loading: false, error: null }, false)).toBe(true)
  })
})

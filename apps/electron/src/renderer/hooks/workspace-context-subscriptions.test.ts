import { expect, mock, test } from 'bun:test'
import { WorkspaceContextSubscriptions } from './workspace-context-subscriptions'
import { shouldRefreshWorkspaceContext } from './useWorkspaceContext'

test('returning after all context consumers unmount requires a fresh read of settled cached docs', () => {
  const subscriptions = new WorkspaceContextSubscriptions()
  const refresh = mock(async () => {})
  const leave = subscriptions.subscribe('hq', refresh)
  subscriptions.markLoaded('hq')
  const cached = { docs: [], loading: false, error: null }
  expect(shouldRefreshWorkspaceContext(cached, subscriptions.hasLoaded('hq'))).toBe(false)
  leave()
  subscriptions.markLoaded('hq') // A fetch finishing after unmount cannot make the cache fresh.
  const leaveAgain = subscriptions.subscribe('hq', refresh)
  expect(shouldRefreshWorkspaceContext(cached, subscriptions.hasLoaded('hq'))).toBe(true)
  leaveAgain()
})

test('unmounting either of two consumers preserves the remaining change subscription', () => {
  for (const firstToLeave of [0, 1]) {
    const subscriptions = new WorkspaceContextSubscriptions()
    const refreshers = [mock(async () => {}), mock(async () => {})]
    const leave = refreshers.map(refresh => subscriptions.subscribe('hq', refresh))
    refreshers.forEach(refresh => refresh.mockClear())
    subscriptions.markLoaded('hq')
    leave[firstToLeave]!()
    subscriptions.refreshChanged('hq')
    expect(subscriptions.hasLoaded('hq')).toBe(true)
    expect(refreshers[firstToLeave]).not.toHaveBeenCalled()
    expect(refreshers[1 - firstToLeave]).toHaveBeenCalledWith(true)
    leave[1 - firstToLeave]!()
    expect(subscriptions.hasLoaded('hq')).toBe(false)
  }
})

test('a remount explicitly invalidates any request left in flight by the prior consumer', () => {
  const subscriptions = new WorkspaceContextSubscriptions()
  const first = mock(() => new Promise<void>(() => {}))
  const leave = subscriptions.subscribe('hq', first)
  expect(first).toHaveBeenCalledWith(true)
  leave()
  const next = mock(async () => {})
  const leaveNext = subscriptions.subscribe('hq', next)
  expect(next).toHaveBeenCalledWith(true)
  leaveNext()
})

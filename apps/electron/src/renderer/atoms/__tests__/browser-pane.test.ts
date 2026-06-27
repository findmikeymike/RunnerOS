import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { BrowserInstanceInfo } from '../../../shared/types'
import {
  browserInstancesAtom,
  removeBrowserInstanceAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
} from '../browser-pane'
import { windowWorkspaceIdAtom } from '../sessions'

function makeInstance(id: string, workspaceId?: string | null): BrowserInstanceInfo {
  return {
    id,
    url: 'https://example.com',
    title: 'Example',
    favicon: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    boundSessionId: null,
    ownerType: 'manual',
    ownerSessionId: null,
    workspaceId,
    isVisible: true,
    agentControlActive: false,
    themeColor: null,
  }
}

describe('browser pane atoms', () => {
  it('does not resurrect removed instance from stale update event', () => {
    const store = createStore()

    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))
    expect(store.get(browserInstancesAtom).map((i) => i.id)).toEqual(['browser-1'])

    store.set(removeBrowserInstanceAtom, 'browser-1')
    expect(store.get(browserInstancesAtom)).toHaveLength(0)

    // Simulate late out-of-order state event arriving after removal
    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))

    expect(store.get(browserInstancesAtom)).toHaveLength(0)
  })

  it('authoritative list refresh can restore an instance after prior remove', () => {
    const store = createStore()

    store.set(removeBrowserInstanceAtom, 'browser-2')
    expect(store.get(browserInstancesAtom)).toHaveLength(0)

    // Simulate full list() reconciliation from main process
    store.set(setBrowserInstancesAtom, [makeInstance('browser-2')])

    expect(store.get(browserInstancesAtom).map((i) => i.id)).toEqual(['browser-2'])
  })

  it('filters browser instances by active workspace while keeping legacy global windows visible', () => {
    const store = createStore()
    store.set(windowWorkspaceIdAtom, 'workspace-a')

    store.set(setBrowserInstancesAtom, [
      makeInstance('global', null),
      makeInstance('workspace-a-browser', 'workspace-a'),
      makeInstance('workspace-b-browser', 'workspace-b'),
    ])

    expect(store.get(browserInstancesAtom).map((i) => i.id)).toEqual([
      'global',
      'workspace-a-browser',
    ])
  })
})

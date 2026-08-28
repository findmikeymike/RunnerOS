import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { BrowserInstanceInfo } from '../../../shared/types'
import {
  activeBrowserInstanceIdAtom,
  browserSidecarOpenAtom,
  browserInstancesAtom,
  closeBrowserSidecarAtom,
  dismissBrowserSidecarAtom,
  dismissedAgentBrowserIdsAtom,
  openBrowserSidecarAtom,
  removeBrowserInstanceAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
  shouldAutoOpenAgentBrowser,
} from '../browser-pane'

function makeInstance(id: string): BrowserInstanceInfo {
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
    isVisible: true,
    agentControlActive: false,
    themeColor: null,
  }
}

describe('browser pane atoms', () => {
  it('opens and closes the selected browser sidecar without removing the instance', () => {
    const store = createStore()
    store.set(setBrowserInstancesAtom, [makeInstance('browser-sidecar')])

    store.set(openBrowserSidecarAtom, 'browser-sidecar')
    expect(store.get(activeBrowserInstanceIdAtom)).toBe('browser-sidecar')
    expect(store.get(browserSidecarOpenAtom)).toBe(true)

    store.set(closeBrowserSidecarAtom)
    expect(store.get(browserSidecarOpenAtom)).toBe(false)
    expect(store.get(browserInstancesAtom)).toHaveLength(1)
  })

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

  it('respects explicit dismissal during an agent run and resets it when reopened', () => {
    const store = createStore()
    const active = { ...makeInstance('agent-browser'), agentControlActive: true }
    store.set(setBrowserInstancesAtom, [active])
    store.set(openBrowserSidecarAtom, active.id)
    store.set(dismissBrowserSidecarAtom)

    expect(store.get(browserSidecarOpenAtom)).toBe(false)
    expect(store.get(dismissedAgentBrowserIdsAtom).has(active.id)).toBe(true)

    store.set(openBrowserSidecarAtom, active.id)
    expect(store.get(browserSidecarOpenAtom)).toBe(true)
    expect(store.get(dismissedAgentBrowserIdsAtom).has(active.id)).toBe(false)
  })

  it('auto-opens only on a new agent-control transition for the active session', () => {
    const info = {
      ...makeInstance('session-browser'),
      boundSessionId: 'session-a',
      agentControlActive: true,
    }

    expect(shouldAutoOpenAgentBrowser(false, info, 'session-a', new Set())).toBe(true)
    expect(shouldAutoOpenAgentBrowser(true, info, 'session-a', new Set())).toBe(false)
    expect(shouldAutoOpenAgentBrowser(false, info, 'session-b', new Set())).toBe(false)
    expect(shouldAutoOpenAgentBrowser(false, info, 'session-a', new Set([info.id]))).toBe(false)
    expect(shouldAutoOpenAgentBrowser(false, { ...info, boundSessionId: null }, 'session-a', new Set())).toBe(false)
  })

  it('authoritative list refresh can restore an instance after prior remove', () => {
    const store = createStore()

    store.set(removeBrowserInstanceAtom, 'browser-2')
    expect(store.get(browserInstancesAtom)).toHaveLength(0)

    // Simulate full list() reconciliation from main process
    store.set(setBrowserInstancesAtom, [makeInstance('browser-2')])

    expect(store.get(browserInstancesAtom).map((i) => i.id)).toEqual(['browser-2'])
  })
})

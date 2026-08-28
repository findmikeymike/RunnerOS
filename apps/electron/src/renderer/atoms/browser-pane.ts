/**
 * Browser Pane Atoms
 *
 * Jotai atoms for browser instance state in the renderer.
 * Synced from the main process via BROWSER_PANE_STATE_CHANGED IPC events.
 */

import { atom } from 'jotai'
import type { BrowserInstanceInfo } from '../../shared/types'

/** Map of all browser instances by ID */
export const browserInstancesMapAtom = atom<Map<string, BrowserInstanceInfo>>(new Map())

/** Derived: array of all browser instances (for iteration) */
export const browserInstancesAtom = atom<BrowserInstanceInfo[]>(
  (get) => Array.from(get(browserInstancesMapAtom).values())
)

/** Derived: count of active browser instances */
export const browserInstanceCountAtom = atom<number>(
  (get) => get(browserInstancesMapAtom).size
)

/** Currently active browser instance ID (selected/focused by user interactions) */
export const activeBrowserInstanceIdAtom = atom<string | null>(null)

/** Whether the selected controlled browser is docked beside the current work. */
export const browserSidecarOpenAtom = atom(false)

/** Agent-controlled browsers the user explicitly dismissed during the current run. */
export const dismissedAgentBrowserIdsAtom = atom<Set<string>>(new Set<string>())

/** Select a browser and reveal the shared right-side work surface. */
export const openBrowserSidecarAtom = atom(
  null,
  (get, set, instanceId: string) => {
    const dismissedIds = new Set(get(dismissedAgentBrowserIdsAtom))
    dismissedIds.delete(instanceId)
    set(dismissedAgentBrowserIdsAtom, dismissedIds)
    set(activeBrowserInstanceIdAtom, instanceId)
    set(browserSidecarOpenAtom, true)
  },
)

/** Hide the browser surface without destroying its login session. */
export const closeBrowserSidecarAtom = atom(
  null,
  (_get, set) => {
    set(browserSidecarOpenAtom, false)
  },
)

/** Respect an explicit user close until that browser's current agent run ends. */
export const dismissBrowserSidecarAtom = atom(
  null,
  (get, set) => {
    const activeId = get(activeBrowserInstanceIdAtom)
    const activeInstance = activeId ? get(browserInstancesMapAtom).get(activeId) : null
    if (activeId && activeInstance?.agentControlActive) {
      const dismissedIds = new Set(get(dismissedAgentBrowserIdsAtom))
      dismissedIds.add(activeId)
      set(dismissedAgentBrowserIdsAtom, dismissedIds)
    }
    set(browserSidecarOpenAtom, false)
  },
)

export const clearBrowserAutoOpenDismissalAtom = atom(
  null,
  (get, set, instanceId: string) => {
    const dismissedIds = get(dismissedAgentBrowserIdsAtom)
    if (!dismissedIds.has(instanceId)) return
    const next = new Set(dismissedIds)
    next.delete(instanceId)
    set(dismissedAgentBrowserIdsAtom, next)
  },
)

export function shouldAutoOpenAgentBrowser(
  wasActive: boolean,
  info: BrowserInstanceInfo,
  activeSessionId: string | null | undefined,
  dismissedIds: ReadonlySet<string>,
): boolean {
  return !wasActive
    && info.agentControlActive
    && !!info.boundSessionId
    && info.boundSessionId === activeSessionId
    && !dismissedIds.has(info.id)
}

/** Tombstones for instances removed from renderer state (guards against late out-of-order updates) */
export const removedBrowserInstanceIdsAtom = atom<Set<string>>(new Set<string>())

/** Derived: currently active browser instance info */
export const activeBrowserInstanceAtom = atom<BrowserInstanceInfo | null>((get) => {
  const activeId = get(activeBrowserInstanceIdAtom)
  if (!activeId) return null
  return get(browserInstancesMapAtom).get(activeId) ?? null
})

/** Update a single browser instance (from IPC state change event) */
export const updateBrowserInstanceAtom = atom(
  null,
  (get, set, info: BrowserInstanceInfo) => {
    const removedIds = get(removedBrowserInstanceIdsAtom)
    if (removedIds.has(info.id)) {
      return
    }

    const map = new Map(get(browserInstancesMapAtom))
    map.set(info.id, info)
    set(browserInstancesMapAtom, map)
  }
)

/** Remove a browser instance (when destroyed) */
export const removeBrowserInstanceAtom = atom(
  null,
  (get, set, id: string) => {
    const map = new Map(get(browserInstancesMapAtom))
    map.delete(id)
    set(browserInstancesMapAtom, map)

    const removedIds = new Set(get(removedBrowserInstanceIdsAtom))
    removedIds.add(id)
    set(removedBrowserInstanceIdsAtom, removedIds)

    const dismissedIds = new Set(get(dismissedAgentBrowserIdsAtom))
    dismissedIds.delete(id)
    set(dismissedAgentBrowserIdsAtom, dismissedIds)
  }
)

/** Set all browser instances at once (from list query) */
export const setBrowserInstancesAtom = atom(
  null,
  (get, set, instances: BrowserInstanceInfo[]) => {
    const map = new Map<string, BrowserInstanceInfo>()
    for (const info of instances) {
      map.set(info.id, info)
    }
    set(browserInstancesMapAtom, map)

    const removedIds = new Set(get(removedBrowserInstanceIdsAtom))
    for (const info of instances) {
      removedIds.delete(info.id)
    }
    set(removedBrowserInstanceIdsAtom, removedIds)

    const liveIds = new Set(instances.map((info) => info.id))
    const dismissedIds = new Set(
      Array.from(get(dismissedAgentBrowserIdsAtom)).filter((id) => liveIds.has(id)),
    )
    set(dismissedAgentBrowserIdsAtom, dismissedIds)
  }
)

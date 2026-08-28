/**
 * BrowserTabStrip
 *
 * Rendered in the TopBar, shows compact badges for all active browser instances.
 * Each badge opens a shared action menu.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import * as Icons from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import {
  activeBrowserInstanceIdAtom,
  browserInstancesAtom,
  clearBrowserAutoOpenDismissalAtom,
  closeBrowserSidecarAtom,
  dismissBrowserSidecarAtom,
  dismissedAgentBrowserIdsAtom,
  openBrowserSidecarAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
  removeBrowserInstanceAtom,
  shouldAutoOpenAgentBrowser,
} from '@/atoms/browser-pane'
import { BrowserTabBadge } from './BrowserTabBadge'
import type { BrowserInstanceInfo } from '../../../shared/types'
import { getHostname } from './utils'
import { navigate, routes } from '@/lib/navigate'

const DEFAULT_MAX_VISIBLE_BADGES = 3

interface BrowserTabStripProps {
  activeSessionId?: string | null
  instancesOverride?: BrowserInstanceInfo[]
  maxVisibleBadges?: number
}

export function BrowserTabStrip({
  activeSessionId,
  instancesOverride,
  maxVisibleBadges = DEFAULT_MAX_VISIBLE_BADGES,
}: BrowserTabStripProps) {
  const instances = useAtomValue(browserInstancesAtom)
  const setInstances = useSetAtom(setBrowserInstancesAtom)
  const updateInstance = useSetAtom(updateBrowserInstanceAtom)
  const removeInstance = useSetAtom(removeBrowserInstanceAtom)
  const [activeInstanceId, setActiveInstanceId] = useAtom(activeBrowserInstanceIdAtom)
  const openBrowserSidecar = useSetAtom(openBrowserSidecarAtom)
  const closeBrowserSidecar = useSetAtom(closeBrowserSidecarAtom)
  const dismissBrowserSidecar = useSetAtom(dismissBrowserSidecarAtom)
  const clearAutoOpenDismissal = useSetAtom(clearBrowserAutoOpenDismissalAtom)
  const dismissedAgentBrowserIds = useAtomValue(dismissedAgentBrowserIdsAtom)
  const effectiveInstances = instancesOverride ?? instances
  const instancesRef = useRef(effectiveInstances)
  const agentControlStateRef = useRef(new Map<string, boolean>())
  const dismissedAgentBrowserIdsRef = useRef(dismissedAgentBrowserIds)
  const removeReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const orderedInstances = useMemo(() => {
    const items = [...effectiveInstances]

    // Global list: keep all browser windows visible.
    // Optional ordering preference: session-local windows first.
    if (activeSessionId) {
      items.sort((a, b) => {
        const aInActiveSession = a.boundSessionId === activeSessionId ? 0 : 1
        const bInActiveSession = b.boundSessionId === activeSessionId ? 0 : 1
        if (aInActiveSession !== bInActiveSession) return aInActiveSession - bInActiveSession
        return a.id.localeCompare(b.id)
      })
    } else {
      items.sort((a, b) => a.id.localeCompare(b.id))
    }

    return items
  }, [effectiveInstances, activeSessionId])

  useEffect(() => {
    instancesRef.current = effectiveInstances
    for (const instance of effectiveInstances) {
      if (!agentControlStateRef.current.has(instance.id)) {
        agentControlStateRef.current.set(instance.id, instance.agentControlActive)
      }
    }
  }, [effectiveInstances])

  useEffect(() => {
    dismissedAgentBrowserIdsRef.current = dismissedAgentBrowserIds
  }, [dismissedAgentBrowserIds])

  useEffect(() => {
    if (instancesOverride) return

    const browserPaneApi = window.electronAPI?.browserPane
    if (!browserPaneApi || !window.electronAPI.isChannelAvailable('browser-pane:list')) {
      setInstances([])
      setActiveInstanceId(null)
      return
    }

    browserPaneApi.list()
      .then((items) => {
        agentControlStateRef.current = new Map(items.map((item) => [item.id, item.agentControlActive]))
        setInstances(items)
        if (items.length === 0) {
          setActiveInstanceId(null)
          return
        }
        setActiveInstanceId((prev) => prev ?? items[0].id)
      })
      .catch((error) => {
        console.warn('[BrowserTabStrip] Failed to list browser panes:', error)
        setInstances([])
        setActiveInstanceId(null)
      })
  }, [instancesOverride, setInstances, setActiveInstanceId])

  useEffect(() => {
    if (instancesOverride) return

    const browserPaneApi = window.electronAPI?.browserPane
    if (!browserPaneApi || !window.electronAPI.isChannelAvailable('browser-pane:list')) return

    const cleanupState = browserPaneApi.onStateChanged((info: BrowserInstanceInfo) => {
      const wasActive = agentControlStateRef.current.get(info.id) ?? false
      agentControlStateRef.current.set(info.id, info.agentControlActive)
      updateInstance(info)
      if (!info.agentControlActive) {
        clearAutoOpenDismissal(info.id)
      } else if (shouldAutoOpenAgentBrowser(wasActive, info, activeSessionId, dismissedAgentBrowserIdsRef.current)) {
        openBrowserSidecar(info.id)
      }
    })

    const cleanupRemoved = browserPaneApi.onRemoved((id: string) => {
      removeInstance(id)
      agentControlStateRef.current.delete(id)
      setActiveInstanceId((prev) => {
        if (prev !== id) return prev
        const remaining = instancesRef.current.filter((item) => item.id !== id)
        return remaining[0]?.id ?? null
      })
      if (activeInstanceId === id) closeBrowserSidecar()

      if (removeReconcileTimerRef.current) {
        clearTimeout(removeReconcileTimerRef.current)
      }

      removeReconcileTimerRef.current = setTimeout(() => {
        removeReconcileTimerRef.current = null
        void browserPaneApi.list()
          .then((items) => {
            setInstances(items)
            setActiveInstanceId((prev) => {
              if (!prev) return items[0]?.id ?? null
              return items.some((item) => item.id === prev) ? prev : (items[0]?.id ?? null)
            })
          })
          .catch((error) => {
            console.warn('[BrowserTabStrip] Reconcile list failed after remove:', error)
          })
      }, 75)
    })

    const cleanupInteracted = browserPaneApi.onInteracted((id: string) => {
      setActiveInstanceId(id)
    })

    return () => {
      cleanupState()
      cleanupRemoved()
      cleanupInteracted()
      if (removeReconcileTimerRef.current) {
        clearTimeout(removeReconcileTimerRef.current)
        removeReconcileTimerRef.current = null
      }
    }
  }, [activeInstanceId, activeSessionId, clearAutoOpenDismissal, closeBrowserSidecar, instancesOverride, openBrowserSidecar, updateInstance, removeInstance, setActiveInstanceId, setInstances])

  useEffect(() => {
    if (orderedInstances.length === 0) {
      setActiveInstanceId(null)
      return
    }
    if (!activeInstanceId || !orderedInstances.some((item) => item.id === activeInstanceId)) {
      setActiveInstanceId(orderedInstances[0].id)
    }
  }, [orderedInstances, activeInstanceId, setActiveInstanceId])

  const focusBrowserWindow = useCallback((instance: BrowserInstanceInfo) => {
    openBrowserSidecar(instance.id)
    if (instancesOverride) return
  }, [instancesOverride, openBrowserSidecar])

  const popOutBrowserWindow = useCallback((instance: BrowserInstanceInfo) => {
    if (instancesOverride) return
    if (activeInstanceId === instance.id) dismissBrowserSidecar()
    void window.electronAPI.browserPane.popOut(instance.id).catch((error) => {
      console.warn(`[BrowserTabStrip] Failed to pop out browser ${instance.id}:`, error)
    })
  }, [activeInstanceId, dismissBrowserSidecar, instancesOverride])

  const openSessionUsingWindow = useCallback((instance: BrowserInstanceInfo) => {
    const sessionId = instance.boundSessionId ?? instance.ownerSessionId
    if (!sessionId) return
    navigate(routes.view.allSessions(sessionId))
  }, [])

  const terminateBrowserWindow = useCallback((instance: BrowserInstanceInfo) => {
    if (!instancesOverride) {
      const browserPaneApi = window.electronAPI?.browserPane
      if (!browserPaneApi) {
        console.warn('[BrowserTabStrip] browserPane API unavailable for terminate action')
      } else {
        void browserPaneApi.destroy(instance.id).catch((error) => {
          console.warn(`[BrowserTabStrip] Failed to terminate browser window ${instance.id}:`, error)
        })
      }
      removeInstance(instance.id)
    }

    setActiveInstanceId((prev) => {
      if (prev !== instance.id) return prev
      const remaining = instancesRef.current.filter((item) => item.id !== instance.id)
      return remaining[0]?.id ?? null
    })
  }, [instancesOverride, removeInstance, setActiveInstanceId])

  const renderBrowserActions = useCallback((instance: BrowserInstanceInfo) => {
    const canUseLiveWindowActions = !instancesOverride
    const targetSessionId = instance.boundSessionId ?? instance.ownerSessionId
    const canOpenSession = !!targetSessionId
    const openSessionLabel = instance.agentControlActive
      ? 'Open Session Using this Window'
      : 'Open Session Which Used this Window'

    return (
      <>
        <StyledDropdownMenuItem
          disabled={!canUseLiveWindowActions}
          onSelect={() => focusBrowserWindow(instance)}
        >
          <Icons.Monitor className="h-3.5 w-3.5" />
          Open in Sidecar
        </StyledDropdownMenuItem>

        <StyledDropdownMenuItem
          disabled={!canUseLiveWindowActions}
          onSelect={() => popOutBrowserWindow(instance)}
        >
          <Icons.ExternalLink className="h-3.5 w-3.5" />
          Pop Out Browser
        </StyledDropdownMenuItem>

        <StyledDropdownMenuItem
          disabled={!canOpenSession}
          onSelect={() => openSessionUsingWindow(instance)}
        >
          <Icons.PanelRightOpen className="h-3.5 w-3.5" />
          {openSessionLabel}
        </StyledDropdownMenuItem>

        <StyledDropdownMenuSeparator />

        <StyledDropdownMenuItem
          variant="destructive"
          disabled={!canUseLiveWindowActions}
          onSelect={() => terminateBrowserWindow(instance)}
        >
          <Icons.XCircle className="h-3.5 w-3.5" />
          Terminate Browser
        </StyledDropdownMenuItem>
      </>
    )
  }, [instancesOverride, focusBrowserWindow, openSessionUsingWindow, popOutBrowserWindow, terminateBrowserWindow])

  if (orderedInstances.length === 0) return null

  const visibleBadgeCount = Math.max(1, maxVisibleBadges)
  const visible = orderedInstances.slice(0, visibleBadgeCount)
  const overflow = orderedInstances.slice(visibleBadgeCount)

  return (
    <div className="flex items-center gap-1.5">
      {visible.map((instance) => (
        <DropdownMenu key={instance.id}>
          <DropdownMenuTrigger asChild>
            <BrowserTabBadge
              instance={instance}
              isActive={instance.id === activeInstanceId}
            />
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-56">
            {renderBrowserActions(instance)}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      ))}

      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-[26px] px-1.5 rounded-lg text-[11px] text-foreground/50 bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors cursor-pointer titlebar-no-drag"
            >
              +{overflow.length}
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" minWidth="min-w-64">
            {overflow.map((instance) => {
              const hostname = getHostname(instance.url)
              const displayLabel = instance.title.trim() || hostname || 'Local File'
              return (
                <DropdownMenuSub key={instance.id}>
                  <StyledDropdownMenuSubTrigger>
                    {instance.isLoading ? (
                      <Spinner className="text-[10px]" />
                    ) : (
                      <Icons.Globe className="h-3.5 w-3.5" />
                    )}
                    <span className="truncate">{displayLabel}</span>
                  </StyledDropdownMenuSubTrigger>
                  <StyledDropdownMenuSubContent minWidth="min-w-56">
                    {renderBrowserActions(instance)}
                  </StyledDropdownMenuSubContent>
                </DropdownMenuSub>
              )
            })}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

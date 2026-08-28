/**
 * PanelStackContainer
 *
 * Horizontal layout container for ALL panels:
 * Sidebar → Navigator → Content Panel(s) with resize sashes.
 *
 * Content panels use CSS flex-grow with their proportions as weights:
 * - Each panel gets `flex: <proportion> 1 0px` with `min-width: PANEL_MIN_WIDTH`
 * - Flex distributes available space proportionally — panels fill the viewport
 * - When panels hit min-width, overflow-x: auto kicks in naturally
 *
 * Sidebar and Navigator are NOT part of the proportional layout —
 * they have their own fixed/user-resizable widths managed by AppShell.
 * They just reduce the available width for content panels and scroll with everything else.
 *
 * The right sidebar stays OUTSIDE this container.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { panelStackAtom, focusedPanelIdAtom, focusedSessionIdAtom } from '@/atoms/panel-stack'
import {
  activeVisualSurfaceAtom,
  resolveVisualSurfacePresentationAtom,
  visualSurfacePresentationModeAtom,
} from '@/atoms/visual-surfaces'
import {
  activeBrowserInstanceIdAtom,
  browserInstancesAtom,
  browserSidecarOpenAtom,
  closeBrowserSidecarAtom,
  dismissBrowserSidecarAtom,
} from '@/atoms/browser-pane'
import { useContainerWidth } from '@/hooks/useContainerWidth'
import { VisualSurfacePanel } from '@/components/visual-surfaces/VisualSurfacePanel'
import {
  clampVisualSidecarWidth,
  readVisualSidecarWidthPreference,
  serializeVisualSidecarWidthPreference,
  VISUAL_SIDECAR_DEFAULT_WIDTH,
  VISUAL_SIDECAR_MAX_WIDTH,
  VISUAL_SIDECAR_MIN_CHAT_WIDTH,
  VISUAL_SIDECAR_MIN_WIDTH,
} from '@/components/visual-surfaces/VisualSidecarResizeHandle'
import { BrowserSidecarPanel } from '@/components/browser/BrowserSidecarPanel'
import { PanelSlot } from './PanelSlot'
import { PanelResizeSash } from './PanelResizeSash'
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_TRAILING_INSET,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from './panel-constants'

/** Spring transition matching AppShell's sidebar/navigator animation */
const PANEL_SPRING = { type: 'spring' as const, stiffness: 600, damping: 49 }

interface PanelStackContainerProps {
  sidebarSlot: React.ReactNode
  sidebarWidth: number
  navigatorSlot: React.ReactNode
  navigatorWidth: number
  isSidebarAndNavigatorHidden: boolean
  isRightSidebarVisible?: boolean
  /** Compact mode: single-panel, list/content toggle (mobile or narrow window) */
  isCompact?: boolean
  isResizing?: boolean
  /** Remove floating-panel gutters so the product surface becomes the window canvas. */
  edgeToEdge?: boolean
}

export function PanelStackContainer({
  sidebarSlot,
  sidebarWidth,
  navigatorSlot,
  navigatorWidth,
  isSidebarAndNavigatorHidden,
  isRightSidebarVisible,
  isCompact = false,
  isResizing,
  edgeToEdge = false,
}: PanelStackContainerProps) {
  const panelStack = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const activeVisualSurface = useAtomValue(activeVisualSurfaceAtom)
  const visualPresentationMode = useAtomValue(visualSurfacePresentationModeAtom)
  const resolveVisualPresentation = useSetAtom(resolveVisualSurfacePresentationAtom)
  const browserInstances = useAtomValue(browserInstancesAtom)
  const activeBrowserInstanceId = useAtomValue(activeBrowserInstanceIdAtom)
  const setActiveBrowserInstanceId = useSetAtom(activeBrowserInstanceIdAtom)
  const browserSidecarOpen = useAtomValue(browserSidecarOpenAtom)
  const closeBrowserSidecar = useSetAtom(closeBrowserSidecarAtom)
  const dismissBrowserSidecar = useSetAtom(dismissBrowserSidecarAtom)

  const contentPanels = panelStack

  // Compact mode: show list OR content based on the focused panel's ROUTE,
  // not just whether a panel exists. When the route has a session selected
  // (e.g., allSessions/session/abc), show content. When on a list view
  // (e.g., allSessions), show navigator. This allows back-navigation to
  // return to the session list.
  const hasSelectedContent = isCompact && !!focusedSessionId
  const visiblePanels = isCompact
    ? contentPanels.filter(e => e.id === focusedPanelId).slice(0, 1)
    : contentPanels

  const scrollRef = useRef<HTMLDivElement>(null)
  const containerWidth = useContainerWidth(scrollRef)
  const prevCountRef = useRef(contentPanels.length)
  const visualPreferenceWriteRef = useRef(Promise.resolve())
  const [visualSidecarWidth, setVisualSidecarWidth] = useState(VISUAL_SIDECAR_DEFAULT_WIDTH)

  const hasSidebar = sidebarWidth > 0
  // In compact mode, hide navigator when content is selected (show list OR content, not both)
  const hasNavigator = isCompact ? (navigatorWidth > 0 && !hasSelectedContent) : navigatorWidth > 0
  const isMultiPanel = visiblePanels.length > 1
  const visibleVisualSurface =
    activeVisualSurface && (!activeVisualSurface.sessionId || activeVisualSurface.sessionId === focusedSessionId)
      ? activeVisualSurface
      : null
  const activeBrowserInstance = browserSidecarOpen
    ? browserInstances.find((instance) => instance.id === activeBrowserInstanceId) ?? null
    : null
  const isLeftEdge = !hasSidebar && !hasNavigator
  const shouldCenterSinglePanel = !isCompact && visiblePanels.length === 1 && !hasNavigator && !hasSidebar
  const stackGap = edgeToEdge ? PANEL_GAP : hasSidebar && !hasNavigator ? 24 : PANEL_GAP
  const topBreathingRoom = edgeToEdge ? 0 : hasSidebar ? 18 : 0
  const bottomBreathingRoom = edgeToEdge ? 0 : 2

  // Auto-scroll to newly pushed content panel
  useEffect(() => {
    if (contentPanels.length > prevCountRef.current && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          left: scrollRef.current.scrollWidth,
          behavior: isCompact ? 'instant' : 'smooth',
        })
      })
    }
    prevCountRef.current = contentPanels.length
  }, [contentPanels.length, isCompact])

  useEffect(() => {
    let cancelled = false
    window.electronAPI.readPreferences().then(({ content }) => {
      if (!cancelled) setVisualSidecarWidth(readVisualSidecarWidthPreference(content))
    }).catch(() => {
      // Keep the default width when preferences are unavailable.
    })
    return () => { cancelled = true }
  }, [])

  const transition = (isResizing || isCompact) ? { duration: 0 } : PANEL_SPRING
  const canUseInlineSidecar =
    !isCompact &&
    !isMultiPanel &&
    containerWidth >= 1100
  const inlineVisualGapCount = 1 + Number(hasSidebar) + Number(hasNavigator)
  const inlineVisualMaxWidth = useMemo(() => {
    const available = containerWidth
      - sidebarWidth
      - navigatorWidth
      - (inlineVisualGapCount * stackGap)
      - VISUAL_SIDECAR_MIN_CHAT_WIDTH
    return Math.min(VISUAL_SIDECAR_MAX_WIDTH, Math.max(0, available))
  }, [containerWidth, inlineVisualGapCount, navigatorWidth, sidebarWidth, stackGap])
  const canUseInlineVisualSidecar = canUseInlineSidecar && inlineVisualMaxWidth >= VISUAL_SIDECAR_MIN_WIDTH
  const effectiveVisualSidecarWidth = clampVisualSidecarWidth(visualSidecarWidth, inlineVisualMaxWidth)
  const showInlineBrowserSidecar = !!activeBrowserInstance && canUseInlineSidecar
  const showOverlayBrowserSidecar = !!activeBrowserInstance && !canUseInlineSidecar
  const showInlineVisualSidecar =
    !activeBrowserInstance &&
    !!visibleVisualSurface &&
    canUseInlineVisualSidecar &&
    visualPresentationMode !== 'rollup'
  const resolvedVisualPresentation = visibleVisualSurface
    ? showInlineVisualSidecar
      ? 'sidecar'
      : 'rollup'
    : null

  useEffect(() => {
    resolveVisualPresentation(resolvedVisualPresentation)
  }, [resolveVisualPresentation, resolvedVisualPresentation])

  const hideBrowserSidecar = useCallback(() => {
    closeBrowserSidecar()
  }, [closeBrowserSidecar])

  const showCanvasSidecar = useCallback(() => {
    dismissBrowserSidecar()
  }, [dismissBrowserSidecar])

  const resizeVisualSidecar = useCallback((width: number) => {
    setVisualSidecarWidth(clampVisualSidecarWidth(width, inlineVisualMaxWidth))
  }, [inlineVisualMaxWidth])

  const persistVisualSidecarWidth = useCallback((width: number) => {
    const nextWidth = clampVisualSidecarWidth(width, inlineVisualMaxWidth)
    visualPreferenceWriteRef.current = visualPreferenceWriteRef.current.then(async () => {
      const { content } = await window.electronAPI.readPreferences()
      await window.electronAPI.writePreferences(serializeVisualSidecarWidthPreference(content, nextWidth))
    }).catch((err) => {
      console.warn('[PanelStackContainer] failed to persist canvas width:', err)
    })
  }, [inlineVisualMaxWidth])

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-w-0 flex relative z-panel panel-scroll @container/shell"
      style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        // Extra vertical space for box-shadows (collapsed back with negative margin)
        paddingBottom: edgeToEdge ? 0 : PANEL_STACK_VERTICAL_OVERFLOW + bottomBreathingRoom,
        paddingTop: edgeToEdge ? 0 : PANEL_STACK_VERTICAL_OVERFLOW + topBreathingRoom,
        marginTop: edgeToEdge ? 0 : -PANEL_STACK_VERTICAL_OVERFLOW + topBreathingRoom,
        // Extend to window bottom so scrollbar sits at the very edge
        marginBottom: -bottomBreathingRoom,
        // Keep the rightmost panel off the window edge while leaving room for shadows.
        paddingRight: edgeToEdge ? 0 : isCompact ? PANEL_EDGE_INSET : PANEL_TRAILING_INSET,
      }}
    >
      {/* Inner flex container — flex-grow: 1 fills viewport, content can overflow for scroll.
           Animated paddingLeft provides window-edge spacing when sidebar/navigator are hidden.
           Hidden slots use marginRight: -PANEL_GAP to cancel their trailing flex gap. */}
      <motion.div
        className="relative z-[1] flex h-full"
        initial={false}
        animate={{ paddingLeft: edgeToEdge ? 0 : !hasSidebar ? PANEL_EDGE_INSET : 0 }}
        transition={transition}
        style={{
          gap: stackGap,
          flexGrow: 1,
          minWidth: 0,
          justifyContent: shouldCenterSinglePanel ? 'center' : 'flex-start',
        }}
      >
        {/* === SIDEBAR SLOT === */}
        <motion.div
          data-panel-role="sidebar"
          initial={false}
          animate={{
            width: hasSidebar ? sidebarWidth : 0,
            marginRight: hasSidebar ? 0 : -stackGap,
            opacity: hasSidebar ? 1 : 0,
          }}
          transition={transition}
          className="h-full relative shrink-0"
          style={{ overflowX: 'clip', overflowY: 'visible' }}
        >
          <div className="h-full" style={{ width: sidebarWidth }}>
            {sidebarSlot}
          </div>
        </motion.div>

        {/* === NAVIGATOR SLOT === */}
        <motion.div
          data-panel-role="navigator"
          initial={false}
          animate={{
            width: hasNavigator ? navigatorWidth : 0,
            marginRight: hasNavigator ? 0 : -stackGap,
            opacity: hasNavigator ? 1 : 0,
          }}
          transition={transition}
          className={cn(
            'h-full overflow-hidden relative shrink-0 z-[2]',
            'runneros-glass-panel',
          )}
          style={{
            // In compact mode (no content selected), navigator fills available space
            ...(isCompact && hasNavigator && !hasSelectedContent ? { flex: '1 1 auto' } : {}),
            borderTopLeftRadius: RADIUS_INNER,
            borderBottomLeftRadius: !hasSidebar ? RADIUS_EDGE : RADIUS_INNER,
            borderTopRightRadius: RADIUS_INNER,
            borderBottomRightRadius: RADIUS_INNER,
          }}
        >
          <div className="h-full" style={{ width: isCompact && hasNavigator && !hasSelectedContent ? '100%' : navigatorWidth }}>
            {navigatorSlot}
          </div>
        </motion.div>

        {/* === CONTENT PANELS WITH SASHES === */}
        {visiblePanels.length === 0 ? (
          // Only show empty placeholder when not in compact mode (compact shows navigator instead)
          isCompact ? null : <div className="flex-1 flex items-center justify-center" />
        ) : (
          visiblePanels.map((entry, index) => (
            <PanelSlot
              key={entry.id}
              entry={entry}
              isOnly={visiblePanels.length === 1}
              isFocusedPanel={isMultiPanel ? entry.id === focusedPanelId : true}
              isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
              isAtLeftEdge={index === 0 && isLeftEdge}
              isAtRightEdge={index === visiblePanels.length - 1 && !isRightSidebarVisible && !showInlineVisualSidecar && !showInlineBrowserSidecar}
              proportion={entry.proportion}
              isCompact={isCompact}
              edgeToEdge={edgeToEdge}
              sash={index > 0 ? (
                <PanelResizeSash
                  leftIndex={index - 1}
                  rightIndex={index}
                />
              ) : undefined}
            />
          ))
        )}
        {showInlineVisualSidecar ? (
          <VisualSurfacePanel
            presentation="inline"
            inlineWidth={effectiveVisualSidecarWidth}
            inlineMaxWidth={inlineVisualMaxWidth}
            onInlineWidthChange={resizeVisualSidecar}
            onInlineWidthCommit={persistVisualSidecarWidth}
          />
        ) : null}
        {showInlineBrowserSidecar && activeBrowserInstance ? (
          <BrowserSidecarPanel
            activeInstance={activeBrowserInstance}
            instances={browserInstances}
            presentation="inline"
            hasCanvas={!!visibleVisualSurface}
            onSelectInstance={setActiveBrowserInstanceId}
            onShowCanvas={showCanvasSidecar}
            onClose={hideBrowserSidecar}
            onDismiss={dismissBrowserSidecar}
          />
        ) : null}
        {showOverlayBrowserSidecar && activeBrowserInstance ? (
          <BrowserSidecarPanel
            activeInstance={activeBrowserInstance}
            instances={browserInstances}
            presentation="overlay"
            hasCanvas={!!visibleVisualSurface}
            onSelectInstance={setActiveBrowserInstanceId}
            onShowCanvas={showCanvasSidecar}
            onClose={hideBrowserSidecar}
            onDismiss={dismissBrowserSidecar}
          />
        ) : null}
      </motion.div>
    </div>
  )
}

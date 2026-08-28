import * as React from 'react'
import { ExternalLink, Layers3, PanelRightClose } from 'lucide-react'
import type { BrowserInstanceInfo, BrowserPaneBounds } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { hasOpenOverlay } from '@/lib/overlay-detection'
import { cn } from '@/lib/utils'
import {
  cancelDeferredSidecarHide,
  deferSidecarHide,
  type DeferredSidecarHideGate,
} from './browser-sidecar-lifecycle'
import { getHostname } from './utils'

interface BrowserSidecarPanelProps {
  activeInstance: BrowserInstanceInfo
  instances: BrowserInstanceInfo[]
  presentation: 'inline' | 'overlay'
  hasCanvas: boolean
  onSelectInstance: (instanceId: string) => void
  onShowCanvas: () => void
  /** System close (ownership loss/removal) that must not suppress the next agent run. */
  onClose: () => void
  /** Explicit user close that should be respected for the current agent run. */
  onDismiss: () => void
}

function browserLabel(instance: BrowserInstanceInfo): string {
  const host = getHostname(instance.url)
  if (host) return host.replace(/^www\./, '')
  return instance.title || 'Browser'
}

function elementBounds(element: HTMLElement): BrowserPaneBounds | null {
  const rect = element.getBoundingClientRect()
  if (rect.width < 120 || rect.height < 120) return null
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function sameBounds(left: BrowserPaneBounds | null, right: BrowserPaneBounds): boolean {
  return !!left
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
}

export const BrowserSidecarPanel: React.FC<BrowserSidecarPanelProps> = ({
  activeInstance,
  instances,
  presentation,
  hasCanvas,
  onSelectInstance,
  onShowCanvas,
  onClose,
  onDismiss,
}) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const dockedRef = React.useRef(false)
  const lastBoundsRef = React.useRef<BrowserPaneBounds | null>(null)
  const frameRef = React.useRef<number | null>(null)
  const wasDockedRef = React.useRef(false)
  const hideGateRef = React.useRef<DeferredSidecarHideGate>({ generation: 0 })
  const [overlayOpen, setOverlayOpen] = React.useState(() => hasOpenOverlay())

  React.useEffect(() => {
    const hideGate = hideGateRef.current
    cancelDeferredSidecarHide(hideGate)
    const instanceId = activeInstance.id
    return () => {
      deferSidecarHide(hideGate, () => (
        window.electronAPI.browserPane.hideSidecar(instanceId).catch(() => {})
      ))
    }
  }, [activeInstance.id])

  React.useEffect(() => {
    let frame: number | null = null
    const update = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        setOverlayOpen(hasOpenOverlay())
      })
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    update()
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  const updateBounds = React.useCallback(() => {
    const element = hostRef.current
    if (!element || !dockedRef.current) return
    const bounds = elementBounds(element)
    if (!bounds || sameBounds(lastBoundsRef.current, bounds)) return
    lastBoundsRef.current = bounds
    void window.electronAPI.browserPane.updateDockBounds(activeInstance.id, bounds).catch((error) => {
      console.warn(`[BrowserSidecarPanel] Failed to update bounds for ${activeInstance.id}:`, error)
    })
  }, [activeInstance.id])

  const scheduleBoundsUpdate = React.useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      updateBounds()
    })
  }, [updateBounds])

  React.useLayoutEffect(() => {
    const element = hostRef.current
    if (!element) return

    let cancelled = false
    dockedRef.current = false
    lastBoundsRef.current = null
    wasDockedRef.current = false

    if (overlayOpen) {
      void window.electronAPI.browserPane.hideSidecar(activeInstance.id).catch(() => {})
      return
    }

    const dock = () => {
      const bounds = elementBounds(element)
      if (!bounds) {
        frameRef.current = requestAnimationFrame(dock)
        return
      }

      lastBoundsRef.current = bounds
      void window.electronAPI.browserPane.dock(activeInstance.id, bounds)
        .then(() => {
          if (cancelled) return
          dockedRef.current = true
          wasDockedRef.current = true
          scheduleBoundsUpdate()
        })
        .catch((error) => {
          console.warn(`[BrowserSidecarPanel] Failed to dock ${activeInstance.id}:`, error)
        })
    }

    dock()

    const resizeObserver = new ResizeObserver(scheduleBoundsUpdate)
    resizeObserver.observe(element)
    window.addEventListener('resize', scheduleBoundsUpdate)
    window.addEventListener('scroll', scheduleBoundsUpdate, true)

    return () => {
      cancelled = true
      dockedRef.current = false
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleBoundsUpdate)
      window.removeEventListener('scroll', scheduleBoundsUpdate, true)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [activeInstance.id, overlayOpen, scheduleBoundsUpdate])

  React.useEffect(() => {
    if (activeInstance.presentation === 'sidecar') {
      const ownerId = activeInstance.sidecarHostWebContentsId
      const localId = window.electronAPI.webContentsId
      if (ownerId == null || localId == null || ownerId === localId) {
        wasDockedRef.current = true
      } else if (wasDockedRef.current) {
        onClose()
      }
      return
    }
    if (overlayOpen) return
    if (wasDockedRef.current && !activeInstance.isVisible) onDismiss()
  }, [activeInstance.isVisible, activeInstance.presentation, activeInstance.sidecarHostWebContentsId, onClose, onDismiss, overlayOpen])

  const popOut = React.useCallback(() => {
    void window.electronAPI.browserPane.popOut(activeInstance.id)
      .then(onDismiss)
      .catch((error) => {
        console.warn(`[BrowserSidecarPanel] Failed to pop out ${activeInstance.id}:`, error)
      })
  }, [activeInstance.id, onDismiss])

  const close = React.useCallback(() => {
    void window.electronAPI.browserPane.hideSidecar(activeInstance.id)
      .finally(onDismiss)
  }, [activeInstance.id, onDismiss])

  return (
    <aside
      data-browser-sidecar="open"
      data-browser-sidecar-mode={presentation}
      className={cn(
        'z-[9] flex min-h-0 overflow-hidden rounded-[12px] border border-border/70 bg-background shadow-modal-small',
        presentation === 'inline'
          ? 'h-full w-[clamp(420px,38vw,580px)] shrink-0'
          : 'absolute bottom-2 right-2 top-2 w-[min(620px,calc(100%_-_16px))]',
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/55 bg-background/95 px-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {instances.map((instance) => (
              <button
                key={instance.id}
                type="button"
                title={instance.title || instance.url}
                onClick={() => onSelectInstance(instance.id)}
                className={cn(
                  'flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
                  instance.id === activeInstance.id
                    ? 'bg-foreground/[0.09] text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
                )}
              >
                <span className={cn('size-1.5 rounded-full', instance.agentControlActive ? 'bg-amber-400' : 'bg-emerald-400/70')} />
                <span className="truncate">{browserLabel(instance)}</span>
              </button>
            ))}
            {hasCanvas ? (
              <button
                type="button"
                title="Show Canvas"
                onClick={onShowCanvas}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <Layers3 className="size-3.5" />
                Canvas
              </button>
            ) : null}
          </div>
          <Button type="button" size="icon" variant="ghost" className="size-7" title="Pop browser out" aria-label="Pop browser out" onClick={popOut}>
            <ExternalLink className="size-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="size-7" title="Close browser sidecar" aria-label="Close browser sidecar" onClick={close}>
            <PanelRightClose className="size-3.5" />
          </Button>
        </header>
        <div ref={hostRef} className="min-h-0 flex-1 bg-[#080808]" aria-label="Controlled browser" />
      </div>
    </aside>
  )
}

export default BrowserSidecarPanel

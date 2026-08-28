import * as React from 'react'
import { cn } from '@/lib/utils'

export const VISUAL_SIDECAR_DEFAULT_WIDTH = 480
export const VISUAL_SIDECAR_MIN_WIDTH = 360
export const VISUAL_SIDECAR_MAX_WIDTH = 720
export const VISUAL_SIDECAR_MIN_CHAT_WIDTH = 420

const KEYBOARD_RESIZE_STEP = 24

export function clampVisualSidecarWidth(width: number, maxWidth: number): number {
  const safeMax = Math.max(VISUAL_SIDECAR_MIN_WIDTH, maxWidth)
  if (!Number.isFinite(width)) return Math.min(VISUAL_SIDECAR_DEFAULT_WIDTH, safeMax)
  return Math.min(Math.max(width, VISUAL_SIDECAR_MIN_WIDTH), safeMax)
}

export function readVisualSidecarWidthPreference(content: string): number {
  try {
    const preferences = JSON.parse(content) as { layout?: { visualSidecarWidth?: unknown } }
    const stored = Number(preferences.layout?.visualSidecarWidth)
    return Number.isFinite(stored) ? stored : VISUAL_SIDECAR_DEFAULT_WIDTH
  } catch {
    return VISUAL_SIDECAR_DEFAULT_WIDTH
  }
}

export function serializeVisualSidecarWidthPreference(content: string, width: number): string {
  let preferences: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(content) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      preferences = parsed as Record<string, unknown>
    }
  } catch {
    // Replace malformed preferences with the valid setting being saved.
  }
  const previousLayout = preferences.layout && typeof preferences.layout === 'object' && !Array.isArray(preferences.layout)
    ? preferences.layout as Record<string, unknown>
    : {}
  return JSON.stringify({
    ...preferences,
    layout: { ...previousLayout, visualSidecarWidth: Math.round(width) },
    updatedAt: Date.now(),
  }, null, 2)
}

interface VisualSidecarResizeHandleProps {
  width: number
  maxWidth: number
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
}

export function VisualSidecarResizeHandle({
  width,
  maxWidth,
  onWidthChange,
  onWidthCommit,
}: VisualSidecarResizeHandleProps) {
  const [isDragging, setIsDragging] = React.useState(false)
  const cleanupRef = React.useRef<(() => void) | null>(null)

  const stopDragging = React.useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  React.useEffect(() => stopDragging, [stopDragging])

  const handleMouseDown = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()

    stopDragging()
    const startX = event.clientX
    const startWidth = width
    let latestWidth = width
    setIsDragging(true)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestWidth = clampVisualSidecarWidth(startWidth - (moveEvent.clientX - startX), maxWidth)
      onWidthChange(latestWidth)
    }
    const handleMouseUp = () => {
      onWidthCommit(latestWidth)
      stopDragging()
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsDragging(false)
    }

    cleanupRef.current = cleanup
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [maxWidth, onWidthChange, onWidthCommit, stopDragging, width])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const nextWidth = clampVisualSidecarWidth(width + KEYBOARD_RESIZE_STEP, maxWidth)
      onWidthChange(nextWidth)
      onWidthCommit(nextWidth)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      const nextWidth = clampVisualSidecarWidth(width - KEYBOARD_RESIZE_STEP, maxWidth)
      onWidthChange(nextWidth)
      onWidthCommit(nextWidth)
    } else if (event.key === 'Enter' || event.key === 'Home') {
      event.preventDefault()
      const nextWidth = clampVisualSidecarWidth(VISUAL_SIDECAR_DEFAULT_WIDTH, maxWidth)
      onWidthChange(nextWidth)
      onWidthCommit(nextWidth)
    }
  }, [maxWidth, onWidthChange, onWidthCommit, width])

  const resetWidth = React.useCallback(() => {
    const nextWidth = clampVisualSidecarWidth(VISUAL_SIDECAR_DEFAULT_WIDTH, maxWidth)
    onWidthChange(nextWidth)
    onWidthCommit(nextWidth)
  }, [maxWidth, onWidthChange, onWidthCommit])

  return (
    <div
      role="separator"
      aria-label="Resize chat and canvas"
      aria-orientation="vertical"
      aria-valuemin={VISUAL_SIDECAR_MIN_WIDTH}
      aria-valuemax={Math.round(maxWidth)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      data-testid="visual-sidecar-resize-handle"
      data-resizing={isDragging ? 'true' : 'false'}
      className={cn(
        'group absolute inset-y-0 -left-3 z-20 flex w-6 cursor-col-resize items-center justify-center outline-none',
        'focus-visible:ring-1 focus-visible:ring-orange-300/70',
      )}
      title="Drag to resize chat and canvas. Double-click to reset."
      onMouseDown={handleMouseDown}
      onDoubleClick={resetWidth}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          'h-14 w-1 rounded-full bg-white/20 shadow-xs transition-all',
          'group-hover:h-20 group-hover:bg-orange-300/70 group-focus-visible:h-20 group-focus-visible:bg-orange-300/70',
          isDragging && 'h-20 bg-orange-300',
        )}
      />
    </div>
  )
}

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('visual sidecar layout', () => {
  it('uses a local dark palette so canvas text stays readable', () => {
    const panel = readFileSync(join(import.meta.dir, '..', 'VisualSurfacePanel.tsx'), 'utf8')
    const board = readFileSync(join(import.meta.dir, '..', 'VisualBoardSurface.tsx'), 'utf8')

    expect(panel).toContain("'dark z-[7] flex min-h-0 animate-in text-foreground")
    expect(panel).toContain("'dark relative min-h-[220px]")
    expect(board).toContain('dark flex h-full min-h-0 flex-col overflow-hidden bg-[#050505] text-foreground')
  })

  it('wires the adjustable canvas width into the single-panel layout', () => {
    const stack = readFileSync(
      join(import.meta.dir, '..', '..', 'app-shell', 'PanelStackContainer.tsx'),
      'utf8',
    )
    const panel = readFileSync(join(import.meta.dir, '..', 'VisualSurfacePanel.tsx'), 'utf8')
    const handle = readFileSync(join(import.meta.dir, '..', 'VisualSidecarResizeHandle.tsx'), 'utf8')

    expect(stack).toContain('inlineWidth={effectiveVisualSidecarWidth}')
    expect(stack).toContain('onInlineWidthChange={resizeVisualSidecar}')
    expect(stack).toContain('onInlineWidthCommit={persistVisualSidecarWidth}')
    expect(stack).toContain('inlineVisualMaxWidth >= VISUAL_SIDECAR_MIN_WIDTH')
    expect(panel).toContain('<VisualSidecarResizeHandle')
    expect(handle).toContain('data-testid="visual-sidecar-resize-handle"')
  })
})

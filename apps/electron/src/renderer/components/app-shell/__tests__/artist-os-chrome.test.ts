import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Artist OS persistent shell chrome', () => {
  test('uses the thin ScriptOS-style sidebar and bottom-corner toggle', () => {
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    const openToggle = shell.indexOf('data-testid="sidebar-toggle-open"')
    const panelShell = shell.indexOf('=== OUTER LAYOUT: Unified Panel Stack')

    expect(openToggle).toBeGreaterThan(-1)
    expect(openToggle).toBeLessThan(panelShell)
    expect(shell).toContain('data-testid="sidebar-toggle-close"')
    expect(shell).toContain('pointer-events-auto absolute bottom-3 right-2 z-[80]')
    expect(shell).toContain('pointer-events-auto fixed bottom-3 left-2 z-[100]')
    expect(shell).toContain('usesWorkspaceHeader ? "px-3 pb-10 pt-3"')
    expect(shell).not.toContain('w-[56px]')
    expect(shell).not.toContain('<PanelLeftRounded')
  })

  test('keeps clickable traffic lights and the header divider permanently rendered', () => {
    const topBar = readFileSync(join(import.meta.dir, '..', 'TopBar.tsx'), 'utf8')
    const windowManager = readFileSync(
      join(import.meta.dir, '..', '..', '..', '..', 'main', 'window-manager.ts'),
      'utf8',
    )

    expect(topBar).toContain("RENDERER_PRODUCT_VARIANT === 'artist-os'")
    expect(topBar).toContain('data-testid="persistent-mac-window-controls"')
    expect(topBar).toContain('border-b border-white/10 bg-black text-white')
    expect(topBar).toContain('bg-[#ff5f57]')
    expect(topBar).toContain('bg-[#febc2e]')
    expect(topBar).toContain('bg-[#28c840]')
    expect(topBar).toContain('window.electronAPI.closeWindow()')
    expect(topBar).toContain('window.electronAPI.menuMinimize()')
    expect(topBar).toContain('window.electronAPI.menuMaximize()')
    expect(windowManager).toContain("RUNTIME_IDENTITY.variant === 'artist-os' ? false : visible")
    expect(windowManager).toContain("window.on('restore', keepArtistTrafficLightsStable)")
    expect(windowManager).toContain('managed.window.setWindowButtonVisibility(shouldShow)')
  })

  test('names the HQ and campaign agent front door Command', () => {
    const shell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')

    expect(shell).toMatch(/id: "nav:chat",\s+title: "Command",\s+label:[\s\S]*?icon: Sparkles/)
    expect(shell).toMatch(/id: "nav:work-chat",\s+title: "Command",\s+label:[\s\S]*?icon: Sparkles/)
  })
})

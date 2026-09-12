import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AppShellProvider } from '../../apps/electron/src/renderer/context/AppShellContext'
import { PanelSlot } from '../../apps/electron/src/renderer/components/app-shell/PanelSlot'
const host = window as any
host.saved = []
host.settingsSaved = []
host.electronAPI = {
  getWorkspaceSettings: async () => ({}),
  getSelfEditTarget: async () => null,
  getGitBranch: async () => null,
  isChannelAvailable: () => true,
  updateWorkspaceSetting: async (workspaceId: string, key: string, value: unknown) => {
    host.settingsSaved.push({ workspaceId, key, value })
  },
}
const root = createRoot(document.getElementById('root')!)
// Keep the same panel identity, just as route reconciliation does when both
// workspaces have Context selected. Flush the parent update before asserting.
host.renderWorkspace = (workspaceId: string) => flushSync(() => root.render(
  <AppShellProvider value={{ activeWorkspaceId: workspaceId } as any}>
    <PanelSlot
      entry={{ id: 'same-panel', route: 'workspace-context', proportion: 1 } as any}
      isOnly
      isFocusedPanel
      isSidebarAndNavigatorHidden={false}
      isAtLeftEdge
      isAtRightEdge
      proportion={1}
    />
  </AppShellProvider>,
))
host.renderWorkspace('A')
host.deferImport = () => {
  File.prototype.text = function () {
    return new Promise<string>(resolve => { host.finishImport = resolve })
  }
}

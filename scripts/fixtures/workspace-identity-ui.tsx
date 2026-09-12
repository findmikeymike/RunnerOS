import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AppShellProvider } from '../../apps/electron/src/renderer/context/AppShellContext'
import { useDirectoryPicker } from '../../apps/electron/src/renderer/hooks/useDirectoryPicker'
import { PanelSlot } from '../../apps/electron/src/renderer/components/app-shell/PanelSlot'
const host = window as any
host.saved = []
host.settingsSaved = []
host.pickerCalls = []
host.electronAPI = {
  getWorkspaceSettings: async () => ({}),
  getSelfEditTarget: async () => null,
  getGitBranch: async () => null,
  isChannelAvailable: () => true,
  openFolderDialog: () => new Promise<string>(resolve => { host.finishNativePicker = resolve }),
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

// Unlike the page regression, this keeps the hook mounted while the callback's
// owner changes. It exercises the reusable picker's own asynchronous boundary.
function PickerHarness({ owner }: { owner: string }) {
  const picker = useDirectoryPicker(path => { host.pickerCalls.push({ owner, path }) })
  host.picker = picker
  return <button onClick={picker.pickDirectory}>Open harness picker</button>
}
host.renderPicker = (owner: string, mode: 'remote' | 'local' = 'remote') => {
  host.pickerMode = mode
  flushSync(() => root.render(<PickerHarness owner={owner} />))
}

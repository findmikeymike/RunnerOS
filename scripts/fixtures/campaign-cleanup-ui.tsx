import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@craft-agent/ui'
import { VaultPage } from '../../apps/electron/src/renderer/components/app-shell/VaultPage'
import { WorkspaceRail } from '../../apps/electron/src/renderer/components/app-shell/WorkspaceRail'
import { CampaignCleanupDialog } from '../../apps/electron/src/renderer/components/app-shell/CampaignCleanupDialog'

const harness = window as any
harness.calls = []
harness.deleted = []
harness.cleanupClosedCount = 0
harness.failPreview = false
harness.failDelete = false
harness.delayDelete = false
const preview = {
  workspaceId: 'summer', campaignName: 'Summer EP', previewToken: 'reviewed-inventory',
  retainedFileCount: 2, retainedBytes: 3000000, retainedMemoryCount: 3, deletedFileCount: 9,
  retainedFiles: [
    { relativePath: 'assets/master.wav', sizeBytes: 2000000, sha256: 'a', reason: 'Audio' },
    { relativePath: 'release-kit/cover.png', sizeBytes: 1000000, sha256: 'b', reason: 'Release Kit' },
  ], warnings: ['Posts already scheduled with external services are not cancelled.'],
}
harness.electronAPI = {
  previewCampaignCleanup: async (id: string) => {
    harness.calls.push(['preview', id])
    if (harness.failPreview) throw new Error('Stop active agent work before deleting this campaign.')
    return preview
  },
  deleteCampaign: async (id: string, token: string) => {
    harness.calls.push(['delete', id, token])
    if (harness.failDelete) throw new Error('Campaign changed. Check the preview again.')
    if (harness.delayDelete) await new Promise(resolve => { harness.finishDelete = resolve })
    return { workspaceId: id, hqWorkspaceId: 'hq', retainedFileCount: 2, retainedMemoryCount: 3, pastReleaseLabel: 'Summer EP' }
  },
}
function Preview() {
  const [open, setOpen] = useState(false)
  return <main><button onClick={() => setOpen(true)}>Delete campaign</button>{open ? <CampaignCleanupDialog
    workspace={{ id: 'summer', name: 'Summer EP' }}
    onClose={() => { harness.cleanupClosedCount++; setOpen(false) }}
    onDeleted={result => { harness.deleted.push(result); setOpen(false) }}
  /> : null}</main>
}
const root = createRoot(document.getElementById('root')!)
harness.renderVault = () => {
  const asset = { source: 'copy', status: 'archived', rightsStatus: 'unknown', usableByAgents: false, createdAt: '2026-09-08', updatedAt: '2026-09-08' }
  harness.electronAPI.getArtistVaultManifest = async () => ({ version: 1, workspaceId: 'hq', vaultRoot: 'vault', storageMode: 'copied', assets: [
    { ...asset, id: 'old-master', category: 'music', kind: 'master-final', label: 'Summer master', tags: ['past-release', 'release:Summer EP'], campaigns: ['summer'] },
    { ...asset, id: 'old-cover', category: 'visuals', kind: 'cover-art', label: 'Summer cover', tags: ['past-release', 'release:Summer EP'], campaigns: ['summer'] },
    { ...asset, id: 'winter-video', category: 'video', kind: 'final-video', label: 'Winter video', tags: ['past-release', 'release:Winter EP'], campaigns: ['winter'] },
    { ...asset, id: 'new-master', category: 'music', kind: 'demo', label: 'New demo' },
  ] })
  root.render(<VaultPage workspaceId="hq" />)
}
harness.renderRail = (active = 'summer') => root.render(<TooltipProvider><WorkspaceRail orientation="horizontal" activeWorkspaceId={active}
  workspaces={[
    { id: 'hq', name: 'Artist HQ', rootPath: '/fake/hq', artistWorkspaceScope: 'hq', createdAt: 1 },
    { id: 'summer', name: 'Summer EP', rootPath: '/fake/summer', artistWorkspaceScope: 'campaign', createdAt: 1 },
  ]} onSelect={() => {}} /></TooltipProvider>)
root.render(<Preview />)

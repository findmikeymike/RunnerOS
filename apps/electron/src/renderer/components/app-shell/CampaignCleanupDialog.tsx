import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { CampaignCleanupPreview, CampaignCleanupResult } from '@craft-agent/shared/campaign-cleanup'

interface CampaignCleanupDialogProps {
  workspace: { id: string; name: string }
  onClose: () => void
  onDeleted: (result: CampaignCleanupResult) => void
}

export function CampaignCleanupDialog({ workspace, onClose, onDeleted }: CampaignCleanupDialogProps) {
  const [preview, setPreview] = React.useState<CampaignCleanupPreview | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [deleting, setDeleting] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const submitting = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPreview(null)
    setError(null)
    window.electronAPI.previewCampaignCleanup(workspace.id).then(result => {
      if (!cancelled) setPreview(result)
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspace.id, revision])

  const confirm = async () => {
    if (!preview || submitting.current) return
    submitting.current = true
    setDeleting(true)
    setError(null)
    let result: CampaignCleanupResult
    try {
      result = await window.electronAPI.deleteCampaign(workspace.id, preview.previewToken)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setPreview(null)
      submitting.current = false
      setDeleting(false)
      return
    }
    onDeleted(result)
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !submitting.current) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" showCloseButton={!deleting}
        onEscapeKeyDown={event => { if (deleting) event.preventDefault() }}
        onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Delete “{workspace.name}”?</DialogTitle>
          <DialogDescription>Clear this campaign from your workspace while keeping its useful files.</DialogDescription>
        </DialogHeader>
        {loading ? <p role="status" className="flex items-center gap-2 text-sm text-foreground/60"><Loader2 className="h-4 w-4 animate-spin" />Checking what to keep…</p> : null}
        {preview ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium">Keep in Vault → Past Releases → {workspace.name}</p>
              <p className="mt-1 text-foreground/60">{preview.retainedFileCount} files ({formatBytes(preview.retainedBytes)}), plus a release record. Saved memories stay in Memory.</p>
              <details className="mt-2 text-xs text-foreground/60">
                <summary className="cursor-pointer py-1">Review files being kept</summary>
                <ul className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-lg bg-foreground/[0.03] p-3">
                  {preview.retainedFiles.map(file => <li key={file.relativePath} className="break-all" title={file.reason}>{file.relativePath}</li>)}
                  {!preview.retainedFiles.length ? <li>No campaign files to move.</li> : null}
                </ul>
              </details>
            </div>
            <div>
              <p className="font-medium">Permanently delete</p>
              <p className="mt-1 text-foreground/60">Campaign chats, planning pages, temporary drafts, tasks, local schedules, and personal skill instructions saved only in this workspace. Shared personal instructions stay available. This cannot be undone.</p>
            </div>
            <p className="text-xs text-foreground/60">Before deleting, copy any useful workspace-only skill instructions into All workspaces from the skill’s personal instructions editor.</p>
            {preview.warnings.length ? <ul className="space-y-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={onClose}>Cancel</Button>
          {error && !preview ? <Button variant="outline" onClick={() => setRevision(value => value + 1)}>Check again</Button> : null}
          <Button variant="destructive" disabled={!preview || loading || deleting} onClick={() => void confirm()}>
            {deleting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving files and deleting…</> : 'Keep files & delete campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function ImportPersonalInstructions({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [scope, setScope] = useState<'shared' | 'workspace'>('shared')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (busy) return
    setError(null)
    try {
      const input = JSON.parse(text)
      if (typeof input.parentManagedId !== 'string' || typeof input.text !== 'string') throw new Error('Paste an exported personal-instructions record.')
      setBusy(true)
      const saved = await window.electronAPI.importSkillPersonalInstructions(workspaceId, { parentManagedId: input.parentManagedId, text: input.text }, scope)
      if (!saved) throw new Error('The imported instructions are empty.')
      toast.success(saved.enabled ? 'Personal instructions imported' : 'Instructions kept disabled until their built-in is available')
      setOpen(false); setText('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <>
    <button type="button" onClick={() => { setError(null); setOpen(true) }} className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground">Import preferences</button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader><DialogTitle>Import personal instructions</DialogTitle><DialogDescription>Paste an export below. This replaces personal instructions for that skill in the selected scope. If its built-in is unavailable, the text is kept disabled.</DialogDescription></DialogHeader>
        <label className="text-sm">Scope <select disabled={busy} value={scope} onChange={event => setScope(event.target.value as 'shared' | 'workspace')} className="ml-2 rounded-md border bg-background px-2 py-1"><option value="shared">All workspaces</option><option value="workspace">This workspace</option></select></label>
        <textarea disabled={busy} aria-label="Exported personal instructions" value={text} onChange={event => setText(event.target.value)} rows={7} className="w-full rounded-lg border bg-background p-3 text-sm" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? 'Importing…' : 'Import'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

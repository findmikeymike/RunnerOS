import { navigate, routes } from '@/lib/navigate'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { PersonalInstruction } from '../../../shared/types'

type Scope = 'shared' | 'workspace'

/** User text only. The managed recipe never enters this component. */
export function SkillPersonalInstructions({ workspaceId, skillSlug, available = true }: { workspaceId: string; skillSlug: string; available?: boolean }) {
  const [scope, setScope] = useState<Scope>('shared')
  const [records, setRecords] = useState<PersonalInstruction[]>([])
  const [text, setText] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setRecords([])
    window.electronAPI.getSkillPersonalInstructions(workspaceId, skillSlug).then(value => {
      if (!cancelled) setRecords(value)
    }).catch(err => { if (!cancelled) setError(String(err)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, skillSlug, retry])

  useEffect(() => {
    const record = records.find(item => item.scope === scope)
    setText(record?.text ?? '')
    setEnabled(record?.enabled ?? true)
  }, [records, scope])

  const save = async (remove = false) => {
    if (!remove && !available) return
    setBusy(true)
    try {
      if (remove) await window.electronAPI.deleteSkillPersonalInstructions(workspaceId, skillSlug, scope)
      else await window.electronAPI.saveSkillPersonalInstructions(workspaceId, skillSlug, { scope, text, enabled })
      const updated = await window.electronAPI.getSkillPersonalInstructions(workspaceId, skillSlug)
      setRecords(updated)
      if (remove && !available && updated.length === 0) navigate(routes.view.skills())
      toast.success(remove ? 'Personal instructions deleted' : 'Personal instructions saved')
    } catch (err) {
      toast.error('Could not save personal instructions', { description: err instanceof Error ? err.message : String(err) })
    } finally { setBusy(false) }
  }
  if (loading) return <p className="px-4 py-3 text-sm text-muted-foreground">Loading personal instructions…</p>
  if (error) return <div className="px-4 py-3 text-sm"><p>Could not load personal instructions.</p><button className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
  return <div className="space-y-3 px-4 pb-4">
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm" htmlFor="skill-personal-scope">Personal instructions</label>
      <select aria-label="Personal instruction scope" id="skill-personal-scope" value={scope} disabled={busy} onChange={event => {
        const current = records.find(item => item.scope === scope)
        const dirty = text !== (current?.text ?? '') || enabled !== (current?.enabled ?? true)
        if (!dirty || window.confirm('Discard unsaved personal instructions and switch scope?')) setScope(event.target.value as Scope)
      }} className="rounded-md border border-white/10 bg-background px-2 py-1 text-xs">
        <option value="shared">All workspaces</option>
        <option value="workspace">This workspace</option>
      </select>
    </div>
    {!available && <p className="text-sm text-muted-foreground">This built-in is no longer available. Your personal instructions are kept below for export or deletion.</p>}
    <textarea readOnly={!available} aria-label="Personal instructions" value={text} disabled={busy} onChange={event => setText(event.target.value)} rows={5} placeholder="Add your preferences for this skill…" className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <button disabled={busy || !text.trim()} className="disabled:opacity-40" onClick={() => {
        navigator.clipboard.writeText(JSON.stringify({ parentManagedId: `artist-os:skill:${skillSlug}`, text }, null, 2)).then(() => toast.success('Personal instructions copied for export')).catch(() => toast.error('Could not copy personal instructions'))
      }}>Copy for export</button>
      <button disabled={busy || !available} onClick={() => setImporting(value => !value)}>Import personal instructions</button>
      <span className="ml-auto">16 KB maximum</span>
    </div>
    {importing && <div className="space-y-2">
      <textarea disabled={busy} aria-label="Import personal instructions" value={importText} onChange={event => setImportText(event.target.value)} rows={3} placeholder="Paste exported personal instructions…" className="w-full rounded-md border border-white/10 bg-white/[0.03] p-2 text-xs" />
      <button disabled={busy} className="text-xs underline disabled:opacity-40" onClick={() => {
        if (busy) return
        try {
          const imported = JSON.parse(importText)
          if (imported.parentManagedId !== `artist-os:skill:${skillSlug}` || typeof imported.text !== 'string') throw new Error('This export belongs to a different skill or has an invalid format.')
          if (new TextEncoder().encode(imported.text).length > 16 * 1024) throw new Error('Personal instructions must be 16 KB or less.')
          if (text && !window.confirm('Replace the current draft with these imported personal instructions?')) return
          setText(imported.text); setImporting(false); setImportText('')
          toast.success('Imported into your draft. Save to apply.')
        } catch (err) { toast.error('Could not import', { description: err instanceof Error ? err.message : String(err) }) }
      }}>Use imported text</button>
    </div>}
    <div className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} disabled={busy || !available} onChange={event => setEnabled(event.target.checked)} />Enabled</label>
      <button disabled={busy || !available || (!text.trim() && !records.some(item => item.scope === scope))} onClick={() => void save()} className="ml-auto rounded-md bg-foreground/10 px-3 py-1.5 disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
      {records.some(item => item.scope === scope) && <button disabled={busy} onClick={() => { if (window.confirm('Delete these personal instructions? The built-in skill stays available.')) void save(true) }} className="text-destructive disabled:opacity-40">Delete</button>}
    </div>
  </div>
}

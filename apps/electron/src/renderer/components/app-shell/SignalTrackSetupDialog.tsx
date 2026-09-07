import * as React from 'react'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { normalizeSignalVideoLinks, validateSignalTrackConfig, type SignalChannel, type SignalTrackConfig } from '@craft-agent/shared/shared-intel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { signalTrackName } from '@/lib/signal-tracks'

const field = 'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white'
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-white/10 px-3 text-sm text-white disabled:opacity-40'

export interface SignalTrackSetupDialogProps {
  open: boolean; config: SignalTrackConfig; adoption?: boolean; weeklyEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  resolveChannel: (url: string) => Promise<SignalChannel>;
  onSave: (config: SignalTrackConfig) => Promise<void>;
}
export function SignalTrackSetupDialog({ open, config, adoption, weeklyEnabled, onOpenChange, resolveChannel, onSave }: SignalTrackSetupDialogProps) {
  const [draft, setDraft] = React.useState(config)
  const [url, setUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const epoch = React.useRef(0)
  React.useEffect(() => {
    epoch.current++
    if (open) { setDraft({ ...config, enabled: weeklyEnabled, cadence: weeklyEnabled ? 'weekly' : config.cadence }); setUrl(''); setError(null); setBusy(false) }
    return () => { epoch.current++ }
    // Opening takes a snapshot. Background refresh must not erase unsaved edits.
  }, [open])
  const update = (channelId: string, patch: Partial<SignalChannel>) => setDraft(value => ({ ...value, sources: value.sources.map(source => source.channelId === channelId ? { ...source, ...patch } : source) }))
  const add = async () => {
    const token = epoch.current; setBusy(true); setError(null)
    try {
      const input = url.trim()
      const source = await resolveChannel(input.startsWith('@') ? `https://www.youtube.com/${input}` : input)
      if (token !== epoch.current) return
      if (draft.sources.some(item => item.channelId === source.channelId)) throw new Error('This channel is already saved in this track.')
      setDraft(value => ({ ...value, sources: [...value.sources, source] })); setUrl('')
    } catch (cause) { if (token === epoch.current) setError(String(cause instanceof Error ? cause.message : cause)) }
    finally { if (token === epoch.current) setBusy(false) }
  }
  const save = async () => {
    if (url.trim()) { setError('Add or clear the pending channel before saving.'); return }
    const token = epoch.current; setBusy(true); setSaving(true); setError(null)
    try {
      const next = validateSignalTrackConfig({ ...draft, enabled: draft.track === 'your-world' && !draft.sources.length ? false : draft.enabled })
      await onSave(next)
      if (token === epoch.current) onOpenChange(false)
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (token === epoch.current) { setBusy(false); setSaving(false) } }
  }
  return <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value) }}>
    <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl flex-col overflow-hidden bg-[#151719] p-5 text-white">
      <DialogHeader><DialogTitle>{adoption ? 'Review Industry update' : `${signalTrackName(config.track)} channels`}</DialogTitle>
        <DialogDescription>{adoption ? 'Your channels and existing schedule timing are preserved. Saving adopts the updated scan workflow.' : 'Connect YouTube or Monid for channel metadata.'}</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto">
        {draft.sources.map(source => <div key={source.channelId} className="space-y-2 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2"><input aria-label="Channel name" className={field} value={source.name} onChange={event => update(source.channelId, { name: event.target.value })} disabled={busy} />
            <button className={button} title={`Remove ${source.name}`} aria-label={`Remove ${source.name}`} disabled={busy} onClick={() => setDraft(value => ({ ...value, sources: value.sources.filter(item => item.channelId !== source.channelId) }))}><Trash2 size={16} /></button></div>
          <a className="block truncate text-xs text-white/50" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
          <label className="flex items-center gap-3 text-xs">Priority<select aria-label={`Priority for ${source.name}`} className={field} value={source.priority} disabled={busy} onChange={event => update(source.channelId, { priority: event.target.value as SignalChannel['priority'] })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
          <textarea aria-label={`Notes for ${source.name}`} placeholder="Optional channel notes" className={field} maxLength={2000} value={source.notes ?? ''} disabled={busy} onChange={event => update(source.channelId, { notes: event.target.value })} />
        </div>)}
        <div className="flex gap-2"><input aria-label="YouTube channel URL or handle" placeholder="YouTube channel URL or @handle" className={field} value={url} onChange={event => setUrl(event.target.value)} disabled={busy || draft.sources.length >= 20} />
          <button className={button} aria-label="Add channel" title="Add channel" disabled={busy || !url.trim() || draft.sources.length >= 20} onClick={() => { void add() }}>{busy ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}</button></div>
        <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs">Lookback days<input className={field} type="number" min={1} max={14} value={draft.sinceDays} disabled={busy} onChange={event => setDraft(value => ({ ...value, sinceDays: Number(event.target.value) }))} /></label>
          <label className="space-y-1 text-xs">New videos per channel<input className={field} type="number" min={1} max={3} value={draft.maxPerChannel} disabled={busy} onChange={event => setDraft(value => ({ ...value, maxPerChannel: Number(event.target.value) }))} /></label></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled && draft.cadence === 'weekly'} disabled={busy || (draft.track === 'your-world' && !draft.sources.length)} onChange={event => setDraft(value => ({ ...value, enabled: event.target.checked, cadence: event.target.checked ? 'weekly' : 'manual' }))} />Weekly scan</label>
        {draft.track === 'your-world' && !draft.sources.length && weeklyEnabled ? <p className="text-xs text-amber-200">Removing the last channel pauses future scans.</p> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t border-white/10 pt-3"><button className={button} disabled={saving} onClick={() => onOpenChange(false)}>Cancel</button><button className={`${button} bg-white/90 !text-black`} disabled={busy} onClick={() => { void save() }}>{saving ? 'Saving...' : adoption ? 'Adopt update' : 'Save'}</button></div>
    </DialogContent>
  </Dialog>
}

export function SignalLinksDialog({ open, trackName, onOpenChange, onAnalyze }: {
  open: boolean; trackName: string; onOpenChange: (open: boolean) => void;
  onAnalyze: (links: string[], idempotencyKey: string) => Promise<void>;
}) {
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const request = React.useRef({ fingerprint: '', key: '' })
  React.useEffect(() => { if (open) { setText(''); setError(null); request.current = { fingerprint: '', key: crypto.randomUUID() } } }, [open])
  const inputs = text.split(/\s+/).filter(Boolean)
  const parsed = normalizeSignalVideoLinks(inputs)
  const analyze = async () => {
    if (!parsed.ok || busy) return
    const fingerprint = JSON.stringify(parsed.videos)
    if (request.current.fingerprint && request.current.fingerprint !== fingerprint) request.current.key = crypto.randomUUID()
    request.current.fingerprint = fingerprint
    setBusy(true); setError(null)
    try { await onAnalyze(inputs, request.current.key); onOpenChange(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}><DialogContent className="w-[calc(100vw-2rem)] max-w-lg bg-[#151719] text-white">
    <DialogHeader><DialogTitle>{trackName}: Analyze links</DialogTitle><DialogDescription>1-10 specific YouTube videos. Subscriptions and weekly coverage stay unchanged.</DialogDescription></DialogHeader>
    <textarea aria-label="YouTube video links" className={`${field} min-h-40`} value={text} disabled={busy} onChange={event => setText(event.target.value)} />
    {text.trim() && !parsed.ok ? <div role="alert" className="text-sm text-red-300">{parsed.errors.map((issue, index) => <p key={index}>{issue.index >= 0 ? `Link ${issue.index + 1}: ` : ''}{issue.message}</p>)}</div> : null}
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    <p className="text-xs text-white/50">Connect YouTube or Monid for video metadata.</p>
    <div className="flex justify-end gap-2"><button className={button} disabled={busy} onClick={() => onOpenChange(false)}>Cancel</button><button className={button} disabled={busy || !parsed.ok} onClick={() => { void analyze() }}>{busy ? 'Queueing...' : 'Analyze'}</button></div>
  </DialogContent></Dialog>
}

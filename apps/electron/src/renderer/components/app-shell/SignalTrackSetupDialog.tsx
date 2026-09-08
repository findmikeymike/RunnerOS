import * as React from 'react'
import { Check, ChevronDown, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { SIGNAL_CHANNEL_ID, normalizeSignalVideoLinks, validateSignalTrackConfig, type SignalChannel, type SignalTrack, type SignalTrackConfig } from '@craft-agent/shared/shared-intel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { signalTrackName } from '@/lib/signal-tracks'

const field = 'w-full min-w-0 rounded-md border border-white/10 bg-[#202023] px-3 py-2 text-sm text-white placeholder:text-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ff5a36] disabled:opacity-50'
const button = 'inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40'
const primary = button + ' !border-transparent !bg-[#ff5a36] !text-white hover:!bg-[#ff704f]'
const trackKinds = ['industry', 'your-world'] as const
type TrackConfigs = Record<SignalTrack, SignalTrackConfig>

export interface SignalTrackSetupDialogProps {
  open: boolean; configs: TrackConfigs; initialTrack: SignalTrack; adoptIndustry: boolean;
  nextRuns?: Partial<Record<SignalTrack, string>>;
  industryError?: string;
  onPauseLegacy?: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  resolveChannel: (url: string) => Promise<SignalChannel>;
  onSave: (config: SignalTrackConfig, adoption: boolean) => Promise<SignalTrackConfig>;
}

export function SignalTrackSetupDialog({ open, configs, initialTrack, adoptIndustry, nextRuns, industryError, onPauseLegacy, onOpenChange, resolveChannel, onSave }: SignalTrackSetupDialogProps) {
  const [drafts, setDrafts] = React.useState(configs)
  const baseline = React.useRef(configs)
  const [track, setTrack] = React.useState(initialTrack)
  const [urls, setUrls] = React.useState<Record<SignalTrack, string>>({ industry: '', 'your-world': '' })
  const [adoption, setAdoption] = React.useState(adoptIndustry)
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'add' | 'save' | 'pause' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<SignalTrack | null>(null)
  const [confirmClose, setConfirmClose] = React.useState(false)
  const epoch = React.useRef(0)
  React.useEffect(() => {
    epoch.current++
    if (open) {
      baseline.current = configs; setDrafts(configs); setTrack(initialTrack); setAdoption(adoptIndustry)
      setUrls({ industry: '', 'your-world': '' }); setError(null); setBusy(null); setSaved(null); setConfirmClose(false); setExpanded(null); setLegacyPaused(false)
    }
    return () => { epoch.current++ }
    // Snapshot on open: polling must not overwrite either track's edits.
  }, [open])
  const draft = drafts[track]
  const blocked = track === 'industry' && !!industryError
  const [legacyPaused, setLegacyPaused] = React.useState(false)
  const dirty = (kind: SignalTrack) => JSON.stringify(drafts[kind]) !== JSON.stringify(baseline.current[kind]) || !!urls[kind].trim()
  const close = () => {
    if (busy) return
    if (trackKinds.some(dirty)) setConfirmClose(true)
    else onOpenChange(false)
  }
  const edit = (update: (value: SignalTrackConfig) => SignalTrackConfig) => {
    setDrafts(value => ({ ...value, [track]: update(value[track]) })); setSaved(null); setError(null); setConfirmClose(false)
  }
  const update = (channelId: string, patch: Partial<SignalChannel>) => edit(value => ({ ...value, sources: value.sources.map(source => source.channelId === channelId ? { ...source, ...patch } : source) }))
  const add = async () => {
    if (busy) return
    const token = epoch.current; const target = track; setBusy('add'); setError(null); setSaved(null)
    try {
      const input = urls[target].trim()
      const source = await resolveChannel(input.startsWith('@') ? 'https://www.youtube.com/' + input : input)
      if (token !== epoch.current) return
      if (drafts[target].sources.some(item => item.channelId === source.channelId)) throw new Error('This channel is already saved in this track.')
      setDrafts(value => ({ ...value, [target]: { ...value[target], sources: [...value[target].sources, source] } }))
      setUrls(value => ({ ...value, [target]: '' })); setExpanded(source.channelId)
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (token === epoch.current) setBusy(null) }
  }
  const save = async () => {
    if (busy || blocked) return
    if (urls[track].trim()) { setError('Add or clear the pending channel before saving.'); return }
    const token = epoch.current; const target = track; setBusy('save'); setError(null); setSaved(null)
    try {
      // Verify changed URLs and imported legacy rows before persisting canonical channel IDs.
      const sources: SignalChannel[] = []
      for (const source of draft.sources) {
        const old = baseline.current[target].sources.find(item => item.channelId === source.channelId)
        const needsLookup = !SIGNAL_CHANNEL_ID.test(source.channelId) || source.url !== old?.url
        const resolved = needsLookup ? await resolveChannel(source.url.trim()) : source
        if (token !== epoch.current) return
        if (sources.some(item => item.channelId === resolved.channelId)) throw new Error('Two entries point to the same YouTube channel. Remove the duplicate before saving.')
        sources.push({ ...resolved, name: source.name.trim(), priority: source.priority, notes: source.notes })
      }
      const enabled = (draft.track === 'industry' || draft.sources.length > 0) && draft.enabled
      const next = validateSignalTrackConfig({ ...draft, sources, enabled, cadence: enabled ? 'weekly' : 'manual' })
      const result = await onSave(next, target === 'industry' && adoption)
      if (token !== epoch.current) return
      baseline.current = { ...baseline.current, [target]: result }
      setDrafts(value => ({ ...value, [target]: result })); setSaved(target); setExpanded(null)
      if (target === 'industry') { setAdoption(false); setLegacyPaused(false) }
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (token === epoch.current) setBusy(null) }
  }
  const pauseExisting = async () => {
    if (busy || !onPauseLegacy) return
    const token = epoch.current; setBusy('pause')
    try {
      await onPauseLegacy()
      if (token !== epoch.current) return
      const paused = { enabled: false, cadence: 'manual' as const }
      baseline.current = { ...baseline.current, industry: { ...baseline.current.industry, ...paused } }
      setDrafts(value => ({ ...value, industry: { ...value.industry, ...paused } })); setLegacyPaused(true)
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (token === epoch.current) setBusy(null) }
  }
  const switchTrack = (kind: SignalTrack) => { setTrack(kind); setExpanded(null); setError(null); setConfirmClose(false) }
  return <Dialog open={open} onOpenChange={value => { if (!value) close() }}>
    <DialogContent className="flex max-h-[min(820px,90dvh)] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-lg border-white/10 bg-[#141416] p-0 text-white shadow-xl sm:max-w-2xl">
      <DialogHeader className="px-6 pb-5 pt-6 text-left">
        <DialogTitle className="text-lg font-semibold text-white">Channels & schedule</DialogTitle>
        <DialogDescription className="sr-only">Manage research channels and weekly scans for Industry and Your World.</DialogDescription>
      </DialogHeader>
      <div role="tablist" aria-label="Channel settings track" className="mx-6 mb-5 flex w-fit max-w-[calc(100%-3rem)] gap-1 rounded-lg bg-white/5 p-1">
        {trackKinds.map((kind, index) => <button key={kind} role="tab" aria-selected={track === kind} tabIndex={track === kind ? 0 : -1} disabled={!!busy}
          className={'min-h-9 rounded-md px-4 text-sm ' + (track === kind ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white')}
          onClick={() => switchTrack(kind)}
          onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; switchTrack(trackKinds[next]!); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus() } }}>
          {signalTrackName(kind)}{dirty(kind) ? <span className="ml-2 text-[#ff7959]" aria-label="Unsaved changes">*</span> : null}
        </button>)}
      </div>
      <div className="min-h-0 overflow-y-auto px-6 pb-5">
        {blocked ? <p role="alert" className="mb-3 text-sm text-red-300">{industryError} Your World settings are still available.</p> : null}
        <div className="flex items-center justify-between gap-4 border-y border-white/10 py-4">
          <div><label htmlFor="signals-weekly" className="text-sm font-medium">Weekly scan</label>
            <p className="mt-1 text-xs text-white/45">{draft.enabled && draft.cadence === 'weekly' ? nextRuns?.[track] || 'A weekly time is assigned when you save.' : 'Off. You can still scan anytime.'}</p></div>
          <Switch id="signals-weekly" aria-label={signalTrackName(track) + ' weekly scan'} checked={draft.enabled && draft.cadence === 'weekly'} disabled={!!busy || blocked || (track === 'your-world' && !draft.sources.length)}
            className="data-[state=checked]:bg-[#ff5a36] data-[state=unchecked]:bg-white/15 [&_[data-slot=switch-thumb]]:bg-white"
            onCheckedChange={checked => edit(value => ({ ...value, enabled: checked, cadence: checked ? 'weekly' : 'manual' }))} />
        </div>
        {track === 'industry' && adoption ? <p className="pt-3 text-xs leading-5 text-white/50">Save to update your existing scan. Its scheduled time stays the same.</p> : null}
        <div className="flex items-center justify-between pb-2 pt-5 text-xs text-white/45"><span>YouTube channels</span><span>{draft.sources.length}/20</span></div>
        <div className="divide-y divide-white/10">
          {draft.sources.map(source => <div key={source.channelId} className="py-3">
            <button className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={expanded === source.channelId} disabled={!!busy} onClick={() => setExpanded(value => value === source.channelId ? null : source.channelId)}>
              <span className="min-w-0 break-words text-sm font-medium text-white/90">{source.name}</span><ChevronDown size={16} className={'mt-0.5 shrink-0 text-white/40 transition-transform ' + (expanded === source.channelId ? 'rotate-180' : '')} />
            </button>
            {expanded === source.channelId ? <div className="space-y-3 pt-3">
              <label className="block space-y-1.5 text-xs text-white/50">Channel name<input aria-label="Channel name" className={field} maxLength={200} value={source.name} onChange={event => update(source.channelId, { name: event.target.value })} disabled={!!busy} /></label>
              <label className="block space-y-1.5 text-xs text-white/50">YouTube URL<input aria-label={'YouTube URL for ' + source.name} className={field} value={source.url} onChange={event => update(source.channelId, { url: event.target.value })} disabled={!!busy} /></label>
              <div className="flex items-center justify-between gap-3"><label className="flex items-center gap-3 text-xs text-white/50">Priority<select aria-label={'Priority for ' + source.name} className={field} value={source.priority} disabled={!!busy} onChange={event => update(source.channelId, { priority: event.target.value as SignalChannel['priority'] })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
                <button className={button + ' !px-2 text-red-300'} title={'Remove ' + source.name} aria-label={'Remove ' + source.name} disabled={!!busy} onClick={() => edit(value => ({ ...value, sources: value.sources.filter(item => item.channelId !== source.channelId) }))}><Trash2 size={15} /></button></div>
              <textarea aria-label={'Notes for ' + source.name} placeholder="What matters about this channel? (optional)" className={field + ' min-h-20 resize-y'} maxLength={2000} value={source.notes ?? ''} disabled={!!busy} onChange={event => update(source.channelId, { notes: event.target.value })} />
            </div> : <p className="mt-1.5 break-all text-xs leading-5 text-white/40">{source.url}</p>}
          </div>)}
        </div>
        <div className="mt-3 flex gap-2"><input aria-label="YouTube channel URL or handle" placeholder="YouTube channel URL or @handle" className={field} value={urls[track]} onChange={event => { setUrls(value => ({ ...value, [track]: event.target.value })); setSaved(null) }} disabled={!!busy || draft.sources.length >= 20} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (urls[track].trim()) void add() } }} />
          <button className={button + ' !px-2.5'} aria-label="Add channel" title="Add channel" disabled={!!busy || !urls[track].trim() || draft.sources.length >= 20} onClick={() => { void add() }}>{busy === 'add' ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}</button></div>
        <details className="mt-5 border-t border-white/10 pt-3"><summary className="cursor-pointer text-xs text-white/50">Scan limits</summary>
          <div className="mt-3 grid grid-cols-2 gap-3"><label className="space-y-1.5 text-xs text-white/50">Look back (days)<input className={field} type="number" min={1} max={14} value={draft.sinceDays} disabled={!!busy} onChange={event => edit(value => ({ ...value, sinceDays: Number(event.target.value) }))} /></label>
            <label className="space-y-1.5 text-xs text-white/50">Videos per channel<input className={field} type="number" min={1} max={3} value={draft.maxPerChannel} disabled={!!busy} onChange={event => edit(value => ({ ...value, maxPerChannel: Number(event.target.value) }))} /></label></div>
        </details>
      </div>
      <div className="space-y-3 border-t border-white/10 px-6 py-4">
        {error ? <p role="alert" className="break-words text-sm text-red-300">{error}</p> : null}
        {track === 'industry' && adoption && (error || blocked) && onPauseLegacy && configs.industry.enabled && !legacyPaused ? <button className={button} disabled={!!busy} onClick={() => { void pauseExisting() }}>{busy === 'pause' ? 'Pausing...' : 'Pause existing weekly scan'}</button> : null}
        {track === 'industry' && legacyPaused ? <p role="status" className="text-xs text-white/60">Existing weekly scan paused. Channel edits are not saved yet.</p> : null}
        {confirmClose ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-white/65">Discard unsaved changes?</span><div className="flex gap-2"><button className={button} onClick={() => setConfirmClose(false)}>Keep editing</button><button className={button} onClick={() => onOpenChange(false)}>Discard</button></div></div> : <div className="flex flex-wrap items-center justify-between gap-3">
          <span role="status" className="flex items-center gap-1.5 text-xs text-white/50">{saved ? <><Check size={14} className="text-emerald-400" />{signalTrackName(saved)} saved</> : null}</span>
          <div className="flex gap-2"><button className={button} disabled={!!busy} onClick={close}>Done</button><button className={primary} disabled={!!busy || blocked} onClick={() => { void save() }}>{busy === 'save' ? 'Saving...' : 'Save ' + signalTrackName(track)}</button></div>
        </div>}
      </div>
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
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}><DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-xl gap-5 overflow-y-auto rounded-lg border-white/10 bg-[#141416] p-6 text-white sm:max-w-xl">
    <DialogHeader className="text-left"><DialogTitle className="text-lg font-semibold text-white">Review videos</DialogTitle><DialogDescription className="text-sm text-white/50">A one-off {trackName} report. Your channels and schedule stay unchanged.</DialogDescription></DialogHeader>
    <label className="space-y-2 text-xs text-white/50">YouTube video links<textarea aria-label="YouTube video links" placeholder="Paste up to 10 video links, one per line" className={field + ' mt-2 min-h-40 resize-y'} value={text} disabled={busy} onChange={event => setText(event.target.value)} /></label>
    {text.trim() && !parsed.ok ? <div role="alert" className="text-sm text-red-300">{parsed.errors.map((issue, index) => <p key={index}>{issue.index >= 0 ? 'Link ' + (issue.index + 1) + ': ' : ''}{issue.message}</p>)}</div> : null}
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4"><span className="text-xs text-white/45">{parsed.ok ? parsed.videos.length + ' video' + (parsed.videos.length === 1 ? '' : 's') : ''}</span><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => onOpenChange(false)}>Cancel</button><button className={primary} disabled={busy || !parsed.ok} onClick={() => { void analyze() }}>{busy ? 'Queueing...' : 'Create report'}</button></div></div>
  </DialogContent></Dialog>
}

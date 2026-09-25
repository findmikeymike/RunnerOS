import * as React from 'react'
import { ArrowRight, ArrowUpRight, Loader2, Search, Square, Volume2, X } from 'lucide-react'
import type { LabInspirationEdition, LabSong } from '@craft-agent/shared/lab'
import { navigate, routes } from '@/lib/navigate'
import { flushLabState, reloadLabState } from '@/lib/lab-song-state'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useDiscoverySpeech } from '@/hooks/useDiscoverySpeech'
import { CompactPageHeader } from './CompactPageHeader'

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]'
const field = `w-full rounded-lg border border-white/[0.08] bg-[#111111] px-3 py-2.5 text-sm text-white/90 ${focus}`
const action = `inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${focus}`

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function sourceUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null
  } catch { return null }
}

/** A key makes every async operation belong to exactly one workspace lifetime. */
export function LabInspirationHome({ workspaceId }: { workspaceId?: string }) {
  if (!workspaceId) return <div className="p-8 text-sm text-muted-foreground">Select a workspace to explore the Lab.</div>
  return <InspirationJournal key={workspaceId} workspaceId={workspaceId} />
}

function InspirationJournal({ workspaceId }: { workspaceId: string }) {
  const [topic, setTopic] = React.useState('')
  const [editions, setEditions] = React.useState<LabInspirationEdition[]>([])
  const [songs, setSongs] = React.useState<LabSong[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [discoveryId, setDiscoveryId] = React.useState<string | null>(null)
  const [angleIndex, setAngleIndex] = React.useState(0)
  const [destination, setDestination] = React.useState('')
  const [newSongTitle, setNewSongTitle] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const alive = React.useRef(true)
  const lock = React.useRef(false)
  const revision = React.useRef(0)
  const openerRef = React.useRef<HTMLButtonElement | null>(null)
  const headingId = React.useId()

  const refresh = React.useCallback(async () => {
    const request = ++revision.current
    try {
      const result = await window.electronAPI.listLabInspiration(workspaceId)
      if (!alive.current || request !== revision.current) return
      setEditions([...result].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      setLoadError(null)
    } catch (err) {
      if (alive.current && request === revision.current) setLoadError(message(err))
    } finally {
      if (alive.current && request === revision.current) setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    alive.current = true
    void refresh()
    void window.electronAPI.getLabState(workspaceId).then(state => {
      if (alive.current) setSongs(state.songs)
    }).catch(err => { if (alive.current) setError(`Could not load song destinations: ${message(err)}`) })
    return () => { alive.current = false }
  }, [refresh, workspaceId])

  const running = editions.find(edition => edition.state === 'running')
  React.useEffect(() => {
    if (!running || loadError) return
    const timer = window.setTimeout(() => { void refresh() }, 2500)
    return () => window.clearTimeout(timer)
  }, [running, editions, loadError, refresh])

  const edition = editions.find(item => item.id === selectedId) ?? editions[0]
  const discovery = edition?.discoveries.find(item => item.id === discoveryId)
  const narration = discovery ? [discovery.title, 'Source-based summary.', discovery.summary,
    'The human tension. An interpretation.', discovery.tension, 'Sit with this.', discovery.question,
    'Ways into the song.', ...discovery.angles.map((angle, index) => `${index + 1}. ${angle}`)].join('\n\n') : ''
  const speech = useDiscoverySpeech(narration, !!discovery)
  function closeDiscovery() { speech.stop(); setDiscoveryId(null) }

  async function start(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current || running || !topic.trim()) return
    lock.current = true
    setBusy('start'); setError(null)
    try {
      const result = await window.electronAPI.startLabInspiration(workspaceId, { topic: topic.trim() })
      if (!alive.current) return
      ++revision.current
      setEditions(previous => [result, ...previous.filter(item => item.id !== result.id)])
      setSelectedId(result.id); setDiscoveryId(null)
    } catch (err) { if (alive.current) setError(message(err)) }
    finally { lock.current = false; if (alive.current) setBusy(null) }
  }

  async function cancel() {
    if (lock.current || !running) return
    lock.current = true; setBusy('cancel'); setError(null)
    try { await window.electronAPI.cancelLabInspiration(workspaceId, running.id); if (alive.current) await refresh() }
    catch (err) { if (alive.current) setError(message(err)) }
    finally { lock.current = false; if (alive.current) setBusy(null) }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current || !edition || !discovery || !destination) return
    if (destination === 'new' && !newSongTitle.trim()) return
    lock.current = true; setBusy('save'); setError(null)
    try {
      // Finish any local recovery write before appending a new canonical capture.
      await flushLabState(workspaceId)
      if (!alive.current) return
      const result = await window.electronAPI.saveLabInspiration(workspaceId, {
        editionId: edition.id, discoveryId: discovery.id, angleIndex,
        ...(destination === 'new' ? { newSongTitle: newSongTitle.trim() } : { songId: destination }),
      })
      if (!alive.current) return
      await reloadLabState(workspaceId)
      if (alive.current) navigate(routes.view.lab('pad', result.songId))
    } catch (err) { if (alive.current) setError(message(err)) }
    finally { lock.current = false; if (alive.current) setBusy(null) }
  }

  return <div className="h-full overflow-y-auto bg-[#050505] text-white/90">
    <div className="flex w-full flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
      <CompactPageHeader
        eyebrow="A songwriter’s journal"
        title="The Lab"
        tone="blue"
        className="border-sky-100/[0.12]"
        actions={<button type="button" className={cn('flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/10 px-3 py-2 text-xs font-medium text-white/85 transition-colors hover:bg-black/20', focus)} onClick={() => navigate(routes.view.lab('pad'))}>Open Pad <ArrowUpRight className="h-3.5 w-3.5" /></button>}
      />
      <div className="mx-auto w-full max-w-[1120px] pb-8">
      <section className="my-4 rounded-xl border border-white/[0.08] bg-gradient-to-br from-sky-200/[0.04] to-white/[0.02] p-5 sm:p-6" aria-labelledby={headingId}>
        <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-sky-200/70">Follow a curiosity</p>
        <h2 id={headingId} className="mt-1 text-xl font-medium tracking-tight text-white/90">There’s a song in the things that move you.</h2>
        <p className="mt-2 text-xs leading-5 text-white/55">A strange story, a memory, a feeling, or a question that won’t leave you alone.</p>
        <form onSubmit={start} className="mt-3">
          <label htmlFor="lab-inspiration-topic" className="sr-only">What’s pulling at you?</label>
          <div className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-[#111111] p-2 sm:flex-row sm:items-center">
            <input id="lab-inspiration-topic" value={topic} onChange={event => setTopic(event.target.value)} maxLength={500} placeholder="A subject, feeling, or question…" disabled={!!busy || !!running} className={cn('min-w-0 flex-1 rounded-lg bg-transparent px-3 py-3 text-sm placeholder:text-white/35 disabled:opacity-60', focus)} required />
            <button type="submit" disabled={loading || !!loadError || !!busy || !!running || !topic.trim()} className={cn(action, 'bg-sky-300 font-medium text-slate-950 hover:bg-sky-200')}>
              {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Explore
            </button>
          </div>
          {!editions.length && <div className="mt-3 flex flex-wrap gap-2" aria-label="Curiosity starting points">
            {['Objects we can’t throw away', 'Forgotten local rituals', 'Why we envy people we love'].map(suggestion => <button key={suggestion} type="button" disabled={!!busy || !!running} onClick={() => setTopic(suggestion)} className={cn('rounded-full border border-white/[0.06] px-3 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40', focus)}>{suggestion}</button>)}
          </div>}
        </form>
      </section>

      {error && !discovery && <div role="alert" className="mb-5 rounded-lg border border-red-300/20 bg-red-300/5 p-4 text-sm text-red-200">{error}</div>}
      {loadError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200/20 p-4 text-sm"><span>Could not refresh your journal. {loadError}</span><button type="button" className={cn(action, 'bg-white/10')} onClick={() => { void refresh() }}>Retry loading</button></div>}
      {running && <div role="status" className="mb-7 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sky-200/15 bg-sky-200/[0.04] p-5">
        <span className="flex items-center gap-3 text-sm"><Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-200" /><span>Following “{running.topic}”<span className="mt-1 block text-xs text-white/55">Looking for source material and useful writing angles.</span></span></span>
        <button type="button" disabled={!!busy} onClick={() => { void cancel() }} className={cn(action, 'text-white/65 hover:bg-white/5')}>Cancel</button>
      </div>}

      <section aria-label="Discoveries" className="pt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-white/60">{edition ? 'From your explorations' : 'Your next starting point'}</h2>
          {editions.length > 0 && <label className="flex max-w-full items-center gap-3 text-xs text-white/55">Edition<select aria-label="Choose exploration" value={edition?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setDiscoveryId(null) }} className={cn(field, 'max-w-[280px] py-2 text-xs')}>
            {editions.slice(0, 30).map(item => <option key={item.id} value={item.id}>{item.topic} · {new Date(item.createdAt).toLocaleDateString()} · {item.state}</option>)}
          </select></label>}
        </div>
        {loading ? <p role="status" className="py-10 text-sm text-white/55">Loading your journal…</p> : !edition ? <div className="max-w-lg pb-12"><h3 className="font-medium tracking-tight text-xl">Start with something you wonder about.</h3><p className="mt-3 text-sm leading-7 text-white/55">Your discoveries will live here: source material, human tensions, and possibilities to take into a song. Nothing has been researched yet.</p></div> : <>
          {edition.state === 'empty' && <p className="pb-8 text-sm leading-7 text-white/60">This exploration didn’t yield enough sourced material. Try a more specific question or a different subject. Your earlier editions are still here.</p>}
          {edition.state === 'failed' && <p role="alert" className="pb-8 text-sm leading-7 text-red-200/85">This exploration couldn’t finish. {edition.error} You can enter the topic again to start a new run.</p>}
          {edition.state === 'cancelled' && <p className="pb-8 text-sm text-white/60">This exploration was cancelled. Start another whenever you’re ready.</p>}
          <div className={cn("grid gap-4", edition.discoveries.length === 2 ? "md:grid-cols-2" : edition.discoveries.length >= 3 ? "md:grid-cols-3" : "")}>
            {edition.discoveries.map((item, index) => <button key={item.id} type="button" aria-haspopup="dialog" onClick={event => { openerRef.current = event.currentTarget; setDiscoveryId(item.id); setAngleIndex(0); setDestination(''); setNewSongTitle(''); setError(null) }} className={cn('group flex min-w-0 flex-col rounded-xl border p-6 text-left transition-colors', discoveryId === item.id ? 'border-sky-200/35 bg-sky-400/[0.07]' : 'border-white/[0.06] bg-[#111111] hover:border-white/25', focus)}>
              <span className="mb-6 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-sky-200/65"><span>Discovery 0{index + 1}</span><ArrowUpRight className="h-4 w-4" /></span>
              <h3 className="break-words font-medium tracking-tight text-xl leading-tight">{item.title}</h3>
              <p className="mt-4 line-clamp-4 text-sm leading-6 text-white/60">{item.summary}</p>
              <span className="mt-auto pt-7 text-xs text-white/45">{item.sources.length} {item.sources.length === 1 ? 'source' : 'sources'} · Explore the angles</span>
            </button>)}
          </div>
        </>}
      </section>

      <Dialog open={!!discovery && !!edition} onOpenChange={open => { if (!open) closeDiscovery() }}>
      {discovery && edition && <DialogContent showCloseButton={false} aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); openerRef.current?.focus() }} className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border border-white/[0.08] bg-[#111111] p-0 text-white/90 sm:max-w-[1000px]">
        <div className="shrink-0 border-b border-white/[0.08] px-6 py-5 sm:px-8">
        <div className="flex items-start justify-between gap-5"><div><p className="mb-3 text-[10px] uppercase tracking-[0.2em] text-sky-200/70">An open thread</p><DialogTitle className="pr-3 font-medium tracking-tight text-2xl leading-tight">{discovery.title}</DialogTitle></div><button type="button" aria-label="Close discovery" className={cn('rounded-lg p-2 text-white/50 hover:bg-white/10', focus)} onClick={closeDiscovery}><X className="h-4 w-4" /></button></div>
        <button type="button" onClick={() => { if (speech.status === 'idle') void speech.play(); else speech.stop() }} className={cn(action, 'mt-4 border border-sky-200/20 bg-sky-200/5 text-sky-100 hover:bg-sky-200/10')}>
          {speech.status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : speech.status === 'playing' ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          {speech.status === 'loading' ? 'Cancel audio' : speech.status === 'playing' ? 'Stop listening' : 'Listen to findings'}
        </button>
        {speech.error && <p role="alert" className="mt-3 text-sm text-red-200">{speech.error}</p>}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-6 sm:p-8">
        {error && <p role="alert" className="mb-5 text-sm text-red-200">{error}</p>}
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_0.8fr]">
          <div className="space-y-7">
            <div><h3 className="text-xs font-medium text-white/50">Source-based summary</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/80">{discovery.summary}</p></div>
            <div><h3 className="text-xs font-medium text-sky-200/75">The human tension · an interpretation</h3><p className="mt-3 text-base leading-7">{discovery.tension}</p></div>
            <div className="border-l-2 border-sky-200/30 pl-5"><h3 className="text-xs text-white/50">Sit with this</h3><p className="mt-2 text-sm leading-7 text-white/80">{discovery.question}</p></div>
            <div><h3 className="mb-3 text-xs text-white/50">Read the sources</h3><ul className="space-y-2">{discovery.sources.map((source, index) => { const url = sourceUrl(source.url); return <li key={`${source.receiptId}-${index}`}>{url ? <button type="button" title={url.href} onClick={() => { void window.electronAPI.openUrl(url.href).catch(err => { if (alive.current) setError(message(err)) }) }} className={cn('inline-flex max-w-full items-center gap-2 rounded text-left text-xs text-sky-200/80 hover:text-sky-100', focus)}><span className="truncate">{index + 1}. {url.hostname}{url.pathname === '/' ? '' : url.pathname}</span><ArrowUpRight className="h-3 w-3 shrink-0" /></button> : <span className="text-xs text-white/40">Source link unavailable</span>}<p className="mt-1 text-[10px] text-white/45">Read {new Date(source.observedAt).toLocaleDateString()}</p>{source.excerpt && <p className="mt-2 text-xs leading-6 text-white/55">{source.excerpt}</p>}</li> })}</ul><p className="mt-3 text-[11px] leading-5 text-white/40">AI-assisted research and interpretation. Read the original sources for context.</p></div>
          </div>
          <form onSubmit={save} className="space-y-5 rounded-xl border border-white/[0.06] bg-black/10 p-5">
            <fieldset disabled={busy === 'save'}><legend className="mb-4 text-sm font-medium">Choose a way into the song</legend><div className="space-y-3">{discovery.angles.map((angle, index) => <label key={index} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm leading-6', angleIndex === index ? 'border-sky-200/30 bg-sky-200/5' : 'border-white/[0.06]')}><input type="radio" name="inspiration-angle" checked={angleIndex === index} onChange={() => setAngleIndex(index)} className="mt-1.5 accent-sky-200" /><span className="whitespace-pre-wrap">{angle}</span></label>)}</div></fieldset>
            <label className="block text-xs text-white/60">Save to<select required value={destination} disabled={busy === 'save'} onChange={event => setDestination(event.target.value)} className={cn(field, 'mt-2')}><option value="">Choose a song…</option><option value="new">Create a new song</option>{songs.map(song => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label>
            {destination === 'new' && <label className="block text-xs text-white/60">New song title<input required maxLength={180} disabled={busy === 'save'} value={newSongTitle} onChange={event => setNewSongTitle(event.target.value)} className={cn(field, 'mt-2')} /></label>}
            <p className="text-[11px] leading-5 text-white/45">Keeps the selected angle and its sources in the song’s Remember area. Your lyrics stay as they are.</p>
            <button type="submit" disabled={!!busy || !discovery.angles.length || !destination || (destination === 'new' && !newSongTitle.trim())} className={cn(action, 'w-full bg-sky-300 font-medium text-slate-950 hover:bg-sky-200')}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Save & open Pad</button>
          </form>
        </div>
        </div>
      </DialogContent>}
      </Dialog>
      </div>
    </div>
  </div>
}

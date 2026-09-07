import * as React from 'react'
import { ExternalLink, Link2, Maximize2, Play, Plus, Radio, RefreshCw, SlidersHorizontal, Diamond } from 'lucide-react'
import { DocumentFormattedMarkdownOverlay } from '@craft-agent/ui'
import { isFinalSignalReport, signalWorkflowFor, type SignalMode, type SignalTrack, type SignalTrackConfig, type SignalEntryReference } from '@craft-agent/shared/shared-intel'
import type { ContextDocDTO } from '../../../shared/types'
import type { OutputManifestDTO, OutputSummaryDTO } from '@/hooks/useOutputs'
import type { ArtistIntelConfig } from '@/lib/artist-intel'
import { parseArtistIntelReportDocResult } from '@/lib/artist-intel'
import { useSignalTracks } from '@/hooks/useSignalTracks'
import { useSignalReportContent } from '@/hooks/useSignalReportContent'
import { formatSignalDate, readableSignalBody, signalDocumentDate } from '@/lib/artist-signals'
import { legacySignalSchedule, legacySignalSources, signalDefaultKey, signalOutputRun, signalScheduleMatches, signalTrackName, signalWeeklyReadiness } from '@/lib/signal-tracks'
import { Info_Markdown } from '@/components/info'
import { navigate, routes } from '@/lib/navigate'
import { computeNextRuns } from '@/components/automations/utils'
import { SignalBriefingPlayer } from './SignalBriefingPlayer'
import { SignalLinksDialog, SignalTrackSetupDialog } from './SignalTrackSetupDialog'
import { SignalIdeasActions } from './SignalIdeaHandoff'

export interface SignalNuggetInput { text: string; sourceTitle: string; sourceKey: string; track: SignalTrack; outputId?: string }
export interface SignalsTracksPanelProps {
  workspaceId: string; workspaceName: string; outputs: OutputSummaryDTO[]; documents: ContextDocDTO[];
  getOutput: (id: string) => Promise<OutputManifestDTO | null>;
  onSaveNugget: (input: SignalNuggetInput) => Promise<void>;
  ensureWorkflow: (track: SignalTrack, mode: SignalMode) => Promise<string>;
  onDevelopIdea?: (reference: SignalEntryReference) => void;
  legacy: {
    config: ArtistIntelConfig; busy: boolean; weeklyEnabled: boolean; runDisabledReason?: string | null;
    notice?: { tone: string; title: string; detail?: string } | null;
    onRun: () => Promise<void>; onToggleWeekly: () => Promise<void>; onConfigure: () => void;
  };
}
interface LibraryItem { key: string; kind: 'context' | 'output'; title: string; summary: string; date?: string; body?: string; output?: OutputSummaryDTO; mode?: SignalMode }
const control = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-xs text-white/75 hover:bg-white/10 disabled:opacity-40'

export function SignalsTracksPanel(props: SignalsTracksPanelProps) {
  const { workspaceId, documents, outputs, getOutput, legacy } = props
  const tracks = useSignalTracks(workspaceId, props.ensureWorkflow)
  const [track, setTrack] = React.useState<SignalTrack>('industry')
  const [selections, setSelections] = React.useState<Record<SignalTrack, string | null>>({ industry: null, 'your-world': null })
  const [pendingReviews, setPendingReviews] = React.useState<Partial<Record<SignalTrack, string>>>({})
  const [setup, setSetup] = React.useState<{ config: SignalTrackConfig; adoption: boolean } | null>(null)
  const [linksOpen, setLinksOpen] = React.useState(false)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [selection, setSelection] = React.useState('')
  const [nuggetBusy, setNuggetBusy] = React.useState(false)
  const [actionError, setActionError] = React.useState<{ track: SignalTrack; message: string } | null>(null)
  const [adopting, setAdopting] = React.useState(false)
  const adoptionEpoch = React.useRef(0)
  const requests = React.useRef<Partial<Record<SignalTrack, string>>>({})
  const reader = React.useRef<HTMLDivElement>(null)
  const scope = React.useRef(workspaceId); scope.current = workspaceId
  React.useEffect(() => { setSelections({ industry: null, 'your-world': null }); setPendingReviews({}); setTrack('industry'); setSetup(null); setLinksOpen(false); setActionError(null); requests.current = {}; return () => { adoptionEpoch.current++ } }, [workspaceId])
  const changeTrack = (next: SignalTrack) => { adoptionEpoch.current++; setAdopting(false); setSetup(null); setLinksOpen(false); setTrack(next) }
  const legacySchedules = tracks.automations.filter(legacySignalSchedule)
  const legacyMode = !tracks.state || tracks.state.tracks.industry.revision === 'initial' || legacySchedules.length > 0
  const currentLegacy = track === 'industry' && legacyMode
  const config = tracks.state?.tracks[track]
  const schedule = tracks.automations.find(item => tracks.state && signalScheduleMatches(item, tracks.state.hqWorkspaceId, track))
  const readiness = signalWeeklyReadiness(config, schedule)
  const weekly = currentLegacy ? legacy.weeklyEnabled : readiness.active
  const busy = tracks.busy || adopting || (currentLegacy && legacy.busy)
  const runs = tracks.state?.runs.filter(run => run.track === track) ?? []
  const latestRun = runs[0]
  const active = runs.some(run => run.mode === 'scan' && ['queued', 'running'].includes(run.status))
  const library = React.useMemo<LibraryItem[]>(() => {
    const items: LibraryItem[] = []
    for (const output of outputs) {
      const run = tracks.state ? signalOutputRun(output, tracks.state) : undefined
      const newWorkflow = ['signals-industry-scan', 'weekly-world-scan', 'signal-video-review'].includes(output.origin?.workflowSlug ?? '')
      if (run ? run.track !== track : track !== 'industry' || newWorkflow) continue
      const trustedLegacy = isFinalSignalReport(output) && output.origin?.workflowSlug === 'weekly-signal-scan'
      const savedResearch = !newWorkflow && output.origin?.source !== 'workflow' && !output.tags?.includes('signal-source-packet') && output.status === 'published'
        && (output.origin?.source === 'deep-research' || ['youtube-intelligence-agent', 'youtube-research-agent', 'signal-analyst-agent'].includes(output.origin?.agentSlug ?? '')
          || (output.origin?.source === 'manual' && output.tags?.some(tag => ['research', 'intel', 'signals', 'analysis'].includes(tag))))
      if (!run && !trustedLegacy && !savedResearch) continue
      items.push({ key: `output:${output.id}`, kind: 'output', title: output.title, summary: output.summary ?? '',
        date: output.completedAt || output.createdAt, output, mode: run?.mode ?? (trustedLegacy ? 'scan' : undefined) })
    }
    if (track === 'industry') {
      for (const doc of documents) {
        if (['artist-intel-config', 'artist-intel-report'].includes(doc.slug)) continue
        if (doc.slug !== 'artist-signal-nuggets' && !/research|report|intel|analysis/i.test(`${doc.slug} ${doc.metadata.name} ${doc.metadata.description ?? ''}`)) continue
        items.push({ key: `context:${doc.slug}`, kind: 'context', title: doc.metadata.name, summary: doc.metadata.description ?? '', date: signalDocumentDate(doc.body), body: readableSignalBody(doc.body) })
      }
      const previous = parseArtistIntelReportDocResult(documents.find(doc => doc.slug === 'artist-intel-report'))
      if (previous.ok && !previous.report.outputId && (previous.report.title || previous.report.summary)) {
        items.push({ key: 'context:latest-intel-summary', kind: 'context', title: previous.report.title || 'Saved Industry summary', summary: previous.report.summary || '',
          date: previous.report.generatedAt || previous.report.updatedAt, body: previous.report.summary || '', mode: 'scan' })
      }
    }
    return items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }, [outputs, documents, track, tracks.state])
  const selectedKey = signalDefaultKey(library, selections[track])
  const selected = library.find(item => item.key === selectedKey) ?? null
  const { content, loading } = useSignalReportContent(workspaceId, selected, getOutput)
  React.useEffect(() => { setSelection(''); setFullscreen(false) }, [selectedKey, track, workspaceId])
  React.useEffect(() => { setSelection('') }, [content])
  React.useEffect(() => {
    if (!tracks.state) return
    for (const kind of ['industry', 'your-world'] as const) {
      const pending = pendingReviews[kind]
      const run = tracks.state.runs.find(item => item.runId === pending)
      const output = outputs.find(item => item.id === run?.outputId)
      if (run && output && signalOutputRun(output, tracks.state)) {
        setSelections(value => ({ ...value, [kind]: `output:${output.id}` }))
        setPendingReviews(value => ({ ...value, [kind]: undefined }))
      }
    }
  }, [tracks.state, outputs, pendingReviews])
  const reportError = (cause: unknown, target = track) => setActionError({ track: target, message: cause instanceof Error ? cause.message : String(cause) })
  const runScan = async () => {
    const target = track; setActionError(null)
    if (currentLegacy) { await legacy.onRun(); return }
    const key = requests.current[target] ?? crypto.randomUUID(); requests.current[target] = key
    try { await tracks.start(target, 'scan', key); delete requests.current[target] }
    catch (cause) { reportError(cause, target) }
  }
  const toggleWeekly = async () => {
    if (currentLegacy) { await legacy.onToggleWeekly(); return }
    if (!config) return
    try { await tracks.save({ ...config, enabled: !weekly, cadence: !weekly ? 'weekly' : 'manual' }, false); setActionError(null) }
    catch (cause) { reportError(cause) }
  }
  const adopt = async () => {
    if (!tracks.state) return
    const owner = workspaceId; const token = ++adoptionEpoch.current; setAdopting(true); setActionError(null)
    try {
      const body = tracks.state.legacyIndustry?.configBody ?? documents.find(doc => doc.slug === 'artist-intel-config')?.body
      const old = legacySignalSources(body, legacy.config)
      const sources: SignalTrackConfig['sources'] = []
      for (const source of old) {
        if (scope.current !== owner || token !== adoptionEpoch.current) return
        const resolved = await window.electronAPI.resolveSignalChannel(owner, source.url)
        if (scope.current !== owner || token !== adoptionEpoch.current) return
        if (sources.some(item => item.channelId === resolved.channelId)) throw new Error('Existing channels resolve to the same channel. Review duplicates in existing settings first.')
        sources.push({ ...resolved, name: source.name, priority: source.priority, notes: source.notes })
      }
      if (scope.current !== owner || token !== adoptionEpoch.current) return
      setSetup({ adoption: true, config: { ...tracks.state.tracks.industry, sinceDays: legacy.config.sinceDays, maxPerChannel: legacy.config.maxPerChannel,
        sources, enabled: legacy.weeklyEnabled, cadence: legacy.weeklyEnabled ? 'weekly' : 'manual' } })
    } catch (cause) { if (scope.current === owner && token === adoptionEpoch.current) reportError(cause, 'industry') }
    finally { if (scope.current === owner && token === adoptionEpoch.current) setAdopting(false) }
  }
  const saveNugget = async () => {
    if (!selected || !selection || nuggetBusy) return
    setNuggetBusy(true)
    try { await props.onSaveNugget({ text: selection, sourceTitle: selected.title, sourceKey: selected.key, track, outputId: selected.output?.id }); setSelection(''); window.getSelection()?.removeAllRanges() }
    catch (cause) { reportError(cause) } finally { setNuggetBusy(false) }
  }
  const status = currentLegacy ? legacy.notice?.title : latestRun ? ({ queued: 'Scan queued', running: 'Research running', 'no-change': 'No new findings', partial: 'Partial coverage', failed: 'Research needs attention', cancelled: 'Research cancelled', report: 'Report ready' }[latestRun.status]) : undefined
  const detail = currentLegacy ? legacy.notice?.detail : latestRun?.error
  const nextRuns = weekly && schedule?.cron ? computeNextRuns(schedule.cron, 1, schedule.timezone) : []
  return <section aria-label="Signals intelligence reader" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Signals track" className="flex gap-1">
        {(['industry', 'your-world'] as const).map((kind, index) => <button key={kind} role="tab" aria-selected={track === kind} tabIndex={track === kind ? 0 : -1}
          className={`${control} ${track === kind ? '!border-[#ff5a36] !text-[#ff5a36]' : ''}`}
          onClick={() => changeTrack(kind)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; changeTrack(next === 0 ? 'industry' : 'your-world'); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus() } }}>{signalTrackName(kind)}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className={control}><input type="checkbox" aria-label={`${signalTrackName(track)} weekly scan`} checked={weekly} disabled={busy || (!currentLegacy && !config) || (track === 'your-world' && !config?.sources.length && !weekly)} onChange={() => { void toggleWeekly() }} />Weekly</label>
        <button className={control} title="Edit channels" aria-label="Edit channels" disabled={busy || (!currentLegacy && !config)} onClick={() => currentLegacy ? legacy.onConfigure() : config && setSetup({ config, adoption: false })}><SlidersHorizontal size={15} /></button>
        <button className={control} disabled={busy || !tracks.state} onClick={() => setLinksOpen(true)}><Link2 size={15} />Analyze links</button>
        <button className={`${control} bg-white/90 !text-black`} aria-label="Run scan" title={currentLegacy ? legacy.runDisabledReason ?? 'Run scan' : 'Run scan'} disabled={busy || active || (currentLegacy ? !!legacy.runDisabledReason : !config || (track === 'your-world' && !config.sources.length))} onClick={() => { void runScan() }}><Play size={15} /><span className="hidden sm:inline">Run scan</span></button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-white/50"><span>Weekly {weekly ? 'active' : 'paused'}</span>{schedule?.snoozedUntil ? <span>Snoozed until {formatSignalDate(schedule.snoozedUntil)}</span> : null}{nextRuns?.[0] ? <span>Next {new Date(nextRuns[0]).toLocaleString()}</span> : null}
      {currentLegacy && tracks.state ? <button className="text-white/80 underline underline-offset-4" disabled={busy} onClick={() => { void adopt() }}>Review scan update</button> : null}
      {adopting ? <button className="text-white/80 underline underline-offset-4" onClick={() => { adoptionEpoch.current++; setAdopting(false) }}>Cancel update review</button> : null}</div>
    {!currentLegacy && readiness.needsRepair ? <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-amber-200"><span>Weekly schedule and Signals settings do not match.</span><button className={control} disabled={busy || !config || (track === 'your-world' && !config.sources.length)} onClick={() => { void toggleWeekly() }}>Repair weekly scan</button></div> : null}
    {tracks.error || actionError?.track === track || status ? <div aria-live="polite" className="border-l-2 border-white/20 px-3 py-1 text-sm text-white/70">
      {tracks.error ? <p role="alert">{tracks.error}</p> : null}{actionError?.track === track ? <p role="alert" className="text-red-300">{actionError.message}</p> : null}{status ? <p>{status}</p> : null}{detail ? <p className="text-xs text-white/50">{detail}</p> : null}</div> : null}
    <div className="min-h-[440px] border-t border-white/10 bg-[#111214]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
        <div className="min-w-0 flex-1"><p className="text-xs text-white/45">{selected?.mode === 'links' ? 'Video review' : selected?.mode === 'scan' ? `${signalTrackName(track)} scan` : 'Saved intelligence'}</p>
          <h2 className="mt-1 break-words text-lg font-medium text-white">{selected?.title || signalTrackName(track)}</h2>{selected?.date ? <p className="mt-1 text-xs text-white/45">Report {formatSignalDate(selected.date)}</p> : null}</div>
        <div className="flex w-full max-w-full flex-nowrap items-center gap-2 sm:w-auto">
          {selection ? <button className={control} aria-label="Save selection" title="Save selection" disabled={nuggetBusy} onClick={() => { void saveNugget() }}><Diamond size={15} /><span className="hidden sm:inline">Save selection</span></button> : null}
          <select aria-label={`${signalTrackName(track)} report library`} className={`${control} min-w-0 max-w-[240px] !shrink flex-1 truncate`} value={selectedKey ?? ''} onChange={event => setSelections(value => ({ ...value, [track]: event.target.value }))}>
            {!library.length ? <option value="">No reports yet</option> : library.map(item => <option key={item.key} value={item.key}>{item.mode === 'links' ? 'Video review: ' : ''}{item.title}</option>)}</select>
          <button className={`${control} !w-9 !px-0`} title="Read full report" aria-label="Read full report" disabled={!content} onClick={() => setFullscreen(true)}><Maximize2 size={15} /></button>
          {selected?.output ? <button className={`${control} !w-9 !px-0`} title="Open source output" aria-label="Open source output" onClick={() => navigate(routes.view.output(selected.output!.id))}><ExternalLink size={15} /></button> : null}
        </div>
      </div>
      {!loading && selected?.output ? <SignalBriefingPlayer key={`${workspaceId}:${track}:${selectedKey}:${fullscreen}`} workspaceId={workspaceId} output={selected.output} content={content} /> : null}
      <div ref={reader} className="px-4 py-5 selection:bg-orange-400/30" onMouseUp={() => { const selectedText = window.getSelection(); const node = selectedText?.rangeCount ? selectedText.getRangeAt(0).commonAncestorContainer : null; setSelection(node && reader.current?.contains(node) ? selectedText!.toString().trim().slice(0, 4000) : '') }}>
        {loading ? <div className="flex h-64 items-center justify-center"><RefreshCw size={18} className="animate-spin text-white/40" /></div> : content ? <Info_Markdown className="mx-auto max-w-[900px] break-words text-sm leading-7 text-white/75">{content}</Info_Markdown> : <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-white/55"><Radio size={20} /><p>No {signalTrackName(track)} reports yet</p>{track === 'your-world' ? <div className="flex flex-wrap gap-2"><button className={control} disabled={!config} onClick={() => config && setSetup({ config, adoption: false })}><Plus size={15} />Add channels</button><button className={control} disabled={!tracks.state} onClick={() => setLinksOpen(true)}><Link2 size={15} />Analyze links</button></div> : null}</div>}
      </div>
    </div>
    {!loading && selected?.output && props.onDevelopIdea ? <SignalIdeasActions key={`ideas:${workspaceId}:${selected.output.id}`} workspaceId={workspaceId} outputId={selected.output.id} revision={content} onDevelop={props.onDevelopIdea} /> : null}
    <DocumentFormattedMarkdownOverlay content={content} isOpen={fullscreen} onClose={() => setFullscreen(false)} typeBadge={{ label: signalTrackName(track), icon: Radio }} />
    {setup ? <SignalTrackSetupDialog key={`setup:${workspaceId}:${setup.config.track}`} open config={setup.config} adoption={setup.adoption} weeklyEnabled={setup.adoption ? legacy.weeklyEnabled : weekly} onOpenChange={open => { if (!open) setSetup(null) }} resolveChannel={url => window.electronAPI.resolveSignalChannel(workspaceId, url)} onSave={next => tracks.save(next, setup.adoption)} /> : null}
    <SignalLinksDialog key={`links:${workspaceId}:${track}`} open={linksOpen} trackName={signalTrackName(track)} onOpenChange={setLinksOpen} onAnalyze={async (links, key) => { const owner = workspaceId; const target = track; const queued = await tracks.start(target, 'links', key, links); if (scope.current === owner) setPendingReviews(value => ({ ...value, [target]: queued.runId })) }} />
  </section>
}

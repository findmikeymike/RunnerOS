import * as React from 'react'
import { Check, ExternalLink, Info, Link2, Maximize2, Play, Plus, Radio, RefreshCw, SlidersHorizontal, Bookmark } from 'lucide-react'
import { DocumentFormattedMarkdownOverlay } from '@craft-agent/ui'
import { isFinalSignalReport, parseSignalBriefing, type SignalMode, type SignalTrack, type SignalTrackConfig, type SignalEntryReference } from '@craft-agent/shared/shared-intel'
import type { ContextDocDTO } from '../../../shared/types'
import type { OutputManifestDTO, OutputSummaryDTO } from '@/hooks/useOutputs'
import type { ArtistIntelConfig } from '@/lib/artist-intel'
import { parseArtistIntelReportDocResult } from '@/lib/artist-intel'
import { useSignalTracks } from '@/hooks/useSignalTracks'
import { useSignalReportContent } from '@/hooks/useSignalReportContent'
import { formatSignalDate, readableSignalBody, signalDocumentDate, signalPreviewText } from '@/lib/artist-signals'
import { legacySignalSchedule, legacySignalSources, signalDefaultKey, signalDocumentInTrack, signalLibraryLabels, signalNextRun, signalNuggetsKey, signalOutputRun, signalScheduleMatches, signalTrackName, signalWeeklyReadiness } from '@/lib/signal-tracks'
import { Info_Markdown } from '@/components/info'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { navigate, routes } from '@/lib/navigate'
import { SignalBriefingPlayer } from './SignalBriefingPlayer'
import { SignalLinksDialog, SignalTrackSetupDialog } from './SignalTrackSetupDialog'
import { SignalIdeasActions } from './SignalIdeasActions'

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
  const [setup, setSetup] = React.useState<{ configs: Record<SignalTrack, SignalTrackConfig>; adoptIndustry: boolean; industryError?: string } | null>(null)
  const [linksOpen, setLinksOpen] = React.useState(false)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [selection, setSelection] = React.useState('')
  const [nuggetBusy, setNuggetBusy] = React.useState(false)
  const [nuggetSaved, setNuggetSaved] = React.useState(false)
  const [nuggetError, setNuggetError] = React.useState<string | null>(null)
  const nuggetPending = React.useRef(false)
  const [actionError, setActionError] = React.useState<{ track: SignalTrack; message: string } | null>(null)
  const requests = React.useRef<Partial<Record<SignalTrack, string>>>({})
  const reader = React.useRef<HTMLDivElement>(null)
  const scope = React.useRef(workspaceId); scope.current = workspaceId
  React.useEffect(() => { setSelections({ industry: null, 'your-world': null }); setPendingReviews({}); setTrack('industry'); setSetup(null); setLinksOpen(false); setActionError(null); requests.current = {} }, [workspaceId])
  const changeTrack = (next: SignalTrack) => { setSetup(null); setLinksOpen(false); setTrack(next) }
  const legacySchedules = tracks.automations.filter(legacySignalSchedule)
  const legacyMode = !tracks.state || tracks.state.tracks.industry.revision === 'initial' || legacySchedules.length > 0
  const currentLegacy = track === 'industry' && legacyMode
  const config = tracks.state?.tracks[track]
  const schedule = tracks.automations.find(item => tracks.state && signalScheduleMatches(item, tracks.state.hqWorkspaceId, track))
  const readiness = signalWeeklyReadiness(config, schedule)
  const weekly = currentLegacy ? legacy.weeklyEnabled : readiness.active
  const busy = tracks.busy || (currentLegacy && legacy.busy)
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
    for (const doc of documents) {
      if (!signalDocumentInTrack(doc, track)) continue
      items.push({ key: `context:${doc.slug}`, kind: 'context', title: doc.slug === 'artist-signal-nuggets' ? 'Saved insights' : doc.metadata.name, summary: doc.metadata.description ?? '', date: signalDocumentDate(doc.body), body: readableSignalBody(doc.body) })
    }
    if (!items.some(item => item.key === signalNuggetsKey)) items.push({ key: signalNuggetsKey, kind: 'context', title: 'Saved insights', summary: '' })
    if (track === 'industry') {
      const previous = parseArtistIntelReportDocResult(documents.find(doc => doc.slug === 'artist-intel-report'))
      if (previous.ok && !previous.report.outputId && (previous.report.title || previous.report.summary)) {
        items.push({ key: 'context:latest-intel-summary', kind: 'context', title: previous.report.title || 'Saved Industry summary', summary: previous.report.summary || '',
          date: previous.report.generatedAt || previous.report.updatedAt, body: previous.report.summary || '', mode: 'scan' })
      }
    }
    return items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }, [outputs, documents, track, tracks.state])
  const reports = library.filter(item => item.key !== signalNuggetsKey)
  const selectedKey = signalDefaultKey(library, selections[track])
  const selected = library.find(item => item.key === selectedKey) ?? null
  const { content, loading, error: contentError, retry } = useSignalReportContent(workspaceId, selected, getOutput)
  const labels = React.useMemo(() => signalLibraryLabels(library), [library])
  const briefing = !contentError && selected?.output ? parseSignalBriefing(content) : null
  const previewText = signalPreviewText(contentError ? content : selected?.summary || content)
  const boardContent = selected?.output ? briefing || previewText : content
  const fullReportReady = Boolean(content) && !loading && !contentError
  const readerIdentity = React.useRef('')
  readerIdentity.current = `${workspaceId}:${track}:${selectedKey}`
  React.useEffect(() => { setSelection(''); setFullscreen(false); setNuggetSaved(false); setNuggetError(null) }, [selectedKey, track, workspaceId])
  React.useEffect(() => { setSelection('') }, [content])
  React.useEffect(() => {
    if (fullscreen) return
    const update = () => {
      const value = window.getSelection()
      const node = value?.rangeCount ? value.getRangeAt(0).commonAncestorContainer : null
      setSelection(node && reader.current?.contains(node) ? value!.toString().trim().slice(0, 4000) : '')
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [fullscreen])
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
  const openSettings = () => {
    if (!tracks.state) return
    try {
      const configs = { ...tracks.state.tracks }
      for (const kind of ['industry', 'your-world'] as const) {
        const matcher = tracks.automations.find(item => signalScheduleMatches(item, tracks.state!.hqWorkspaceId, kind))
        const enabled = signalWeeklyReadiness(configs[kind], matcher).active
        configs[kind] = { ...configs[kind], enabled, cadence: enabled ? 'weekly' : 'manual' }
      }
      let industryError: string | undefined
      if (legacyMode) {
        try {
        const body = tracks.state.legacyIndustry?.configBody ?? documents.find(doc => doc.slug === 'artist-intel-config')?.body
        const sources = legacySignalSources(body, legacy.config).map((source, index) => ({
          channelId: `legacy:${index}`, url: source.url, name: source.name, priority: source.priority, notes: source.notes,
        }))
        configs.industry = { ...configs.industry, sources, sinceDays: legacy.config.sinceDays, maxPerChannel: legacy.config.maxPerChannel,
          enabled: legacy.weeklyEnabled, cadence: legacy.weeklyEnabled ? 'weekly' : 'manual' }
        } catch (cause) {
          industryError = cause instanceof Error ? cause.message : String(cause)
          configs.industry = { ...configs.industry, enabled: legacy.weeklyEnabled, cadence: legacy.weeklyEnabled ? 'weekly' : 'manual' }
        }
      }
      setActionError(null)
      setSetup({ configs, adoptIndustry: legacyMode, industryError })
    } catch (cause) { reportError(cause) }
  }
  const saveNugget = async () => {
    if (!selected || !selection || nuggetPending.current) return
    const owner = readerIdentity.current
    nuggetPending.current = true
    setNuggetBusy(true); setNuggetError(null); setNuggetSaved(false)
    try {
      await props.onSaveNugget({ text: selection, sourceTitle: selected.title, sourceKey: selected.key, track, outputId: selected.output?.id })
      if (owner === readerIdentity.current) { setSelection(''); setNuggetSaved(true); window.getSelection()?.removeAllRanges() }
    } catch (cause) { if (owner === readerIdentity.current) setNuggetError(cause instanceof Error ? cause.message : String(cause)) }
    finally { nuggetPending.current = false; setNuggetBusy(false) }
  }
  const status = contentError ? 'Report unavailable' : currentLegacy ? legacy.notice?.title : latestRun ? ({ queued: 'Scan queued', running: 'Research running', 'no-change': 'No new findings', partial: 'Partial coverage', failed: 'Research needs attention', cancelled: 'Research cancelled', report: 'Report ready' }[latestRun.status]) : undefined
  const detail = currentLegacy ? legacy.notice?.detail : latestRun?.error
  const nextRun = weekly && schedule ? signalNextRun(schedule) : null
  const snoozed = weekly && schedule?.snoozedUntil && Date.parse(schedule.snoozedUntil) > Date.now()
  const channelCount = currentLegacy ? legacy.config.sources.length : config?.sources.length ?? 0
  const nextRuns: Partial<Record<SignalTrack, string>> = {}
  for (const kind of ['industry', 'your-world'] as const) {
    const matcher = kind === 'industry' && legacyMode ? legacySchedules[0] : tracks.automations.find(item => tracks.state && signalScheduleMatches(item, tracks.state.hqWorkspaceId, kind))
    const date = matcher && signalNextRun(matcher)
    if (date) nextRuns[kind] = `Next: ${date.toLocaleString()}`
  }
  const saveSelectionButton = <button className={`${control} !w-9 !px-0`} aria-label="Save selection" title={nuggetSaved ? 'Saved to insights' : 'Save selection'} disabled={nuggetBusy || !selection} onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onClick={() => { void saveNugget() }}>{nuggetSaved ? <Check size={15} /> : <Bookmark size={15} />}</button>
  return <section aria-label="Signals intelligence reader" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Signals track" className="flex gap-1">
        {(['industry', 'your-world'] as const).map((kind, index) => <button key={kind} role="tab" aria-selected={track === kind} tabIndex={track === kind ? 0 : -1}
          className={`${control} ${track === kind ? '!border-[#ff5a36] !text-[#ff5a36]' : ''}`}
          onClick={() => changeTrack(kind)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; changeTrack(next === 0 ? 'industry' : 'your-world'); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus() } }}>{signalTrackName(kind)}</button>)}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="How Signals works" title="How Signals works" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/5 hover:text-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"><Info size={17} /></button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={10} aria-label="How Signals works" className="w-[360px] max-w-[calc(100vw-40px)] max-h-[min(560px,var(--radix-popover-content-available-height))] overflow-y-auto rounded-lg border border-white/10 bg-[#151517] p-5 text-sm text-white/65 shadow-xl">
            <h3 className="mb-4 font-semibold text-white/95">How Signals works</h3>
            <div className="space-y-4 leading-relaxed">
              <p><strong className="font-medium text-white/90">Industry</strong> follows music-business news. <strong className="font-medium text-white/90">Your World</strong> follows the interests, ideas and causes behind your music.</p>
              <p>Use <strong className="font-medium text-white/90">Channels &amp; schedule</strong> to choose channels and turn weekly scans on or off for each track. <strong className="font-medium text-white/90">Scan now</strong> checks those channels immediately. <strong className="font-medium text-white/90">Review videos</strong> creates a one-off report from specific video links.</p>
              <div className="border-t border-white/10 pt-4">
                <h4 className="mb-1 font-medium text-white/90">Connections</h4>
                <p>Set up YouTube Data API or connect Monid in Settings → Connections to discover channel videos. For reliable transcripts, connect Monid; Zero adds another backup.</p>
                <p className="mt-2 text-xs text-white/50">Native YouTube first, Monid second, Zero last. Zero handles transcripts, not channel discovery. Paid fallbacks use your saved spending limits.</p>
              </div>
              <p>Each scan checks for new material and builds a report. Read the briefing, open the full report, save useful excerpts to Saved insights, or listen when a voice connection is set up.</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={control} disabled={busy || !tracks.state} onClick={openSettings}><SlidersHorizontal size={15} />Channels &amp; schedule</button>
        <button className={control} disabled={busy || !tracks.state} onClick={() => setLinksOpen(true)}><Link2 size={15} />Review videos</button>
        <button className={`${control} !border-transparent !bg-white/90 !text-black`} aria-label="Scan now" title={currentLegacy ? legacy.runDisabledReason ?? 'Scan now' : 'Scan saved sources now'} disabled={busy || active || (currentLegacy ? !!legacy.runDisabledReason : !config || (track === 'your-world' && !config.sources.length))} onClick={() => { void runScan() }}><Play size={15} /><span>Scan now</span></button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
      <span>{channelCount} {channelCount === 1 ? 'channel' : 'channels'}</span><span aria-hidden="true">&middot;</span>
      <span>Weekly {snoozed ? 'snoozed' : weekly ? 'on' : 'off'}</span>{snoozed ? <span>Until {formatSignalDate(schedule!.snoozedUntil!)}</span> : null}{nextRun ? <span>Next {nextRun.toLocaleString()}</span> : null}
    </div>
    {!currentLegacy && readiness.needsRepair ? <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-amber-200"><span>Weekly schedule needs attention.</span><button className={control} disabled={busy || !tracks.state} onClick={openSettings}>Review schedule</button></div> : null}
    {tracks.error || actionError?.track === track || status ? <div aria-live="polite" className="border-l-2 border-white/20 px-3 py-1 text-sm text-white/70">
      {tracks.error ? <p role="alert">{tracks.error}</p> : null}{actionError?.track === track ? <p role="alert" className="text-red-300">{actionError.message}</p> : null}{status ? <p>{status}</p> : null}{detail ? <p className="text-xs text-white/50">{detail}</p> : null}</div> : null}
    <div className="border-t border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
        <div className="min-w-0 flex-1"><p className="text-xs text-white/45">{selectedKey === signalNuggetsKey ? 'Excerpts you saved from reports' : selected?.mode === 'links' ? 'Video review' : selected?.mode === 'scan' ? `${signalTrackName(track)} scan` : ''}</p>
          <h2 className="mt-1 break-words text-lg font-medium text-white">{selected?.title || 'Reports'}</h2>{selected?.date ? <p className="mt-1 text-xs text-white/45">Report {formatSignalDate(selected.date)}</p> : null}</div>
        <div className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">
          {reports.length > 1 ? <select aria-label={`${signalTrackName(track)} report library`} className={`${control} min-w-0 max-w-[280px] !shrink flex-1 truncate`} value={selectedKey === signalNuggetsKey ? '' : selectedKey ?? ''} onChange={event => setSelections(value => ({ ...value, [track]: event.target.value }))}>
            {selectedKey === signalNuggetsKey ? <option value="" disabled>Choose a report</option> : null}{reports.map(item => <option key={item.key} value={item.key}>{labels.get(item.key)}</option>)}</select> : null}
          {selectedKey === signalNuggetsKey ? <button className={control} onClick={() => setSelections(value => ({ ...value, [track]: null }))}>Back to reports</button>
            : <button className={control} onClick={() => setSelections(value => ({ ...value, [track]: signalNuggetsKey }))}><Bookmark size={15} />Saved insights</button>}
          {selected?.output ? <button className={`${control} !w-9 !px-0`} title="Open source output" aria-label="Open source output" onClick={() => navigate(routes.view.output(selected.output!.id))}><ExternalLink size={15} /></button> : null}
        </div>
      </div>
      {contentError ? <div role="alert" className="space-y-2 break-words border-b border-white/10 px-4 py-3 text-sm text-red-300"><p>Could not load the full report. {contentError}</p><button className={control} disabled={loading} onClick={retry}><RefreshCw size={15} />Retry report</button></div> : null}
      {!loading && !contentError && selected?.output ? <SignalBriefingPlayer key={`${workspaceId}:${track}:${selectedKey}:${fullscreen}`} workspaceId={workspaceId} output={selected.output} content={content} showTranscriptControl={false} /> : null}
      {selected && (fullReportReady || selected.output) ? <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <p className="text-xs text-white/50">{selected.output ? contentError ? 'Preview only - full report unavailable' : briefing ? 'Your briefing' : 'Report preview' : 'Saved intelligence'}</p>
        <div className="flex items-center gap-2">{selection || nuggetBusy || nuggetSaved ? saveSelectionButton : null}<button className={control} disabled={!fullReportReady} onClick={() => { setSelection(''); setFullscreen(true) }}><Maximize2 size={15} />{selected.output ? 'Read full report' : 'Open reader'}</button></div>
      </div> : null}
      {nuggetError ? <p role="alert" className="break-words px-4 py-2 text-sm text-red-300">Could not save selection. {nuggetError}</p> : null}
      {!loading && selected?.output && props.onDevelopIdea ? <SignalIdeasActions key={`ideas:${workspaceId}:${selected.output.id}`} workspaceId={workspaceId} outputId={selected.output.id} revision={content} onDevelop={props.onDevelopIdea} /> : null}
      <div ref={reader} className={`px-4 py-4 selection:bg-orange-400/30 ${selected?.output ? '' : 'max-h-[420px] overflow-y-auto'}`}>
        {loading ? <div role="status" className="flex h-24 items-center justify-center gap-2 text-xs text-white/50"><RefreshCw size={18} className="animate-spin" />Loading report</div> : boardContent ? selected?.output ? <p className="mx-auto max-w-[900px] break-words text-sm leading-6 text-white/75">{boardContent}</p> : <Info_Markdown safeMode className="mx-auto max-w-[900px] break-words text-sm leading-7 text-white/75">{boardContent}</Info_Markdown> : <div className="flex min-h-48 flex-col items-center justify-center gap-3 py-6 text-white/55"><Radio size={22} className="text-white/30" /><p className="text-sm">{selectedKey === signalNuggetsKey ? 'No saved insights yet' : contentError ? 'No preview available' : `No ${signalTrackName(track)} reports yet`}</p>
          {selectedKey === signalNuggetsKey ? <p className="text-xs text-white/40">Select a passage in a report to save it here.</p> : !contentError ? currentLegacy || (track === 'your-world' && !channelCount) ? <button className={control} disabled={busy || !tracks.state} onClick={openSettings}><Plus size={15} />Choose channels</button> : <button className={control} disabled={busy || active || !config} onClick={() => { void runScan() }}><Play size={15} />Create first report</button> : null}</div>}
      </div>
    </div>
    {nuggetSaved ? <p role="status" className="px-4 text-xs text-white/60">Saved to insights</p> : null}
    <DocumentFormattedMarkdownOverlay safeMode content={content} isOpen={fullscreen && fullReportReady} onClose={() => setFullscreen(false)} accessibleTitle={selected?.title} onSelectionChange={setSelection} headerActions={saveSelectionButton} error={nuggetError ?? undefined} errorLabel="Could not save selection" typeBadge={{ label: signalTrackName(track), icon: Radio }} />
    {setup ? <SignalTrackSetupDialog key={`setup:${workspaceId}`} open configs={setup.configs} initialTrack={track} adoptIndustry={setup.adoptIndustry} nextRuns={nextRuns} industryError={setup.industryError} onPauseLegacy={tracks.pauseLegacy} onOpenChange={open => { if (!open) setSetup(null) }} resolveChannel={url => window.electronAPI.resolveSignalChannel(workspaceId, url)} onSave={tracks.save} /> : null}
    <SignalLinksDialog key={`links:${workspaceId}:${track}`} open={linksOpen} trackName={signalTrackName(track)} onOpenChange={setLinksOpen} onAnalyze={async (links, key) => { const owner = workspaceId; const target = track; const queued = await tracks.start(target, 'links', key, links); if (scope.current === owner) setPendingReviews(value => ({ ...value, [target]: queued.runId })) }} />
  </section>
}

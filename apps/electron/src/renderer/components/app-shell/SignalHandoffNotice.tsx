import * as React from 'react'
import { Link2Off, RefreshCw } from 'lucide-react'
import type { SignalEntryReference, SignalRetrievedEntry } from '@craft-agent/shared/shared-intel'
import { resolvedSignalIdea } from '@/lib/signal-idea-handoff'
import { navigate, routes } from '@/lib/navigate'

export function SignalHandoffNotice({ sessionId, workspaceId, processing, onGuardChange }: { sessionId: string; workspaceId: string; processing: boolean; onGuardChange?: (guarded: boolean) => void }) {
  const [reference, setReference] = React.useState<SignalEntryReference | null>(null)
  const [candidate, setCandidate] = React.useState<SignalRetrievedEntry | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [detach, setDetach] = React.useState(false)
  const [reviewed, setReviewed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const epoch = React.useRef(0)
  const locked = React.useRef(false)
  const sequence = React.useRef(0)
  React.useEffect(() => {
    const token = ++epoch.current
    locked.current = false
    setReference(null); setCandidate(null); setError(null); setDetach(false); setBusy(false); setReviewed(false)
    onGuardChange?.(true)
    const load = () => {
      if (locked.current) return
      const request = ++sequence.current
      void window.electronAPI.getSignalHandoff(sessionId).then(ref => {
        if (epoch.current !== token || sequence.current !== request) return
        setReference(ref); setError(null); onGuardChange?.(!!ref)
      }).catch(() => {
        if (epoch.current !== token || sequence.current !== request) return
        setError('The research source could not be checked. Review your draft before detaching its source.'); onGuardChange?.(true)
      })
    }
    load()
    const timer = setInterval(load, 3000)
    return () => { clearInterval(timer); epoch.current++ }
  }, [sessionId, workspaceId, processing, onGuardChange])
  const run = async (action: () => Promise<void>) => {
    if (locked.current || processing) return
    locked.current = true; sequence.current++; setBusy(true)
    const token = epoch.current
    try { await action() }
    catch (cause) { if (epoch.current === token) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (epoch.current === token) { locked.current = false; setBusy(false) } }
  }
  if (!reference && !error) return null
  const token = epoch.current
  return <div className="border-b border-white/10 px-4 py-2 text-xs text-muted-foreground" aria-label="Signal draft source">
    <div className="flex flex-wrap items-center gap-3"><span>Signal idea attached. Its saved source is checked when you send.</span>
      {reference ? <button disabled={busy || processing} className="inline-flex items-center gap-1 disabled:opacity-40" onClick={() => { void run(async () => {
        const result = await window.electronAPI.getSignalIdeas(workspaceId, reference.outputId)
        if (epoch.current !== token) return
        const next = result.ok ? result.entries.find(entry => entry.kind === 'idea' && entry.reference.entryId === reference.entryId && entry.reference.hqWorkspaceId === reference.hqWorkspaceId) : undefined
        if (!next) throw new Error('The source idea is no longer available. Review the draft before detaching it.')
        const verified = resolvedSignalIdea(await window.electronAPI.resolveSignalIdea(workspaceId, next.reference), next.reference)
        if (epoch.current === token) { setCandidate(verified); setDetach(false); setReviewed(false) }
      }) }}><RefreshCw size={13} />Review source</button> : null}
      <button disabled={busy || processing} className="inline-flex items-center gap-1 disabled:opacity-40" onClick={() => { setDetach(true); setCandidate(null); setReviewed(false) }}><Link2Off size={13} />Detach source</button>
    </div>
    {candidate ? <div className="mt-2 space-y-2"><p className="text-foreground">{candidate.title}: {candidate.excerpt}</p>
      <p>Report {candidate.createdAt}; {candidate.temporalKind}; event date {candidate.eventDate ?? 'unknown'}.</p>
      {candidate.sources.map(source => <p key={source.sourceId} className="break-words">{source.sourceUrl} / published {source.sourcePublishedAt ?? 'unknown'}</p>)}
      <p>Review your draft against this current source. Your text will not be replaced.</p>
      <button disabled={busy || processing} className="underline disabled:opacity-40" onClick={() => { void run(async () => {
        const id = await window.electronAPI.bindSignalHandoff(sessionId, candidate.reference)
        if (epoch.current !== token) return
        setReference(candidate.reference); setCandidate(null)
        if (id !== sessionId) navigate(routes.view.allSessions(id))
      }) }}>Use this source revision</button></div> : null}
    {detach ? <div className="mt-2 space-y-2"><p>Detaching keeps your text but stops source checks. Remove or correct stale research before sending.</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I have reviewed the draft's research text.</label>
      <button disabled={!reviewed || busy || processing} className="underline disabled:opacity-40" onClick={() => { void run(async () => {
        await window.electronAPI.clearSignalHandoff(sessionId)
        if (epoch.current === token) { setReference(null); setDetach(false); setError(null); onGuardChange?.(false) }
      }) }}>Detach and keep reviewed draft</button></div> : null}
    {error ? <p role="alert" className="mt-2 text-red-400">{error}</p> : null}
  </div>
}

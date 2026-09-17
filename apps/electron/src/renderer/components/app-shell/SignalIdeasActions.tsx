import * as React from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import type { SignalEntryReference, SignalRetrievedEntry } from '@craft-agent/shared/shared-intel'

export function SignalIdeasActions({ workspaceId, outputId, revision, onDevelop }: {
  workspaceId: string; outputId: string; revision: string; onDevelop: (reference: SignalEntryReference) => void
}) {
  const [ideas, setIdeas] = React.useState<SignalRetrievedEntry[]>([])
  const [error, setError] = React.useState(false)
  const [attempt, retry] = React.useReducer(value => value + 1, 0)
  React.useEffect(() => {
    let current = true
    setIdeas([]); setError(false)
    void window.electronAPI.getSignalIdeas(workspaceId, outputId).then(result => {
      if (!current) return
      if (!result.ok) { setError(true); return }
      setIdeas(result.entries.filter(entry => entry.kind === 'idea'
        && entry.reference.hqWorkspaceId === workspaceId && entry.reference.outputId === outputId))
    }).catch(() => { if (current) setError(true) })
    return () => { current = false }
  }, [workspaceId, outputId, revision, attempt])
  if (error) return <div role="alert" className="flex items-center gap-3 border-t border-white/10 px-4 py-3 text-xs text-muted-foreground">
    <span>Report ideas could not be loaded.</span>
    <button onClick={retry} className="inline-flex items-center gap-1 text-foreground"><RefreshCw size={13} />Retry</button>
  </div>
  if (!ideas.length) return null
  return <details aria-label="Develop report ideas" className="group border-t border-white/[0.07] bg-white/[0.015]">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-sm text-white/65 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-300/50 sm:px-8 [&::-webkit-details-marker]:hidden">
      <span>Ideas worth exploring <span className="ml-2 text-xs text-white/35">{ideas.length}</span></span>
      <ArrowRight size={15} className="transition-transform group-open:rotate-90" />
    </summary>
    <div className="space-y-1 px-3 pb-4 sm:px-5">
      {ideas.map(idea => <button key={idea.reference.entryId} className="group/idea flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-300/50" onClick={() => onDevelop(idea.reference)} aria-label={`Develop this idea: ${idea.title}`}>
        <span className="min-w-0"><span className="block text-sm text-white/80">{idea.title}</span><span className="mt-1 block text-xs text-white/40">Explore with your team</span></span>
        <ArrowRight size={15} className="shrink-0 text-white/30 group-hover/idea:text-orange-300" />
      </button>)}
    </div>
  </details>
}

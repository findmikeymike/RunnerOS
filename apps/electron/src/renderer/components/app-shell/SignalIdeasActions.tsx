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
  return <div aria-label="Develop report ideas" className="space-y-2 border-t border-white/10 px-4 py-3">
    {ideas.map(idea => <div key={idea.reference.entryId} className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 flex-1 break-words text-sm text-white/75">{idea.title}</span>
      <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-xs text-white/80 hover:bg-white/10" onClick={() => onDevelop(idea.reference)} aria-label={`Develop this idea: ${idea.title}`}><ArrowRight size={14} />Develop this idea</button>
    </div>)}
  </div>
}

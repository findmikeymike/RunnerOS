import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { cn } from '@/lib/utils'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'

export type ArtistManagerCreationKind = 'worker' | 'workflow' | 'automation' | 'skill'

const CREATION_DRAFTS: Record<ArtistManagerCreationKind, string> = {
  worker: 'Help me create a worker. Ask only the minimum questions needed to define one clear job, then show me the complete worker draft before saving it.',
  workflow: 'Help me create a workflow: a chain of specialists acting in sequence for long, complex work. Ask only what is missing, then show me the complete workflow draft before saving it.',
  automation: 'Help me create an automation. Ask what should trigger it, what should happen, and what needs approval. Then show me the complete automation draft before saving it.',
  skill: 'Help me find the right skill. Ask what capability I need, search Artist OS skills first, and search the external marketplace only if there is no strong local match. Do not install or activate external content from search results.',
}

export function getArtistManagerCreationDraft(kind: ArtistManagerCreationKind): string {
  return CREATION_DRAFTS[kind]
}

export function ArtistManagerCreateLink({
  kind,
  workspaceId,
  className,
}: {
  kind: ArtistManagerCreationKind
  workspaceId: string | null | undefined
  className?: string
}) {
  const {
    activeAgents = [],
    skills = [],
    enabledSources = [],
    onCreateSession,
    onInputChange,
  } = useAppShellContext()
  const [opening, setOpening] = React.useState(false)
  const label = kind === 'skill' ? 'Find with Artist Manager' : 'Create with Artist Manager'

  const handleOpen = React.useCallback(async () => {
    if (!workspaceId || opening) return
    setOpening(true)
    try {
      const manager = activeAgents.find((agent) => agent.slug === CONCIERGE_SLUG)
        ?? await window.electronAPI.getAgentDefinition(CONCIERGE_SLUG)
      if (!manager) throw new Error('Artist Manager is not installed')
      const contextDocs = await window.electronAPI
        .listWorkspaceContextDocsForAgent(workspaceId, manager.slug)
        .catch(() => [])
      await openAgentSessionComposer({
        agent: manager,
        workspaceId,
        onCreateSession,
        onInputChange,
        skills,
        sources: enabledSources,
        contextDocs,
        agentCatalog: activeAgents.filter((agent) => agent.slug !== manager.slug),
        draftInput: getArtistManagerCreationDraft(kind),
      })
    } catch (error) {
      toast.error('Failed to open Artist Manager', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setOpening(false)
    }
  }, [activeAgents, enabledSources, kind, onCreateSession, onInputChange, opening, skills, workspaceId])

  return (
    <button
      type="button"
      onClick={() => void handleOpen()}
      disabled={!workspaceId || opening}
      className={cn(
        'group inline-flex items-center gap-1.5 text-[11px] font-medium text-white/38 transition-colors hover:text-orange-200/78 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      aria-label={`${label}. Opens a guided Artist Manager chat.`}
    >
      <Sparkles className="h-3 w-3 text-orange-300/48 transition-colors group-hover:text-orange-300/80" />
      {opening ? 'Opening Artist Manager…' : label}
    </button>
  )
}

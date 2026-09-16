import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { cn } from '@/lib/utils'
import { RENDERER_PRODUCT_VARIANT, type RendererProductVariant } from '@/lib/product-identity'
import { BUILDER_SLUG, CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'

export type ArtistManagerCreationKind = 'worker' | 'workflow' | 'automation' | 'skill'

const CREATION_DRAFTS: Record<ArtistManagerCreationKind, string> = {
  worker: 'Help me create a worker. Ask only the minimum questions needed to define one clear job, then show me the complete worker draft before saving it.',
  workflow: 'Help me create a workflow: a chain of specialists acting in sequence for long, complex work. Ask only what is missing, then show me the complete workflow draft before saving it.',
  automation: 'Help me set up automatic work. Begin by asking, "What would you like Artist OS to handle automatically?" Resolve the right active worker or workflow and bind every required workflow input. If I have not said when it should repeat, ask one compact choice: daily, weekly, monthly, or when something happens. Do not ask again if my request already makes the recurrence clear. Prefer automatic placement unless I name an exact time, then show one plain-language review sentence before saving with schedule_work.',
  skill: 'Help me find the right skill. Ask what capability I need, search Artist OS skills first, and search the external marketplace only if there is no strong local match. Do not install or activate external content from search results.',
}

export function getArtistManagerCreationDraft(kind: ArtistManagerCreationKind, variant: RendererProductVariant = 'runner'): string {
  if (variant === 'artist-os' && kind === 'automation') {
    return 'Help me create or revise reusable automatic work. Reuse the outcome and timing I provide, inspect existing workers, workflows and automations before creating another, and ask only for missing decisions. Bind every required workflow input and show one plain-language review before saving through the supported scheduling or maintenance tools.'
  }
  return CREATION_DRAFTS[kind]
}

export function getCreationLinkTarget(kind: ArtistManagerCreationKind, variant: RendererProductVariant, labelOverride?: string) {
  const builder = variant === 'artist-os'
  const displayName = builder ? 'Builder' : 'Artist Manager'
  const taskModeId = builder ? ({ worker: 'agents', workflow: 'workflows', automation: 'automations', skill: 'general' } as const)[kind] : undefined
  return {
    slug: builder ? BUILDER_SLUG : CONCIERGE_SLUG,
    displayName,
    taskModeId,
    label: labelOverride
      ? builder ? labelOverride.replace(/Artist Manager/g, 'Builder') : labelOverride
      : `${kind === 'skill' ? 'Find' : 'Create'} with ${displayName}`,
  }
}

export function ArtistManagerCreateLink({
  kind,
  workspaceId,
  className,
  label: labelOverride,
  prominent = false,
  draft,
}: {
  kind: ArtistManagerCreationKind
  workspaceId: string | null | undefined
  className?: string
  label?: string
  prominent?: boolean
  draft?: string
}) {
  const {
    activeAgents = [],
    skills = [],
    enabledSources = [],
    onCreateSession,
    onInputChange,
  } = useAppShellContext()
  const [opening, setOpening] = React.useState(false)
  const { slug, displayName, taskModeId, label } = getCreationLinkTarget(kind, RENDERER_PRODUCT_VARIANT, labelOverride)

  const handleOpen = React.useCallback(async () => {
    if (!workspaceId || opening) return
    setOpening(true)
    try {
      const creator = activeAgents.find((agent) => agent.slug === slug)
        ?? await window.electronAPI.getAgentDefinition(slug)
      if (!creator) throw new Error(`${displayName} is not installed`)
      const contextDocs = await window.electronAPI
        .listWorkspaceContextDocsForAgent(workspaceId, creator.slug)
        .catch(() => [])
      await openAgentSessionComposer({
        agent: creator,
        workspaceId,
        onCreateSession,
        onInputChange,
        skills,
        sources: enabledSources,
        contextDocs,
        agentCatalog: activeAgents.filter((agent) => agent.slug !== creator.slug),
        taskModeId,
        draftInput: draft ?? getArtistManagerCreationDraft(kind, RENDERER_PRODUCT_VARIANT),
        autoSendDraft: false,
      })
    } catch (error) {
      toast.error(`Failed to open ${displayName}`, {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setOpening(false)
    }
  }, [activeAgents, draft, enabledSources, kind, onCreateSession, onInputChange, opening, skills, workspaceId, slug, displayName, taskModeId])

  return (
    <button
      type="button"
      onClick={() => void handleOpen()}
      disabled={!workspaceId || opening}
      className={cn(
        prominent
          ? 'group inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#f4511e] px-3 text-[10.5px] font-semibold text-white transition-colors hover:bg-[#ff5a22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200/55 disabled:cursor-not-allowed disabled:opacity-40'
          : 'group inline-flex items-center gap-1.5 text-[11px] font-medium text-white/38 transition-colors hover:text-orange-200/78 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      aria-label={`${label}. Opens an unsent draft in ${displayName}.`}
    >
      <Sparkles className={cn('h-3 w-3 transition-colors', prominent ? 'text-white/90' : 'text-orange-300/48 group-hover:text-orange-300/80')} />
      {opening ? `Opening ${displayName}…` : label}
    </button>
  )
}

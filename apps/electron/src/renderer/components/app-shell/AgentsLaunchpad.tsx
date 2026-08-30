/**
 * AgentsLaunchpad
 *
 * The main-content view shown when the user is in the Agents navigator
 * but hasn't selected a specific agent yet. Replaces the older "list of
 * 40 agents in the middle pane" — sidebar children now carry the active
 * subset, so this view is a friendly orientation surface instead.
 *
 * Surfaces:
 *   - Active worker directory — click any worker to start a chat
 *   - Search, category filters, favorites, and recently used workers
 *   - Worker configuration stays available as an explicit secondary action
 *   - "Manage agents" CTA → opens the AgentLibraryDialog (handled by parent
 *     via the same hook so toggling state is consistent across surfaces)
 *   - Lightweight intro copy framing the mental model
 */

import * as React from 'react'
import { BookOpen, Boxes, ChevronDown, ChevronRight, Clock3, DatabaseZap, Kanban, LoaderCircle, Lock, Plus, Search, Settings2, Sparkles, Star, Zap } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { useAgents } from '@/hooks/useAgents'
import { useAgentDisplayNames } from '@/hooks/useAgentDisplayNames'
import { AgentLibraryDialog } from './AgentLibraryDialog'
import { AgentEditDialog } from './AgentEditDialog'
import { CONCIERGE_SLUG, ORCHESTRATOR_SLUG } from '@craft-agent/shared/agent-definitions/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAgentMemory } from '@/hooks/useAgentMemory'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { MemoryEditDialog } from '@/components/agents/MemoryEditDialog'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import { useAppShellContext } from '@/context/AppShellContext'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { cn } from '@/lib/utils'
import { defaultWorkerSlugs } from '@/lib/worker-defaults'
import { CompactPageHeader } from './CompactPageHeader'
import { getModelsForProviderType } from '@config/llm-connections'
import { getModelShortName, type ModelDefinition } from '@config/models'
import type { MemoryEntry } from '@craft-agent/shared/memory/types'
import type { AgentDefinitionDTO, ContextDocDTO, LlmConnectionWithStatus } from '../../../shared/types'

interface AgentsLaunchpadProps {
  workspaceId: string | null | undefined
  includeCampaignDefaultWorkers?: boolean
}

type WorkerDirectoryView = 'all' | 'recent' | 'favorites'

export function AgentsLaunchpad({ workspaceId, includeCampaignDefaultWorkers = false }: AgentsLaunchpadProps) {
  const defaultVisibleSlugs = defaultWorkerSlugs(includeCampaignDefaultWorkers)
  const { activeAgents, allAgents, loading } = useAgents(workspaceId, {
    defaultVisibleSlugs,
  })
  const { getDisplayName } = useAgentDisplayNames()
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)
  const { onCreateSession, onInputChange } = useAppShellContext()
  const [libraryOpen, setLibraryOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [selectedAgent, setSelectedAgent] = React.useState<AgentDefinitionDTO | null>(null)
  const [collapsedDomains, setCollapsedDomains] = React.useState<Set<string>>(() => new Set())
  const [query, setQuery] = React.useState('')
  const [selectedDomain, setSelectedDomain] = React.useState('all')
  const [directoryView, setDirectoryView] = React.useState<WorkerDirectoryView>('all')
  const [favoriteSlugs, setFavoriteSlugs] = React.useState<string[]>([])
  const [recentSlugs, setRecentSlugs] = React.useState<string[]>([])
  const [launchingSlug, setLaunchingSlug] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void readWorkerPreferences(workspaceId).then((preferences) => {
      if (cancelled) return
      setFavoriteSlugs(preferences.favorites)
      setRecentSlugs(preferences.recent)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const handleStartChat = React.useCallback(async (agent: AgentDefinitionDTO) => {
    if (!workspaceId || launchingSlug) return
    setLaunchingSlug(agent.slug)
    try {
      const contextDocs = await window.electronAPI
        .listWorkspaceContextDocsForAgent(workspaceId, agent.slug)
        .catch(() => [])
      await openAgentSessionComposer({
        agent,
        workspaceId,
        onCreateSession,
        onInputChange,
        skills,
        sources,
        contextDocs,
      })
      setRecentSlugs((current) => {
        const next = [agent.slug, ...current.filter((slug) => slug !== agent.slug)].slice(0, 12)
        writeWorkerPreference(workspaceId, 'recent', next)
        return next
      })
    } catch (err) {
      toast.error('Failed to start worker chat', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLaunchingSlug(null)
    }
  }, [launchingSlug, onCreateSession, onInputChange, skills, sources, workspaceId])

  const toggleFavorite = React.useCallback((slug: string) => {
    setFavoriteSlugs((current) => {
      const next = current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug]
      writeWorkerPreference(workspaceId, 'favorites', next)
      return next
    })
  }, [workspaceId])

  const grouped = React.useMemo(() => {
    const visibleAgents = dedupeLaunchpadAgents(activeAgents.filter((a) => (
      !isSystemAgent(a.slug)
      && !isHiddenFromWorkerHome(a.slug)
    )))
    const orch = visibleAgents.find((a) => a.slug === ORCHESTRATOR_SLUG)
    const defaultOrder = new Map(defaultVisibleSlugs.map((slug, index) => [slug, index]))
    const rest = visibleAgents
      .filter((a) => a.slug !== ORCHESTRATOR_SLUG)
      .sort((a, b) => compareLaunchpadAgents(a, b, defaultOrder, getDisplayName))
    const sorted = orch ? [orch, ...rest] : rest
    const groups = new Map<string, typeof sorted>()

    for (const agent of sorted) {
      const domain = getAgentDomain(
        agent.metadata.tags,
        agent.slug,
        getDisplayName(agent),
        agent.metadata.description,
      )
      const bucket = groups.get(domain) ?? []
      bucket.push(agent)
      groups.set(domain, bucket)
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => agentDomainRank(a) - agentDomainRank(b) || a.localeCompare(b))
  }, [activeAgents, defaultVisibleSlugs, getDisplayName])

  const domains = React.useMemo(() => grouped.map(([domain]) => domain), [grouped])

  const visibleGroups = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const favorites = new Set(favoriteSlugs)
    const recentOrder = new Map(recentSlugs.map((slug, index) => [slug, index]))
    const matches = (agent: AgentDefinitionDTO, domain: string) => {
      if (selectedDomain !== 'all' && domain !== selectedDomain) return false
      if (directoryView === 'favorites' && !favorites.has(agent.slug)) return false
      if (directoryView === 'recent' && !recentOrder.has(agent.slug)) return false
      if (!normalizedQuery) return true
      return [
        getDisplayName(agent),
        agent.metadata.name,
        agent.metadata.description,
        agent.slug,
        domain,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    }

    const filtered = grouped
      .map(([domain, agents]) => [domain, agents.filter((agent) => matches(agent, domain))] as const)
      .filter(([, agents]) => agents.length > 0)

    if (directoryView === 'recent') {
      const agents = filtered
        .flatMap(([, items]) => items)
        .sort((a, b) => (recentOrder.get(a.slug) ?? Number.MAX_SAFE_INTEGER) - (recentOrder.get(b.slug) ?? Number.MAX_SAFE_INTEGER))
      return agents.length > 0 ? [['Recent', agents] as const] : []
    }

    if (directoryView === 'favorites') {
      return filtered.length > 0
        ? [['Favorites', filtered.flatMap(([, agents]) => agents)] as const]
        : []
    }

    return filtered
  }, [directoryView, favoriteSlugs, getDisplayName, grouped, query, recentSlugs, selectedDomain])

  const visibleWorkerCount = React.useMemo(
    () => visibleGroups.reduce((count, [, agents]) => count + agents.length, 0),
    [visibleGroups],
  )

  const toggleDomain = React.useCallback((domain: string) => {
    setCollapsedDomains((current) => {
      const next = new Set(current)
      if (next.has(domain)) {
        next.delete(domain)
      } else {
        next.add(domain)
      }
      return next
    })
  }, [])

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto min-h-full w-full max-w-[1600px] px-5 py-4 xl:px-8 xl:py-5">
        <CompactPageHeader
          eyebrow="Team"
          title="Workers"
          tone="orange"
          className="mb-4 !min-h-[112px] [&>div.relative]:!min-h-[112px]"
          actions={
            <>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.06]"
              >
                <Plus className="h-3.5 w-3.5" />
                New worker
              </button>
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-orange-500/85 px-4 text-xs font-medium text-white transition-colors hover:bg-orange-500"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Manage library
              </button>
            </>
          }
        />

        <div className="mb-5 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workers by name or capability"
              aria-label="Search workers"
              className="h-10 w-full rounded-[10px] border border-white/[0.08] bg-white/[0.035] pl-9 pr-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 focus:border-orange-400/45 focus:bg-white/[0.05]"
            />
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="inline-flex h-10 items-center rounded-[10px] border border-white/[0.08] bg-white/[0.025] p-1" role="group" aria-label="Worker view">
              <DirectoryViewButton active={directoryView === 'all'} onClick={() => setDirectoryView('all')}>
                All
              </DirectoryViewButton>
              <DirectoryViewButton active={directoryView === 'recent'} onClick={() => setDirectoryView('recent')} icon={<Clock3 className="h-3 w-3" />}>
                Recent
              </DirectoryViewButton>
              <DirectoryViewButton active={directoryView === 'favorites'} onClick={() => setDirectoryView('favorites')} icon={<Star className="h-3 w-3" />}>
                Favorites
              </DirectoryViewButton>
            </div>
            <label className="sr-only" htmlFor="worker-domain-filter">Filter workers by category</label>
            <select
              id="worker-domain-filter"
              value={selectedDomain}
              onChange={(event) => setSelectedDomain(event.target.value)}
              className="h-10 min-w-[154px] rounded-[10px] border border-white/[0.08] bg-[#111] px-3 text-xs text-white/68 outline-none transition-colors focus:border-orange-400/45"
            >
              <option value="all">All categories</option>
              {domains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
            </select>
          </div>
        </div>

        {/* Active worker directory */}
        {loading && grouped.length === 0 ? (
          <div className="text-sm text-white/50">Loading workers...</div>
        ) : grouped.length === 0 ? (
          <EmptyState
            allAgentsCount={allAgents.length}
            onOpenLibrary={() => setLibraryOpen(true)}
          />
        ) : visibleGroups.length === 0 ? (
          <WorkerDirectoryEmptyState
            view={directoryView}
            hasQuery={Boolean(query.trim()) || selectedDomain !== 'all'}
            onReset={() => {
              setQuery('')
              setSelectedDomain('all')
              setDirectoryView('all')
            }}
          />
        ) : (
          <div className="space-y-5">
            {visibleGroups.map(([domain, agents]) => {
              const collapsed = collapsedDomains.has(domain)

              return (
                <section key={domain}>
                  <button
                    type="button"
                    onClick={() => toggleDomain(domain)}
                    className="mb-2.5 flex w-full items-center gap-2.5 text-left"
                    aria-expanded={!collapsed}
                  >
                    {collapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0 text-white/30" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0 text-white/30" />
                    )}
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">{domain}</h2>
                    <div className="h-px flex-1 bg-white/[0.06]" />
                    <span className="text-[11px] text-white/32">{agents.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                      {agents.map((agent) => (
                        <AgentCard
                          key={agent.slug}
                          slug={agent.slug}
                          name={cleanDisplayText(getDisplayName(agent))}
                          description={cleanDisplayText(agent.metadata.description)}
                          isOrchestrator={agent.slug === ORCHESTRATOR_SLUG}
                          isFavorite={favoriteSlugs.includes(agent.slug)}
                          isLaunching={launchingSlug === agent.slug}
                          onStartChat={() => void handleStartChat(agent)}
                          onToggleFavorite={() => toggleFavorite(agent.slug)}
                          onConfigure={() => setSelectedAgent(agent)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
            <p className="pb-1 text-right text-[11px] text-white/28">
              {visibleWorkerCount} {visibleWorkerCount === 1 ? 'worker' : 'workers'}
            </p>
          </div>
        )}
      </div>

      <AgentLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        workspaceId={workspaceId}
      />

      <AgentEditDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
      />

      <AgentDetailDialog
        agent={selectedAgent}
        workspaceId={workspaceId}
        onAgentUpdated={setSelectedAgent}
        onOpenChange={(open) => {
          if (!open) setSelectedAgent(null)
        }}
      />
    </div>
  )
}

interface AgentCardProps {
  slug: string
  name: string
  description: string
  isOrchestrator: boolean
  isFavorite: boolean
  isLaunching: boolean
  onStartChat: () => void
  onToggleFavorite: () => void
  onConfigure: () => void
}

function AgentCard({
  slug,
  name,
  description,
  isOrchestrator,
  isFavorite,
  isLaunching,
  onStartChat,
  onToggleFavorite,
  onConfigure,
}: AgentCardProps) {
  const Icon = getAgentCardIcon(slug, name)

  return (
    <div className="group relative min-h-[88px]">
      <button
        type="button"
        onClick={onStartChat}
        disabled={isLaunching}
        className="relative flex min-h-[88px] w-full items-start gap-3 overflow-hidden rounded-[12px] border border-white/[0.09] bg-[#0f1011] px-3 py-3 pr-[78px] text-left transition-colors hover:border-white/[0.16] hover:bg-[#141516] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/55 disabled:cursor-wait"
        aria-label={`Start chat with ${name}`}
      >
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#fb923c] to-[#f97316] text-neutral-950">
          {isLaunching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3 w-3" />}
        </span>
        <span className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold tracking-tight text-white">
              {name}
            </h3>
            {isOrchestrator && (
              <span className="rounded-full border border-white/12 bg-white/[0.055] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/62">
                core
              </span>
            )}
          </div>
          <span className="mt-1 block line-clamp-2 text-[11.5px] leading-[17px] text-neutral-300/76">
            {description}
          </span>
        </span>
      </button>

      <div className={cn(
        'absolute right-2.5 top-2.5 z-10 flex items-center gap-0.5 rounded-[8px] bg-[#0f1011]/90 p-0.5 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
        isFavorite ? 'opacity-100' : 'opacity-0',
      )}>
        <button
          type="button"
          onClick={onToggleFavorite}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/55',
            isFavorite ? 'text-orange-300' : 'text-white/32 hover:text-white/72',
          )}
          aria-label={isFavorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
          aria-pressed={isFavorite}
        >
          <Star className={cn('h-3.5 w-3.5', isFavorite && 'fill-current')} />
        </button>
        <button
          type="button"
          onClick={onConfigure}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-white/32 transition-colors hover:bg-white/[0.07] hover:text-white/72 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/55"
          aria-label={`Configure ${name}`}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function DirectoryViewButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-medium transition-colors',
        active ? 'bg-white/[0.09] text-white' : 'text-white/42 hover:bg-white/[0.045] hover:text-white/72',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function WorkerDirectoryEmptyState({
  view,
  hasQuery,
  onReset,
}: {
  view: WorkerDirectoryView
  hasQuery: boolean
  onReset: () => void
}) {
  const message = hasQuery
    ? 'No workers match those filters.'
    : view === 'favorites'
      ? 'No favorite workers yet.'
      : 'No recently used workers yet.'

  return (
    <div className="rounded-[14px] border border-dashed border-white/[0.10] bg-white/[0.02] px-5 py-10 text-center">
      <p className="text-sm text-white/56">{message}</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-3 inline-flex h-8 items-center rounded-[8px] border border-white/[0.09] bg-white/[0.04] px-3 text-xs text-white/62 transition-colors hover:bg-white/[0.07] hover:text-white"
      >
        Show all workers
      </button>
    </div>
  )
}

function getAgentCardIcon(slug: string, name: string) {
  const text = `${slug} ${name}`.toLowerCase()
  if (text.includes('orchestr') || text.includes('router') || text.includes('hnic')) return Boxes
  if (text.includes('security') || text.includes('ads') || text.includes('compliance')) return Lock
  if (text.includes('workflow') || text.includes('project') || text.includes('ops')) return Kanban
  return Sparkles
}

interface WorkerDirectoryPreferencesFile {
  workerDirectory?: Record<string, {
    favorites?: string[]
    recent?: string[]
  }>
  updatedAt?: number
  [key: string]: unknown
}

function parseWorkerSlugs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

async function readWorkerPreferences(
  workspaceId: string | null | undefined,
): Promise<{ favorites: string[]; recent: string[] }> {
  try {
    const { content } = await window.electronAPI.readPreferences()
    const parsed = JSON.parse(content || '{}') as WorkerDirectoryPreferencesFile
    const workspacePreferences = parsed.workerDirectory?.[workspaceId ?? 'default']
    return {
      favorites: parseWorkerSlugs(workspacePreferences?.favorites),
      recent: parseWorkerSlugs(workspacePreferences?.recent),
    }
  } catch {
    return { favorites: [], recent: [] }
  }
}

let workerPreferenceWriteQueue = Promise.resolve()

function writeWorkerPreference(
  workspaceId: string | null | undefined,
  preference: 'favorites' | 'recent',
  slugs: string[],
) {
  const workspaceKey = workspaceId ?? 'default'
  workerPreferenceWriteQueue = workerPreferenceWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const { content } = await window.electronAPI.readPreferences()
      const parsed = JSON.parse(content || '{}') as WorkerDirectoryPreferencesFile
      const currentWorkspace = parsed.workerDirectory?.[workspaceKey] ?? {}
      const next: WorkerDirectoryPreferencesFile = {
        ...parsed,
        workerDirectory: {
          ...parsed.workerDirectory,
          [workspaceKey]: {
            ...currentWorkspace,
            [preference]: slugs,
          },
        },
        updatedAt: Date.now(),
      }
      const result = await window.electronAPI.writePreferences(JSON.stringify(next, null, 2))
      if (!result.success) throw new Error(result.error ?? 'Preference write failed')
    })
    .catch((error) => {
      console.warn('[Workers] Failed to save directory preferences:', error)
    })
}

interface AgentDetailDialogProps {
  agent: AgentDefinitionDTO | null
  workspaceId: string | null | undefined
  onAgentUpdated: (agent: AgentDefinitionDTO) => void
  onOpenChange: (open: boolean) => void
}

function AgentDetailDialog({ agent, workspaceId, onAgentUpdated, onOpenChange }: AgentDetailDialogProps) {
  const { getDisplayName } = useAgentDisplayNames()
  const { upsert } = useAgents(workspaceId)
  const availableSkills = useAtomValue(skillsAtom)
  const availableSources = useAtomValue(sourcesAtom)
  const [promptOpen, setPromptOpen] = React.useState(false)
  const [promptDraft, setPromptDraft] = React.useState('')
  const [promptSaving, setPromptSaving] = React.useState(false)
  const [bundlePicker, setBundlePicker] = React.useState<'skills' | 'sources' | null>(null)
  const [runtimePickerOpen, setRuntimePickerOpen] = React.useState(false)

  React.useEffect(() => {
    setPromptOpen(true)
    setPromptDraft(agent?.systemPrompt ?? '')
  }, [agent?.slug, agent?.systemPrompt])

  if (!agent) return null

  const name = cleanDisplayText(getDisplayName(agent))
  const description = cleanDisplayText(agent.metadata.description)
  const skills = agent.metadata.skills ?? []
  const tools = agent.metadata.sources ?? []
  const promptDirty = promptDraft !== (agent.systemPrompt || '')
  const handleSavePrompt = async () => {
    if (!promptDirty || promptSaving) return
    setPromptSaving(true)
    try {
      const updated = await upsert({
        slug: agent.slug,
        metadata: agent.metadata,
        systemPrompt: promptDraft,
      })
      onAgentUpdated(updated)
      toast.success('System prompt saved')
    } catch (err) {
      toast.error('Failed to save system prompt', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPromptSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(agent)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden !rounded-[18px] !border !border-white/[0.08] !bg-[#09090c] p-0 !text-white !shadow-modal-small">
        <DialogHeader className="border-b border-white/[0.06] bg-[radial-gradient(circle_at_18%_0%,rgba(249,115,22,0.20),transparent_34%),#0b0b0f] px-5 pb-3 pt-4">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-[13px] border border-white/[0.08] bg-white/[0.055] font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#fed7aa]">
            {name.slice(0, 2)}
          </div>
          <DialogTitle className="text-[20px] font-semibold leading-tight text-white">{name}</DialogTitle>
          <DialogDescription className="max-w-2xl text-sm leading-5 text-white/52">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(88vh-116px)] overflow-y-auto px-5 pb-4 pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <DetailTile
              label="LLM connection"
              value={agent.metadata.llmConnection ?? 'Workspace default'}
              onEdit={() => setRuntimePickerOpen(true)}
            />
            <DetailTile
              label="Model"
              value={agent.metadata.model ?? 'Provider default'}
              onEdit={() => setRuntimePickerOpen(true)}
            />
          </div>

          <section className="mt-3 rounded-[14px] border border-white/[0.07] bg-white/[0.035] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/42">
                <Sparkles className="h-3.5 w-3.5 text-[#fdba74]" />
                System prompt
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleSavePrompt()}
                  disabled={!promptDirty || promptSaving}
                  className="inline-flex h-7 items-center rounded-[8px] border border-[#fb923c]/25 bg-[#f97316]/18 px-2 text-[11px] font-medium text-white/82 transition-colors hover:bg-[#f97316]/26 disabled:cursor-default disabled:border-white/[0.06] disabled:bg-white/[0.035] disabled:text-white/28"
                >
                  {promptSaving ? 'Saving' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setPromptOpen(prev => !prev)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-white/38 transition-colors hover:bg-white/[0.06] hover:text-[#fed7aa]"
                  aria-label={promptOpen ? 'Collapse system prompt' : 'Expand system prompt'}
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${promptOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
            {promptOpen ? (
              <textarea
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                className="h-[220px] w-full resize-y rounded-[10px] border border-white/[0.08] bg-black/25 p-3 font-mono text-xs leading-5 text-white/74 outline-none transition-colors placeholder:text-white/24 focus:border-[#fb923c]/55"
                placeholder="Write this worker's system prompt..."
              />
            ) : (
              <button
                type="button"
                onClick={() => setPromptOpen(true)}
                className="block w-full rounded-[10px] border border-white/[0.06] bg-black/20 p-3 text-left text-xs leading-5 text-white/58 transition-colors hover:border-[#fb923c]/30 hover:bg-white/[0.045] hover:text-white/76"
              >
                <span className="line-clamp-2">{summarizePrompt(promptDraft)}</span>
              </button>
            )}
          </section>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <CapabilityBlock
              icon={<Zap className="h-3.5 w-3.5" />}
              title="Skills"
              items={skills}
              empty="No bundled skills"
              onAdd={() => setBundlePicker('skills')}
            />
            <CapabilityBlock
              icon={<DatabaseZap className="h-3.5 w-3.5" />}
              title="Tools"
              items={tools}
              empty="No bundled tools"
              onAdd={() => setBundlePicker('sources')}
            />
          </div>

          <AgentContextMemoryPanel agent={agent} workspaceId={workspaceId} />
        </div>
      </DialogContent>

      <AgentBundlePickerDialog
        open={bundlePicker !== null}
        type={bundlePicker}
        agent={agent}
        skills={availableSkills.map((skill) => ({
          slug: skill.slug,
          name: skill.metadata.name,
          description: skill.metadata.description,
          category: inferSkillCategory(skill.slug, skill.metadata.name, skill.metadata.description, skill.metadata.category),
        }))}
        sources={availableSources.map((source) => ({
          slug: source.config.slug,
          name: source.config.name,
          description: source.config.type ?? '',
          category: inferSourceCategory(source.config.slug, source.config.name, source.config.type ?? ''),
        }))}
        onOpenChange={(open) => {
          if (!open) setBundlePicker(null)
        }}
        onSave={async (type, selected) => {
          const updated = await upsert({
            slug: agent.slug,
            metadata: {
              ...agent.metadata,
              [type]: selected.length > 0 ? selected : undefined,
            },
            systemPrompt: agent.systemPrompt,
          })
          onAgentUpdated(updated)
          toast.success(type === 'skills' ? 'Worker skills updated' : 'Worker tools updated')
          setBundlePicker(null)
        }}
      />

      <AgentRuntimePickerDialog
        open={runtimePickerOpen}
        agent={agent}
        onOpenChange={setRuntimePickerOpen}
        onSave={async ({ llmConnection, model }) => {
          const updated = await upsert({
            slug: agent.slug,
            metadata: {
              ...agent.metadata,
              llmConnection: llmConnection.trim() || undefined,
              model: model.trim() || undefined,
            },
            systemPrompt: agent.systemPrompt,
          })
          onAgentUpdated(updated)
          toast.success('Worker runtime updated')
          setRuntimePickerOpen(false)
        }}
      />
    </Dialog>
  )
}

function DetailTile({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="rounded-[14px] border border-white/[0.1] bg-white/[0.04] p-3 shadow-middle">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/34">{label}</div>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-5 w-5 items-center justify-center rounded-[7px] text-white/38 transition-colors hover:bg-white/[0.06] hover:text-[#fed7aa]"
            aria-label={`Edit ${label.toLowerCase()}`}
          >
            <Plus className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <div className="mt-1.5 truncate text-sm font-medium text-white/82">{value}</div>
    </div>
  )
}

function AgentRuntimePickerDialog({
  open,
  agent,
  onOpenChange,
  onSave,
}: {
  open: boolean
  agent: AgentDefinitionDTO
  onOpenChange: (open: boolean) => void
  onSave: (payload: { llmConnection: string; model: string }) => Promise<void>
}) {
  const [connections, setConnections] = React.useState<LlmConnectionWithStatus[]>([])
  const [llmConnection, setLlmConnection] = React.useState('')
  const [model, setModel] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLlmConnection(agent.metadata.llmConnection ?? '')
    setModel(agent.metadata.model ?? '')
    window.electronAPI
      .listLlmConnectionsWithStatus()
      .then((rows) => {
        if (!cancelled) setConnections(rows)
      })
      .catch(() => {
        if (!cancelled) setConnections([])
      })
    return () => { cancelled = true }
  }, [agent.metadata.llmConnection, agent.metadata.model, open])

  const selectedConnection = React.useMemo(() => {
    if (llmConnection) return connections.find((connection) => connection.slug === llmConnection)
    return connections.find((connection) => connection.isDefault)
  }, [connections, llmConnection])

  const modelOptions = React.useMemo(() => getRuntimeModelOptions(selectedConnection), [selectedConnection])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({ llmConnection, model })
    } catch (err) {
      toast.error('Failed to update runtime', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden !rounded-[16px] !border !border-white/[0.08] !bg-[#09090c] p-0 !text-white !shadow-modal-small">
        <DialogHeader className="border-b border-white/[0.06] bg-[#0b0b0f] px-5 py-4">
          <DialogTitle className="text-lg font-semibold text-white">Edit runtime</DialogTitle>
          <DialogDescription className="text-sm text-white/48">
            Set this worker&apos;s connection and model override.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-white/42">
              LLM connection
            </span>
            <select
              value={llmConnection}
              onChange={(event) => {
                setLlmConnection(event.target.value)
                setModel('')
              }}
              className="h-10 w-full rounded-[10px] border border-white/[0.09] bg-white/[0.045] px-3 text-sm text-white outline-none transition-colors hover:bg-white/[0.06] focus:border-[#fb923c]/55"
            >
              <option value="">Workspace default</option>
              {connections.map((connection) => (
                <option key={connection.slug} value={connection.slug}>
                  {formatConnectionOption(connection)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-white/42">
              Model
            </span>
            <select
              value={modelOptions.some((option) => option.value === model) ? model : ''}
              onChange={(event) => setModel(event.target.value)}
              className="h-10 w-full rounded-[10px] border border-white/[0.09] bg-white/[0.045] px-3 text-sm text-white outline-none transition-colors hover:bg-white/[0.06] focus:border-[#fb923c]/55"
            >
              <option value="">Provider default</option>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Custom model id"
              className="mt-2 h-10 w-full rounded-[10px] border border-white/[0.09] bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/28 hover:bg-white/[0.04] focus:border-[#fb923c]/55"
            />
          </label>

          <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.025] p-3 text-xs leading-5 text-white/42">
            API key and logged-in status come from saved RunnerOS connections. Leave both fields default to inherit the workspace setup.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-[9px] border-white/[0.10] bg-transparent px-3 text-xs text-white/70 hover:bg-white/[0.06]"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-8 rounded-[9px] bg-[#f97316] px-3 text-xs text-white hover:bg-[#fb923c]"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CapabilityBlock({
  icon,
  title,
  items,
  empty,
  onAdd,
}: {
  icon: React.ReactNode
  title: string
  items: string[]
  empty: string
  onAdd?: () => void
}) {
  return (
    <section className="rounded-[14px] border border-white/[0.07] bg-white/[0.035] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/42">
          <span className="text-[#fdba74]">{icon}</span>
          {title}
        </div>
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-5 w-5 items-center justify-center rounded-[7px] text-white/38 transition-colors hover:bg-white/[0.06] hover:text-[#fed7aa]"
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            <Plus className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className="rounded-full border border-white/[0.07] bg-white/[0.045] px-2 py-0.5 text-[11px] text-white/62"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-xs text-white/34">{empty}</div>
      )}
    </section>
  )
}

interface BundleOption {
  slug: string
  name: string
  description?: string
  category: string
}

interface AgentBundlePickerDialogProps {
  open: boolean
  type: 'skills' | 'sources' | null
  agent: AgentDefinitionDTO
  skills: BundleOption[]
  sources: BundleOption[]
  onOpenChange: (open: boolean) => void
  onSave: (type: 'skills' | 'sources', selected: string[]) => Promise<void>
}

function AgentBundlePickerDialog({
  open,
  type,
  agent,
  skills,
  sources,
  onOpenChange,
  onSave,
}: AgentBundlePickerDialogProps) {
  const [selected, setSelected] = React.useState<string[]>([])
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(new Set())
  const [saving, setSaving] = React.useState(false)
  const options = type === 'skills' ? skills : type === 'sources' ? sources : []
  const groupedOptions = React.useMemo(() => groupBundleOptions(options), [options])

  React.useEffect(() => {
    if (!open || !type) return
    const current = type === 'skills' ? agent.metadata.skills ?? [] : agent.metadata.sources ?? []
    setSelected(current)
    setOpenGroups(new Set())
  }, [agent.metadata.skills, agent.metadata.sources, open, type])

  if (!type) return null

  const selectedSet = new Set(selected)
  const title = type === 'skills' ? 'Edit skills' : 'Edit tools'

  const handleToggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return Array.from(next)
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(type, selected)
    } catch (err) {
      toast.error(type === 'skills' ? 'Failed to update skills' : 'Failed to update tools', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  const toggleGroup = (category: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[72vh] max-w-lg overflow-hidden !rounded-[16px] !border !border-white/[0.08] !bg-[#09090c] p-0 !text-white !shadow-modal-small">
        <DialogHeader className="border-b border-white/[0.06] bg-[#0b0b0f] px-5 py-4">
          <DialogTitle className="text-lg font-semibold text-white">{title}</DialogTitle>
          <DialogDescription className="text-sm text-white/48">
            Choose what this worker carries into new sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[46vh] space-y-2 overflow-y-auto px-5 py-4">
          {options.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-white/[0.10] p-5 text-center text-xs text-white/38">
              No {type === 'skills' ? 'skills' : 'tools'} available.
            </div>
          ) : (
            groupedOptions.map((group) => {
              const isOpen = openGroups.has(group.category)
              const selectedCount = group.items.filter((item) => selectedSet.has(item.slug)).length
              return (
                <div key={group.category} className="overflow-hidden rounded-[13px] border border-white/[0.065] bg-white/[0.025]">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.category)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/48">
                      {group.category}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-white/32">
                      {selectedCount > 0 ? `${selectedCount} selected` : group.items.length}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="space-y-1.5 border-t border-white/[0.055] p-2">
                      {group.items.map((option) => (
                        <label
                          key={option.slug}
                          className="flex cursor-pointer items-start gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/[0.045]"
                        >
                          <input
                            type="checkbox"
                            checked={selectedSet.has(option.slug)}
                            onChange={() => handleToggle(option.slug)}
                            className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[#fb923c]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-white">{cleanDisplayText(option.name)}</div>
                            {option.description ? (
                              <div className="mt-0.5 truncate text-xs text-white/40">{cleanDisplayText(option.description)}</div>
                            ) : null}
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-[9px] border-white/[0.10] bg-transparent px-3 text-xs text-white/70 hover:bg-white/[0.06]"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-8 rounded-[9px] bg-[#f97316] px-3 text-xs text-white hover:bg-[#fb923c]"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AgentContextMemoryPanel({
  agent,
  workspaceId,
}: {
  agent: AgentDefinitionDTO
  workspaceId: string | null | undefined
}) {
  const { entries, loading, error, warning, upsert, remove } = useAgentMemory(agent.slug)
  const { docs, upsert: upsertContextDoc } = useWorkspaceContext(workspaceId)
  const [editingEntry, setEditingEntry] = React.useState<MemoryEntry | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [contextPickerOpen, setContextPickerOpen] = React.useState(false)
  const visibleDocs = React.useMemo(
    () => docs.filter((doc) => isContextDocVisibleToAgent(doc, agent.slug)),
    [agent.slug, docs],
  )

  return (
    <section className="mt-3 rounded-[14px] border border-white/[0.07] bg-white/[0.035] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/42">
          <BookOpen className="h-3.5 w-3.5 text-[#fdba74]" />
          Context & Memory
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 rounded-[8px] border border-white/[0.08] bg-white/[0.045] px-2.5 text-xs text-white/72 hover:bg-white/[0.08] hover:text-white"
            onClick={() => setContextPickerOpen(true)}
          >
            Context
          </Button>
          <Button
            size="sm"
            className="h-7 rounded-[8px] bg-[#f97316] px-2.5 text-xs text-white hover:bg-[#fb923c]"
            onClick={() => {
              setEditingEntry(null)
              setDialogOpen(true)
            }}
          >
            Add memory
          </Button>
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/34">
          Context
        </div>
        {visibleDocs.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-white/[0.10] p-2.5 text-xs text-white/38">
            No context docs routed to this worker.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visibleDocs.map((doc) => (
              <span
                key={doc.slug}
                className="rounded-full border border-white/[0.07] bg-white/[0.045] px-2 py-1 text-[11px] text-white/62"
              >
                {cleanDisplayText(doc.metadata.name)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/34">
        Memory
      </div>

      {loading ? (
        <div className="text-xs text-white/38">Loading memory...</div>
      ) : error ? (
        <div className="text-xs text-red-300">{error}</div>
      ) : (
        <>
          {warning ? <div className="mb-2 text-xs text-amber-300">{warning}</div> : null}
          {entries.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-white/[0.10] p-2.5 text-xs text-white/38">
              No memory yet.
            </div>
          ) : (
            <div className="space-y-2">
              {entries.slice(0, 3).map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => {
                    setEditingEntry(entry)
                    setDialogOpen(true)
                  }}
                  className="block w-full rounded-[10px] border border-white/[0.06] bg-black/20 p-2.5 text-left transition-colors hover:border-[#fb923c]/30 hover:bg-white/[0.045]"
                >
                  <div className="truncate text-xs font-medium text-white/78">{entry.name}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/42">{entry.body}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <MemoryEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editingEntry}
        scopeLabel={`${cleanDisplayText(agent.metadata.name)} MEMORY.md`}
        onSave={upsert}
      />

      <AgentContextPickerDialog
        open={contextPickerOpen}
        agent={agent}
        docs={docs}
        onOpenChange={setContextPickerOpen}
        onSave={async (selectedTargetedSlugs) => {
          const selected = new Set(selectedTargetedSlugs)
          const mutations = docs
            .flatMap((doc) => {
              if (doc.metadata.routing.mode !== 'targeted') return []
              const currentAgents = new Set<string>(doc.metadata.routing.agents)
              const shouldInclude = selected.has(doc.slug)
              if (shouldInclude) currentAgents.add(agent.slug)
              else currentAgents.delete(agent.slug)
              return [upsertContextDoc({
                slug: doc.slug,
                metadata: {
                  ...doc.metadata,
                  routing: { mode: 'targeted', agents: Array.from(currentAgents).sort() },
                },
                body: doc.body,
              })]
            })
          await Promise.all(mutations)
          toast.success('Worker context updated')
          setContextPickerOpen(false)
        }}
      />
    </section>
  )
}

function AgentContextPickerDialog({
  open,
  agent,
  docs,
  onOpenChange,
  onSave,
}: {
  open: boolean
  agent: AgentDefinitionDTO
  docs: ContextDocDTO[]
  onOpenChange: (open: boolean) => void
  onSave: (selectedTargetedSlugs: string[]) => Promise<void>
}) {
  const [selectedTargeted, setSelectedTargeted] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setSelectedTargeted(
      docs
        .filter((doc) => doc.metadata.routing.mode === 'targeted' && doc.metadata.routing.agents.includes(agent.slug))
        .map((doc) => doc.slug),
    )
  }, [agent.slug, docs, open])

  const selectedSet = new Set(selectedTargeted)
  const broadcastDocs = docs.filter((doc) => doc.metadata.enabled && doc.metadata.routing.mode === 'broadcast')
  const targetedDocs = docs.filter((doc) => doc.metadata.enabled && doc.metadata.routing.mode === 'targeted')

  const toggle = (slug: string) => {
    setSelectedTargeted((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return Array.from(next)
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(selectedTargeted)
    } catch (err) {
      toast.error('Failed to update context', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[72vh] max-w-lg overflow-hidden !rounded-[16px] !border !border-white/[0.08] !bg-[#09090c] p-0 !text-white !shadow-modal-small">
        <DialogHeader className="border-b border-white/[0.06] bg-[#0b0b0f] px-5 py-4">
          <DialogTitle className="text-lg font-semibold text-white">Edit context</DialogTitle>
          <DialogDescription className="text-sm text-white/48">
            Broadcast docs are already visible to every worker. Choose targeted docs for this one.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[46vh] space-y-4 overflow-y-auto px-5 py-4">
          {broadcastDocs.length > 0 ? (
            <ContextDocGroup title="All workers" docs={broadcastDocs} locked />
          ) : null}
          <ContextDocGroup
            title="Targeted docs"
            docs={targetedDocs}
            selectedSet={selectedSet}
            onToggle={toggle}
            empty="No targeted context docs yet."
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-[9px] border-white/[0.10] bg-transparent px-3 text-xs text-white/70 hover:bg-white/[0.06]"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-8 rounded-[9px] bg-[#f97316] px-3 text-xs text-white hover:bg-[#fb923c]"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ContextDocGroup({
  title,
  docs,
  selectedSet,
  onToggle,
  locked,
  empty,
}: {
  title: string
  docs: ContextDocDTO[]
  selectedSet?: Set<string>
  onToggle?: (slug: string) => void
  locked?: boolean
  empty?: string
}) {
  return (
    <section>
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/42">{title}</div>
      {docs.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-white/[0.10] p-4 text-center text-xs text-white/38">
          {empty ?? 'No context docs.'}
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <label
              key={doc.slug}
              className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3"
            >
              <input
                type="checkbox"
                checked={locked ? true : selectedSet?.has(doc.slug) ?? false}
                disabled={locked}
                onChange={() => onToggle?.(doc.slug)}
                className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[#fb923c] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{cleanDisplayText(doc.metadata.name)}</div>
                {doc.metadata.description ? (
                  <div className="mt-0.5 truncate text-xs text-white/40">{cleanDisplayText(doc.metadata.description)}</div>
                ) : null}
              </div>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}

interface EmptyStateProps {
  allAgentsCount: number
  onOpenLibrary: () => void
}

function EmptyState({ allAgentsCount, onOpenLibrary }: EmptyStateProps) {
  return (
    <div className="rounded-[18px] border border-dashed border-white/[0.15] bg-white/[0.02] p-8 text-center">
      <p className="text-sm text-white/70">
        No workers are active in this workspace yet.
      </p>
      <p className="mt-1 mb-4 text-xs text-white/50">
        {allAgentsCount > 0
          ? 'Activate a worker from the library to use it here.'
          : 'Create a new worker or open the library.'}
      </p>
      {allAgentsCount > 0 && (
        <button
          type="button"
          onClick={onOpenLibrary}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.10] bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/75 hover:bg-white/[0.08]"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Open library
        </button>
      )}
    </div>
  )
}

function groupBundleOptions(options: BundleOption[]) {
  const groups = new Map<string, BundleOption[]>()
  for (const option of options) {
    const items = groups.get(option.category) ?? []
    items.push(option)
    groups.set(option.category, items)
  }

  return Array.from(groups.entries())
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => bundleCategoryRank(a.category) - bundleCategoryRank(b.category) || a.category.localeCompare(b.category))
}

function bundleCategoryRank(category: string) {
  const order = [
    'Core operations',
    'Research & analysis',
    'Content & marketing',
    'Creative production',
    'Development',
    'Local tools',
    'MCP tools',
    'Data & APIs',
    'Other',
  ]
  const index = order.indexOf(category)
  return index === -1 ? order.length : index
}

function inferSkillCategory(slug: string, name: string, description?: string, category?: string) {
  if (category === 'founder') return 'Founder'
  if (category === 'content-generation' || category === 'marketing') return 'Content & marketing'
  const text = `${slug} ${name} ${description ?? ''}`.toLowerCase()
  if (matchesAny(text, ['100m-', 'blue-ocean-strategy', 'crossing-the-chasm', 'four-steps', 'lean-startup', 'mom-test', 'monetizing-innovation', 'obviously-awesome', 'spin-selling', 'storybrand', 'traction'])) return 'Founder'
  if (matchesAny(text, ['research', 'competitor', 'customer', 'profile', 'analyze', 'analysis', 'audit', 'spy', 'perspective'])) return 'Research & analysis'
  if (matchesAny(text, ['meta ads', 'meta-ads', 'facebook ads'])) return 'Content & marketing'
  if (matchesAny(text, ['marketing', 'content', 'copy', 'ads', 'seo', 'viral', 'twitter', 'tweet', 'x-', 'pricing', 'lead'])) return 'Content & marketing'
  if (matchesAny(text, ['creative', 'video', 'image', '3d', 'design', 'brand', 'visual', 'hyperframes'])) return 'Creative production'
  if (matchesAny(text, ['code', 'api', 'database', 'dev', 'react', 'typescript', 'debug', 'test', 'deploy', 'github'])) return 'Development'
  if (matchesAny(text, ['runneros', 'workflow', 'automation', 'source', 'orchestration', 'routing'])) return 'Core operations'
  return 'Other'
}

function inferSourceCategory(slug: string, name: string, type: string) {
  const text = `${slug} ${name} ${type}`.toLowerCase()
  if (type.toLowerCase() === 'local' || matchesAny(text, ['local', 'filesystem', 'bash', 'computer'])) return 'Local tools'
  if (type.toLowerCase() === 'mcp' || text.includes('mcp')) return 'MCP tools'
  if (matchesAny(text, ['api', 'exa', 'search', 'ads', 'data'])) return 'Data & APIs'
  return 'Other'
}

function matchesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle))
}

function getRuntimeModelOptions(connection: LlmConnectionWithStatus | undefined) {
  if (!connection) return []

  const models = connection.models && connection.models.length > 0
    ? connection.models
    : getModelsForProviderType(connection.providerType, connection.piAuthProvider)

  return models.map((entry) => {
    if (typeof entry === 'string') {
      return { value: entry, label: getModelShortName(entry) }
    }
    const model = entry as ModelDefinition
    return { value: model.id, label: model.name || getModelShortName(model.id) }
  })
}

function formatConnectionOption(connection: LlmConnectionWithStatus) {
  const status = connection.isAuthenticated ? 'ready' : 'not signed in'
  const defaultLabel = connection.isDefault ? 'default, ' : ''
  return `${connection.name} (${defaultLabel}${status})`
}

function isContextDocVisibleToAgent(doc: ContextDocDTO, agentSlug: string) {
  if (!doc.metadata.enabled) return false
  if (doc.metadata.routing.mode === 'broadcast') return true
  return doc.metadata.routing.agents.includes(agentSlug)
}

function getAgentDomain(tags: string[] | undefined, slug: string, name: string, description?: string) {
  if (slug === 'setup-concierge') {
    return 'Command'
  }

  if (slug === 'industry-hunter' || slug === 'comms-agent' || slug === 'outreach-agent' || slug === 'college-radio-agent') {
    return 'Outreach'
  }

  if (slug === 'branding-agent' || slug === 'world-builder') {
    return 'Brand & Story'
  }

  if (slug === 'persona-agent' || slug === 'content-genius' || slug === 'record-doctor' || slug === 'art-director') {
    return 'Creative'
  }

  if (slug === 'anticipation-director' || slug === 'content-director') {
    return 'Content Creation'
  }

  if (slug === 'youtube-research-agent' || slug === 'youtube-intelligence-agent' || slug === 'spotify-analyst') {
    return 'Research'
  }

  if (
    slug === 'ig-trending-power-up'
    || slug === 'influencer-campaign-power-up'
    || slug === 'playlisting-power-up'
    || slug === 'spotify-playlist-creator'
  ) {
    return 'Promotion'
  }

  const joined = `${slug} ${name} ${description ?? ''} ${(tags ?? []).join(' ')}`.toLowerCase()
  if (matchesAny(joined, ['social publisher', 'trypost', 'socials', 'social posting', 'posting', 'publisher'])) return 'Socials'
  if (matchesAny(joined, ['scroll stopper', 'scroll-stopper', 'content genius', 'hypermotion', 'lottie', 'video director', 'video editor', '3d agent', '3dcellforge', 'motion', 'caption', 'clip', 'shortform'])) return 'Content Creation'
  if (matchesAny(joined, ['anr', 'a&r', 'industry', 'artist development', 'label operator', 'labels', 'sync', 'outreach', 'comms', 'press', 'email'])) return 'Outreach'
  if (matchesAny(joined, ['ads', 'marketing', 'campaign', 'growth', 'meta ads', 'google ads', 'power-up', 'power up', 'service-handoff', 'ig trending', 'influencer campaign', 'playlisting power'])) return 'Promotion'
  if (matchesAny(joined, ['shopify', 'printify', 'print agent', 'merch', 'storefront', 'commerce', 'pod', 'apparel'])) return 'Merch'
  if (matchesAny(joined, ['legendary', 'gaygent', 'brand', 'copy', 'creative direction', 'positioning', 'persona'])) return 'Creative'
  if (matchesAny(joined, ['spotify', 'playlist', 'youtube intelligence', 'youtube research', 'audience', 'research', 'analy', 'insight'])) return 'Research'
  if (matchesAny(joined, ['workflow', 'ops', 'orchestr', 'router', 'guide', 'chat', 'routing'])) return 'Command'
  if (matchesAny(joined, ['code', 'tool', 'diagnostic', 'reporting'])) return 'Operators'
  return 'Other Workers'
}

function agentDomainRank(domain: string) {
  const order = [
    'Creative',
    'Brand & Story',
    'Content Creation',
    'Socials',
    'Promotion',
    'Outreach',
    'Merch',
    'Research',
    'Command',
    'Operators',
    'Other Workers',
  ]
  const index = order.indexOf(domain)
  return index === -1 ? order.length : index
}

function isSystemAgent(slug: string) {
  return slug === CONCIERGE_SLUG || slug === ORCHESTRATOR_SLUG || slug === 'update-system-agent'
}

function isHiddenFromWorkerHome(slug: string) {
  return HIDDEN_WORKER_HOME_AGENT_SLUGS.has(slug)
}

const HIDDEN_WORKER_HOME_AGENT_SLUGS = new Set([
  '3d-agent',
  'hypermotion-agent',
  'lottie-animation-agent',
  'open-slide-agent',
  'researcher',
])

function dedupeLaunchpadAgents(agents: AgentDefinitionDTO[]): AgentDefinitionDTO[] {
  const bestByKey = new Map<string, AgentDefinitionDTO>()
  for (const agent of agents) {
    const key = canonicalAgentKey(agent)
    const current = bestByKey.get(key)
    if (!current || launchpadAgentRank(agent.slug) < launchpadAgentRank(current.slug)) {
      bestByKey.set(key, agent)
    }
  }
  return Array.from(bestByKey.values())
}

function canonicalAgentKey(agent: AgentDefinitionDTO): string {
  if (agent.slug === 'ads-agent' || agent.slug === 'meta-ads-agent') return 'ads-agent'
  return agent.slug
}

function launchpadAgentRank(slug: string): number {
  const preferred = [
    'ads-agent',
    'ig-trending-power-up',
    'influencer-campaign-power-up',
    'playlisting-power-up',
    'spotify-analyst',
    'spotify-playlist-creator',
    'content-genius',
    'hypermotion-agent',
    'lottie-animation-agent',
    'video-director',
    'video-editor-agent',
    '3d-agent',
    'social-publisher',
    'trypost-agent',
    'postiz-agent',
    'shopify-agent',
    'print-agent',
    'gaygent-master',
    'persona-agent',
    'youtube-intelligence-agent',
    'youtube-research-agent',
    'setup-concierge',
  ]
  const index = preferred.indexOf(slug)
  return index === -1 ? preferred.length : index
}

function compareLaunchpadAgents(
  a: AgentDefinitionDTO,
  b: AgentDefinitionDTO,
  defaultOrder: Map<string, number>,
  getDisplayName: (agent: AgentDefinitionDTO) => string,
): number {
  const aDefaultIndex = defaultOrder.get(a.slug)
  const bDefaultIndex = defaultOrder.get(b.slug)
  if (aDefaultIndex !== undefined && bDefaultIndex !== undefined) {
    return aDefaultIndex - bDefaultIndex
  }
  if (aDefaultIndex !== undefined) return -1
  if (bDefaultIndex !== undefined) return 1
  return getDisplayName(a).localeCompare(getDisplayName(b))
}

function cleanDisplayText(value: string) {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function summarizePrompt(prompt: string) {
  const cleaned = cleanDisplayText(prompt).replace(/^#+\s*/gm, '').trim()
  if (!cleaned) return 'No system prompt set.'
  if (cleaned.length <= 260) return cleaned
  return `${cleaned.slice(0, 260).trim()}...`
}

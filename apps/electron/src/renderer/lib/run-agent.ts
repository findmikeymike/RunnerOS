import { toast } from 'sonner'
import { navigate, routes } from '@/lib/navigate'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import { isSourceUsable } from '@craft-agent/shared/sources/availability'
import { buildAgentTaskModePromptSection, filterContextDocsForTaskMode, resolveAgentTaskMode, selectTaskModeSourceSlugs } from '@craft-agent/shared/agent-definitions/task-modes'
import type { MemoryEntry, LoadedMemoryFile } from '@craft-agent/shared/memory/types'
import type { SessionLogEntry } from '@craft-agent/shared/sessions-log'
import { selectActiveMemoryEntries } from '@craft-agent/shared/memory/render'
import { resolveAgentReferences, hasMissingReferences, describeMissingReferences } from '@/lib/agent-references'
import { composeAgentSystemPrompt, managerBriefReceiptFromDocs } from '@/lib/compose-agent-prompt'
import type { AgentDefinitionDTO, ContextDocDTO, CreateSessionOptions, Session, SkillDescriptor, LoadedSource } from '../../shared/types'

/**
 * Look up the Artist OS workspace kind for a workspace id.
 *
 * Returns undefined — never throws — when the lookup fails or the workspace has
 * no scope, so prompt composition falls back to its heuristic instead of the
 * launch failing over a piece of metadata.
 */
export async function resolveArtistWorkspaceScope(
  workspaceId: string,
  getWorkspaces: () => Promise<Array<{ id: string; artistWorkspaceScope?: string }>> =
    () => window.electronAPI.getWorkspaces(),
): Promise<'hq' | 'campaign' | 'lab' | 'general' | undefined> {
  try {
    const scope = (await getWorkspaces()).find((workspace) => workspace.id === workspaceId)?.artistWorkspaceScope
    return scope === 'hq' || scope === 'campaign' || scope === 'lab' || scope === 'general' ? scope : undefined
  } catch {
    return undefined
  }
}

export async function ensureAgentDeclaredSkillsEnabled(params: {
  agent: AgentDefinitionDTO
  workspaceId: string
  activeSkills: SkillDescriptor[]
  listGlobalSkills?: (workspaceId: string) => Promise<SkillDescriptor[]>
  setGlobalSkillEnabled?: (workspaceId: string, skillSlug: string, enabled: boolean) => Promise<string[]>
  getSkills?: (workspaceId: string) => Promise<SkillDescriptor[]>
}): Promise<SkillDescriptor[]> {
  const declaredSkillSlugs = params.agent.metadata.skills ?? []
  if (declaredSkillSlugs.length === 0) return params.activeSkills

  const activeSlugs = new Set(params.activeSkills.flatMap(skill => [skill.slug, ...(skill.aliases ?? [])]))
  const missingSlugs = declaredSkillSlugs.filter((slug) => !activeSlugs.has(slug))
  if (missingSlugs.length === 0) return params.activeSkills

  const listGlobalSkills = params.listGlobalSkills ?? window.electronAPI.listGlobalSkills
  const setGlobalSkillEnabled = params.setGlobalSkillEnabled ?? window.electronAPI.setGlobalSkillEnabled
  const getSkills = params.getSkills ?? window.electronAPI.getSkills
  const globalSkills = await listGlobalSkills(params.workspaceId)
  const installedGlobalSlugs = new Set(globalSkills.flatMap(skill => [skill.slug, ...(skill.aliases ?? [])]))
  const installedMissingSlugs = missingSlugs.filter((slug) => installedGlobalSlugs.has(slug))
  if (installedMissingSlugs.length === 0) return params.activeSkills

  // Write sequentially because each update reads and rewrites the workspace's
  // enabled-global-skills manifest. Parallel writes could lose a sibling slug.
  for (const slug of installedMissingSlugs) {
    await setGlobalSkillEnabled(params.workspaceId, slug, true)
  }

  return getSkills(params.workspaceId)
}

function assertFocusedAgentReferences(agent: AgentDefinitionDTO, label: string, skills: SkillDescriptor[], sources: LoadedSource[]): void {
  const resolution = resolveAgentReferences(agent, skills, sources)
  const unusable = (agent.metadata.sources ?? []).filter(slug => {
    const source = sources.find(source => source.config.slug === slug)
    return source && !isSourceUsable(source)
  })
  const problems = [
    ...resolution.missingSkills.map(slug => `missing skill @${slug}`),
    ...resolution.missingSources.map(slug => `missing connection @${slug}`),
    ...unusable.map(slug => `disabled or disconnected @${slug}`),
  ]
  if (problems.length) throw new Error(`${agent.metadata.name} — ${label} needs ${problems.join(', ')}. Fix the listed Skills or Connections, then retry this focus.`)
}

export function buildAgentCreateSessionOptions(
  agent: AgentDefinitionDTO,
  /**
   * Optional live skill / source snapshots. When provided:
   *   - missing slugs are dropped from `agentSkillSlugs` / `enabledSourceSlugs`
   *     so the session doesn't try to activate things that don't exist
   *   - the system prompt gets a generated footer enumerating each bundled
   *     skill + tool with their description (so the LLM has clear "here's
   *     your menu" guidance, not just an opaque list of slugs)
   * When omitted (legacy callers), all declared slugs pass through verbatim
   * and no footer is generated.
   */
  context?: {
    skills: SkillDescriptor[]
    sources: LoadedSource[]
    contextDocs?: ContextDocDTO[]
    agentCatalog?: AgentDefinitionDTO[]
    userMemoryEntries?: MemoryEntry[]
    agentMemoryEntries?: MemoryEntry[]
    recentSessions?: SessionLogEntry[]
    currentWorkspaceId?: string
    /**
     * Which kind of Artist OS workspace this session runs in. The server path
     * has always passed this; the chat path did not, and fell back to sniffing
     * sentinel context docs to decide whether the asset contract applies. Once
     * those docs went on-demand the sniff had nothing to fire on, so a
     * chat-launched worker in a campaign silently lost the contract while a
     * workflow-launched one kept it.
     */
    artistWorkspaceScope?: 'hq' | 'campaign' | 'lab' | 'general'
  },
  taskModeId?: string,
): CreateSessionOptions {
  const taskMode = resolveAgentTaskMode(agent, taskModeId ?? (agent.slug === CONCIERGE_SLUG && agent.metadata.taskModes?.some(mode => mode.id === 'just-talk') ? 'just-talk' : undefined))
  const promptAgent = taskMode
    ? {
        ...agent,
        metadata: {
          ...agent.metadata,
          skills: taskMode.primarySkillSlugs,
          sources: taskMode.requiredSourceSlugs,
          optionalSources: taskMode.optionalSourceSlugs,
        },
      }
    : agent.slug === CONCIERGE_SLUG
      ? { ...agent, metadata: { ...agent.metadata, skills: ['artist-manager-operating-system'] } }
      : agent
  if (taskMode) {
    if (!context) throw new Error(`Load current Skills and Connections before starting ${agent.metadata.name} — ${taskMode.label}.`)
    assertFocusedAgentReferences(promptAgent, taskMode.label, context.skills, context.sources)
  }
  const contextDocs = filterContextDocsForTaskMode(context?.contextDocs ?? [], taskMode)
  let skillSlugs = promptAgent.metadata.skills ?? []
  let sourceSlugs = [
    ...(promptAgent.metadata.sources ?? []),
    ...(promptAgent.metadata.optionalSources ?? []),
  ]
  let promptSources = context?.sources ?? []

  if (context) {
    const resolution = resolveAgentReferences(promptAgent, context.skills, context.sources)
    skillSlugs = resolution.resolvedSkills
    sourceSlugs = [...resolution.resolvedSources, ...resolution.resolvedOptionalSources]
    const includedSourceSlugs = new Set(sourceSlugs)
    promptSources = context.sources.filter((source) => includedSourceSlugs.has(source.config.slug))
  }

  if (taskMode) {
    sourceSlugs = selectTaskModeSourceSlugs(taskMode, sourceSlugs)
    const selectedSources = new Set(sourceSlugs)
    promptSources = promptSources.filter(source => selectedSources.has(source.config.slug))
  }

  // Compose the prompt: persona body + workspace context + bundle footer.
  // Each section is optional; pure absence collapses cleanly.
  const composedPrompt = context
    ? composeAgentSystemPrompt(
        promptAgent,
        context.skills,
        promptSources,
        contextDocs,
        (taskMode && agent.slug !== CONCIERGE_SLUG ? [] : context.agentCatalog ?? []).map((a) => ({
          slug: a.slug,
          name: a.metadata.name,
          description: a.metadata.description,
          inputs: a.metadata.inputs,
          outputs: a.metadata.outputs,
          visualAgent: a.metadata.visualAgent,
          tags: a.metadata.tags,
          routing: a.metadata.routing,
        })),
        {
          userMemoryEntries: context.userMemoryEntries,
          agentMemoryEntries: context.agentMemoryEntries,
          artistWorkspaceScope: context.artistWorkspaceScope,
          recentSessions: context.recentSessions,
          currentWorkspaceId: context.currentWorkspaceId,
          taskMode,
        },
      )
    : [agent.systemPrompt, buildAgentTaskModePromptSection(taskMode)].filter(Boolean).join("\n\n")
  const isConcierge = agent.slug === CONCIERGE_SLUG
  const agentCatalog = taskMode && agent.slug !== CONCIERGE_SLUG ? [] : context?.agentCatalog ?? []
  const managerBriefReceipt = managerBriefReceiptFromDocs(contextDocs)

  const options: CreateSessionOptions = {
    customSystemPrompt: composedPrompt || undefined,
    agentSkillSlugs: taskMode ? skillSlugs : skillSlugs.length ? skillSlugs : undefined,
    enabledSourceSlugs: taskMode ? sourceSlugs : sourceSlugs.length ? sourceSlugs : undefined,
    trustedWorkerTools: agent.metadata.trustedWorkerTools?.length ? agent.metadata.trustedWorkerTools : undefined,
    llmConnection: agent.metadata.llmConnection,
    model: agent.metadata.model,
    permissionMode: agent.metadata.permissionMode,
    thinkingLevel: agent.metadata.thinkingLevel,
    spawnedFromAgent: {
      agentSlug: agent.slug,
      agentName: agent.metadata.name,
      timestamp: Date.now(),
    },
    launchReceipt: {
      createdAt: Date.now(),
      origin: isConcierge ? 'concierge' : 'agent',
      summary: isConcierge ? 'Campaign chat session.' : `Started from @${agent.slug}.`,
      agent: {
        slug: agent.slug,
        name: agent.metadata.name,
        description: agent.metadata.description,
        inputs: agent.metadata.inputs,
        outputs: agent.metadata.outputs,
        tags: agent.metadata.tags,
      },
      ...(taskMode
        ? {
            taskMode: {
              schemaVersion: 1 as const,
              id: taskMode.id,
              label: taskMode.label,
              definitionRevision: taskMode.definitionRevision,
              selectionSource: 'user' as const,
              primarySkills: taskMode.primarySkillSlugs,
              adjacentSkills: taskMode.adjacentSkills,
              fullMode: taskMode.fullMode,
            },
          }
        : {}),
      config: {
        llmConnection: agent.metadata.llmConnection,
        model: agent.metadata.model,
        permissionMode: agent.metadata.permissionMode,
        thinkingLevel: agent.metadata.thinkingLevel,
      },
      injected: {
        systemPromptChars: composedPrompt.length,
        skills: skillSlugs,
        sources: sourceSlugs,
        trustedWorkerTools: agent.metadata.trustedWorkerTools ?? [],
        contextDocs: contextDocs.map((doc) => ({
          slug: doc.slug,
          name: doc.metadata.name,
        })),
        ...(managerBriefReceipt ? { managerBrief: managerBriefReceipt } : {}),
        memory: {
          user: selectActiveMemoryEntries(context?.userMemoryEntries ?? []).map((entry) => ({ name: memoryEntryTitle(entry) })),
          agent: selectActiveMemoryEntries(context?.agentMemoryEntries ?? []).map((entry) => ({ name: memoryEntryTitle(entry) })),
        },
        ...(agentCatalog.length > 0
          ? {
              agentCatalog: agentCatalog.map((a) => ({
                slug: a.slug,
                name: a.metadata.name,
                description: a.metadata.description,
                inputs: a.metadata.inputs,
                outputs: a.metadata.outputs,
                visualAgent: a.metadata.visualAgent,
                tags: a.metadata.tags,
                routing: a.metadata.routing,
              })),
            }
          : {}),
      },
      ...(isConcierge
        ? {
            routing: {
              mode: 'concierge',
              activeAgentCount: agentCatalog.length,
              instruction: 'Use the active agent capability catalog to route the user to a specialist when appropriate.',
            },
          }
        : {}),
    },
  }

  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as CreateSessionOptions
}

export function shouldDeferAgentTaskModeSelection(
  agent: AgentDefinitionDTO,
  taskModeId?: string,
): boolean {
  return agent.slug !== CONCIERGE_SLUG && !taskModeId && (agent.metadata.taskModes?.length ?? 0) > 1
}

/** Create only the chat shell; the selected mode is composed server-side before first send. */
export function buildPendingAgentTaskModeSessionOptions(agent: AgentDefinitionDTO): CreateSessionOptions {
  const isConcierge = agent.slug === CONCIERGE_SLUG
  return {
    llmConnection: agent.metadata.llmConnection,
    model: agent.metadata.model,
    permissionMode: agent.metadata.permissionMode,
    thinkingLevel: agent.metadata.thinkingLevel,
    spawnedFromAgent: {
      agentSlug: agent.slug,
      agentName: agent.metadata.name,
      timestamp: Date.now(),
    },
    launchReceipt: {
      createdAt: Date.now(),
      origin: isConcierge ? 'concierge' : 'agent',
      summary: `Waiting for ${agent.metadata.name} focus selection.`,
      agent: {
        slug: agent.slug,
        name: agent.metadata.name,
        description: agent.metadata.description,
        inputs: agent.metadata.inputs,
        outputs: agent.metadata.outputs,
        tags: agent.metadata.tags,
      },
      taskModeSelectionPending: true,
      config: {
        llmConnection: agent.metadata.llmConnection,
        model: agent.metadata.model,
        permissionMode: agent.metadata.permissionMode,
        thinkingLevel: agent.metadata.thinkingLevel,
      },
      injected: {
        skills: [],
        sources: [],
        contextDocs: [],
      },
    },
  }
}

export async function openAgentSessionComposer(params: {
  agent: AgentDefinitionDTO
  workspaceId: string
  onCreateSession: (workspaceId: string, options?: CreateSessionOptions) => Promise<Session>
  onInputChange: (sessionId: string, value: string) => void
  /**
   * Optional live skill/source snapshots. When provided, missing slugs are
   * dropped from the spawned session config and the user gets a transparent
   * toast listing what got dropped. Strongly recommended — without these, the
   * session may try to activate skills/sources that don't exist on this
   * machine and silently fail to bind them.
   */
  skills?: SkillDescriptor[]
  sources?: LoadedSource[]
  /**
   * Workspace context docs already filtered by routing for this agent. When
   * omitted, the composer asks the server for the source-of-truth filtered set.
   */
  contextDocs?: ContextDocDTO[]
  /**
   * Active agents visible to the Concierge as a structured routing catalog.
   */
  agentCatalog?: AgentDefinitionDTO[]
  /** Focused launch recipe chosen before this session is created. */
  taskModeId?: string
  /**
   * Optional draft to prefill instead of the agent's saved greeting.
   */
  draftInput?: string
  /**
   * Immediately start the worker with draftInput instead of leaving it in the
   * composer. Intended for explicit "run this worker" controls.
   */
  autoSendDraft?: boolean
  /** Keep the current surface visible until a surrounding multi-step launch succeeds. */
  navigateOnCreate?: boolean
  /** Cancel an asynchronous voice handoff if its workspace or conversation changes. */
  shouldContinue?: () => boolean
  onSendMessage?: (
    sessionId: string,
    message: string,
  ) => boolean | void | Promise<boolean | void>
}): Promise<Session> {
  const assertCurrent = () => { if (params.shouldContinue && !params.shouldContinue()) throw new Error('Command handoff was cancelled.') }
  assertCurrent()
  if (shouldDeferAgentTaskModeSelection(params.agent, params.taskModeId)) {
    const session = await params.onCreateSession(
      params.workspaceId,
      buildPendingAgentTaskModeSessionOptions(params.agent),
    )
    assertCurrent()
    const draft = params.draftInput?.trim()
    if (draft) params.onInputChange(session.id, draft)
    if (params.navigateOnCreate !== false) {
      if (window.location.hash.startsWith('#artist-hq/')) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      }
      navigate(routes.view.allSessions(session.id))
    }
    return session
  }
  const taskMode = resolveAgentTaskMode(params.agent, params.taskModeId ?? (params.agent.slug === CONCIERGE_SLUG && params.agent.metadata.taskModes?.some(mode => mode.id === 'just-talk') ? 'just-talk' : undefined))
  const launchAgent = taskMode
    ? {
        ...params.agent,
        metadata: { ...params.agent.metadata, skills: taskMode.primarySkillSlugs, sources: taskMode.requiredSourceSlugs, optionalSources: taskMode.optionalSourceSlugs },
      }
    : params.agent
  let launchSkills = params.skills
  let launchSources = params.sources
  if (taskMode) {
    ;[launchSkills, launchSources] = await Promise.all([
      launchSkills ?? window.electronAPI.getSkills(params.workspaceId),
      launchSources ?? window.electronAPI.getSources(params.workspaceId),
    ])
  }
  if (launchSkills) {
    try {
      launchSkills = await ensureAgentDeclaredSkillsEnabled({
        agent: launchAgent,
        workspaceId: params.workspaceId,
        activeSkills: launchSkills,
      })
    } catch (error) {
      if (taskMode) throw new Error(`Could not prepare Skills for ${params.agent.metadata.name} — ${taskMode.label}. ${error instanceof Error ? error.message : String(error)}`)
      console.error(`[Agents] Failed to activate declared skills for ${params.agent.slug}:`, error)
    }
  }

  if (taskMode) assertFocusedAgentReferences(launchAgent, taskMode.label, launchSkills!, launchSources!)

  assertCurrent()
  const contextDocs = taskMode
    ? await window.electronAPI.listWorkspaceContextDocsForAgent(params.workspaceId, params.agent.slug, taskMode.id)
    : params.contextDocs ?? await window.electronAPI.listWorkspaceContextDocsForAgent(params.workspaceId, params.agent.slug)
  const [userMemoryEntries, agentMemoryEntries] = await Promise.all([
    loadUserMemoryEntries(),
    loadAgentMemoryEntries(params.agent.slug),
  ])
  const recentSessions = await loadRecentSessionEntries(params.agent.slug)

  // Surface a one-off toast if the agent declares slugs that don't resolve in
  // this workspace. The session still spawns without them; the warning is so
  // the user knows why output may be reduced.
  if (!taskMode && launchSkills && launchSources) {
    const resolution = resolveAgentReferences(launchAgent, launchSkills, launchSources)
    if (hasMissingReferences(resolution)) {
      const summary = describeMissingReferences(resolution)
      toast.warning(`${params.agent.metadata.name}: ${summary}`, {
        description: 'The session will run without those bundles. Activate them in this workspace to fix.',
      })
    }
  }

  // Resolve the workspace kind so the composed prompt matches what the server
  // builds for the same agent. A lookup failure degrades to the old heuristic
  // rather than blocking the launch.
  const artistWorkspaceScope = await resolveArtistWorkspaceScope(params.workspaceId)

  // When live skills/sources are available, pass them through so the session
  // gets a composed system prompt (persona body + bundle footer) and any
  // missing slugs are dropped from agentSkillSlugs/enabledSourceSlugs.
  const context = launchSkills && launchSources
    ? { skills: launchSkills, sources: launchSources, contextDocs, agentCatalog: params.agentCatalog, userMemoryEntries, agentMemoryEntries, artistWorkspaceScope, recentSessions, currentWorkspaceId: params.workspaceId }
    : contextDocs.length > 0 || userMemoryEntries.length > 0 || agentMemoryEntries.length > 0 || (params.agentCatalog?.length ?? 0) > 0 || artistWorkspaceScope || recentSessions.length > 0
      ? { skills: [], sources: [], contextDocs, agentCatalog: params.agentCatalog, userMemoryEntries, agentMemoryEntries, artistWorkspaceScope, recentSessions, currentWorkspaceId: params.workspaceId }
      : undefined

  assertCurrent()
  const session = await params.onCreateSession(
    params.workspaceId,
    buildAgentCreateSessionOptions(params.agent, context, params.taskModeId),
  )
  assertCurrent()
  // Seed a guarded handoff before navigation unmounts its voice owner. The shell
  // stores this synchronously, so the new ChatPage reads it on its first render.
  const draft = params.draftInput?.trim()
  const seededHandoffDraft = Boolean(params.shouldContinue && draft && !params.autoSendDraft)
  if (seededHandoffDraft) params.onInputChange(session.id, draft!)
  if (params.navigateOnCreate !== false) {
    if (window.location.hash.startsWith('#artist-hq/')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    navigate(routes.view.allSessions(session.id))
  }

  if (draft && !seededHandoffDraft) {
    if (params.autoSendDraft && params.onSendMessage) {
      await sendAgentDraft(params.onSendMessage, session.id, draft, params.agent.metadata.name)
    } else {
      setTimeout(() => params.onInputChange(session.id, draft), 100)
    }
  }

  return session
}

export async function sendAgentDraft(
  onSendMessage: (sessionId: string, message: string) => boolean | void | Promise<boolean | void>,
  sessionId: string,
  draft: string,
  agentName: string,
): Promise<void> {
  const sent = await onSendMessage(sessionId, draft)
  if (sent === false) {
    throw new Error(`${agentName} opened, but its first message failed to send. Retry it from the worker session.`)
  }
}

/**
 * Load USER.md entries via the typed electronAPI bridge. The bridge
 * method is declared on `ElectronAPI` (apps/electron/src/shared/types.ts);
 * a transport failure surfaces a console warning instead of silently
 * returning empty so the user has a signal that memory injection failed.
 */
export async function loadUserMemoryEntries(): Promise<MemoryEntry[]> {
  try {
    const result = await window.electronAPI.listUserMemory()
    return normalizeMemoryEntries(result)
  } catch (err) {
    console.warn('[memory] failed to load USER.md; agent will run without user memory:', err)
    return []
  }
}

/**
 * This agent's recent sessions for the "where we left off" prompt section.
 *
 * A failure here is never worth blocking a launch: the agent simply starts
 * without knowing what it did last, exactly as it did before the log existed.
 */
export async function loadRecentSessionEntries(agentSlug: string): Promise<SessionLogEntry[]> {
  try {
    return (await window.electronAPI.listAgentSessions?.(agentSlug)) ?? []
  } catch (err) {
    console.warn(`[sessions-log] failed to load SESSIONS.md for "${agentSlug}":`, err)
    return []
  }
}

export async function loadAgentMemoryEntries(agentSlug: string): Promise<MemoryEntry[]> {
  try {
    const result = await window.electronAPI.listAgentMemory(agentSlug)
    return normalizeMemoryEntries(result)
  } catch (err) {
    console.warn(`[memory] failed to load MEMORY.md for "${agentSlug}"; agent will run without per-agent memory:`, err)
    return []
  }
}

function normalizeMemoryEntries(value: MemoryEntry[] | LoadedMemoryFile | null | undefined): MemoryEntry[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  return value.entries ?? []
}

function memoryEntryTitle(entry: MemoryEntry): string {
  return entry.name.trim() || 'Memory'
}

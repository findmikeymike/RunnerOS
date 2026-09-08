import type { LoadedAgent } from '../agent-definitions/types.ts'
import { resolveAgentTaskMode, type ResolvedAgentTaskMode } from '../agent-definitions/task-modes.ts'
import type { StoredSession } from './types.ts'

/** These fields must come from host session state, never branch request options. */
export type HostAgentFocusState = Pick<StoredSession,
  'customSystemPrompt' | 'agentSkillSlugs' | 'trustedWorkerTools' |
  'enabledSourceSlugs' | 'spawnedFromAgent' | 'launchReceipt'>

/** Portable selection intent only. Prompts, receipts, tool grants, and sources are not authority. */
export interface AgentFocusTransferIntent {
  version: 1
  agentSlug: string
  taskMode?: { id: string; definitionRevision: string }
  taskModeSelectionPending?: true
}

/**
 * Same-host branch/fork inheritance. Spread the result AFTER request options.
 * Pass an admitted snapshot when the branch anchor has host-recorded turn focus.
 * Without one this preserves the source's current focus, not invented historical state.
 */
export function inheritHostAgentFocus(
  source: HostAgentFocusState,
  admittedSnapshot?: HostAgentFocusState,
): HostAgentFocusState {
  const selected = admittedSnapshot ?? source
  return structuredClone({
    customSystemPrompt: selected.customSystemPrompt,
    agentSkillSlugs: selected.agentSkillSlugs,
    trustedWorkerTools: selected.trustedWorkerTools,
    enabledSourceSlugs: selected.enabledSourceSlugs,
    spawnedFromAgent: selected.spawnedFromAgent,
    launchReceipt: selected.launchReceipt,
  })
}

/** Export only identity and focus from host state; fail closed on contradictory bindings. */
export function createAgentFocusTransferIntent(
  source: Pick<HostAgentFocusState, 'spawnedFromAgent' | 'launchReceipt'>,
): AgentFocusTransferIntent | undefined {
  const binding = source.spawnedFromAgent?.agentSlug
  const receiptBinding = source.launchReceipt?.agent?.slug
  if (binding && receiptBinding && binding !== receiptBinding) {
    throw new Error('Cannot transfer a session with conflicting agent bindings.')
  }
  const agentSlug = binding ?? receiptBinding
  const taskMode = source.launchReceipt?.taskMode
  const pending = source.launchReceipt?.taskModeSelectionPending === true
  if (!agentSlug) {
    if (taskMode || pending) throw new Error('Cannot transfer focused state without an agent binding.')
    return undefined
  }
  if (taskMode && pending) throw new Error('Cannot transfer both a selected and pending task mode.')
  if (taskMode && taskMode.schemaVersion !== 1) throw new Error('Unsupported transferred task-mode version.')
  const intent: AgentFocusTransferIntent = {
    version: 1,
    agentSlug,
    ...(taskMode ? { taskMode: { id: taskMode.id, definitionRevision: taskMode.definitionRevision } } : {}),
    ...(pending ? { taskModeSelectionPending: true as const } : {}),
  }
  return parseAgentFocusTransferIntent(intent)
}

/** Unknown/client fields are discarded; malformed selection claims are rejected. */
export function parseAgentFocusTransferIntent(value: unknown): AgentFocusTransferIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid transferred agent focus.')
  const input = value as Record<string, unknown>
  if (input.version !== 1 || typeof input.agentSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.agentSlug)) {
    throw new Error('Invalid transferred agent identity.')
  }
  if (input.taskModeSelectionPending !== undefined && input.taskModeSelectionPending !== true) {
    throw new Error('Invalid pending task-mode selection.')
  }
  let taskMode: AgentFocusTransferIntent['taskMode']
  if (input.taskMode !== undefined) {
    if (!input.taskMode || typeof input.taskMode !== 'object' || Array.isArray(input.taskMode)) throw new Error('Invalid transferred task mode.')
    const mode = input.taskMode as Record<string, unknown>
    if (typeof mode.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(mode.id)
      || typeof mode.definitionRevision !== 'string' || !/^task-mode-v1-[a-f0-9]{8}$/.test(mode.definitionRevision)) {
      throw new Error('Invalid transferred task-mode identity or revision.')
    }
    taskMode = { id: mode.id, definitionRevision: mode.definitionRevision }
  }
  if (taskMode && input.taskModeSelectionPending) throw new Error('Cannot transfer both a selected and pending task mode.')
  return {
    version: 1,
    agentSlug: input.agentSlug,
    ...(taskMode ? { taskMode } : {}),
    ...(input.taskModeSelectionPending ? { taskModeSelectionPending: true } : {}),
  }
}

export interface ValidatedTransferredAgentFocus {
  intent: AgentFocusTransferIntent
  /** Destination-owned definition, never the transported mode body. */
  taskMode?: ResolvedAgentTaskMode
  primarySkillSlugs: string[]
  requiredSourceSlugs: string[]
  optionalSourceSlugs: string[]
}

/**
 * Validate BEFORE creating/importing a destination session or reusing its SDK state.
 * Destination agent/workspace authorization is checked by the caller's normal launch resolver.
 * readySourceSlugs must represent enabled, usable destination sources, not mere declarations.
 * After this check, compose the prompt/receipt/tools through resolveAgentSessionOptions;
 * never copy a remote customSystemPrompt, trustedWorkerTools, or injected receipt.
 */
export function validateTransferredAgentFocus(
  rawIntent: unknown,
  destinationAgent: Pick<LoadedAgent, 'slug' | 'metadata'> | undefined,
  dependencies: { installedSkillSlugs: ReadonlySet<string>; readySourceSlugs: ReadonlySet<string> },
): ValidatedTransferredAgentFocus {
  const intent = parseAgentFocusTransferIntent(rawIntent)
  if (!destinationAgent || destinationAgent.slug !== intent.agentSlug) {
    throw new Error(`Transferred agent "${intent.agentSlug}" is unavailable in the destination.`)
  }
  const modes = destinationAgent.metadata.taskModes ?? []
  if (intent.taskModeSelectionPending) {
    if (modes.length === 0) throw new Error('The destination agent no longer offers task-mode selection.')
    // A pending shell remains pending: do not activate its whole skill/source inventory.
    return { intent, primarySkillSlugs: [], requiredSourceSlugs: [], optionalSourceSlugs: [] }
  }
  if (!intent.taskMode && modes.length > 0 && destinationAgent.slug !== 'concierge') {
    throw new Error('This transferred agent requires an explicit task mode. Select its focus before transfer.')
  }
  const taskMode = resolveAgentTaskMode(destinationAgent, intent.taskMode?.id)
  if (taskMode && taskMode.definitionRevision !== intent.taskMode!.definitionRevision) {
    throw new Error(`Transferred focus "${taskMode.label}" differs from the destination definition. Review the destination focus before continuing.`)
  }
  const primarySkillSlugs = taskMode?.primarySkillSlugs ?? (destinationAgent.slug === 'concierge'
    ? ['artist-manager-operating-system']
    : [...(destinationAgent.metadata.skills ?? [])])
  const requiredSourceSlugs = taskMode?.requiredSourceSlugs ?? [...(destinationAgent.metadata.sources ?? [])]
  const optionalSourceSlugs = taskMode?.optionalSourceSlugs ?? [...(destinationAgent.metadata.optionalSources ?? [])]
  const declaredSkills = new Set(destinationAgent.metadata.skills ?? [])
  const missingSkills = primarySkillSlugs.filter(slug => !declaredSkills.has(slug) || !dependencies.installedSkillSlugs.has(slug))
  const missingSources = requiredSourceSlugs.filter(slug => !dependencies.readySourceSlugs.has(slug))
  if (missingSkills.length || missingSources.length) {
    throw new Error(`Transferred focus is blocked in the destination:${missingSkills.length ? ` missing skills (${missingSkills.join(', ')});` : ''}${missingSources.length ? ` unavailable required sources (${missingSources.join(', ')});` : ''}`)
  }
  return { intent, taskMode, primarySkillSlugs, requiredSourceSlugs, optionalSourceSlugs }
}

/** Build a host-owned pending shell without loading any specialist capability. */
export function createPendingAgentFocusState(
  agent: Pick<LoadedAgent, 'slug' | 'metadata'>,
): HostAgentFocusState {
  const timestamp = Date.now()
  return {
    customSystemPrompt: undefined,
    agentSkillSlugs: [],
    enabledSourceSlugs: [],
    trustedWorkerTools: [],
    spawnedFromAgent: { agentSlug: agent.slug, agentName: agent.metadata.name, timestamp },
    launchReceipt: {
      createdAt: timestamp, origin: agent.slug === 'concierge' ? 'concierge' : 'agent',
      agent: { slug: agent.slug, name: agent.metadata.name, description: agent.metadata.description },
      taskModeSelectionPending: true,
      config: {}, injected: { skills: [], sources: [], contextDocs: [] },
    },
  }
}

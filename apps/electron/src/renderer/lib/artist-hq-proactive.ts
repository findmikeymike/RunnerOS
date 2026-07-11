import type { HqOperationalSourceHealth, HqRecommendationStatus, HqStateRouteHint } from '@craft-agent/shared/hq-state'
import type { AgentDefinitionDTO, ContextDocDTO } from '../../shared/types'

const PROACTIVE_HQ_MODE_STORAGE_PREFIX = 'artist-hq:proactive-mode'

export interface HqRouteReadiness {
  canLaunch: boolean
  agentAvailable: boolean
  blockedReason?: string
}

export interface HqRouteContextSelection {
  contextDocs: ContextDocDTO[]
  missingSlugs: string[]
  disabledSlugs: string[]
}

export interface HqRecommendationActionState {
  canLaunch: boolean
  canDefer: boolean
  canRate: boolean
  label: string
}

export function resolveHqRecommendationActionState(
  status: HqRecommendationStatus,
  readiness: HqRouteReadiness,
  proactiveMode: boolean,
  busy: boolean,
): HqRecommendationActionState {
  const launchable = status === 'proposed' || status === 'viewed' || status === 'accepted' || status === 'failed'
  const canDefer = launchable
  const label = busy ? 'Starting...'
    : status === 'failed' ? 'Retry Route'
      : status === 'awaiting_approval' ? 'Awaiting Approval'
        : status === 'launched' || status === 'in_progress' ? 'Work in Progress'
          : status === 'completed' ? 'Completed'
            : proactiveMode ? (readiness.blockedReason ? 'Start Review' : 'Start Route') : 'Proactive Off'
  return {
    canLaunch: readiness.canLaunch && launchable && !busy,
    canDefer,
    canRate: status === 'completed' || status === 'failed',
    label,
  }
}

export function unhealthyHqSources(sources: HqOperationalSourceHealth[]): HqOperationalSourceHealth[] {
  return sources.filter((source) => source.status !== 'fresh')
}

export function proactiveHqModeStorageKey(workspaceId: string): string {
  return `${PROACTIVE_HQ_MODE_STORAGE_PREFIX}:${workspaceId}`
}

export function dedupeAgentsBySlug(agents: AgentDefinitionDTO[]): AgentDefinitionDTO[] {
  const seen = new Set<string>()
  const out: AgentDefinitionDTO[] = []
  for (const agent of agents) {
    if (seen.has(agent.slug)) continue
    seen.add(agent.slug)
    out.push(agent)
  }
  return out
}

export function resolveHqRouteReadiness(
  route: HqStateRouteHint | undefined,
  availableAgentSlugs: Set<string>,
  proactiveMode: boolean,
): HqRouteReadiness {
  if (!route) return { canLaunch: false, agentAvailable: false, blockedReason: 'No route is available.' }
  const agentAvailable = Boolean(route.agentSlug && availableAgentSlugs.has(route.agentSlug))
  const blockedReason = route.blockedReason
    ?? (route.target === 'agent' && !agentAvailable ? `@${route.agentSlug} is not active in this workspace.` : undefined)
  return {
    agentAvailable,
    blockedReason,
    canLaunch: proactiveMode && route.target === 'agent' && agentAvailable && !blockedReason,
  }
}

export function selectHqRouteContextDocs(route: HqStateRouteHint, docs: ContextDocDTO[]): HqRouteContextSelection {
  const docBySlug = new Map(docs.map((doc) => [doc.slug, doc]))
  const contextDocs: ContextDocDTO[] = []
  const missingSlugs: string[] = []
  const disabledSlugs: string[] = []

  for (const slug of uniqueStrings(route.contextDocSlugs)) {
    const doc = docBySlug.get(slug)
    if (!doc) {
      missingSlugs.push(slug)
      continue
    }
    if (doc.metadata.enabled === false) {
      disabledSlugs.push(slug)
      continue
    }
    contextDocs.push(doc)
  }

  return { contextDocs, missingSlugs, disabledSlugs }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

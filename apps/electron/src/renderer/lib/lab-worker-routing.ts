import type { AgentDefinitionDTO } from '../../shared/types'

export type LabWorkerRole =
  | 'lyrics.generate'
  | 'lyrics.review'
  | 'lyrics.rewrite'
  | 'lyrics.section.chorus'
  | 'lyrics.section.verse'
  | 'lyrics.section.bridge'
  | 'song.concept'
  | 'song.reference'
  | 'producer.handoff'
  | 'research.reference'

export interface LabWorkerCandidate {
  agent: AgentDefinitionDTO
  matchedRole: LabWorkerRole
  reason: string
  recommended: boolean
}
export interface LabWorkerRouteRequest {
  role: LabWorkerRole
  fallbackRoles?: LabWorkerRole[]
  sectionId?: string
  sectionLabel?: string
}

export interface LabWorkerRouteResult {
  role: LabWorkerRole
  requestedRoles: LabWorkerRole[]
  candidates: LabWorkerCandidate[]
  recommended?: LabWorkerCandidate
  emptyReason?: string
}

const LAB_WORKER_ROLES: Record<string, LabWorkerRole[]> = {
  'reverse-magic': ['lyrics.generate', 'song.reference', 'song.concept'],
  'legendary-writer': ['lyrics.review', 'lyrics.rewrite', 'lyrics.section.verse', 'lyrics.section.bridge'],
  'record-doctor': ['producer.handoff'],
  'chorus-writer': ['lyrics.section.chorus', 'lyrics.rewrite'],
  'hook-doctor': ['lyrics.section.chorus', 'song.concept'],
  'bridge-builder': ['lyrics.section.bridge', 'lyrics.rewrite'],
}

const ROLE_REASONS: Record<LabWorkerRole, string> = {
  'lyrics.generate': 'Best fit for generating new lyric material.',
  'lyrics.review': 'Best fit for lyric diagnosis and critique.',
  'lyrics.rewrite': 'Best fit for strengthening existing lyric lines.',
  'lyrics.section.chorus': 'Best fit for chorus and hook work.',
  'lyrics.section.verse': 'Best fit for verse development.',
  'lyrics.section.bridge': 'Best fit for bridge turns and pivots.',
  'song.concept': 'Best fit for song thesis and concept work.',
  'song.reference': 'Best fit for reference psychology and annotation logic.',
  'producer.handoff': 'Best fit for producer review packets.',
  'research.reference': 'Best fit for reference and research gathering.',
}

export function getLabWorkerRoles(agentSlug: string): LabWorkerRole[] {
  return LAB_WORKER_ROLES[agentSlug] ?? []
}

export function resolveLabWorkerRoute(
  activeAgents: AgentDefinitionDTO[],
  request: LabWorkerRouteRequest,
): LabWorkerRouteResult {
  const requestedRoles = uniqueRoles([request.role, ...(request.fallbackRoles ?? [])])
  const agentsBySlug = dedupeAgentsBySlug(activeAgents)

  for (const role of requestedRoles) {
    const candidates = agentsBySlug
      .map((agent) => candidateForRole(agent, role))
      .filter((candidate): candidate is LabWorkerCandidate => Boolean(candidate))

    if (candidates.length > 0) {
      const [recommended, ...rest] = candidates
      return {
        role,
        requestedRoles,
        candidates: [
          { ...recommended, recommended: true },
          ...rest.map((candidate) => ({ ...candidate, recommended: false })),
        ],
        recommended: { ...recommended, recommended: true },
      }
    }
  }

  return {
    role: request.role,
    requestedRoles,
    candidates: [],
    emptyReason: 'No active Lab worker handles this yet. Add one from Manage Library.',
  }
}

function candidateForRole(agent: AgentDefinitionDTO, role: LabWorkerRole): LabWorkerCandidate | null {
  const roles = getLabWorkerRoles(agent.slug)
  if (!roles.includes(role)) return null
  return {
    agent,
    matchedRole: role,
    reason: ROLE_REASONS[role],
    recommended: false,
  }
}

function dedupeAgentsBySlug(agents: AgentDefinitionDTO[]): AgentDefinitionDTO[] {
  const seen = new Set<string>()
  const result: AgentDefinitionDTO[] = []
  for (const agent of agents) {
    if (seen.has(agent.slug)) continue
    seen.add(agent.slug)
    result.push(agent)
  }
  return result
}

function uniqueRoles(roles: LabWorkerRole[]): LabWorkerRole[] {
  return Array.from(new Set(roles))
}

import { createHash } from 'node:crypto'
import {
  hqIntentFingerprint,
  type HqOperationalScope,
  type HqRecommendationCandidate,
  type HqStateOfPlay,
  type HqStateNextMove,
} from '@craft-agent/shared/hq-state'
import { listOutputManifests } from '@craft-agent/shared/outputs'
import {
  readHqRecommendationStore,
  transitionHqRecommendation,
  upsertHqRecommendation,
} from '@craft-agent/shared/hq-state/recommendation-storage'

export function persistHqRecommendations(
  workspaceRootPath: string,
  state: HqStateOfPlay,
  scope: HqOperationalScope,
): HqRecommendationCandidate[] {
  return [state.nextMove, ...state.alternatives].map((move) => persistMove(workspaceRootPath, state.generatedAt, scope, move))
}

export function reconcileHqRecommendationOutcomes(workspaceRootPath: string, now = new Date()): void {
  const outputs = listOutputManifests(workspaceRootPath)
  const candidates = readHqRecommendationStore(workspaceRootPath).candidates
  for (const candidate of candidates) {
    if (!['launched', 'in_progress', 'awaiting_approval'].includes(candidate.status)) continue
    const completionContract = candidate.completionContract
    if (completionContract?.type !== 'output') continue
    const sessionIds = new Set(candidate.executionRefs.filter((ref) => ref.kind === 'session').map((ref) => ref.id))
    if (sessionIds.size === 0) continue
    const output = outputs
      .filter((item) => item.origin.sessionId && sessionIds.has(item.origin.sessionId))
      .filter((item) => item.tags?.includes(completionContract.requiredTag))
      .filter((item) => !completionContract.expectedAgentSlug || item.origin.agentSlug === completionContract.expectedAgentSlug)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (!output) continue
    const to = output.status === 'failed' || output.approval?.state === 'changes_requested'
      ? 'failed'
      : output.approval?.state === 'pending'
        ? 'awaiting_approval'
        : output.status === 'published' || Boolean(output.completedAt)
          ? 'completed'
          : 'in_progress'
    transitionHqRecommendation(workspaceRootPath, candidate.id, to, {
      actor: { type: 'system' },
      reason: `Reconciled from Output ${output.id}.`,
      executionRef: { kind: 'output', id: output.id, linkedAt: now.toISOString() },
      createdAt: now.toISOString(),
    })
  }
}

function persistMove(
  workspaceRootPath: string,
  now: string,
  scope: HqOperationalScope,
  move: HqStateNextMove,
): HqRecommendationCandidate {
  const intent = hqIntentFingerprint({
    scope,
    worker: move.worker,
    title: move.title,
    intent: move.why,
  })
  const id = recommendationId(intent, move.entityRef?.source)
  return upsertHqRecommendation(workspaceRootPath, {
    version: 1,
    id,
    fingerprint: intent,
    scope,
    title: move.title,
    reason: move.why,
    desiredOutcome: desiredOutcome(move),
    completionContract: completionContract(id, move),
    status: 'proposed',
    route: move.route,
    entityRef: move.entityRef,
    executionRefs: [],
    createdAt: now,
    updatedAt: now,
    lastProposedAt: now,
  })
}

function completionContract(id: string, move: HqStateNextMove): HqRecommendationCandidate['completionContract'] {
  if (move.entityRef) return { type: 'entity-resolution', entity: move.entityRef }
  if (move.route?.target === 'agent' && move.route.agentSlug) {
    return { type: 'output', requiredTag: `hq-recommendation:${id}`, expectedAgentSlug: move.route.agentSlug }
  }
  return { type: 'manual-review' }
}

function recommendationId(fingerprint: string, source: string | undefined): string {
  const digest = createHash('sha256').update(`${fingerprint}|${source ?? ''}`).digest('hex').slice(0, 20)
  return `sop_${digest}`
}

function desiredOutcome(move: HqStateNextMove): string {
  if (move.entityRef) return `${move.title} is resolved and no longer requires attention.`
  return `${move.title} produces a concrete artifact, decision, or verified state change.`
}

import { createHash } from 'node:crypto'
import {
  hqIntentFingerprint,
  type HqOperationalScope,
  type HqRecommendationCandidate,
  type HqStateOfPlay,
} from '@craft-agent/shared/hq-state'
import { upsertHqRecommendation } from '@craft-agent/shared/hq-state/recommendation-storage'

export function persistPrimaryHqRecommendation(
  workspaceRootPath: string,
  state: HqStateOfPlay,
  scope: HqOperationalScope,
): HqRecommendationCandidate {
  const now = state.generatedAt
  const intent = hqIntentFingerprint({
    scope,
    worker: state.nextMove.worker,
    title: state.nextMove.title,
    intent: state.nextMove.why,
  })
  const id = recommendationId(intent, state.nextMove.entityRef?.source)
  return upsertHqRecommendation(workspaceRootPath, {
    version: 1,
    id,
    fingerprint: intent,
    scope,
    title: state.nextMove.title,
    reason: state.nextMove.why,
    desiredOutcome: desiredOutcome(state),
    status: 'proposed',
    route: state.nextMove.route,
    entityRef: state.nextMove.entityRef,
    executionRefs: [],
    createdAt: now,
    updatedAt: now,
    lastProposedAt: now,
  })
}

function recommendationId(fingerprint: string, source: string | undefined): string {
  const digest = createHash('sha256').update(`${fingerprint}|${source ?? ''}`).digest('hex').slice(0, 20)
  return `sop_${digest}`
}

function desiredOutcome(state: HqStateOfPlay): string {
  if (state.nextMove.entityRef) return `${state.nextMove.title} is resolved and no longer requires attention.`
  return `${state.nextMove.title} produces a concrete artifact, decision, or verified state change.`
}

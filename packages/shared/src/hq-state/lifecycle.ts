import type { HqOperationalScope, HqRecommendationStatus, HqStateEntityRef, HqStateRouteHint } from './types.ts'

export interface HqRecommendationExecutionRef {
  kind: 'session' | 'scheduled-work' | 'workflow-run' | 'output'
  id: string
  linkedAt: string
}

export interface HqRecommendationCandidate {
  version: 1
  id: string
  fingerprint: string
  scope: HqOperationalScope
  title: string
  reason: string
  desiredOutcome: string
  status: HqRecommendationStatus
  route?: HqStateRouteHint
  entityRef?: HqStateEntityRef
  executionRefs: HqRecommendationExecutionRef[]
  createdAt: string
  updatedAt: string
  lastProposedAt: string
  snoozedUntil?: string
  statusReason?: string
}

export interface HqRecommendationEvent {
  version: 1
  id: string
  recommendationId: string
  from?: HqRecommendationStatus
  to: HqRecommendationStatus
  actor: { type: 'system' | 'user' | 'agent'; id?: string }
  reason?: string
  executionRef?: HqRecommendationExecutionRef
  createdAt: string
}

export interface HqRecommendationStore {
  version: 1
  candidates: HqRecommendationCandidate[]
  updatedAt: string
}

export interface HqRecommendationOutcome {
  version: 1
  recommendationId: string
  status: 'successful' | 'partial' | 'unsuccessful' | 'unknown'
  evaluatedAt: string
  evidence: HqStateEntityRef[]
  userUsefulness?: 'useful' | 'neutral' | 'not_useful'
  notes?: string
}

export interface HqRecommendationTransitionInput {
  recommendationId: string
  to: HqRecommendationStatus
  reason?: string
  snoozedUntil?: string
  executionRef?: HqRecommendationExecutionRef
}

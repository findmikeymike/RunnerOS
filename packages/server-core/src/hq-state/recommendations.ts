import { createHash } from 'node:crypto'
import {
  hqIntentFingerprint,
  type HqOperationalScope,
  type HqRecommendationCandidate,
  type HqStateEntityRef,
  type HqStateOfPlay,
  type HqStateNextMove,
} from '@craft-agent/shared/hq-state'
import { listOutputManifests } from '@craft-agent/shared/outputs'
import { AUTOMATIONS_HISTORY_FILE } from '@craft-agent/shared/automations'
import { parseScheduledWorkDocResult, SCHEDULED_WORK_CONTEXT_SLUG } from '@craft-agent/shared/scheduled-work'
import { loadContextDoc } from '@craft-agent/shared/workspace-context'
import { readRun } from '@craft-agent/shared/workflows'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  readHqRecommendationStore,
  transitionHqRecommendation,
  upsertHqRecommendationOutcome,
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
    const completionContract = candidate.completionContract
    if (completionContract?.type === 'entity-resolution') {
      const resolution = resolveEntityOutcome(workspaceRootPath, completionContract.entity)
      if (!resolution) continue
      const observedOnly = ['proposed', 'viewed', 'accepted'].includes(candidate.status)
      if (observedOnly && resolution.lifecycle !== 'completed') continue
      if (!observedOnly && !['launched', 'in_progress', 'awaiting_approval'].includes(candidate.status)) continue
      const lifecycle = observedOnly ? 'superseded' : resolution.lifecycle
      transitionHqRecommendation(workspaceRootPath, candidate.id, lifecycle, {
        actor: { type: 'system' },
        reason: observedOnly ? `${resolution.reason} The observed obligation no longer needs attention.` : resolution.reason,
        executionRef: { kind: completionContract.entity.kind, id: completionContract.entity.id, linkedAt: now.toISOString() },
        createdAt: now.toISOString(),
      })
      if (resolution.outcome) upsertHqRecommendationOutcome(workspaceRootPath, {
        version: 1,
        recommendationId: candidate.id,
        status: resolution.outcome,
        evaluatedAt: now.toISOString(),
        evidence: [completionContract.entity],
      })
      continue
    }
    if (!['launched', 'in_progress', 'awaiting_approval'].includes(candidate.status)) continue
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
    if (to === 'completed' || to === 'failed') upsertHqRecommendationOutcome(workspaceRootPath, {
      version: 1,
      recommendationId: candidate.id,
      status: to === 'completed' ? 'successful' : 'unsuccessful',
      evaluatedAt: now.toISOString(),
      evidence: [{ kind: 'output', id: output.id, source: `output:${output.id}`, scope: candidate.scope }],
    })
  }
}

function resolveEntityOutcome(workspaceRootPath: string, entity: HqStateEntityRef): {
  lifecycle: 'in_progress' | 'awaiting_approval' | 'completed' | 'failed'
  outcome?: 'successful' | 'unsuccessful'
  reason: string
} | null {
  if (entity.kind === 'output') {
    const output = listOutputManifests(workspaceRootPath).find((item) => item.id === entity.id)
    if (!output) return null
    if (output.status === 'failed' || output.approval?.state === 'changes_requested') return { lifecycle: 'failed', outcome: 'unsuccessful', reason: `Linked Output ${entity.id} failed or needs changes.` }
    if (output.approval?.state === 'pending') return { lifecycle: 'awaiting_approval', reason: `Linked Output ${entity.id} awaits approval.` }
    if (output.status === 'published' || output.completedAt) return { lifecycle: 'completed', outcome: 'successful', reason: `Linked Output ${entity.id} completed.` }
    return { lifecycle: 'in_progress', reason: `Linked Output ${entity.id} remains active.` }
  }
  if (entity.kind === 'workflow-run') {
    const run = readRun(workspaceRootPath, entity.id)
    if (!run) return null
    if (run.state === 'succeeded') return { lifecycle: 'completed', outcome: 'successful', reason: `Workflow run ${entity.id} succeeded.` }
    if (run.state === 'failed' || run.state === 'cancelled' || run.state === 'interrupted') return { lifecycle: 'failed', outcome: 'unsuccessful', reason: `Workflow run ${entity.id} ended ${run.state}.` }
    if (run.state === 'paused' || run.steps.some((step) => step.state === 'awaiting-human')) return { lifecycle: 'awaiting_approval', reason: `Workflow run ${entity.id} awaits a decision.` }
    return { lifecycle: 'in_progress', reason: `Workflow run ${entity.id} remains active.` }
  }
  if (entity.kind === 'scheduled-work') {
    const order = readScheduledOrder(workspaceRootPath, entity.id)
    if (!order) return null
    if (order.status === 'done') return { lifecycle: 'completed', outcome: 'successful', reason: `Scheduled work ${entity.id} completed.` }
    if (order.status === 'needs-attention' || order.status === 'canceled') return { lifecycle: 'failed', outcome: 'unsuccessful', reason: `Scheduled work ${entity.id} ended ${order.status}.` }
    if (order.status === 'needs-approval' || order.status === 'awaiting-review') return { lifecycle: 'awaiting_approval', reason: `Scheduled work ${entity.id} awaits approval.` }
    return { lifecycle: 'in_progress', reason: `Scheduled work ${entity.id} remains active.` }
  }
  const automation = latestAutomationResult(workspaceRootPath, entity.id)
  if (!automation) return null
  return automation.ok
    ? { lifecycle: 'completed', outcome: 'successful', reason: `Automation ${entity.id} recovered successfully.` }
    : { lifecycle: 'failed', outcome: 'unsuccessful', reason: `Automation ${entity.id} remains failed.` }
}

function readScheduledOrder(workspaceRootPath: string, orderId: string) {
  const doc = loadContextDoc(workspaceRootPath, SCHEDULED_WORK_CONTEXT_SLUG)
  if (!doc) return undefined
  const fenced = doc.body.match(/```json\s*([\s\S]*?)```/i)?.[1]
  try {
    const raw = JSON.parse(fenced ?? doc.body) as { workspaceId?: string }
    if (!raw.workspaceId) return undefined
    const parsed = parseScheduledWorkDocResult(doc, raw.workspaceId)
    return parsed.ok ? parsed.work.items.find((item) => item.id === orderId && !item.deletedAt) : undefined
  } catch {
    return undefined
  }
}

function latestAutomationResult(workspaceRootPath: string, automationId: string): { ok: boolean } | null {
  const file = join(workspaceRootPath, AUTOMATIONS_HISTORY_FILE)
  if (!existsSync(file)) return null
  let latest: { ts: number; ok: boolean } | null = null
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try {
      const value = JSON.parse(line) as { id?: string; ts?: number; ok?: boolean }
      if (value.id === automationId && typeof value.ts === 'number' && (!latest || value.ts > latest.ts)) latest = { ts: value.ts, ok: value.ok === true }
    } catch { /* malformed history is surfaced by source health */ }
  }
  return latest
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

import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  type HqRecommendationCandidate,
  type HqRecommendationDetail,
  type HqRecommendationLaunchInput,
  type HqRecommendationLaunchResult,
  type HqRecommendationStore,
  type HqRecommendationTransitionInput,
  type HqRecommendationUsefulnessInput,
  type HqRecommendationOutcome,
  parseHqStateOfPlay,
} from '@craft-agent/shared/hq-state'
import { readHqRecommendationEvents, readHqRecommendationOutcomes, readHqRecommendationStore, transitionHqRecommendation, upsertHqRecommendationOutcome } from '@craft-agent/shared/hq-state/recommendation-storage'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { loadAllContextDocs } from '@craft-agent/shared/workspace-context'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { refreshHqStateContextDoc, refreshHqStateContextDocBestEffort } from '../../hq-state/refresh'
import { withWorkspaceContextLock } from '../../scheduled-work/workspace-context-lock'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.hqState.REFRESH,
  RPC_CHANNELS.hqState.LIST_RECOMMENDATIONS,
  RPC_CHANNELS.hqState.GET_RECOMMENDATION_DETAIL,
  RPC_CHANNELS.hqState.SET_RECOMMENDATION_USEFULNESS,
  RPC_CHANNELS.hqState.TRANSITION_RECOMMENDATION,
  RPC_CHANNELS.hqState.LAUNCH_RECOMMENDATION,
] as const

export function registerHqStateHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.hqState.REFRESH, async (_ctx, workspaceId: string): Promise<{ generatedAt: string }> => {
    const rootPath = resolveRootPath(workspaceId)
    return withWorkspaceContextLock(rootPath, async () => {
      const refreshed = refreshHqStateContextDoc(rootPath)
      const state = parseHqStateOfPlay(refreshed.body)
      if (!state) throw new Error('Regenerated State of Play could not be read.')
      const wsServerLike = deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } }
      wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, loadAllContextDocs(rootPath))
      return { generatedAt: state.generatedAt }
    })
  })

  server.handle(RPC_CHANNELS.hqState.LIST_RECOMMENDATIONS, async (_ctx, workspaceId: string): Promise<HqRecommendationStore> => {
    return readHqRecommendationStore(resolveRootPath(workspaceId))
  })

  server.handle(RPC_CHANNELS.hqState.GET_RECOMMENDATION_DETAIL, async (_ctx, workspaceId: string, recommendationId: string): Promise<HqRecommendationDetail> => {
    const rootPath = resolveRootPath(workspaceId)
    validateRecommendationId(recommendationId)
    const candidate = readHqRecommendationStore(rootPath).candidates.find((item) => item.id === recommendationId)
    if (!candidate) throw new Error(`Recommendation not found: ${recommendationId}`)
    return {
      candidate,
      events: readHqRecommendationEvents(rootPath, recommendationId),
      outcome: readHqRecommendationOutcomes(rootPath).find((item) => item.recommendationId === recommendationId),
    }
  })

  server.handle(RPC_CHANNELS.hqState.SET_RECOMMENDATION_USEFULNESS, async (_ctx, workspaceId: string, input: HqRecommendationUsefulnessInput): Promise<HqRecommendationOutcome> => {
    const rootPath = resolveRootPath(workspaceId)
    validateRecommendationId(input?.recommendationId)
    if (!['useful', 'neutral', 'not_useful'].includes(input?.usefulness)) throw new Error('A valid usefulness value is required.')
    return withWorkspaceContextLock(rootPath, async () => {
      const candidate = readHqRecommendationStore(rootPath).candidates.find((item) => item.id === input.recommendationId)
      if (!candidate) throw new Error(`Recommendation not found: ${input.recommendationId}`)
      const prior = readHqRecommendationOutcomes(rootPath).find((item) => item.recommendationId === candidate.id)
      const outcome = upsertHqRecommendationOutcome(rootPath, {
        version: 1,
        recommendationId: candidate.id,
        status: prior?.status ?? 'unknown',
        evaluatedAt: prior?.evaluatedAt ?? new Date().toISOString(),
        evidence: prior?.evidence ?? [],
        userUsefulness: input.usefulness,
        notes: input.notes?.trim() || prior?.notes,
      })
      refreshAndBroadcast(deps, workspaceId, rootPath)
      return outcome
    })
  })

  server.handle(RPC_CHANNELS.hqState.TRANSITION_RECOMMENDATION, async (
    _ctx,
    workspaceId: string,
    input: HqRecommendationTransitionInput,
  ): Promise<HqRecommendationCandidate> => {
    const rootPath = resolveRootPath(workspaceId)
    validateTransitionInput(input)
    return withWorkspaceContextLock(rootPath, async () => {
      const candidate = transitionHqRecommendation(rootPath, input.recommendationId, input.to, {
        actor: { type: 'user' },
        reason: input.reason,
        snoozedUntil: input.snoozedUntil,
        executionRef: input.executionRef,
      })
      refreshHqStateContextDocBestEffort(rootPath)
      const wsServerLike = deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } }
      wsServerLike.wsServer?.push?.(
        RPC_CHANNELS.workspaceContext.CHANGED,
        { to: 'all' },
        workspaceId,
        loadAllContextDocs(rootPath),
      )
      return candidate
    })
  })

  server.handle(RPC_CHANNELS.hqState.LAUNCH_RECOMMENDATION, async (
    _ctx,
    workspaceId: string,
    input: HqRecommendationLaunchInput,
  ): Promise<HqRecommendationLaunchResult> => {
    const rootPath = resolveRootPath(workspaceId)
    validateRecommendationId(input?.recommendationId)
    return withWorkspaceContextLock(rootPath, async () => {
      let candidate = readHqRecommendationStore(rootPath).candidates.find((item) => item.id === input.recommendationId)
      if (!candidate) throw new Error(`Recommendation not found: ${input.recommendationId}`)
      const route = candidate.route
      if (route?.target !== 'agent' || !route.agentSlug || route.blockedReason) {
        throw new Error(route?.blockedReason ?? 'Recommendation does not have a launchable agent route.')
      }
      if (!['proposed', 'viewed', 'accepted', 'failed'].includes(candidate.status)) {
        throw new Error(`Recommendation cannot launch from status ${candidate.status}.`)
      }
      if (candidate.status !== 'accepted') {
        candidate = transitionHqRecommendation(rootPath, candidate.id, 'accepted', {
          actor: { type: 'user' },
          reason: `Accepted route to @${route.agentSlug}.`,
        })
      }

      const recommendationId = candidate.id
      let sessionId: string | undefined
      try {
        const options = await deps.sessionManager.resolveAgentSessionOptions(workspaceId, route.agentSlug)
        const session = await deps.sessionManager.createSession(workspaceId, options)
        sessionId = session.id
        candidate = transitionHqRecommendation(rootPath, candidate.id, 'launched', {
          actor: { type: 'system' },
          reason: `Created and linked @${route.agentSlug} session.`,
          executionRef: { kind: 'session', id: session.id, linkedAt: new Date().toISOString() },
        })
        await sendPersistedMessage(deps, session.id, launchPrompt(candidate, route.prompt))
      } catch (error) {
        const current = readHqRecommendationStore(rootPath).candidates.find((item) => item.id === recommendationId)
        if (current && (current.status === 'accepted' || current.status === 'launched')) {
          transitionHqRecommendation(rootPath, current.id, 'failed', {
            actor: { type: 'system' },
            reason: error instanceof Error ? error.message : String(error),
          })
        }
        if (sessionId) await deps.sessionManager.deleteSession(sessionId).catch(() => undefined)
        refreshAndBroadcast(deps, workspaceId, rootPath)
        throw error
      }

      refreshAndBroadcast(deps, workspaceId, rootPath)
      return { recommendation: candidate, sessionId: sessionId! }
    })
  })
}

function validateRecommendationId(recommendationId: string | undefined): asserts recommendationId is string {
  if (!recommendationId?.startsWith('sop_')) throw new Error('A valid recommendation ID is required.')
}

function launchPrompt(candidate: HqRecommendationCandidate, prompt: string): string {
  if (candidate.completionContract.type !== 'output') return prompt
  return [
    prompt,
    '',
    'Completion contract:',
    '- Produce the requested deliverable as a RunnerOS Output.',
    `- Add the exact Output tag: ${candidate.completionContract.requiredTag}`,
    '- Do not claim completion until that tagged Output exists.',
  ].join('\n')
}

function sendPersistedMessage(deps: HandlerDeps, sessionId: string, prompt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let acknowledged = false
    const onAck = () => {
      if (acknowledged) return
      acknowledged = true
      resolve()
    }
    deps.sessionManager.sendMessage(sessionId, prompt, undefined, undefined, undefined, undefined, undefined, onAck)
      .then(() => {
        if (!acknowledged) reject(new Error('Recommendation message was not persisted.'))
      })
      .catch(reject)
  })
}

function refreshAndBroadcast(deps: HandlerDeps, workspaceId: string, rootPath: string): void {
  refreshHqStateContextDocBestEffort(rootPath)
  const wsServerLike = deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } }
  wsServerLike.wsServer?.push?.(
    RPC_CHANNELS.workspaceContext.CHANGED,
    { to: 'all' },
    workspaceId,
    loadAllContextDocs(rootPath),
  )
}

function validateTransitionInput(input: HqRecommendationTransitionInput): void {
  if (!input?.recommendationId?.startsWith('sop_')) throw new Error('A valid recommendation ID is required.')
  if (!['viewed', 'accepted', 'dismissed', 'snoozed', 'launched'].includes(input.to)) {
    throw new Error(`Recommendation transition is not user-accessible: ${input.to}`)
  }
  if (input.to === 'snoozed') {
    const until = Date.parse(input.snoozedUntil ?? '')
    if (Number.isNaN(until) || until <= Date.now()) throw new Error('Snooze requires a future snoozedUntil timestamp.')
  }
  if (input.to === 'launched' && (input.executionRef?.kind !== 'session' || !input.executionRef.id)) {
    throw new Error('A launched recommendation requires a linked session.')
  }
}

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  type HqRecommendationCandidate,
  type HqRecommendationStore,
  type HqRecommendationTransitionInput,
} from '@craft-agent/shared/hq-state'
import { readHqRecommendationStore, transitionHqRecommendation } from '@craft-agent/shared/hq-state/recommendation-storage'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { loadAllContextDocs } from '@craft-agent/shared/workspace-context'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { refreshHqStateContextDocBestEffort } from '../../hq-state/refresh'
import { withWorkspaceContextLock } from '../../scheduled-work/workspace-context-lock'

export function registerHqStateHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.hqState.LIST_RECOMMENDATIONS, async (_ctx, workspaceId: string): Promise<HqRecommendationStore> => {
    return readHqRecommendationStore(resolveRootPath(workspaceId))
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

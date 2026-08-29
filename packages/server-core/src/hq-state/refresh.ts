import {
  buildManagerBrief,
  buildHqStateContextDoc,
  HQ_STATE_CONTEXT_SLUG,
  serializeHqStateOfPlay,
} from '@craft-agent/shared/hq-state'
import {
  loadAllContextDocs,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import { persistHqRecommendations, reconcileHqRecommendationOutcomes } from './recommendations'
import { readHqRecommendationOutcomes, readHqRecommendationStore } from '@craft-agent/shared/hq-state/recommendation-storage'
import { getWorkspaces } from '@craft-agent/shared/config'
import { buildHqStateInput, findArtistHqWorkspace } from './snapshot'

const scheduledRefreshes = new Map<string, ReturnType<typeof setTimeout>>()
const REFRESH_DEBOUNCE_MS = 100

export function shouldRefreshHqStateForContextSlug(slug: string): boolean {
  return slug !== HQ_STATE_CONTEXT_SLUG
}

export function refreshHqStateContextDoc(workspaceRootPath: string): LoadedContextDoc {
  const docs = loadAllContextDocs(workspaceRootPath)
  const input = buildHqStateInput(workspaceRootPath)
  reconcileHqRecommendationOutcomes(workspaceRootPath)
  const built = buildHqStateContextDoc(input)
  applyRecentOutcome(built.state, workspaceRootPath)
  const recommendations = persistHqRecommendations(
    workspaceRootPath,
    built.state,
    input.operational?.scope ?? { type: 'hq' },
  )
  applyRecommendationState(built.state.nextMove, recommendations[0])
  built.state.alternatives.forEach((move, index) => applyRecommendationState(move, recommendations[index + 1]))
  promoteActiveRecommendation(built.state)
  if (built.state.version === 2) {
    built.state.managerBrief = buildManagerBrief({
      ...input,
      operatingState: {
        nextMove: built.state.nextMove,
        attention: built.state.attention,
        blockers: built.state.missing,
      },
    })
  }
  built.body = serializeHqStateOfPlay(built.state)
  const existing = docs.find((doc) => doc.slug === HQ_STATE_CONTEXT_SLUG)
  return upsertContextDoc(workspaceRootPath, {
    slug: built.slug,
    metadata: existing
      ? {
          ...built.metadata,
          enabled: existing.metadata.enabled,
        }
      : built.metadata,
    body: built.body,
  })
}

/** Refresh the one Artist HQ brief after a change in either HQ or a campaign workspace. */
export function refreshArtistHqStateForWorkspaceBestEffort(changedRootPath: string): LoadedContextDoc | null {
  const targetRootPath = resolveHqRefreshRoot(changedRootPath)
  if (!targetRootPath) {
    console.warn('[hq-state] Failed to refresh State of Play context doc: no Artist HQ workspace is configured')
    return null
  }
  return refreshHqStateContextDocBestEffort(targetRootPath)
}

function applyRecentOutcome(state: import('@craft-agent/shared/hq-state').HqStateOfPlay, workspaceRootPath: string): void {
  const outcomes = new Map(readHqRecommendationOutcomes(workspaceRootPath).map((outcome) => [outcome.recommendationId, outcome]))
  const candidate = readHqRecommendationStore(workspaceRootPath).candidates
    .filter((item) => ['completed', 'failed', 'superseded'].includes(item.status) && outcomes.has(item.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (!candidate) return
  const outcome = outcomes.get(candidate.id)!
  state.recentOutcome = {
    recommendationId: candidate.id,
    title: candidate.title,
    recommendationStatus: candidate.status as 'completed' | 'failed' | 'superseded',
    outcomeStatus: outcome.status,
    evaluatedAt: outcome.evaluatedAt,
    userUsefulness: outcome.userUsefulness,
  }
}

function promoteActiveRecommendation(state: import('@craft-agent/shared/hq-state').HqStateOfPlay): void {
  const moves = [state.nextMove, ...state.alternatives]
  const active = moves.filter((move) => !['dismissed', 'snoozed', 'completed', 'expired', 'superseded'].includes(move.recommendationStatus ?? 'proposed'))
  if (active.length === 0) return
  state.nextMove = active[0]!
  state.alternatives = active.slice(1, 4)
}

function applyRecommendationState(
  move: import('@craft-agent/shared/hq-state').HqStateNextMove,
  recommendation: import('@craft-agent/shared/hq-state').HqRecommendationCandidate | undefined,
): void {
  if (!recommendation) return
  move.recommendationId = recommendation.id
  move.recommendationStatus = recommendation.status
  move.snoozedUntil = recommendation.snoozedUntil
  const outputRef = [...recommendation.executionRefs].reverse().find((ref) => ref.kind === 'output')
  if (outputRef) move.entityRef = { kind: 'output', id: outputRef.id, source: `output:${outputRef.id}`, scope: recommendation.scope }
}

export function refreshHqStateContextDocBestEffort(workspaceRootPath: string): LoadedContextDoc | null {
  try {
    return refreshHqStateContextDoc(workspaceRootPath)
  } catch (error) {
    console.warn('[hq-state] Failed to refresh State of Play context doc:', error instanceof Error ? error.message : error)
    return null
  }
}

export function scheduleHqStateContextRefresh(workspaceRootPath: string): void {
  const targetRootPath = resolveHqRefreshRoot(workspaceRootPath)
  if (!targetRootPath) return
  const pending = scheduledRefreshes.get(targetRootPath)
  if (pending) clearTimeout(pending)
  const timer = setTimeout(() => {
    scheduledRefreshes.delete(targetRootPath)
    refreshHqStateContextDocBestEffort(targetRootPath)
  }, REFRESH_DEBOUNCE_MS)
  timer.unref?.()
  scheduledRefreshes.set(targetRootPath, timer)
}

export function cancelScheduledHqStateContextRefresh(workspaceRootPath: string): void {
  const targetRootPath = resolveHqRefreshRoot(workspaceRootPath) ?? workspaceRootPath
  const pending = scheduledRefreshes.get(targetRootPath)
  if (!pending) return
  clearTimeout(pending)
  scheduledRefreshes.delete(targetRootPath)
}

function resolveHqRefreshRoot(changedRootPath: string): string | null {
  const changedWorkspace = getWorkspaces().find((workspace) => workspace.rootPath === changedRootPath)
  if (!changedWorkspace) return changedRootPath
  const hq = findArtistHqWorkspace()
  if (hq) return hq.rootPath
  return changedWorkspace.artistWorkspaceScope === 'hq' ? changedRootPath : null
}

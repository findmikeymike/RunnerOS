import {
  buildCampaignManagerBrief,
  buildManagerBrief,
  buildHqStateContextDoc,
  campaignStateContextMetadata,
  CAMPAIGN_STATE_CONTEXT_SLUG,
  HQ_STATE_CONTEXT_SLUG,
  parseCampaignManagerBrief,
  parseHqStateOfPlay,
  serializeCampaignManagerBrief,
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
import { buildHqStateInput, buildManagerCampaignSnapshot, findArtistHqWorkspace } from './snapshot'
import { buildHqOperationalSnapshot } from './operational'

const scheduledRefreshes = new Map<string, ReturnType<typeof setTimeout>>()
const REFRESH_DEBOUNCE_MS = 100
const refreshDiagnostics = new Map<string, HqStateRefreshDiagnostic>()
const campaignRefreshDiagnostics = new Map<string, HqStateRefreshDiagnostic>()

export interface HqStateRefreshDiagnostic {
  workspaceRootPath: string
  status: 'success' | 'failed'
  attemptedAt: string
  revision?: string
  error?: string
}

export function shouldRefreshHqStateForContextSlug(slug: string): boolean {
  return slug !== HQ_STATE_CONTEXT_SLUG && slug !== CAMPAIGN_STATE_CONTEXT_SLUG
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

/** Refreshes every derived manager brief affected by a canonical workspace mutation. */
export function refreshArtistManagerStateForWorkspaceBestEffort(changedRootPath: string): {
  hq: LoadedContextDoc | null
  campaigns: LoadedContextDoc[]
} {
  const hq = refreshArtistHqStateForWorkspaceBestEffort(changedRootPath)
  const changedWorkspace = getWorkspaces().find((workspace) => workspace.rootPath === changedRootPath)
  const targets = changedWorkspace?.artistWorkspaceScope === 'hq'
    ? getWorkspaces().filter((workspace) => workspace.artistWorkspaceScope === 'campaign')
    : changedWorkspace?.artistWorkspaceScope === 'campaign'
      ? [changedWorkspace]
      : []
  const campaigns = targets
    .map((workspace) => refreshCampaignStateContextDocBestEffort(workspace.rootPath))
    .filter((doc): doc is LoadedContextDoc => Boolean(doc))
  return { hq, campaigns }
}

export function refreshCampaignStateContextDoc(campaignRootPath: string): LoadedContextDoc {
  const campaignWorkspace = getWorkspaces().find((workspace) => (
    workspace.rootPath === campaignRootPath && workspace.artistWorkspaceScope === 'campaign'
  ))
  if (!campaignWorkspace) throw new Error(`Campaign workspace is not configured: ${campaignRootPath}`)
  const hqWorkspace = findArtistHqWorkspace()
  if (!hqWorkspace) throw new Error('Artist HQ workspace is not configured.')

  const artistState = buildHqStateContextDoc(buildHqStateInput(hqWorkspace.rootPath)).state
  if (artistState.version !== 2) throw new Error('Artist HQ Manager Brief is unavailable.')
  const brief = buildCampaignManagerBrief({
    artistWorkspaceId: hqWorkspace.id,
    artistBrief: artistState.managerBrief,
    campaign: buildManagerCampaignSnapshot(campaignWorkspace, true),
    operational: buildHqOperationalSnapshot(campaignRootPath),
  })
  const existing = loadAllContextDocs(campaignRootPath).find((doc) => doc.slug === CAMPAIGN_STATE_CONTEXT_SLUG)
  return upsertContextDoc(campaignRootPath, {
    slug: CAMPAIGN_STATE_CONTEXT_SLUG,
    metadata: existing
      ? { ...campaignStateContextMetadata(), enabled: existing.metadata.enabled }
      : campaignStateContextMetadata(),
    body: serializeCampaignManagerBrief(brief),
  })
}

export function refreshCampaignStateContextDocBestEffort(campaignRootPath: string): LoadedContextDoc | null {
  const attemptedAt = new Date().toISOString()
  try {
    const refreshed = refreshCampaignStateContextDoc(campaignRootPath)
    const brief = parseCampaignManagerBrief(refreshed.body)
    campaignRefreshDiagnostics.set(campaignRootPath, {
      workspaceRootPath: campaignRootPath,
      status: 'success',
      attemptedAt,
      revision: brief?.revision,
    })
    return refreshed
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    campaignRefreshDiagnostics.set(campaignRootPath, {
      workspaceRootPath: campaignRootPath,
      status: 'failed',
      attemptedAt,
      error: errorMessage,
    })
    console.warn('[hq-state] Failed to refresh Campaign State of Play context doc:', errorMessage)
    return null
  }
}

export function getCampaignStateRefreshDiagnostic(campaignRootPath: string): HqStateRefreshDiagnostic | null {
  return campaignRefreshDiagnostics.get(campaignRootPath) ?? null
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
  const attemptedAt = new Date().toISOString()
  try {
    const refreshed = refreshHqStateContextDoc(workspaceRootPath)
    const state = parseHqStateOfPlay(refreshed.body)
    refreshDiagnostics.set(workspaceRootPath, {
      workspaceRootPath,
      status: 'success',
      attemptedAt,
      revision: state?.version === 2 ? state.managerBrief.revision : undefined,
    })
    return refreshed
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    refreshDiagnostics.set(workspaceRootPath, {
      workspaceRootPath,
      status: 'failed',
      attemptedAt,
      error: errorMessage,
    })
    console.warn('[hq-state] Failed to refresh State of Play context doc:', errorMessage)
    return null
  }
}

export function getHqStateRefreshDiagnostic(workspaceRootPath: string): HqStateRefreshDiagnostic | null {
  return refreshDiagnostics.get(workspaceRootPath) ?? null
}

export function scheduleHqStateContextRefresh(workspaceRootPath: string): void {
  const changedWorkspace = getWorkspaces().find((workspace) => workspace.rootPath === workspaceRootPath)
  if (changedWorkspace?.artistWorkspaceScope === 'campaign') {
    scheduleRefresh(`campaign:${workspaceRootPath}`, () => refreshCampaignStateContextDocBestEffort(workspaceRootPath))
  } else if (changedWorkspace?.artistWorkspaceScope === 'hq') {
    for (const campaign of getWorkspaces().filter((workspace) => workspace.artistWorkspaceScope === 'campaign')) {
      scheduleRefresh(`campaign:${campaign.rootPath}`, () => refreshCampaignStateContextDocBestEffort(campaign.rootPath))
    }
  }
  const targetRootPath = resolveHqRefreshRoot(workspaceRootPath)
  if (!targetRootPath) return
  scheduleRefresh(`hq:${targetRootPath}`, () => refreshHqStateContextDocBestEffort(targetRootPath))
}

function scheduleRefresh(key: string, refresh: () => void): void {
  const pending = scheduledRefreshes.get(key)
  if (pending) clearTimeout(pending)
  const timer = setTimeout(() => {
    scheduledRefreshes.delete(key)
    refresh()
  }, REFRESH_DEBOUNCE_MS)
  timer.unref?.()
  scheduledRefreshes.set(key, timer)
}

export function cancelScheduledHqStateContextRefresh(workspaceRootPath: string): void {
  const targetRootPath = resolveHqRefreshRoot(workspaceRootPath) ?? workspaceRootPath
  const changedWorkspace = getWorkspaces().find((workspace) => workspace.rootPath === workspaceRootPath)
  const campaignKeys = changedWorkspace?.artistWorkspaceScope === 'hq'
    ? getWorkspaces().filter((workspace) => workspace.artistWorkspaceScope === 'campaign').map((workspace) => `campaign:${workspace.rootPath}`)
    : [`campaign:${workspaceRootPath}`]
  for (const key of [`hq:${targetRootPath}`, ...campaignKeys]) {
    const pending = scheduledRefreshes.get(key)
    if (!pending) continue
    clearTimeout(pending)
    scheduledRefreshes.delete(key)
  }
}

function resolveHqRefreshRoot(changedRootPath: string): string | null {
  const changedWorkspace = getWorkspaces().find((workspace) => workspace.rootPath === changedRootPath)
  if (!changedWorkspace) return changedRootPath
  const hq = findArtistHqWorkspace()
  if (hq) return hq.rootPath
  return changedWorkspace.artistWorkspaceScope === 'hq' ? changedRootPath : null
}

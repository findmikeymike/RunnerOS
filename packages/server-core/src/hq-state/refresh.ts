import {
  buildHqStateContextDoc,
  HQ_STATE_CONTEXT_SLUG,
  serializeHqStateOfPlay,
} from '@craft-agent/shared/hq-state'
import {
  loadAllContextDocs,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import { buildHqOperationalSnapshot } from './operational'
import { persistPrimaryHqRecommendation } from './recommendations'

const scheduledRefreshes = new Map<string, ReturnType<typeof setTimeout>>()
const REFRESH_DEBOUNCE_MS = 100

export function shouldRefreshHqStateForContextSlug(slug: string): boolean {
  return slug !== HQ_STATE_CONTEXT_SLUG
}

export function refreshHqStateContextDoc(workspaceRootPath: string): LoadedContextDoc {
  const docs = loadAllContextDocs(workspaceRootPath)
  const operational = buildHqOperationalSnapshot(workspaceRootPath)
  const built = buildHqStateContextDoc({ docs, operational })
  const recommendation = persistPrimaryHqRecommendation(workspaceRootPath, built.state, operational.scope)
  built.state.nextMove.recommendationId = recommendation.id
  built.state.nextMove.recommendationStatus = recommendation.status
  built.state.nextMove.snoozedUntil = recommendation.snoozedUntil
  built.body = serializeHqStateOfPlay(built.state)
  const existing = docs.find((doc) => doc.slug === HQ_STATE_CONTEXT_SLUG)
  return upsertContextDoc(workspaceRootPath, {
    slug: built.slug,
    metadata: existing
      ? {
          ...built.metadata,
          routing: existing.metadata.routing,
          enabled: existing.metadata.enabled,
        }
      : built.metadata,
    body: built.body,
  })
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
  const pending = scheduledRefreshes.get(workspaceRootPath)
  if (pending) clearTimeout(pending)
  const timer = setTimeout(() => {
    scheduledRefreshes.delete(workspaceRootPath)
    refreshHqStateContextDocBestEffort(workspaceRootPath)
  }, REFRESH_DEBOUNCE_MS)
  timer.unref?.()
  scheduledRefreshes.set(workspaceRootPath, timer)
}

export function cancelScheduledHqStateContextRefresh(workspaceRootPath: string): void {
  const pending = scheduledRefreshes.get(workspaceRootPath)
  if (!pending) return
  clearTimeout(pending)
  scheduledRefreshes.delete(workspaceRootPath)
}

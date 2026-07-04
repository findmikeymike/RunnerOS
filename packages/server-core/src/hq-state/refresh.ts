import {
  buildHqStateContextDoc,
  HQ_STATE_CONTEXT_SLUG,
} from '@craft-agent/shared/hq-state'
import {
  loadAllContextDocs,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'

export function shouldRefreshHqStateForContextSlug(slug: string): boolean {
  return slug !== HQ_STATE_CONTEXT_SLUG
}

export function refreshHqStateContextDoc(workspaceRootPath: string): LoadedContextDoc {
  const docs = loadAllContextDocs(workspaceRootPath)
  const built = buildHqStateContextDoc({ docs })
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

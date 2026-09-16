import { useCallback, useEffect } from 'react'
import { useAtom } from 'jotai'
import { workspaceContextStateAtomFamily, type WorkspaceContextState } from '@/atoms/workspace-context'
import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'
import { WorkspaceContextSubscriptions } from './workspace-context-subscriptions'

export interface UseWorkspaceContextResult {
  docs: ContextDocDTO[]
  loading: boolean
  error: string | null
  refresh: (ensureFresh?: boolean) => Promise<void>
  upsert: (input: { slug: string; metadata: ContextDocMetadata; body: string; expectedBody?: string | null }) => Promise<ContextDocDTO>
  remove: (slug: string) => Promise<boolean>
}

const NULL_WORKSPACE_KEY = '__no_workspace__'
const subscriptions = new WorkspaceContextSubscriptions()
const inFlightRefreshes = new Map<string, Promise<void>>()
const invalidatedWorkspaceKeys = new Set<string>()
const mountedWorkspaceKeys = new Map<string, number>()
let workspaceContextCleanup: (() => void) | null = null

function getWorkspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? NULL_WORKSPACE_KEY
}

function sortDocs(docs: ContextDocDTO[]): ContextDocDTO[] {
  return [...docs].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
}

export function shouldRefreshWorkspaceContext(state: WorkspaceContextState, hasLoaded: boolean): boolean {
  return !hasLoaded || state.loading
}

export function useWorkspaceContext(workspaceId: string | null | undefined): UseWorkspaceContextResult {
  const workspaceKey = getWorkspaceKey(workspaceId)
  const [state, setState] = useAtom(workspaceContextStateAtomFamily(workspaceKey))

  const refresh = useCallback(async (ensureFresh = false) => {
    // A changed event must not disappear behind a fetch that started before it.
    // Coalesce events by workspace and discard any superseded response.
    if (ensureFresh) invalidatedWorkspaceKeys.add(workspaceKey)
    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) return existing

    const run = (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        do {
          invalidatedWorkspaceKeys.delete(workspaceKey)
          try {
            const docs = await (workspaceId
              ? window.electronAPI.listWorkspaceContextDocs(workspaceId)
              : Promise.resolve([]))
            if (invalidatedWorkspaceKeys.has(workspaceKey)) continue
            setState({ docs: sortDocs(docs), loading: false, error: null })
            subscriptions.markLoaded(workspaceKey)
          } catch (err) {
            if (invalidatedWorkspaceKeys.has(workspaceKey)) continue
            setState((prev) => ({
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : String(err),
            }))
          }
        } while (invalidatedWorkspaceKeys.has(workspaceKey))
      } finally {
        inFlightRefreshes.delete(workspaceKey)
      }
    })()

    inFlightRefreshes.set(workspaceKey, run)
    return run
  }, [setState, workspaceId, workspaceKey])

  useEffect(() => subscriptions.subscribe(workspaceKey, refresh), [refresh, workspaceKey])

  useEffect(() => {
    if (shouldRefreshWorkspaceContext(state, subscriptions.hasLoaded(workspaceKey))) {
      void refresh()
    }
  }, [refresh, state.loading, workspaceKey])

  useEffect(() => {
    mountedWorkspaceKeys.set(workspaceKey, (mountedWorkspaceKeys.get(workspaceKey) ?? 0) + 1)
    if (!workspaceContextCleanup) {
      workspaceContextCleanup = window.electronAPI.onWorkspaceContextChanged((changedWorkspaceId, docs) => {
        const changedKey = getWorkspaceKey(changedWorkspaceId)
        subscriptions.refreshChanged(changedKey)
        void docs
      })
    }
    return () => {
      const nextCount = (mountedWorkspaceKeys.get(workspaceKey) ?? 1) - 1
      if (nextCount <= 0) {
        mountedWorkspaceKeys.delete(workspaceKey)
        // This workspace no longer observes mutations. Its cached documents
        // must be re-read when a page returns after work completes elsewhere.
      }
      else mountedWorkspaceKeys.set(workspaceKey, nextCount)

      if (mountedWorkspaceKeys.size === 0 && workspaceContextCleanup) {
        workspaceContextCleanup()
        workspaceContextCleanup = null
      }
    }
  }, [workspaceKey])

  const upsert = useCallback(async (input: { slug: string; metadata: ContextDocMetadata; body: string; expectedBody?: string | null }) => {
    if (!workspaceId) throw new Error('No active workspace')
    const saved = await window.electronAPI.upsertWorkspaceContextDoc(workspaceId, input)
    setState((prev) => {
      const next = prev.docs.filter((d) => d.slug !== saved.slug)
      next.push(saved)
      return { ...prev, docs: sortDocs(next), loading: false, error: null }
    })
    return saved
  }, [setState, workspaceId])

  const remove = useCallback(async (slug: string) => {
    if (!workspaceId) return false
    const ok = await window.electronAPI.deleteWorkspaceContextDoc(workspaceId, slug)
    if (ok) {
      setState((prev) => ({
        ...prev,
        docs: prev.docs.filter((d) => d.slug !== slug),
      }))
    }
    return ok
  }, [setState, workspaceId])

  return {
    docs: state.docs,
    loading: state.loading,
    error: state.error,
    refresh,
    upsert,
    remove,
  }
}

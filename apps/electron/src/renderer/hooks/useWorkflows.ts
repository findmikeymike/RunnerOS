/**
 * useWorkflows
 *
 * Renderer-side state for the workflow library. Loads:
 *   - Every workflow in the global library
 *   - The slugs activated in the current workspace
 *
 * Subscribes to the workflows:changed broadcast so the list stays fresh
 * when other clients (or background mutations) edit the library.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useAtom } from 'jotai'
import { workflowsStateAtomFamily, type WorkflowsState } from '@/atoms/workflows'
import type { WorkflowDTO, WorkflowMetadataDTO } from '../../shared/types'

export interface UseWorkflowsResult {
  allWorkflows: WorkflowDTO[]
  activeSlugs: string[]
  activeWorkflows: WorkflowDTO[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setActive: (slug: string, active: boolean) => Promise<void>
  upsert: (input: {
    slug: string
    metadata: WorkflowMetadataDTO
    body: string
  }) => Promise<WorkflowDTO>
  remove: (slug: string) => Promise<boolean>
}

const NULL_WORKSPACE_KEY = '__no_workspace__'
const inFlightRefreshes = new Map<string, Promise<void>>()
const queuedRefreshes = new Set<string>()
let globalWorkflowsCleanup: (() => void) | null = null
const refreshersByWorkspaceKey = new Map<string, Set<() => Promise<void>>>()

function getWorkspaceKey(activeWorkspaceId: string | null | undefined): string {
  return activeWorkspaceId ?? NULL_WORKSPACE_KEY
}

function sortWorkflows(workflows: WorkflowDTO[]): WorkflowDTO[] {
  return [...workflows].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
}

export function useWorkflows(activeWorkspaceId: string | null | undefined): UseWorkflowsResult {
  const workspaceKey = getWorkspaceKey(activeWorkspaceId)
  const [state, setState] = useAtom(workflowsStateAtomFamily(workspaceKey))

  const refresh = useCallback(async () => {
    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) {
      queuedRefreshes.add(workspaceKey)
      return existing
    }

    const run = (async () => {
      try {
        do {
          queuedRefreshes.delete(workspaceKey)
          setState((prev) => ({ ...prev, loading: true }))
          try {
            const [libraryRaw, activeRaw] = await Promise.all([
              window.electronAPI.listAllWorkflows(),
              activeWorkspaceId
                ? window.electronAPI.listActiveWorkflowsInWorkspace(activeWorkspaceId)
                : Promise.resolve([] as string[]),
            ])
            const next: WorkflowsState = {
              allWorkflows: sortWorkflows(libraryRaw),
              activeSlugs: activeRaw,
              loading: false,
              error: null,
            }
            setState(next)
          } catch (err) {
            setState((prev) => ({
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : String(err),
            }))
          }
        } while (queuedRefreshes.has(workspaceKey))
      } finally {
        inFlightRefreshes.delete(workspaceKey)
      }
    })()

    inFlightRefreshes.set(workspaceKey, run)
    return run
  }, [activeWorkspaceId, setState, workspaceKey])

  useEffect(() => {
    const refreshers = refreshersByWorkspaceKey.get(workspaceKey) ?? new Set<() => Promise<void>>()
    refreshers.add(refresh)
    refreshersByWorkspaceKey.set(workspaceKey, refreshers)
    if (!globalWorkflowsCleanup) {
      globalWorkflowsCleanup = window.electronAPI.onWorkflowsChanged(() => {
        for (const workspaceRefreshers of refreshersByWorkspaceKey.values()) {
          for (const refreshWorkspace of workspaceRefreshers) void refreshWorkspace()
        }
      })
    }
    return () => {
      const current = refreshersByWorkspaceKey.get(workspaceKey)
      current?.delete(refresh)
      if (current?.size === 0) refreshersByWorkspaceKey.delete(workspaceKey)
      if (refreshersByWorkspaceKey.size === 0 && globalWorkflowsCleanup) {
        globalWorkflowsCleanup()
        globalWorkflowsCleanup = null
      }
    }
  }, [refresh, workspaceKey])

  useEffect(() => {
    void refresh()
  }, [refresh, workspaceKey])

  const setActive = useCallback(async (slug: string, active: boolean) => {
    if (!activeWorkspaceId) return
    const result = await window.electronAPI.setWorkflowActive(activeWorkspaceId, slug, active)
    setState((prev) => ({ ...prev, activeSlugs: result.active }))
  }, [activeWorkspaceId, setState])

  const upsert = useCallback(async (input: {
    slug: string
    metadata: WorkflowMetadataDTO
    body: string
  }): Promise<WorkflowDTO> => {
    const created = await window.electronAPI.upsertWorkflow({
      ...input,
      activateInWorkspaceId: activeWorkspaceId ?? undefined,
    })
    setState((prev) => {
      const next = prev.allWorkflows.filter((w) => w.slug !== created.slug)
      next.push(created)
      next.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
      return { ...prev, allWorkflows: next }
    })
    if (activeWorkspaceId) {
      setState((prev) => ({
        ...prev,
        activeSlugs: prev.activeSlugs.includes(created.slug)
          ? prev.activeSlugs
          : [...prev.activeSlugs, created.slug],
      }))
    }
    return created
  }, [activeWorkspaceId, setState])

  const remove = useCallback(async (slug: string) => {
    const ok = await window.electronAPI.deleteWorkflow(slug)
    if (ok) {
      setState((prev) => ({
        ...prev,
        allWorkflows: prev.allWorkflows.filter((w) => w.slug !== slug),
        activeSlugs: prev.activeSlugs.filter((s) => s !== slug),
      }))
    }
    return ok
  }, [setState])

  const activeWorkflows = useMemo(() => {
    const activeSet = new Set(state.activeSlugs)
    return state.allWorkflows.filter((w) => activeSet.has(w.slug))
  }, [state.activeSlugs, state.allWorkflows])

  return {
    allWorkflows: state.allWorkflows,
    activeSlugs: state.activeSlugs,
    activeWorkflows,
    loading: state.loading,
    error: state.error,
    refresh,
    setActive,
    upsert,
    remove,
  }
}

/**
 * useWorkflowRuns
 *
 * Renderer-side state for the workflow run history of a workspace.
 * Subscribes to onWorkflowRunUpdated and splices live runs into the list
 * so the recent-runs page and the run page both stay reactive.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { workflowRunsStateAtomFamily, type WorkflowRunsState } from '@/atoms/workflow-runs'
import { RPC_CHANNELS, type WorkflowRunDTO } from '../../shared/types'
import { controlDurableRun, preferWorkflowRun, mergeWorkflowRuns } from '@/lib/durable-workflow-run'
import type { DurableWorkflowCommandDTO } from '../../shared/types'
import { startWorkflowRunDiscovery, refreshAfterUncertainWorkflowStart } from '@/lib/workflow-run-discovery'
import { useWorkspaceSyncRefresh } from './useWorkspaceSyncRefresh'

export interface UseWorkflowRunsResult {
  runs: WorkflowRunDTO[]
  loading: boolean
  hasLoaded: boolean
  listRevision: number
  error: string | null
  refresh: () => Promise<void>
  start: (workflowSlug: string, triggerInputs: Record<string, unknown>) => Promise<WorkflowRunDTO>
  cancel: (runId: string) => Promise<void>
  resume: (runId: string, stepId?: string) => Promise<WorkflowRunDTO>
  control: (run: WorkflowRunDTO, action: 'pause' | 'resume' | 'cancel') => Promise<void>
  canResume: boolean
  remove: (runId: string) => Promise<boolean>
}

const NULL_WORKSPACE_KEY = '__no_workspace__'
const inFlightRefreshes = new Map<string, Promise<void>>()
const mountedWorkspaceKeys = new Map<string, number>()
let globalRunsCleanup: (() => void) | null = null
const setStateByWorkspaceKey = new Map<string, (updater: (prev: WorkflowRunsState) => WorkflowRunsState) => void>()
const refreshersByWorkspaceKey = new Map<string, () => Promise<void>>()

function getWorkspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId ?? NULL_WORKSPACE_KEY
}

function sortRuns(runs: WorkflowRunDTO[]): WorkflowRunDTO[] {
  return [...runs].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

function spliceRun(runs: WorkflowRunDTO[], next: WorkflowRunDTO): WorkflowRunDTO[] {
  const filtered = runs.filter((r) => r.id !== next.id)
  filtered.push(preferWorkflowRun(runs.find(run => run.id === next.id), next))
  return sortRuns(filtered)
}

export function useWorkflowRuns(workspaceId: string | null | undefined): UseWorkflowRunsResult {
  const workspaceKey = getWorkspaceKey(workspaceId)
  const [state, setState] = useAtom(workflowRunsStateAtomFamily(workspaceKey))

  const controlCommands = useRef(new Map<string, DurableWorkflowCommandDTO>())
  const refresh = useCallback(async (authoritative = false, silent = false) => {
    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) return existing

    const run = (async () => {
      if (!silent) setState((prev) => ({ ...prev, loading: true }))
      try {
        const runs = workspaceId
          ? await window.electronAPI.listWorkflowRuns(workspaceId)
          : []
        setState((prev) => {
          return {
            runs: mergeWorkflowRuns(runs, prev.runs, authoritative),
            loading: false,
            hasLoaded: true,
            listRevision: prev.listRevision + 1,
            error: null,
          }
        })
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        inFlightRefreshes.delete(workspaceKey)
      }
    })()

    inFlightRefreshes.set(workspaceKey, run)
    return run
  }, [setState, workspaceId, workspaceKey])

  useWorkspaceSyncRefresh(workspaceId, ['workflow-runs', 'agent-messages'], () => refresh(true))

  useEffect(() => {
    refreshersByWorkspaceKey.set(workspaceKey, refresh)
    setStateByWorkspaceKey.set(workspaceKey, setState)
    return () => {
      if (refreshersByWorkspaceKey.get(workspaceKey) === refresh) {
        refreshersByWorkspaceKey.delete(workspaceKey)
      }
      if (setStateByWorkspaceKey.get(workspaceKey) === setState) {
        setStateByWorkspaceKey.delete(workspaceKey)
      }
    }
  }, [refresh, setState, workspaceKey])



  useEffect(() => {
    mountedWorkspaceKeys.set(workspaceKey, (mountedWorkspaceKeys.get(workspaceKey) ?? 0) + 1)
    if (!globalRunsCleanup) {
      globalRunsCleanup = window.electronAPI.onWorkflowRunUpdated((changedWorkspaceId, run) => {
        const changedKey = getWorkspaceKey(changedWorkspaceId)
        const setStateChanged = setStateByWorkspaceKey.get(changedKey)
        if (setStateChanged) {
          setStateChanged((prev) => ({ ...prev, runs: spliceRun(prev.runs, run) }))
        }
      })
    }
    return () => {
      const nextCount = (mountedWorkspaceKeys.get(workspaceKey) ?? 1) - 1
      if (nextCount <= 0) mountedWorkspaceKeys.delete(workspaceKey)
      else mountedWorkspaceKeys.set(workspaceKey, nextCount)

      if (mountedWorkspaceKeys.size === 0 && globalRunsCleanup) {
        globalRunsCleanup()
        globalRunsCleanup = null
      }
    }
  }, [workspaceKey])

  useEffect(() => {
    if (!workspaceId) return
    return startWorkflowRunDiscovery({ refresh: () => refresh(false, true), target: window })
  }, [workspaceId, refresh])

  const control = useCallback(async (run: WorkflowRunDTO, action: 'pause' | 'resume' | 'cancel') => {
    if (!workspaceId) throw new Error('No active workspace')
    try {
      const saved = await controlDurableRun({ workspaceId, run, action, commands: controlCommands.current, api: window.electronAPI })
      setState(prev => ({ ...prev, runs: spliceRun(prev.runs, saved) }))
    } catch (error) {
      await refresh(false, true)
      throw error
    }
  }, [workspaceId, setState, refresh])

  const start = useCallback(async (
    workflowSlug: string,
    triggerInputs: Record<string, unknown>,
  ): Promise<WorkflowRunDTO> => {
    if (!workspaceId) throw new Error('No active workspace')
    try {
      const created = await window.electronAPI.startWorkflowRun(workspaceId, workflowSlug, triggerInputs)
      setState((prev) => ({ ...prev, runs: spliceRun(prev.runs, created) }))
      return created
    } catch (error) {
      void refreshAfterUncertainWorkflowStart(() => refresh(false, true))
      throw error
    }
  }, [setState, workspaceId, refresh])

  const cancel = useCallback(async (runId: string) => {
    if (!workspaceId) return
    const cancelled = await window.electronAPI.cancelWorkflowRun(workspaceId, runId)
    setState((prev) => ({ ...prev, runs: spliceRun(prev.runs, cancelled) }))
  }, [setState, workspaceId])

  const resume = useCallback(async (runId: string, stepId?: string): Promise<WorkflowRunDTO> => {
    if (!workspaceId) throw new Error('No active workspace')
    const recovered = await window.electronAPI.resumeWorkflowRun(workspaceId, runId, stepId)
    setState((prev) => ({ ...prev, runs: spliceRun(prev.runs, recovered) }))
    return recovered
  }, [setState, workspaceId])

  const remove = useCallback(async (runId: string) => {
    if (!workspaceId) return false
    const ok = await window.electronAPI.deleteWorkflowRun(workspaceId, runId)
    if (ok) {
      setState((prev) => ({ ...prev, runs: prev.runs.filter((r) => r.id !== runId) }))
    }
    return ok
  }, [setState, workspaceId])

  return {
    runs: state.runs,
    loading: state.loading,
    hasLoaded: state.hasLoaded,
    listRevision: state.listRevision,
    error: state.error,
    refresh,
    start,
    cancel,
    resume,
    control,
    canResume: window.electronAPI.isChannelAvailable(RPC_CHANNELS.workflowRuns.RESUME),
    remove,
  }
}

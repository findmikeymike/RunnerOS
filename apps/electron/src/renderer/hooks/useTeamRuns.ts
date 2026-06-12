import { useCallback, useEffect, useMemo } from 'react'
import { useAtom } from 'jotai'
import { teamRunsStateAtomFamily, type TeamRunsState } from '@/atoms/team-runs'
import type { CompleteTeamRunInput, CreateTeamTaskInput, RunTeamRunTickInput, SendTeamMessageInput, StartTeamRunInput, TeamRunControlInput, TeamRunDetail, TeamRunSnapshot, TeamRunTick, UpdateTeamTaskInput } from '../../shared/types'

export interface UseTeamRunsResult {
  runs: TeamRunSnapshot[]
  detailsById: Record<string, TeamRunDetail>
  ticksByRunId: Record<string, TeamRunTick[]>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  get: (runId: string) => Promise<TeamRunDetail | null>
  start: (input: StartTeamRunInput) => Promise<TeamRunDetail>
  control: (runId: string, input: TeamRunControlInput) => Promise<TeamRunDetail>
  complete: (runId: string, input: CompleteTeamRunInput) => Promise<TeamRunDetail>
  tick: (runId: string, input?: RunTeamRunTickInput) => Promise<{ tick: TeamRunTick; run: TeamRunDetail }>
  listTicks: (runId: string) => Promise<TeamRunTick[]>
  wakeAgent: (runId: string, agentSlug: string, taskId?: string, prompt?: string) => Promise<{ sessionId: string; status: 'created' | 'resumed'; run: TeamRunDetail }>
  createTask: (runId: string, input: CreateTeamTaskInput) => Promise<TeamRunDetail>
  updateTask: (runId: string, taskId: string, patch: UpdateTeamTaskInput) => Promise<TeamRunDetail>
  sendMessage: (runId: string, input: SendTeamMessageInput) => Promise<TeamRunDetail>
  markMessagesRead: (runId: string, readerAgentSlug: string) => Promise<TeamRunDetail>
  remove: (runId: string) => Promise<boolean>
}

const NULL_WORKSPACE_KEY = '__no_workspace__'
const loadedWorkspaceKeys = new Set<string>()
const inFlightRefreshes = new Map<string, Promise<void>>()
const mountedWorkspaceKeys = new Map<string, number>()
const refreshersByWorkspaceKey = new Map<string, () => Promise<void>>()
let globalTeamRunCleanup: (() => void) | null = null

function getWorkspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId || NULL_WORKSPACE_KEY
}

function sortRuns(runs: TeamRunSnapshot[]): TeamRunSnapshot[] {
  return [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

function upsertDetail(prev: TeamRunsState, detail: TeamRunDetail): TeamRunsState {
  const runs = prev.runs.filter((run) => run.id !== detail.id)
  const { tasks: _tasks, messages: _messages, events: _events, ...snapshot } = detail
  runs.push(snapshot)
  return {
    ...prev,
    runs: sortRuns(runs),
    detailsById: { ...prev.detailsById, [detail.id]: detail },
    loading: false,
    error: null,
  }
}

export function useTeamRuns(workspaceId: string | null | undefined): UseTeamRunsResult {
  const workspaceKey = getWorkspaceKey(workspaceId)
  const [state, setState] = useAtom(teamRunsStateAtomFamily(workspaceKey))

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setState({ runs: [], detailsById: {}, ticksByRunId: {}, loading: false, error: null })
      return
    }

    const existing = inFlightRefreshes.get(workspaceKey)
    if (existing) return existing

    const run = (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        const runs = await window.electronAPI.listTeamRuns(workspaceId)
        setState((prev) => ({
          ...prev,
          runs: sortRuns(runs),
          loading: false,
          error: null,
        }))
        loadedWorkspaceKeys.add(workspaceKey)
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

  const get = useCallback(async (runId: string): Promise<TeamRunDetail | null> => {
    if (!workspaceId) throw new Error('Workspace is required to load a team run.')
    const detail = await window.electronAPI.getTeamRun(workspaceId, runId)
    if (detail) setState((prev) => upsertDetail(prev, detail))
    return detail
  }, [setState, workspaceId])

  useEffect(() => {
    refreshersByWorkspaceKey.set(workspaceKey, refresh)
    return () => {
      if (refreshersByWorkspaceKey.get(workspaceKey) === refresh) {
        refreshersByWorkspaceKey.delete(workspaceKey)
      }
    }
  }, [refresh, workspaceKey])

  useEffect(() => {
    if (!loadedWorkspaceKeys.has(workspaceKey)) {
      refresh()
    }
  }, [refresh, workspaceKey])

  useEffect(() => {
    mountedWorkspaceKeys.set(workspaceKey, (mountedWorkspaceKeys.get(workspaceKey) ?? 0) + 1)
    if (!globalTeamRunCleanup) {
      globalTeamRunCleanup = window.electronAPI.onTeamRunUpdated((changedWorkspaceId, run) => {
        const changedKey = getWorkspaceKey(changedWorkspaceId)
        if (changedKey === workspaceKey) {
          setState((prev) => upsertDetail(prev, run))
        }
        const refresher = refreshersByWorkspaceKey.get(changedKey)
        if (refresher) void refresher()
      })
    }
    return () => {
      const nextCount = (mountedWorkspaceKeys.get(workspaceKey) ?? 1) - 1
      if (nextCount <= 0) mountedWorkspaceKeys.delete(workspaceKey)
      else mountedWorkspaceKeys.set(workspaceKey, nextCount)

      if (mountedWorkspaceKeys.size === 0 && globalTeamRunCleanup) {
        globalTeamRunCleanup()
        globalTeamRunCleanup = null
      }
    }
  }, [setState, workspaceKey])

  const start = useCallback(async (input: StartTeamRunInput): Promise<TeamRunDetail> => {
    if (!workspaceId) throw new Error('Workspace is required to start a team run.')
    const detail = await window.electronAPI.startTeamRun(workspaceId, input)
    setState((prev) => upsertDetail(prev, detail))
    return detail
  }, [setState, workspaceId])

  const createTask = useCallback(async (runId: string, input: CreateTeamTaskInput): Promise<TeamRunDetail> => {
    if (!workspaceId) throw new Error('Workspace is required to create a team task.')
    const detail = await window.electronAPI.createTeamTask(workspaceId, runId, input)
    setState((prev) => upsertDetail(prev, detail))
    return detail
  }, [setState, workspaceId])

  const control = useCallback(async (runId: string, input: TeamRunControlInput): Promise<TeamRunDetail> => {
    if (!workspaceId) throw new Error('Workspace is required to control a team run.')
    const detail = await window.electronAPI.controlTeamRun(workspaceId, runId, input)
    setState((prev) => upsertDetail(prev, detail))
    return detail
  }, [setState, workspaceId])

  const complete = useCallback(async (runId: string, input: CompleteTeamRunInput): Promise<TeamRunDetail> => {
    if (!workspaceId) throw new Error('Workspace is required to complete a team run.')
    const detail = await window.electronAPI.completeTeamRun(workspaceId, runId, input)
    setState((prev) => upsertDetail(prev, detail))
    return detail
  }, [setState, workspaceId])

  const tick = useCallback(async (runId: string, input?: RunTeamRunTickInput): Promise<{ tick: TeamRunTick; run: TeamRunDetail }> => {
    if (!workspaceId) throw new Error('Workspace is required to tick a team run.')
    const result = await window.electronAPI.tickTeamRun(workspaceId, runId, input)
    setState((prev) => ({
      ...upsertDetail(prev, result.run),
      ticksByRunId: {
        ...prev.ticksByRunId,
        [runId]: [...(prev.ticksByRunId[runId] ?? []), result.tick],
      },
    }))
    return result
  }, [setState, workspaceId])

  const listTicks = useCallback(async (runId: string): Promise<TeamRunTick[]> => {
    if (!workspaceId) throw new Error('Workspace is required to list team run ticks.')
    const ticks = await window.electronAPI.listTeamRunTicks(workspaceId, runId)
    setState((prev) => ({
      ...prev,
      ticksByRunId: { ...prev.ticksByRunId, [runId]: ticks },
    }))
    return ticks
  }, [setState, workspaceId])

  const wakeAgent = useCallback(async (runId: string, agentSlug: string, taskId?: string, prompt?: string): Promise<{ sessionId: string; status: 'created' | 'resumed'; run: TeamRunDetail }> => {
    if (!workspaceId) throw new Error('Workspace is required to wake a team agent.')
    const result = await window.electronAPI.wakeTeamRunAgent(workspaceId, runId, agentSlug, taskId, prompt)
    setState((prev) => upsertDetail(prev, result.run))
    return result
  }, [setState, workspaceId])

  const updateTask = useCallback(async (runId: string, taskId: string, patch: UpdateTeamTaskInput): Promise<TeamRunDetail> => {
    if (!workspaceId) throw new Error('Workspace is required to update a team task.')
    const detail = await window.electronAPI.updateTeamTask(workspaceId, runId, taskId, patch)
    setState((prev) => upsertDetail(prev, detail))
    return detail
  }, [setState, workspaceId])

  const sendMessage = useCallback(async (runId: string, input: SendTeamMessageInput): Promise<TeamRunDetail> => {
    if (!workspaceId) throw new Error('Workspace is required to send a team message.')
    const detail = await window.electronAPI.sendTeamMessage(workspaceId, runId, input)
    setState((prev) => upsertDetail(prev, detail))
    return detail
  }, [setState, workspaceId])

  const markMessagesRead = useCallback(async (runId: string, readerAgentSlug: string): Promise<TeamRunDetail> => {
    if (!workspaceId) throw new Error('Workspace is required to mark team messages read.')
    const detail = await window.electronAPI.markTeamMessagesRead(workspaceId, runId, readerAgentSlug)
    setState((prev) => upsertDetail(prev, detail))
    return detail
  }, [setState, workspaceId])

  const remove = useCallback(async (runId: string) => {
    if (!workspaceId) return false
    const ok = await window.electronAPI.deleteTeamRun(workspaceId, runId)
    if (ok) {
      setState((prev) => {
        const nextDetails = { ...prev.detailsById }
        delete nextDetails[runId]
        return {
          ...prev,
          runs: prev.runs.filter((run) => run.id !== runId),
          detailsById: nextDetails,
        }
      })
    }
    return ok
  }, [setState, workspaceId])

  return {
    runs: useMemo(() => state.runs, [state.runs]),
    detailsById: state.detailsById,
    ticksByRunId: state.ticksByRunId,
    loading: state.loading,
    error: state.error,
    refresh,
    get,
    start,
    control,
    complete,
    tick,
    listTicks,
    wakeAgent,
    createTask,
    updateTask,
    sendMessage,
    markMessagesRead,
    remove,
  }
}

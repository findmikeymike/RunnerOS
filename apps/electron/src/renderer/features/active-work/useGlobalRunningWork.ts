import * as React from 'react'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import { parseAutomationsConfig, type AutomationListItem } from '@/components/automations/types'
import type { ActiveSessionInfo, WorkflowRunDTO } from '../../../shared/types'
import type { ActiveSessionLike } from './build-active-work-items'

export interface GlobalRunningWorkSnapshot {
  workspaceIds: string[]
  sessions: ActiveSessionLike[]
  runs: WorkflowRunDTO[]
  orders: ScheduledWorkOrder[]
  automationsByWorkspace: Map<string, AutomationListItem[]>
  loading: boolean
  error: string | null
}

const FALLBACK_POLL_INTERVAL_MS = 30_000

const emptySnapshot = (workspaceIds: string[]): GlobalRunningWorkSnapshot => ({
  workspaceIds,
  sessions: [],
  runs: [],
  orders: [],
  automationsByWorkspace: new Map(),
  loading: true,
  error: null,
})

export function activeSessionInfoToActiveSession(info: ActiveSessionInfo): ActiveSessionLike {
  return {
    id: info.sessionId,
    workspaceId: info.workspaceId,
    name: info.title || info.triggeredBy?.automationName,
    isProcessing: info.status === 'processing',
    createdAt: info.createdAt,
    lastMessageAt: info.triggeredBy?.timestamp ?? info.createdAt,
    triggeredByAutomationId: info.triggeredBy?.automationId,
    triggeredByAutomationName: info.triggeredBy?.automationName,
  }
}

export function mergeActiveSessions(
  currentSessions: Iterable<ActiveSessionLike>,
  authoritativeSessions: ActiveSessionLike[],
): ActiveSessionLike[] {
  const byId = new Map(Array.from(currentSessions, (session) => [session.id, session]))
  for (const session of authoritativeSessions) {
    const current = byId.get(session.id)
    byId.set(session.id, {
      ...current,
      ...session,
      hidden: session.triggeredByAutomationId || session.triggeredByAutomationName ? false : current?.hidden,
    })
  }
  return [...byId.values()]
}

function replaceWorkspaceOrders(
  current: ScheduledWorkOrder[],
  workspaceId: string,
  next: ScheduledWorkOrder[],
): ScheduledWorkOrder[] {
  return [...current.filter((order) => order.owner.workspaceId !== workspaceId), ...next]
}

export function selectGloballyVisibleOrders(orders: ScheduledWorkOrder[]): ScheduledWorkOrder[] {
  return orders.filter((order) => (
    order.status === 'running'
    || order.status === 'needs-setup'
    || order.status === 'needs-approval'
    || order.status === 'awaiting-review'
    || order.status === 'needs-attention'
  ))
}

export function useGlobalRunningWork(localWorkspaceIds: string[]): GlobalRunningWorkSnapshot {
  const workspaceKey = [...localWorkspaceIds].sort().join('\u0000')
  const [state, setState] = React.useState<GlobalRunningWorkSnapshot>(() => emptySnapshot(localWorkspaceIds))

  React.useEffect(() => {
    const workspaceIds = workspaceKey ? workspaceKey.split('\u0000') : []
    const allowed = new Set(workspaceIds)
    let cancelled = false
    let snapshotRequest = 0
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let refreshInFlight = false
    let refreshQueued = false

    setState(emptySnapshot(workspaceIds))

    const refresh = async () => {
      if (refreshInFlight) {
        refreshQueued = true
        return
      }
      refreshInFlight = true
      const request = ++snapshotRequest
      try {
        const [sessionsResult, runsResult, ordersResult, automationsResult] = await Promise.all([
          Promise.allSettled([window.electronAPI.getActiveSessions()]),
          Promise.allSettled(workspaceIds.map((workspaceId) => window.electronAPI.listWorkflowRuns(workspaceId))),
          Promise.allSettled(workspaceIds.map((workspaceId) => window.electronAPI.getScheduledWork(workspaceId))),
          Promise.allSettled(workspaceIds.map((workspaceId) => window.electronAPI.getAutomations(workspaceId))),
        ])
        if (cancelled || request !== snapshotRequest) return

        setState((current) => {
          const failures = new Set<string>()
          let sessions = current.sessions
          let runs = current.runs
          let orders = current.orders
          const automationsByWorkspace = new Map(current.automationsByWorkspace)

          const activeSessions = sessionsResult[0]
          if (activeSessions?.status === 'fulfilled') {
            sessions = activeSessions.value
              .filter((info) => allowed.has(info.workspaceId))
              .map(activeSessionInfoToActiveSession)
              .filter((session) => session.isProcessing)
          } else {
            failures.add('active sessions')
          }

          runsResult.forEach((result, index) => {
            const workspaceId = workspaceIds[index]!
            if (result.status === 'fulfilled') {
              runs = [
                ...runs.filter((run) => run.workspaceId !== workspaceId),
                ...result.value.filter((run) => run.state === 'running'),
              ]
            } else {
              failures.add('workflow runs')
            }
          })

          ordersResult.forEach((result, index) => {
            const workspaceId = workspaceIds[index]!
            if (result.status === 'fulfilled' && result.value.ok) {
              orders = replaceWorkspaceOrders(
                orders,
                workspaceId,
                selectGloballyVisibleOrders(result.value.work.items),
              )
            } else {
              failures.add('scheduled work')
            }
          })

          automationsResult.forEach((result, index) => {
            const workspaceId = workspaceIds[index]!
            if (result.status === 'fulfilled') automationsByWorkspace.set(workspaceId, parseAutomationsConfig(result.value))
            else failures.add('automations')
          })

          return {
            workspaceIds,
            sessions,
            runs,
            orders,
            automationsByWorkspace,
            loading: false,
            error: failures.size > 0
              ? `Some global work could not be loaded (${[...failures].join(', ')}).`
              : null,
          }
        })
      } finally {
        refreshInFlight = false
        if (!cancelled && refreshQueued) {
          refreshQueued = false
          void refresh()
        }
      }
    }

    const scheduleRefresh = () => {
      if (refreshTimer) return
      snapshotRequest += 1
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refresh()
      }, 100)
    }

    const cleanups = [
      window.electronAPI.onWorkflowRunUpdated((workspaceId) => {
        if (allowed.has(workspaceId)) scheduleRefresh()
      }),
      window.electronAPI.onWorkspaceContextChanged((workspaceId) => {
        if (allowed.has(workspaceId)) scheduleRefresh()
      }),
      window.electronAPI.onAutomationsChanged((workspaceId) => {
        if (allowed.has(workspaceId)) scheduleRefresh()
      }),
      window.electronAPI.onSessionEvent((event) => {
        if (
          event.type === 'session_created'
          || event.type === 'session_deleted'
          || event.type === 'complete'
          || event.type === 'interrupted'
          || event.type === 'error'
          || event.type === 'typed_error'
        ) scheduleRefresh()
      }),
    ]

    void refresh()
    const poll = setInterval(() => {
      if (!refreshInFlight && !refreshTimer) void refresh()
    }, FALLBACK_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      snapshotRequest += 1
      if (refreshTimer) clearTimeout(refreshTimer)
      clearInterval(poll)
      for (const cleanup of cleanups) cleanup()
    }
  }, [workspaceKey])

  return state
}

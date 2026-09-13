import type { ScheduledWorkRuntimeStatus } from '@craft-agent/shared/scheduled-work'

/** Passive facts about the host; a waiting work item does not diagnose scheduler health. */
export function scheduledWorkHealthLabel(status: ScheduledWorkRuntimeStatus, now = Date.now()): string | null {
  switch (status.state) {
    case 'ready': {
      const lastTick = status.lastTickAt ? Date.parse(status.lastTickAt) : NaN
      return Number.isFinite(lastTick) && now - lastTick > 3 * 60_000
        ? `No recent schedule checks (last ${Math.floor((now - lastTick) / 60_000)}m ago)`
        : null
    }
    case 'scheduler-stopped': return 'Scheduler is stopped'
    case 'license-required': return 'Scheduling is waiting for license authorization'
    case 'other-runner': return 'Scheduling runs on another team computer'
    case 'runner-unavailable': return 'Team runner is unavailable'
    case 'background-disabled': return 'Background scheduling is off'
    case 'remote-host': return 'Scheduling is managed on the remote host'
    case 'unavailable': return 'Scheduler status unavailable'
  }
}

export function scheduledWorkHealthMessages(statuses: ScheduledWorkRuntimeStatus[], workspaces: { id: string; name: string }[]): string[] {
  const names = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]))
  return statuses.filter((status) => names.has(status.workspaceId)).flatMap((status) => {
    const label = scheduledWorkHealthLabel(status)
    return label ? [`${names.get(status.workspaceId)}: ${label}`] : []
  })
}

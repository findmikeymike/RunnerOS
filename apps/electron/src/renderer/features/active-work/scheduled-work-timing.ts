import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function scheduledWorkTiming(order: ScheduledWorkOrder, target?: { sessionId?: string; workflowRunId?: string }, now = Date.now()) {
  const latest = target
    ? [...order.runs].reverse().find((run) => target.sessionId ? run.sessionId === target.sessionId : run.workflowRunId === target.workflowRunId)
    : order.runs.at(-1)
  const planned = Date.parse(order.startAt)
  const actual = latest?.startedAt ? Date.parse(latest.startedAt) : NaN
  const lateMs = actual - planned
  // A queued retry may retain historical runs from its previous schedule.
  // Only a matched live target can tie that history to the displayed run.
  const queued = !target && (order.status === 'scheduled' || order.status === 'waiting')
  const label = queued
    ? now - planned >= 60_000 ? `Waiting ${duration(now - planned)} past planned start` : undefined
    : lateMs >= 60_000 ? `Started ${duration(lateMs)} late` : undefined
  const startedAt = Number.isFinite(actual) ? latest?.startedAt : undefined
  return {
    plannedStartAt: order.startAt,
    actualStartAt: queued ? undefined : startedAt,
    lastAttemptStartAt: queued ? startedAt : undefined,
    timingLabel: label,
  }
}

import type { ScheduledWorkRuntimeStatus } from '@craft-agent/shared/scheduled-work'

export interface ScheduledWorkRuntimeStatusInput {
  workspaceId: string
  checkedAt: string
  remote: boolean
  executionAuthorized: boolean
  schedulerRunning: boolean
  background: { allowed: boolean; reason: string; runnerIsStale?: boolean }
  lastTickAt?: string
}

/** Observational only: never changes an order, authorizes execution, or infers health from overdue work. */
export function buildScheduledWorkRuntimeStatus(input: ScheduledWorkRuntimeStatusInput): ScheduledWorkRuntimeStatus {
  const state = resolveState(input)
  return {
    workspaceId: input.workspaceId,
    checkedAt: input.checkedAt,
    state,
    ...(input.lastTickAt !== undefined ? { lastTickAt: input.lastTickAt } : {}),
  }
}

function resolveState(input: ScheduledWorkRuntimeStatusInput): ScheduledWorkRuntimeStatus['state'] {
  // Remote host ownership is meaningful even when this local installation cannot execute.
  if (input.remote) return 'remote-host'
  if (!input.executionAuthorized) return 'license-required'

  const { allowed, reason, runnerIsStale } = input.background
  switch (reason) {
    case 'manual-only':
    case 'background-disabled':
    case 'team-disabled':
      return 'background-disabled'
    case 'no-runner':
    case 'handover-pending':
    case 'recovery-pending':
    case 'stale-observed-revision':
    case 'stale-observed-epoch':
      return 'runner-unavailable'
    case 'not-runner':
      return runnerIsStale ? 'runner-unavailable' : 'other-runner'
    case 'solo':
    case 'runner':
      if (!allowed) return 'unavailable'
      if (runnerIsStale) return 'runner-unavailable'
      return input.schedulerRunning ? 'ready' : 'scheduler-stopped'
    default:
      return 'unavailable'
  }
}

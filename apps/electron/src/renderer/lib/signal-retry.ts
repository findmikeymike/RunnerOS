import { signalWorkflowFor, type SignalRunSummary } from '@craft-agent/shared/shared-intel'
import type { ElectronAPI } from '../../shared/types'

type RetryApi = Pick<ElectronAPI, 'getSignalState' | 'getScheduledWork' | 'getWorkflowRun' | 'mutateScheduledWork'>

/** Requeue only the same failed collection order; existing workflows own their retry UI. */
export async function retrySignalScan(api: RetryApi, workspaceId: string, selected: SignalRunSummary, now = new Date().toISOString()): Promise<{ workflowRunId?: string }> {
  const state = await api.getSignalState(workspaceId)
  const run = state.runs.find(item => item.runId === selected.runId)
  if (!run || run.status !== 'failed' || run.mode !== 'scan' || run.track !== selected.track
    || state.runs.some(item => item.track === run.track && item.mode === 'scan' && ['queued', 'running'].includes(item.status))) {
    throw new Error('This scan changed or another scan is already running. Refresh Signals before retrying.')
  }
  const owner = state.hqWorkspaceId
  const parsed = await api.getScheduledWork(owner)
  if (!parsed.ok) throw new Error(parsed.error)
  const orders = parsed.work.items.filter(item => run.orderIds.includes(item.id))
  if (run.orderIds.length !== 1 || orders.length !== 1) throw new Error('The original scan order could not be verified. Review its work history.')
  const order = orders[0]!
  if (order.deletedAt || order.status !== 'needs-attention' || order.owner.workspaceId !== owner || order.owner.scope !== 'hq'
    || order.execution.type !== 'workflow-run' || order.execution.workflowSlug !== signalWorkflowFor(run.track, run.mode)
    || order.execution.triggerInputs.signalContract !== 'signals-v1' || order.execution.triggerInputs.signalRequestId !== run.runId
    || order.execution.triggerInputs.track !== run.track || order.execution.triggerInputs.mode !== run.mode
    || order.legacyRef || order.inputRequest || order.inputSupplyReceipt || order.authorization || order.authorizationPolicy) {
    throw new Error('The original scan order changed or needs a different review. It was not restarted.')
  }
  const workflowIds = [...new Set([run.workflowRunId, ...order.runs.map(item => item.workflowRunId),
    order.result?.type === 'workflow-run' ? order.result.workflowRunId : undefined].filter((id): id is string => !!id))]
  for (const id of workflowIds.reverse()) {
    const workflow = await api.getWorkflowRun(owner, id)
    if (!workflow) continue
    if (workflow.workspaceId !== owner || workflow.workflowSlug !== order.execution.workflowSlug
      || workflow.trigger.inputs.signalContract !== 'signals-v1' || workflow.trigger.inputs.signalRequestId !== run.runId) {
      throw new Error('The saved workflow does not match this scan. It was not restarted.')
    }
    return { workflowRunId: workflow.id }
  }
  const updated = await api.mutateScheduledWork(owner, { operation: 'upsert', expectedUpdatedAt: order.updatedAt,
    order: { ...order, status: 'scheduled', startAt: now, dueAt: undefined, attention: undefined, result: undefined } })
  if (!updated.ok) throw new Error(updated.error)
  return {}
}

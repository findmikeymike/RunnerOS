import { expect, mock, test } from 'bun:test'
import { retrySignalScan } from './signal-retry'
import type { SignalRunSummary, SignalState } from '@craft-agent/shared/shared-intel'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'

function fixture() {
  const now = '2026-09-16T12:00:00.000Z'
  const run: SignalRunSummary = { runId: 'request', track: 'industry', mode: 'scan', status: 'failed', workflowRunId: 'reserved', orderIds: ['order'], createdAt: now, updatedAt: now }
  const order = { version: 1, id: 'order', owner: { scope: 'hq', workspaceId: 'hq' }, calendarLink: { calendar: 'hq', itemId: 'calendar' }, title: 'Industry', type: 'workflow', status: 'needs-attention', startAt: now, dueAt: now, timezone: 'UTC',
    execution: { type: 'workflow-run', workflowSlug: 'signals-industry-scan', workflowDigest: 'unchanged', permissionMode: 'safe', triggerInputs: { signalContract: 'signals-v1', signalRequestId: 'request', track: 'industry', mode: 'scan' } },
    attention: { reason: 'execution-failed', message: 'timed out' }, inputRefs: [], approvals: [], runs: [], executionKey: { payloadDigest: 'same', idempotencyKey: 'same' }, createdAt: now, updatedAt: now } as unknown as ScheduledWorkOrder
  const state = { hqWorkspaceId: 'hq', runs: [run] } as SignalState
  const work = { version: 1 as const, workspaceId: 'hq', items: [order], updatedAt: now }
  const api = {
    getSignalState: mock(async () => state), getScheduledWork: mock(async () => ({ ok: true as const, work })),
    getWorkflowRun: mock(async () => null), mutateScheduledWork: mock(async () => ({ ok: true as const, work, item: order })),
  } as unknown as Parameters<typeof retrySignalScan>[0]
  return { now, run, order, state, work, api }
}

test('pre-workflow retry requeues the exact owned order and retains execution, permissions and history', async () => {
  const f = fixture(); const now = '2026-09-16T13:00:00.000Z'
  f.order.runs = [{ id: 'attempt', jobId: 'order', status: 'failed', startedAt: f.now, workflowRunId: 'reserved' }] as typeof f.order.runs
  f.order.result = { type: 'workflow-run', workflowRunId: 'reserved', outputIds: [] }
  await expect(retrySignalScan(f.api, 'campaign', f.run, now)).resolves.toEqual({})
  expect(f.api.getScheduledWork).toHaveBeenCalledWith('hq')
  expect(f.api.getWorkflowRun).toHaveBeenCalledWith('hq', 'reserved')
  expect(f.api.mutateScheduledWork).toHaveBeenCalledWith('hq', { operation: 'upsert', expectedUpdatedAt: f.order.updatedAt,
    order: { ...f.order, status: 'scheduled', startAt: now, dueAt: undefined, attention: undefined, result: undefined } })
})
test('existing matching workflow opens its history instead of requeuing preparation', async () => {
  const f = fixture()
  f.api.getWorkflowRun = mock(async () => ({ id: 'reserved', workspaceId: 'hq', workflowSlug: 'signals-industry-scan', trigger: { inputs: { signalContract: 'signals-v1', signalRequestId: 'request' } } })) as unknown as typeof f.api.getWorkflowRun
  expect(await retrySignalScan(f.api, 'hq', f.run)).toEqual({ workflowRunId: 'reserved' })
  expect(f.api.mutateScheduledWork).not.toHaveBeenCalled()
})
test('cancelled, active, deleted, foreign and mismatched orders never requeue', async () => {
  const edits = [
    (f: ReturnType<typeof fixture>) => { f.run.status = 'cancelled' },
    (f: ReturnType<typeof fixture>) => { f.state.runs.push({ ...f.run, runId: 'active', status: 'running' }) },
    (f: ReturnType<typeof fixture>) => { f.order.status = 'canceled' },
    (f: ReturnType<typeof fixture>) => { f.order.status = 'scheduled' },
    (f: ReturnType<typeof fixture>) => { f.order.deletedAt = f.now },
    (f: ReturnType<typeof fixture>) => { f.order.owner.workspaceId = 'other' },
    (f: ReturnType<typeof fixture>) => { f.order.owner.scope = 'campaign' },
    (f: ReturnType<typeof fixture>) => { f.run.orderIds.push('second') },
    (f: ReturnType<typeof fixture>) => { if (f.order.execution.type === 'workflow-run') f.order.execution.triggerInputs.signalRequestId = 'other' },
    (f: ReturnType<typeof fixture>) => { if (f.order.execution.type === 'workflow-run') f.order.execution.triggerInputs.signalContract = 'other' },
  ]
  for (const edit of edits) { const f = fixture(); edit(f); await expect(retrySignalScan(f.api, 'hq', f.run)).rejects.toThrow(); expect(f.api.mutateScheduledWork).not.toHaveBeenCalled() }
})
test('stale order update is surfaced and never replaced with another request', async () => {
  const f = fixture()
  f.api.mutateScheduledWork = mock(async () => ({ ok: false as const, work: f.work, error: 'Order changed' }))
  await expect(retrySignalScan(f.api, 'hq', f.run)).rejects.toThrow('Order changed')
  expect(f.api.mutateScheduledWork).toHaveBeenCalledTimes(1)
})

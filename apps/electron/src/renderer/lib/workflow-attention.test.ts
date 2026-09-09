import { expect, test } from 'bun:test'
import type { WorkflowAttentionDTO, WorkflowAttentionDecisionDTO } from '@craft-agent/shared/protocol'
import { resolveWorkflowAttentionWithRecovery } from './workflow-attention'

const item = (version = 4): WorkflowAttentionDTO => ({ id: 'durable:run:approval', workflowRunId: 'run', recommendation: 'Review', status: 'pending', createdAt: 1, toolCall: { name: 'read', args: { path: 'track.txt' } }, durable: { engine: 'sqlite-v2-readonly-1', workspaceId: 'workspace', runId: 'run', approvalId: 'approval', version, expiresAt: Date.now() + 60000, reviewable: true } })

test('lost reply retains exact command identity even if refresh also fails', async () => {
  const requests: WorkflowAttentionDecisionDTO[] = [], commands = new Map<string, WorkflowAttentionDecisionDTO>()
  const lost = new Error('reply lost')
  const api = { async resolveWorkflowAttention(_workspace: string, _id: string, _decision: 'approved' | 'rejected', command?: WorkflowAttentionDecisionDTO) { requests.push({ ...command! }); if (requests.length === 1) throw lost; return item() }, async listWorkflowAttention(): Promise<WorkflowAttentionDTO[]> { throw new Error('offline') } }
  const input = { workspaceId: 'workspace', runId: 'run', item: item(), decision: 'approved' as const, commands, api, refresh() {} }
  await expect(resolveWorkflowAttentionWithRecovery(input)).rejects.toBe(lost)
  await resolveWorkflowAttentionWithRecovery(input)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
})

test('stale card refreshes but requires another explicit decision for the new version', async () => {
  const requests: WorkflowAttentionDecisionDTO[] = [], commands = new Map<string, WorkflowAttentionDecisionDTO>()
  let refreshed: WorkflowAttentionDTO[] = []
  const conflict = new Error('durable-control-version-conflict')
  const api = { async resolveWorkflowAttention(_workspace: string, _id: string, _decision: 'approved' | 'rejected', command?: WorkflowAttentionDecisionDTO) { requests.push({ ...command! }); if (command!.expectedVersion === 4) throw conflict; return item(5) }, async listWorkflowAttention() { return [item(5)] } }
  const input = { workspaceId: 'workspace', runId: 'run', item: item(), decision: 'rejected' as const, commands, api, refresh(items: WorkflowAttentionDTO[]) { refreshed = items } }
  await expect(resolveWorkflowAttentionWithRecovery(input)).rejects.toBe(conflict)
  expect(requests).toHaveLength(1)
  expect(refreshed[0]!.durable!.version).toBe(5)
  await resolveWorkflowAttentionWithRecovery({ ...input, item: refreshed[0]! })
  expect(requests[1]!.expectedVersion).toBe(5)
  expect(requests[1]!.commandId).not.toBe(requests[0]!.commandId)
})

test('legacy attention keeps its existing request and error behavior', async () => {
  const { durable: _durable, ...legacy } = item()
  let refreshes = 0
  const failure = new Error('legacy failure')
  const api = { async resolveWorkflowAttention(_workspace: string, _id: string, _decision: 'approved' | 'rejected', command?: WorkflowAttentionDecisionDTO): Promise<WorkflowAttentionDTO> { expect(command).toBeUndefined(); throw failure }, async listWorkflowAttention() { refreshes++; return [] } }
  await expect(resolveWorkflowAttentionWithRecovery({ workspaceId: 'workspace', runId: 'run', item: legacy, decision: 'approved', commands: new Map(), api, refresh() {} })).rejects.toBe(failure)
  expect(refreshes).toBe(0)
})

test('a historical decision acknowledgement stays separate from a superseded current action', async () => {
  const current = item(9)
  current.status = 'rejected'
  current.durable!.decisionReceipt = { runId: 'run', workspaceId: 'workspace', commandId: 'saved', action: 'approve', approvalId: 'approval', version: 5, status: 'running', controlRevision: 1 }
  const api = { async resolveWorkflowAttention() { return current }, async listWorkflowAttention() { return [] } }
  const resolved = await resolveWorkflowAttentionWithRecovery({ workspaceId: 'workspace', runId: 'run', item: item(), decision: 'approved', commands: new Map(), api, refresh() {} })
  expect(resolved.status).toBe('rejected')
  expect(resolved.durable!.decisionReceipt!.action).toBe('approve')
})

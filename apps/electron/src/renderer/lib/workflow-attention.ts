import type { WorkflowAttentionDTO, WorkflowAttentionDecisionDTO } from '@craft-agent/shared/protocol'

type Decision = 'approved' | 'rejected'
interface AttentionAPI {
  resolveWorkflowAttention(workspaceId: string, id: string, decision: Decision, command?: WorkflowAttentionDecisionDTO): Promise<WorkflowAttentionDTO>
  listWorkflowAttention(workspaceId: string, runId?: string): Promise<WorkflowAttentionDTO[]>
}

/** Retain identity across uncertain retries; refresh conflicts without approving new state automatically. */
export async function resolveWorkflowAttentionWithRecovery(input: {
  workspaceId: string
  runId: string
  item: WorkflowAttentionDTO
  decision: Decision
  commands: Map<string, WorkflowAttentionDecisionDTO>
  api: AttentionAPI
  refresh: (items: WorkflowAttentionDTO[]) => void
}): Promise<WorkflowAttentionDTO> {
  const { workspaceId, runId, item, decision, commands, api } = input
  let command: WorkflowAttentionDecisionDTO | undefined
  if (item.durable) {
    const key = JSON.stringify([workspaceId, item.id, item.durable.version, decision])
    command = commands.get(key)
    if (!command) {
      command = { commandId: crypto.randomUUID(), expectedVersion: item.durable.version }
      commands.set(key, command)
    }
  }
  try {
    return await api.resolveWorkflowAttention(workspaceId, item.id, decision, command)
  } catch (error) {
    if (item.durable) {
      try { input.refresh(await api.listWorkflowAttention(workspaceId, runId)) } catch { /* Keep original decision error and retry identity. */ }
    }
    throw error
  }
}

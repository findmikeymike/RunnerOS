import type { WorkflowRunDTO, DurableWorkflowCommandDTO, DurableWorkflowControlResultDTO } from '../../shared/types'

type ControlAction = 'pause' | 'resume' | 'cancel'
interface RunAPI {
  controlDurableWorkflowRun(workspaceId: string, runId: string, command: DurableWorkflowCommandDTO): Promise<DurableWorkflowControlResultDTO>
  getWorkflowRun(workspaceId: string, runId: string): Promise<WorkflowRunDTO | null>
}

/** Journal versions, unlike legacy timestamps, advance on every saved transition. */
export function preferWorkflowRun(current: WorkflowRunDTO | undefined | null, incoming: WorkflowRunDTO): WorkflowRunDTO {
  if (current?.durable && incoming.durable) return current.durable.version > incoming.durable.version ? current : incoming
  if (current?.durable && !incoming.durable) return current
  return incoming
}

/** A successful listing is authoritative about durable visibility, even during background polling. */
export function mergeWorkflowRuns(listed: WorkflowRunDTO[], previous: WorkflowRunDTO[], authoritative = false): WorkflowRunDTO[] {
  const byId = new Map(listed.map(run => [run.id, run]))
  if (!authoritative) for (const run of previous) {
    const saved = byId.get(run.id)
    if (run.durable) {
      if (saved?.durable) byId.set(run.id, preferWorkflowRun(run, saved))
    } else if (!saved || !saved.durable && (run.updatedAt ?? '') > (saved.updatedAt ?? '')) byId.set(run.id, run)
  }
  return [...byId.values()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

export function visibleWorkflowRun(runs: WorkflowRunDTO[], runId: string, hydrated: WorkflowRunDTO | null, listReady: boolean): WorkflowRunDTO | null {
  const live = runs.find(run => run.id === runId)
  if (live) return live
  return hydrated?.durable && listReady ? null : hydrated
}

/** Never turn an uncertain retry into a new command against a newer run revision. */
export async function controlDurableRun(input: {
  workspaceId: string; run: WorkflowRunDTO; action: ControlAction
  commands: Map<string, DurableWorkflowCommandDTO>; api: RunAPI
}): Promise<WorkflowRunDTO> {
  const { workspaceId, run, action, commands, api } = input
  if (!run.durable || run.workspaceId !== workspaceId) throw new Error('Invalid saved workflow control')
  const key = JSON.stringify([workspaceId, run.id, action])
  let command = commands.get(key)
  if (!command) {
    command = { commandId: crypto.randomUUID(), expectedVersion: run.durable.version, action }
    commands.set(key, command)
  }
  try {
    await api.controlDurableWorkflowRun(workspaceId, run.id, command)
    const saved = await api.getWorkflowRun(workspaceId, run.id)
    if (!saved?.durable) throw new Error('Saved workflow is unavailable; retry to check the same command.')
    commands.delete(key)
    return saved
  } catch (error) {
    // A conflict proves the command was not committed; the next explicit click may use refreshed state.
    if (error instanceof Error && error.message.includes('durable-control-version-conflict')) commands.delete(key)
    throw error
  }
}

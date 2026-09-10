/**
 * RPC handlers for workflow runs.
 *
 * Run state is owned by the `WorkflowRunner` (in-memory + persisted to
 * `<workspaceRoot>/runs/<runId>/run.json`). These handlers are thin
 * façades over the runner + the run-storage helpers.
 */

import { type DurableWorkflowCommandDTO, type DurableWorkflowControlResultDTO, type WorkflowAttentionDTO, type WorkflowAttentionDecisionDTO, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  loadGlobalWorkflow,
  readActivatedWorkflows,
  readRun,
  listRuns,
  deleteRun,
  type WorkflowRunSnapshot,
  normalizeWorkflowTriggerInputs,
} from '@craft-agent/shared/workflows'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { DurableWorkflowActor } from '../../workflows/durable-workflow-controls'
import {
  approveEscalation,
  listPendingEscalations,
  rejectEscalation,
} from '@craft-agent/shared/agent'

const WORKFLOW_RUNS_RESUME =
  (RPC_CHANNELS.workflowRuns as { RESUME?: string; RERUN_FROM_STEP?: string }).RESUME ??
  (RPC_CHANNELS.workflowRuns as { RESUME?: string; RERUN_FROM_STEP?: string }).RERUN_FROM_STEP ??
  'workflow-runs:resume'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workflowRuns.DURABLE_CONTROL,
  RPC_CHANNELS.workflowRuns.START,
  RPC_CHANNELS.workflowRuns.GET,
  RPC_CHANNELS.workflowRuns.LIST,
  RPC_CHANNELS.workflowRuns.CANCEL,
  WORKFLOW_RUNS_RESUME,
  RPC_CHANNELS.workflowRuns.DELETE,
  RPC_CHANNELS.workflowRuns.LIST_ATTENTION,
  RPC_CHANNELS.workflowRuns.RESOLVE_ATTENTION,
] as const

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function requireRunner(deps: HandlerDeps) {
  if (!deps.getWorkflowRunner) throw new Error('Workflow runner is not available on this host')
  return deps.getWorkflowRunner()
}

async function assertWorkflowRunPermission(workspaceId: string, action: 'agent.chat' | 'files.write'): Promise<void> {
  const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
  assertTeamPermission(resolveRootPath(workspaceId), action)
}

export function registerWorkflowRunsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const actor = (ctx: { clientId: string; workspaceId: string | null }): DurableWorkflowActor =>
    ({ clientId: ctx.clientId, ...(ctx.workspaceId === null ? {} : { workspaceId: ctx.workspaceId }) })
  // Only absence permits legacy fallback. Authorization/storage errors must propagate.
  const durableRun = (workspaceId: string, runId: string, ctx: { clientId: string; workspaceId: string | null }) =>
    deps.getDurableWorkflowRuns?.().get(workspaceId, runId, actor(ctx)) ?? Promise.resolve(null)
  const rejectDurableLegacyMutation = async (workspaceId: string, runId: string, ctx: { clientId: string; workspaceId: string | null }) => {
    if (await durableRun(workspaceId, runId, ctx)) throw new Error('Use durable workflow controls for this saved run; legacy rerun and deletion are unavailable.')
  }
  server.handle(
    RPC_CHANNELS.workflowRuns.DURABLE_CONTROL,
    async (ctx, workspaceId: string, runId: string, command: DurableWorkflowCommandDTO): Promise<DurableWorkflowControlResultDTO> => {
      if (!deps.getDurableWorkflowControls) throw new Error('Durable workflow controls are not available on this host')
      return deps.getDurableWorkflowControls().control(workspaceId, runId, command,
        { clientId: ctx.clientId, ...(ctx.workspaceId === null ? {} : { workspaceId: ctx.workspaceId }) })
    },
  )
  server.handle(
    RPC_CHANNELS.workflowRuns.LIST_ATTENTION,
    async (ctx, workspaceId: string, runId?: string): Promise<WorkflowAttentionDTO[]> => {
      const rootPath = resolveRootPath(workspaceId)
      const legacy = listPendingEscalations(runId ? { workflowRunId: runId } : undefined)
        .filter((attention) => readRun(rootPath, attention.workflowRunId)?.workspaceId === workspaceId)
      const durable = deps.getDurableWorkflowControls
        ? await deps.getDurableWorkflowControls().listAttention(workspaceId, { clientId: ctx.clientId, ...(ctx.workspaceId === null ? {} : { workspaceId: ctx.workspaceId }) }, runId)
        : []
      return [...legacy, ...durable]
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.RESOLVE_ATTENTION,
    async (
      ctx,
      workspaceId: string,
      escalationId: string,
      decision: 'approved' | 'rejected',
      command?: WorkflowAttentionDecisionDTO,
    ): Promise<WorkflowAttentionDTO> => {
      if (decision !== 'approved' && decision !== 'rejected') throw new Error('Invalid attention decision')
      if (typeof escalationId !== 'string') throw new Error('Invalid attention ID')
      if (escalationId.startsWith('durable:')) {
        if (!command || typeof command !== 'object' || Array.isArray(command)
          || typeof command.commandId !== 'string' || !command.commandId.trim()
          || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0
          || Object.keys(command).some((key) => key !== 'commandId' && key !== 'expectedVersion')) {
          throw new Error('Durable attention requires commandId and expectedVersion')
        }
        if (!deps.getDurableWorkflowControls) throw new Error('Durable workflow controls are not available on this host')
        const resolved = await deps.getDurableWorkflowControls().resolveAttention(
          workspaceId, escalationId, decision, command,
          { clientId: ctx.clientId, ...(ctx.workspaceId === null ? {} : { workspaceId: ctx.workspaceId }) },
        )
        // The decision is already committed. A disconnected observer cannot undo it.
        try {
          server.push(RPC_CHANNELS.workflowRuns.ATTENTION_UPDATED, { to: 'client', clientId: ctx.clientId }, workspaceId, resolved)
        } catch { /* Clients recover the saved decision by listing again. */ }
        return resolved
      }
      if (command !== undefined) throw new Error('Durable command metadata cannot target legacy attention')
      const pending = listPendingEscalations().find((item) => item.id === escalationId)
      if (!pending) throw new Error(`Pending attention item not found: ${escalationId}`)
      const run = readRun(resolveRootPath(workspaceId), pending.workflowRunId)
      if (!run || run.workspaceId !== workspaceId) {
        throw new Error('Attention item does not belong to this workspace.')
      }
      await assertWorkflowRunPermission(workspaceId, 'agent.chat')
      const resolvedBy = { type: 'user' as const, clientId: ctx.clientId }
      const resolved = decision === 'approved'
        ? approveEscalation(escalationId, resolvedBy)
        : rejectEscalation(escalationId, resolvedBy)
      server.push(
        RPC_CHANNELS.workflowRuns.ATTENTION_UPDATED,
        { to: 'workspace', workspaceId },
        workspaceId,
        resolved,
      )
      return resolved
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.START,
    async (
      ctx,
      workspaceId: string,
      workflowSlug: string,
      triggerInputs: Record<string, unknown>,
    ): Promise<WorkflowRunSnapshot> => {
      await assertWorkflowRunPermission(workspaceId, 'agent.chat')
      const workspaceRoot = resolveRootPath(workspaceId)
      if (!readActivatedWorkflows(workspaceRoot).active.includes(workflowSlug)) {
        throw new Error(`Workflow "${workflowSlug}" is not active in this workspace.`)
      }
      const workflow = loadGlobalWorkflow(workflowSlug)
      if (!workflow) throw new Error(`Workflow not found: ${workflowSlug}`)
      const runner = requireRunner(deps)
      return runner.start({ workflow, workspaceId, triggerInputs: workflow.metadata.execution === 'durable-local-read' ? triggerInputs : normalizeWorkflowTriggerInputs(workflow, triggerInputs), invocation: 'manual-ui', actor: actor(ctx) })
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.GET,
    async (ctx, workspaceId: string, runId: string): Promise<WorkflowRunSnapshot | null> => {
      return await durableRun(workspaceId, runId, ctx) ?? readRun(resolveRootPath(workspaceId), runId)
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.LIST,
    async (ctx, workspaceId: string): Promise<WorkflowRunSnapshot[]> => {
      const legacy = listRuns(resolveRootPath(workspaceId))
      return deps.getDurableWorkflowRuns ? deps.getDurableWorkflowRuns().list(workspaceId, actor(ctx), legacy) : legacy
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.CANCEL,
    async (ctx, workspaceId: string, runId: string): Promise<WorkflowRunSnapshot> => {
      await rejectDurableLegacyMutation(workspaceId, runId, ctx)
      await assertWorkflowRunPermission(workspaceId, 'agent.chat')
      const runner = requireRunner(deps)
      return runner.cancel(workspaceId, runId)
    },
  )

  server.handle(
    WORKFLOW_RUNS_RESUME,
    async (
      ctx,
      workspaceId: string,
      runId: string,
      stepId?: string,
    ): Promise<WorkflowRunSnapshot> => {
      await rejectDurableLegacyMutation(workspaceId, runId, ctx)
      await assertWorkflowRunPermission(workspaceId, 'agent.chat')
      const workspaceRoot = resolveRootPath(workspaceId)
      const original = readRun(workspaceRoot, runId)
      if (!original) throw new Error(`Workflow run not found: ${runId}`)
      if (original.workspaceId !== workspaceId) {
        throw new Error(`Workflow run "${runId}" does not belong to workspace "${workspaceId}".`)
      }
      if (!readActivatedWorkflows(workspaceRoot).active.includes(original.workflowSlug)) {
        throw new Error(`Workflow "${original.workflowSlug}" is not active in this workspace.`)
      }
      const workflow = loadGlobalWorkflow(original.workflowSlug)
      if (!workflow) throw new Error(`Workflow not found: ${original.workflowSlug}`)
      normalizeWorkflowTriggerInputs(workflow, original.trigger.inputs)
      const runner = requireRunner(deps)
      return runner.rerunFromStep({ workspaceId, runId, stepId })
    },
  )

  server.handle(
    RPC_CHANNELS.workflowRuns.DELETE,
    async (ctx, workspaceId: string, runId: string): Promise<boolean> => {
      await rejectDurableLegacyMutation(workspaceId, runId, ctx)
      await assertWorkflowRunPermission(workspaceId, 'files.write')
      const rootPath = resolveRootPath(workspaceId)
      const existing = readRun(rootPath, runId)
      if (existing && existing.state === 'running') {
        throw new Error(`Cannot delete run "${runId}" while it is still running. Cancel it first.`)
      }
      return deleteRun(rootPath, runId)
    },
  )
}

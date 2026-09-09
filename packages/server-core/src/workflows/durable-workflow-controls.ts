import { canonical, digest, type DurableJournal, type DurableRunSnapshot } from '../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST, type DurableApproval, type DurableDecisionCommand, type DurableControlCommand, type DurableSteeringCommand } from '../../../shared/src/protocol/durable-execution.ts';
import type { WorkflowAttentionDTO, DurableWorkflowCommandDTO, DurableWorkflowControlResultDTO } from '../../../shared/src/protocol/dto.ts';
import type { DurableReadRunner } from './durable-read-runner.ts';

export interface DurableWorkflowActor { clientId: string; workspaceId?: string }
export type DurableWorkflowControlInput = DurableWorkflowCommandDTO;
export type DurableWorkflowControlResult = DurableWorkflowControlResultDTO;
export interface DurableWorkflowControlsOptions {
  journal: DurableJournal;
  runner: Pick<DurableReadRunner, 'decide'> & Partial<Pick<DurableReadRunner, 'control' | 'steer'>>;
  /** Must verify current access and return a stable principal; clientId is only a connection ID. */
  resolvePrincipal: (workspaceId: string, actor: DurableWorkflowActor) => Promise<string> | string;
}
const attentionId = (state: DurableRunSnapshot, approval: DurableApproval) => `durable:${state.spec.runId}:${approval.id}`;

/** Read/decision adapter only. It does not admit runs or write the legacy escalation database. */
export class DurableWorkflowControls {
  constructor(private readonly options: DurableWorkflowControlsOptions) {}

  private async principal(workspaceId: string, actor: DurableWorkflowActor): Promise<string> {
    const pinned = Object.freeze(JSON.parse(canonical(actor)) as DurableWorkflowActor);
    if (!workspaceId || !pinned.clientId || pinned.workspaceId !== undefined && pinned.workspaceId !== workspaceId) throw new Error('durable-attention-workspace-mismatch');
    const principal = await this.options.resolvePrincipal(workspaceId, pinned);
    if (typeof principal !== 'string' || !principal.trim()) throw new Error('durable-attention-principal-required');
    return principal;
  }

  private project(state: DurableRunSnapshot, approval: DurableApproval): WorkflowAttentionDTO {
    const reviewable = approval.input !== undefined && approval.status === 'pending' && approval.expiresAt > Date.now() && state.spec.deadlineAt > Date.now() && digest(state.spec.runtimeManifest) === digest(DURABLE_RUNTIME_MANIFEST);
    return {
      id: attentionId(state, approval), workflowRunId: state.spec.runId,
      recommendation: approval.input === undefined ? 'This older request has no saved reviewable input. Stop the workflow and start a new run.' : approval.expiresAt <= Date.now() ? 'This approval expired. Stop the workflow or resume to request a fresh review.' : `Review the exact input for ${approval.tool}.`,
      status: ['pending', 'expired'].includes(approval.status) ? 'pending' : ['approved', 'consumed'].includes(approval.status) ? 'approved' : 'rejected',
      createdAt: state.spec.createdAt,
      toolCall: { name: approval.tool, args: approval.input === undefined ? null : JSON.parse(canonical(approval.input)) },
      durable: { engine: 'sqlite-v2-readonly-1', workspaceId: state.spec.workspaceId, runId: state.spec.runId, approvalId: approval.id, version: state.version, expiresAt: approval.expiresAt, reviewable },
    };
  }

  async listAttention(workspaceId: string, actor: DurableWorkflowActor, runId?: string): Promise<WorkflowAttentionDTO[]> {
    const principal = await this.principal(workspaceId, actor);
    let states: DurableRunSnapshot[];
    try { states = runId ? [this.options.journal.get(runId, workspaceId)] : this.options.journal.listInternal(workspaceId); }
    catch (error) { if (runId && error instanceof Error && error.message === 'durable-run-not-found') return []; throw error; }
    if (runId && states[0]!.spec.approvalPrincipalId !== principal) throw new Error('durable-attention-principal-mismatch');
    return states.flatMap(state => state.spec.approvalPrincipalId !== principal || !['running', 'paused', 'waiting-approval'].includes(state.status) ? [] : (state.approvals ?? []).filter(approval => ['pending', 'expired'].includes(approval.status) && (state.approvals ?? []).filter(candidate => candidate.operationId === approval.operationId).at(-1)?.id === approval.id).map(approval => this.project(state, approval)));
  }

  async control(workspaceId: string, runId: string, command: DurableWorkflowControlInput, actor: DurableWorkflowActor): Promise<DurableWorkflowControlResult> {
    const pinned = JSON.parse(canonical(command)) as DurableWorkflowControlInput;
    if (!pinned || Array.isArray(pinned) || Object.keys(pinned).some(key => !['commandId', 'expectedVersion', 'action', ...(pinned.action === 'steer' ? ['text'] : [])].includes(key)) || typeof pinned.commandId !== 'string' || !pinned.commandId.trim() || !Number.isSafeInteger(pinned.expectedVersion) || pinned.expectedVersion < 1 || !['pause', 'resume', 'cancel', 'steer'].includes(pinned.action) || pinned.action === 'steer' && (typeof pinned.text !== 'string' || !pinned.text.trim())) throw new Error('invalid-durable-control-command');
    const principal = await this.principal(workspaceId, actor);
    const before = this.options.journal.get(runId, workspaceId);
    if (!before.spec.approvalPrincipalId || before.spec.approvalPrincipalId !== principal) throw new Error('durable-attention-principal-mismatch');
    const request = { ...pinned, workspaceId, runId } as DurableControlCommand | DurableSteeringCommand;
    let receipt = this.options.journal.controlReceipt(request);
    if (!receipt) {
      const runner = this.options.runner;
      if (request.action === 'steer') {
        if (!runner.steer) throw new Error('durable-control-unavailable');
        const result = await runner.steer(request); receipt = result.receipt; void result.execution?.catch(() => {});
      } else {
        if (!runner.control) throw new Error('durable-control-unavailable');
        const result = await runner.control(request); receipt = result.receipt; void result.execution?.catch(() => {});
      }
    }
    const current = this.options.journal.get(runId, workspaceId);
    return { receipt, state: { runId, workspaceId, status: current.status, version: current.version, controlRevision: current.controlRevision, continuationRevision: current.continuationRevision ?? 0, pendingUpdates: current.steering?.filter(entry => entry.appliedAfterTurn === undefined || !current.turns[entry.appliedAfterTurn + 1]).length ?? 0 } };
  }

  async resolveAttention(workspaceId: string, id: string, decision: 'approved' | 'rejected', command: { commandId: string; expectedVersion: number }, actor: DurableWorkflowActor): Promise<WorkflowAttentionDTO> {
    const pinnedCommand = JSON.parse(canonical(command)) as typeof command;
    if (!['approved', 'rejected'].includes(decision)) throw new Error('invalid-durable-attention-decision');
    const principal = await this.principal(workspaceId, actor);
    const state = this.options.journal.listInternal(workspaceId).find(state => state.approvals?.some(approval => attentionId(state, approval) === id));
    const approval = state?.approvals?.find(approval => attentionId(state!, approval) === id);
    if (!state || !approval) throw new Error('durable-attention-not-found');
    if (state.spec.approvalPrincipalId !== principal || approval.principalId !== principal) throw new Error('durable-attention-principal-mismatch');
    const decisionCommand: DurableDecisionCommand = { runId: state.spec.runId, workspaceId, commandId: pinnedCommand.commandId, expectedVersion: pinnedCommand.expectedVersion,
      action: decision === 'approved' ? 'approve' : 'deny', approvalId: approval.id, inputDigest: approval.inputDigest,
      principalId: principal, policyRevision: approval.policyRevision, credentialIdentity: approval.credentialIdentity };
    const existing = this.options.journal.decisionReceipt(decisionCommand);
    if (existing) {
      const projection = this.project(state, approval);
      projection.durable!.decisionReceipt = existing;
      return projection;
    }
    if (decision === 'approved' && digest(state.spec.runtimeManifest) !== digest(DURABLE_RUNTIME_MANIFEST)) throw new Error('durable-runtime-manifest-changed');
    if (decision === 'approved' && approval.input === undefined) throw new Error('durable-attention-input-unavailable');
    const result = await this.options.runner.decide(decisionCommand);
    // The immutable receipt is acknowledged separately from background continuation.
    void result.execution?.catch(() => {});
    const current = this.options.journal.get(state.spec.runId, workspaceId);
    const projection = this.project(current, current.approvals!.find(candidate => candidate.id === approval.id)!);
    projection.durable!.decisionReceipt = result.receipt;
    return projection;
  }
}

import { canonical, type DurableJournal, type DurableRunSnapshot } from '../../../shared/src/durable-execution/index.ts';
import type { WorkflowRunSnapshot } from '../../../shared/src/workflows/run-types.ts';
import type { LoadedWorkflow } from '../../../shared/src/workflows/types.ts';
import type { DurableWorkflowActor, DurableWorkflowControlsOptions } from './durable-workflow-controls.ts';

export interface DurableWorkflowRunsOptions {
  journal: DurableJournal;
  resolvePrincipal: DurableWorkflowControlsOptions['resolvePrincipal'];
  /** Only the owning host may report a worker as active. Absence means recovery is needed. */
  isActive?: (runId: string, workspaceId: string) => boolean;
}

/** Authorized projections of journal state; never creates legacy run.json copies. */
export class DurableWorkflowRuns {
  constructor(private readonly options: DurableWorkflowRunsOptions) {}

  private async principal(workspaceId: string, actor: DurableWorkflowActor): Promise<string> {
    const pinned = Object.freeze(JSON.parse(canonical(actor)) as DurableWorkflowActor);
    if (!workspaceId || !pinned.clientId || (pinned.workspaceId !== undefined && pinned.workspaceId !== workspaceId)) throw new Error('durable-runs-workspace-mismatch');
    const principal = await this.options.resolvePrincipal(workspaceId, pinned);
    if (typeof principal !== 'string' || !principal.trim()) throw new Error('durable-runs-principal-required');
    return principal;
  }

  async get(workspaceId: string, runId: string, actor: DurableWorkflowActor): Promise<WorkflowRunSnapshot | null> {
    const principal = await this.principal(workspaceId, actor);
    let snapshot: DurableRunSnapshot;
    try { snapshot = this.options.journal.get(runId, workspaceId); }
    catch (error) { if (error instanceof Error && error.message === 'durable-run-not-found') return null; throw error; }
    if (snapshot.spec.approvalPrincipalId !== principal) throw new Error('durable-runs-principal-mismatch');
    const projection = this.project(snapshot);
    if (!projection) throw new Error('durable-workflow-not-public');
    return projection;
  }

  async list(workspaceId: string, actor: DurableWorkflowActor, legacyRuns: WorkflowRunSnapshot[] = []): Promise<WorkflowRunSnapshot[]> {
    // Pin caller-owned legacy records before the asynchronous authority lookup.
    const legacy = JSON.parse(canonical(legacyRuns)) as WorkflowRunSnapshot[];
    const principal = await this.principal(workspaceId, actor);
    const journalRuns = this.options.journal.listInternal(workspaceId);
    // Every journal identity is reserved, including internal or differently owned runs.
    const reserved = new Set(journalRuns.map(snapshot => snapshot.spec.runId));
    const durable = journalRuns
      .filter(snapshot => snapshot.spec.approvalPrincipalId === principal)
      .flatMap(snapshot => { const projected = this.project(snapshot); return projected ? [projected] : []; });
    return [...durable, ...legacy.filter(run => run.workspaceId === workspaceId && !reserved.has(run.id))]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  private project(snapshot: DurableRunSnapshot): WorkflowRunSnapshot | null {
    const { spec, status } = snapshot;
    const context = spec.context as unknown as { workflow?: LoadedWorkflow };
    const workflow = context?.workflow;
    const authority = spec.authority as unknown as { adapter?: string; stepCount?: number; completion?: string };
    if (spec.parent || !workflow || typeof workflow.slug !== 'string' || typeof workflow.body !== 'string'
      || !workflow.metadata || workflow.metadata.steps?.length !== 1
      || authority?.adapter !== 'pi-local-read-1' || authority.stepCount !== 1 || authority.completion !== 'journal-only') return null;
    const definition = workflow.metadata.steps[0]!;
    const waiting = status === 'waiting-approval';
    const active = status === 'running' && this.options.isActive?.(spec.runId, spec.workspaceId) === true;
    const state = waiting ? 'paused' : status === 'running' ? active ? 'running' : 'interrupted' : status;
    const stepState = waiting ? 'awaiting-human' : state === 'paused' || state === 'cancelled' ? 'interrupted' : state;
    const message = snapshot.turns.at(-1)?.message as unknown as { content?: Array<{ type?: string; text?: string }> } | undefined;
    const output = status === 'succeeded' ? message?.content?.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') ?? '' : undefined;
    // The journal currently has no wall-clock mutation timestamps. Do not invent completion times.
    const createdAt = new Date(spec.createdAt).toISOString();
    return {
      id: spec.runId, workspaceId: spec.workspaceId, workflowSlug: workflow.slug, state,
      trigger: { type: workflow.metadata.trigger.type, inputs: {}, firedAt: createdAt },
      workflowSnapshot: JSON.parse(canonical({ metadata: workflow.metadata, body: workflow.body })),
      steps: [{ id: definition.id, state: stepState, attempts: snapshot.modelAttempts > 0 ? 1 : 0,
        ...(output !== undefined ? { output, completion: { outputChars: output.length, toolUseCount: snapshot.turns.flatMap(turn => turn.calls).filter(call => call.result !== undefined).length, satisfied: true } } : {}),
        ...(status === 'failed' ? { error: { code: 'durable-execution-failed', message: 'The durable workflow could not complete.' } } : {}),
      }], createdAt, updatedAt: createdAt,
      ...(state === 'interrupted' ? { interruptionReason: 'No worker is currently executing this saved run. Resume to continue.' } : {}),
      durable: { engine: spec.engine, version: snapshot.version, status, controlRevision: snapshot.controlRevision, continuationRevision: snapshot.continuationRevision ?? 0 },
    };
  }
}

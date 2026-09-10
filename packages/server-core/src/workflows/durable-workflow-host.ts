import { canonical } from '../../../shared/src/durable-execution/index.ts';
import type { DurableWorkflowActor } from './durable-workflow-controls.ts';
import { DurableWorkflowRuns } from './durable-workflow-runs.ts';
import type { LoadedWorkflow } from '../../../shared/src/workflows/types.ts';
import type { DurableChildRequest, DurableChildResult } from './durable-child-runner.ts';
import { DurableJournal, loadDurableKey, type DurableSafeStorage, type DurableRunSnapshot } from '../../../shared/src/durable-execution/index.ts';
import { DurableReadRunner, type DurableReadInput, type DurableReadRunnerOptions, type DurableReadAdmission, type DurableReadWorkflowInput } from './durable-read-runner.ts';
import { DurableWorkflowControls, type DurableWorkflowControlsOptions } from './durable-workflow-controls.ts';

export interface DurableWorkflowHostOptions {
  configRoot: string;
  protection: DurableSafeStorage;
  runnerOptions: Omit<DurableReadRunnerOptions, 'journal'>;
  resolvePrincipal: DurableWorkflowControlsOptions['resolvePrincipal'];
}
export type DurableWorkflowHostControls = Pick<DurableWorkflowControls, 'listAttention' | 'resolveAttention' | 'control'>;

/** Host-owned lifetime. No renderer configuration, automatic recovery, or production admission registration. */
export class DurableWorkflowHost {
  readonly controls: DurableWorkflowHostControls;
  readonly runs: Pick<DurableWorkflowRuns, 'get' | 'list'>;
  private readonly requests = new Set<Promise<unknown>>();
  private closing = false;
  private closed = false;
  private closeAttempt?: Promise<void>;

  static open(options: DurableWorkflowHostOptions): DurableWorkflowHost {
    const key = loadDurableKey(options.configRoot, options.protection);
    let journal: DurableJournal | undefined;
    try {
      journal = new DurableJournal({ configRoot: options.configRoot, key });
      const runner = new DurableReadRunner({ ...options.runnerOptions, journal });
      const service = new DurableWorkflowControls({ journal, runner, resolvePrincipal: options.resolvePrincipal });
      const runs = new DurableWorkflowRuns({ journal, resolvePrincipal: options.resolvePrincipal, isActive: (runId, workspaceId) => runner.isActive(runId, workspaceId) });
      return new DurableWorkflowHost(journal, runner, service, runs, options.resolvePrincipal);
    } catch (error) { journal?.close(); throw error; }
    finally { key.fill(0); }
  }

  private constructor(private readonly journal: DurableJournal, private readonly runner: DurableReadRunner, service: DurableWorkflowControls, runs: DurableWorkflowRuns, private readonly resolvePrincipal: DurableWorkflowHostOptions['resolvePrincipal']) {
    this.runs = Object.freeze({
      get: (...args: Parameters<DurableWorkflowRuns['get']>) => this.track(() => runs.get(...args)),
      list: (...args: Parameters<DurableWorkflowRuns['list']>) => this.track(() => runs.list(...args)),
    });
    this.controls = Object.freeze({
      listAttention: (...args: Parameters<DurableWorkflowControls['listAttention']>) => this.track(() => service.listAttention(...args)),
      resolveAttention: (...args: Parameters<DurableWorkflowControls['resolveAttention']>) => this.track(() => service.resolveAttention(...args)),
      control: (...args: Parameters<DurableWorkflowControls['control']>) => this.track(() => service.control(...args)),
    });
  }

  /** Trusted host admission only; the public workflow START handler remains unchanged. */
  start(input: DurableReadInput): Promise<DurableRunSnapshot> { return this.track(() => this.runner.start(input)); }

  /** Persist admission before acknowledging; accepted execution remains owned by this host. */
  admitWorkflow(workflow: LoadedWorkflow, input: DurableReadWorkflowInput): Promise<DurableReadAdmission> {
    return this.track(async () => {
      const admission = await this.runner.admitWorkflow(workflow, input);
      // Register directly: close may have fenced new requests while admission was pending.
      this.requests.add(admission.execution);
      void admission.execution.then(() => this.requests.delete(admission.execution), () => this.requests.delete(admission.execution));
      return admission;
    });
  }

  /** Internal admission guard for every engine, including scheduled and agent callers. No run payload is exposed. */
  hasUnfinishedWorkflow(workspaceId: string, workflowSlug: string): Promise<boolean> {
    return this.track(async () => this.journal.listInternal(workspaceId).some(state => {
      const context = state.spec.context as { workflow?: { slug?: string } } | null;
      return !state.spec.parent && context?.workflow?.slug === workflowSlug && (['running', 'paused', 'waiting-approval'].includes(state.status) || this.runner.isActive(state.spec.runId, workspaceId));
    }));
  }

  /** Normal manual Start supplies only its authenticated transport actor, never a principal. */
  admitWorkflowForActor(workflow: LoadedWorkflow, input: Omit<DurableReadWorkflowInput, 'approvalPrincipalId'>, actor: DurableWorkflowActor): Promise<DurableReadAdmission> {
    const pinnedWorkflow = JSON.parse(canonical(workflow)) as LoadedWorkflow;
    const pinnedInput = JSON.parse(canonical(input)) as typeof input;
    const pinnedActor = Object.freeze(JSON.parse(canonical(actor)) as DurableWorkflowActor);
    return this.track(async () => {
      if (!pinnedActor.clientId || pinnedActor.workspaceId !== undefined && pinnedActor.workspaceId !== pinnedInput.workspaceId) throw new Error('durable-authority-workspace-mismatch');
      const principal = await this.resolvePrincipal(pinnedInput.workspaceId, pinnedActor);
      if (typeof principal !== 'string' || !principal.trim()) throw new Error('durable-authority-unauthenticated');
      return this.admitWorkflow(pinnedWorkflow, { ...pinnedInput, approvalPrincipalId: principal });
    });
  }

  async startWorkflow(workflow: LoadedWorkflow, input: DurableReadWorkflowInput): Promise<DurableRunSnapshot> {
    return (await this.admitWorkflow(workflow, input)).execution;
  }

  /** Host-only child orchestration; no renderer or general delegation tool is registered. */
  startChild(parentRunId: string, workspaceId: string, request: DurableChildRequest): Promise<DurableChildResult> {
    return this.track(() => this.runner.startChild(parentRunId, workspaceId, request));
  }

  private track<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('durable-host-closing'));
    let request: Promise<T>;
    try { request = Promise.resolve(action()); }
    catch (error) { return Promise.reject(error); }
    this.requests.add(request);
    void request.then(() => this.requests.delete(request), () => this.requests.delete(request));
    return request;
  }

  /** Never force-close storage under a live request/agent. The desktop owns any outer quit deadline. */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.closeAttempt) return this.closeAttempt;
    this.closing = true;
    const attempt = (async () => {
      // Pause/fence immediately, before awaiting long-running starts or permission lookups.
      const stopping = this.runner.quiesce();
      const outcomes = await Promise.allSettled([stopping, ...this.requests]);
      const stopped = outcomes[0]!;
      if (stopped.status === 'rejected') throw stopped.reason;
      this.journal.close();
      this.closed = true;
    })();
    this.closeAttempt = attempt;
    void attempt.then(() => { this.closeAttempt = undefined; }, () => { this.closeAttempt = undefined; });
    return attempt;
  }
}

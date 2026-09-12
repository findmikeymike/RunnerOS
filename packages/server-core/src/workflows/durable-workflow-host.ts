import { canonical } from '../../../shared/src/durable-execution/index.ts';
import { durableWorkflowOccurrenceIdentity, type DurableWorkflowOccurrence } from './durable-workflow-occurrence.ts';
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
  /** Local scheduler authority; independent of any connected renderer. */
  resolveScheduledPrincipal?: (workspaceId: string) => string;
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
      return new DurableWorkflowHost(journal, runner, service, runs, options.resolvePrincipal, options.resolveScheduledPrincipal);
    } catch (error) { journal?.close(); throw error; }
    finally { key.fill(0); }
  }

  private constructor(private readonly journal: DurableJournal, private readonly runner: DurableReadRunner, service: DurableWorkflowControls, private readonly runService: DurableWorkflowRuns, private readonly resolvePrincipal: DurableWorkflowHostOptions['resolvePrincipal'], private readonly resolveScheduledPrincipal?: (workspaceId: string) => string) {
    const runs = this.runService;
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

  setBackgroundFenceAuthorizer(authorize: NonNullable<DurableReadRunnerOptions['assertBackgroundFence']>): void {
    this.runner.setBackgroundFenceAuthorizer(authorize);
  }

  assertBackgroundFence(workspaceId: string, fence?: string): void {
    this.runner.assertBackgroundFence(workspaceId, fence);
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

  private scheduledPrincipal(workspaceId: string): string {
    const principal = this.resolveScheduledPrincipal?.(workspaceId);
    if (typeof principal !== 'string' || !principal.trim()) throw new Error('durable-scheduler-authority-unavailable');
    return principal;
  }

  /** Reconcile only: never dispatches, resumes, or resets the original deadline/budget. */
  getScheduledRun(workspaceId: string, occurrence: DurableWorkflowOccurrence) {
    const identity = durableWorkflowOccurrenceIdentity(workspaceId, occurrence);
    return this.track(async () => {
      const principal = this.scheduledPrincipal(workspaceId);
      const run = this.runService.getForPrincipal(workspaceId, identity.runId, principal);
      if (run && (this.journal.get(identity.runId, workspaceId).spec.commandId !== identity.commandId || run.workflowSlug !== occurrence.workflowSlug)) throw new Error('durable-scheduled-occurrence-mismatch');
      return run;
    });
  }

  getRunForScheduler(workspaceId: string, runId: string) {
    return this.track(async () => this.runService.getForPrincipal(workspaceId, runId, this.scheduledPrincipal(workspaceId)));
  }

  /** Scheduler ownership includes terminal or paused runs whose backend is still draining. */
  isRunActive(workspaceId: string, runId: string): Promise<boolean> {
    return this.track(async () => {
      this.scheduledPrincipal(workspaceId);
      return this.runner.isActive(runId, workspaceId);
    });
  }

  admitWorkflowForScheduler(workflow: LoadedWorkflow, input: Omit<DurableReadWorkflowInput, 'approvalPrincipalId'>, occurrence: DurableWorkflowOccurrence): Promise<DurableReadAdmission> {
    const identity = durableWorkflowOccurrenceIdentity(input.workspaceId, occurrence);
    if (input.runId !== identity.runId || input.commandId !== identity.commandId || workflow.slug !== occurrence.workflowSlug) return Promise.reject(new Error('durable-scheduled-occurrence-mismatch'));
    const principal = this.scheduledPrincipal(input.workspaceId);
    return this.admitWorkflow(workflow, { ...input, approvalPrincipalId: principal });
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

import type { DurableChildRequest, DurableChildResult } from './durable-child-runner.ts';
import { DurableJournal, loadDurableKey, type DurableSafeStorage, type DurableRunSnapshot } from '../../../shared/src/durable-execution/index.ts';
import { DurableReadRunner, type DurableReadInput, type DurableReadRunnerOptions } from './durable-read-runner.ts';
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
      return new DurableWorkflowHost(journal, runner, service);
    } catch (error) { journal?.close(); throw error; }
    finally { key.fill(0); }
  }

  private constructor(private readonly journal: DurableJournal, private readonly runner: DurableReadRunner, service: DurableWorkflowControls) {
    this.controls = Object.freeze({
      listAttention: (...args: Parameters<DurableWorkflowControls['listAttention']>) => this.track(() => service.listAttention(...args)),
      resolveAttention: (...args: Parameters<DurableWorkflowControls['resolveAttention']>) => this.track(() => service.resolveAttention(...args)),
      control: (...args: Parameters<DurableWorkflowControls['control']>) => this.track(() => service.control(...args)),
    });
  }

  /** Trusted host admission only; the public workflow START handler remains unchanged. */
  start(input: DurableReadInput): Promise<DurableRunSnapshot> { return this.track(() => this.runner.start(input)); }

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

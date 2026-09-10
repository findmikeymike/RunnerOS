import { resolveTemplate } from '../../../shared/src/workflows/template.ts';
import { DurableChildRunner, type DurableChildRequest, type DurableChildResult } from './durable-child-runner.ts';
import { shouldAllowToolInMode } from '../../../shared/src/agent/mode-manager.ts';
import { permissionsConfigCache } from '../../../shared/src/agent/permissions-config.ts';
import { realpathSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { ensureDurableTextOutput } from '../../../shared/src/outputs/durable-text.ts';
import type { AgentEvent, Workspace } from '@craft-agent/core/types';
import type { AgentBackend, BackendHostRuntimeContext, CoreBackendConfig } from '../../../shared/src/agent/backend/types.ts';
import type { ResolvedBackendContext } from '../../../shared/src/agent/backend/factory.ts';
import { canonical, digest, type DurableClaim, type DurableJournal, type DurableRunSnapshot, type DurableRunSpec } from '../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST, type DurableCheckpoint, type DurableControlCommand, type DurableControlReceipt, type DurableDecisionCommand, type DurableDecisionReceipt, type DurableJson, type DurableSteeringCommand, type DurableSteeringReceipt, type DurableToolAuthorization } from '../../../shared/src/protocol/durable-execution.ts';
import type { LoadedWorkflow } from '../../../shared/src/workflows/types.ts';

export interface DurableReadBinding {
  workspace: Workspace; context: ResolvedBackendContext;
  /** SHA256 of canonical {provider,credential} for the exact Pi transport; never raw credentials. */
  credentialIdentity: string;
}
/** Trusted host inputs only: no renderer/legacy runner registration exists in P-02. */
export interface DurableReadInput {
  runId: string; commandId: string; workspaceId: string; connectionSlug: string; model: string;
  prompt: string; systemPrompt: string; allowedTools: DurableRunSpec['allowedTools'];
  maxOutputTokens: number; deadlineAt: number; maxModelAttempts: number;
  /** Opt-in trusted authorization binding. Omit for the existing certified read path. */
  approvalPrincipalId?: string;
  /** Certified by the host, never estimated from renderer input. */
  costPolicy: DurableRunSpec['costPolicy'];
}
export type DurableReadWorkflowInput = Omit<DurableReadInput, 'prompt'> & { resolvedAgentSlug: string; resolvedSteps?: Array<{ id: string; agent: string; systemPrompt: string }> };
export interface DurableReadAdmission {
  snapshot: DurableRunSnapshot;
  /** Observed internally; callers may separately await completion or failure. */
  execution: Promise<DurableRunSnapshot>;
}
export interface DurableReadBackendArgs {
  context: ResolvedBackendContext; hostRuntime: BackendHostRuntimeContext; coreConfig: CoreBackendConfig;
}
type ReadBackend = Pick<AgentBackend, 'chat' | 'abort' | 'destroy'>;
export interface DurableReadRunnerOptions {
  journal: DurableJournal;
  hostRuntime: BackendHostRuntimeContext;
  /** Resolve current host-owned workspace and connection configuration. */
  resolveBinding(workspaceId: string, connectionSlug: string, model: string): Promise<DurableReadBinding> | DurableReadBinding;
  createBackend?: (args: DurableReadBackendArgs) => Promise<ReadBackend> | ReadBackend;
  onEvent?: (runId: string, event: AgentEvent) => void;
  /** Synchronous source revision after the last awaited authorization/binding lookup. */
  readPolicyRevision?: (workspaceRoot: string) => string;
  resolvePublicationWorkspace?: (workspaceId: string) => { id: string; rootPath: string } | Promise<{ id: string; rootPath: string }>;
  authorizePublication?: (context: { workspaceId: string; approvalPrincipalId: string }) => void;
  publishOutput?: typeof ensureDurableTextOutput;
  onOutputPublished?: (workspaceId: string, outputId: string) => void;
  authorizeRun?: (context: { runId: string; workspaceId: string; approvalPrincipalId: string }) => void;
  authorizeTool?: (request: Extract<DurableCheckpoint, { kind: 'tool-start' }>, context: { runId: string; workspaceId: string; approvalPrincipalId: string; connectionSlug: string; model: string; credentialIdentity: string; deadlineAt: number }) => Promise<DurableToolAuthorization>;
}
export interface DurableReadControlResult {
  receipt: DurableControlReceipt;
  /** Host-owned execution handle, not an RPC value. Observe failures independently from command acknowledgement. */
  execution?: Promise<DurableRunSnapshot>;
}
export interface DurableReadDecisionResult {
  receipt: DurableDecisionReceipt;
  execution?: Promise<DurableRunSnapshot>;
}
export interface DurableReadSteeringResult { receipt: DurableSteeringReceipt; execution?: Promise<DurableRunSnapshot> }
interface ActiveReadExecution { claim?: DurableClaim; backend?: ReadBackend; promise: Promise<DurableRunSnapshot>; replayForSteering?: boolean }
interface FrozenReadContext {
  prompt: string; systemPrompt: string; connectionSlug: string; workspaceRoot: string; bindingDigest: string;
  requireNonEmptyOutput: boolean;
  workflow: DurableJson;
  steps?: Array<{ id: string; prompt: string; systemPrompt: string; requireNonEmptyOutput: boolean }>;
}

/** Reuse the existing Pi provider driver and runtime resolver, with model fallback disabled. */
export async function createDurableReadBackend(args: DurableReadBackendArgs): Promise<ReadBackend> {
  const { createBackendFromResolvedContext } = await import('../../../shared/src/agent/backend/factory.ts');
  return createBackendFromResolvedContext(args);
}
function bindingDigest(binding: DurableReadBinding): string {
  const { context, workspace } = binding, connection = context.connection;
  if (context.provider !== 'pi' || !connection || workspace.remoteServer) throw new Error('durable-read-local-pi-required');
  if (typeof binding.credentialIdentity !== 'string' || !binding.credentialIdentity.trim()) throw new Error('durable-read-credential-identity-required');
  // Save a fingerprint, never a second credential copy. Display labels and access dates do not affect dispatch.
  return digest({ credentialIdentity: binding.credentialIdentity, workspaceId: workspace.id, root: realpathSync(workspace.rootPath), model: context.resolvedModel,
    authType: context.authType ?? null, connection: { slug: connection.slug, providerType: connection.providerType,
      authType: connection.authType, baseUrl: connection.baseUrl ?? null, piAuthProvider: connection.piAuthProvider ?? null,
      customEndpoint: connection.customEndpoint ?? null, models: connection.models ?? null } });
}
function frozenContext(spec: DurableRunSpec): FrozenReadContext {
  const value = spec.context as unknown as FrozenReadContext;
  if (!value || typeof value !== 'object' || typeof value.requireNonEmptyOutput !== 'boolean' || !['prompt', 'systemPrompt', 'connectionSlug', 'workspaceRoot', 'bindingDigest'].every(key => typeof (value as unknown as Record<string, unknown>)[key] === 'string')) throw new Error('invalid-durable-read-context');
  return value;
}

function supportsPublication(workflow: LoadedWorkflow): boolean {
  const output = workflow.metadata.outputs;
  if (output?.mode === 'none') return true;
  if (output?.mode !== 'final-step' || !['report', 'document'].includes(output.kind ?? 'document')
    || Object.keys(output).some(key => !['mode', 'kind', 'title', 'summary', 'primary'].includes(key))) return false;
  for (const value of [output.title, output.summary]) {
    if (value !== undefined && (typeof value !== 'string' || value.includes('{{') || value.includes('}}'))) return false;
  }
  if (output.primary && (output.primary.from !== 'step-output'
    || (output.primary.step !== undefined && output.primary.step !== workflow.metadata.steps.at(-1)?.id)
    || Object.keys(output.primary).some(key => !['from', 'step'].includes(key)))) return false;
  return true;
}
function publicationId(workspaceId: string, runId: string): string {
  const bytes = createHash('sha256').update(canonical(['artist-os-durable-output', workspaceId, runId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** The narrow workflow shape whose execution semantics are implemented by this adapter. */
export function supportsDurableReadWorkflow(workflow: LoadedWorkflow): boolean {
  if (workflow.parseWarnings?.length || workflow.metadata.trigger.type !== 'manual' || !supportsPublication(workflow)
    || workflow.metadata.trigger.inputs?.length || workflow.metadata.steps.length < 1 || workflow.metadata.steps.length > 8) return false;
  const prior = new Set<string>();
  for (const step of workflow.metadata.steps) {
    if (!step || !/^[a-zA-Z0-9_-]+$/.test(step.id) || prior.has(step.id) || !step.input?.trim()
      || step.taskModeId || step.outputSchema || step.timeout !== undefined
      || (step.retries ?? 0) !== 0 || (step.onFailure ?? 'stop') !== 'stop' || step.legacySkillReferences?.length
      || Object.keys(step).some(key => !['id', 'agent', 'input', 'description', 'retries', 'onFailure', 'completion', 'legacySkillReferences', 'legacySkillPromptHash'].includes(key))
      || Object.keys(step.completion ?? {}).some(key => key !== 'requireNonEmptyOutput')) return false;
    let valid = true;
    const remaining = step.input.replace(/\{\{\s*steps\.([a-zA-Z0-9_-]+)\.output\s*(?:\|\s*escape\s*)?\}\}/g, (_match, id: string) => {
      if (!prior.has(id)) valid = false;
      return '';
    });
    if (!valid || remaining.includes('{{') || remaining.includes('}}')) return false;
    prior.add(step.id);
  }
  return true;
}

/** Sequential local read execution. Only journal checkpoints authorize success. */
export class DurableReadRunner {
  private readonly active = new Map<string, ActiveReadExecution>();
  private closing = false;
  private quiescing?: Promise<void>;
  private readonly pendingPauses = new Set<string>();
  private readonly background = new Set<Promise<DurableRunSnapshot>>();
  constructor(private readonly options: DurableReadRunnerOptions) {}

  /** Fence admission immediately, persist cooperative pauses, then drain before the host closes storage. */
  quiesce(): Promise<void> {
    if (this.quiescing) return this.quiescing;
    this.closing = true;
    const errors: unknown[] = [];
    const active = [...this.active.entries()];
    for (const [key] of active) this.pendingPauses.add(key);
    for (const key of this.pendingPauses) {
      const [workspaceId, runId] = JSON.parse(key) as [string, string];
      try {
        const state = this.options.journal.get(runId, workspaceId);
        if (state.status === 'running') this.options.journal.command({ runId, workspaceId, commandId: randomUUID(), expectedVersion: state.version, action: 'pause' });
        this.pendingPauses.delete(key);
      } catch (error) { errors.push(error); }
    }
    this.quiescing = (async () => {
      const results = await Promise.allSettled([...active.map(([, entry]) => entry.promise), ...this.background]);
      for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Durable host quiesce failed');
    })();
    const attempt = this.quiescing;
    void attempt.catch(() => {
      // Preserve this attempt's rejection, but allow a later close to retry retained pause obligations.
      if (this.quiescing === attempt) this.quiescing = undefined;
    });
    return attempt;
  }

  private assertOpen(): void { if (this.closing) throw new Error('durable-host-closing'); }
  private trackBackground(execution: Promise<DurableRunSnapshot>): Promise<DurableRunSnapshot> {
    this.background.add(execution);
    void execution.then(() => this.background.delete(execution), () => this.background.delete(execution));
    return execution;
  }

  /** Existing workflow adapter: unsupported execution semantics fail before admission. */
  async startWorkflow(workflow: LoadedWorkflow, input: DurableReadWorkflowInput): Promise<DurableRunSnapshot> {
    return (await this.admitWorkflow(workflow, input)).execution;
  }

  admitWorkflow(workflow: LoadedWorkflow, input: DurableReadWorkflowInput): Promise<DurableReadAdmission> {
    if (this.closing) return Promise.reject(new Error('durable-host-closing'));
    workflow = JSON.parse(JSON.stringify(workflow)) as LoadedWorkflow;
    const step = workflow.metadata.steps[0];
    if (!supportsDurableReadWorkflow(workflow) || step?.agent !== input.resolvedAgentSlug) {
      return Promise.reject(new Error('unsupported-durable-read-workflow'));
    }
    const { resolvedAgentSlug: _slug, resolvedSteps, ...rest } = input;
    if (workflow.metadata.steps.length > 1 && (!resolvedSteps || resolvedSteps.length !== workflow.metadata.steps.length
      || resolvedSteps.some((resolved, i) => resolved.id !== workflow.metadata.steps[i]!.id || resolved.agent !== workflow.metadata.steps[i]!.agent || !resolved.systemPrompt?.trim()))) {
      return Promise.reject(new Error('unsupported-durable-read-workflow'));
    }
    return this.admit({ ...rest, prompt: step.input }, workflow, resolvedSteps ? JSON.parse(canonical(resolvedSteps)) : undefined);
  }

  async start(input: DurableReadInput): Promise<DurableRunSnapshot> { return (await this.admit(input)).execution; }

  private async admit(input: DurableReadInput, workflow?: LoadedWorkflow, resolvedSteps?: DurableReadWorkflowInput['resolvedSteps']): Promise<DurableReadAdmission> {
    this.assertOpen();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.runId) || !input.prompt.trim() || !input.systemPrompt.trim()) throw new Error('invalid-durable-read-input');
    const requested = JSON.parse(canonical(input)) as DurableReadInput;
    const binding = JSON.parse(JSON.stringify(await this.options.resolveBinding(requested.workspaceId, requested.connectionSlug, requested.model))) as DurableReadBinding;
    this.assertOpen();
    this.checkBinding(binding, requested.workspaceId, requested.connectionSlug, requested.model);
    const context: FrozenReadContext = { prompt: requested.prompt, systemPrompt: requested.systemPrompt,
      connectionSlug: requested.connectionSlug, workspaceRoot: realpathSync(binding.workspace.rootPath), bindingDigest: bindingDigest(binding),
      requireNonEmptyOutput: workflow?.metadata.steps[0]?.completion?.requireNonEmptyOutput !== false,
      workflow: workflow ? JSON.parse(JSON.stringify(workflow)) as DurableJson : null,
      ...(workflow && workflow.metadata.steps.length > 1 ? { steps: workflow.metadata.steps.map((step, i) => ({ id: step.id, prompt: step.input,
        systemPrompt: resolvedSteps![i]!.systemPrompt, requireNonEmptyOutput: step.completion?.requireNonEmptyOutput !== false })) } : {}) };
    let createdAt = Date.now();
    try { createdAt = this.options.journal.get(requested.runId, requested.workspaceId).spec.createdAt; }
    catch (error) { if (!(error instanceof Error) || error.message !== 'durable-run-not-found') throw error; }
    const output = workflow?.metadata.outputs;
    if (output?.mode === 'final-step') {
      if (!requested.approvalPrincipalId || !this.options.authorizePublication || !this.options.resolvePublicationWorkspace) throw new Error('unsupported-durable-read-workflow');
      this.options.authorizePublication({ workspaceId: requested.workspaceId, approvalPrincipalId: requested.approvalPrincipalId });
    }
    const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: requested.runId, workspaceId: requested.workspaceId,
      credentialIdentity: binding.credentialIdentity, runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST },
      createdAt, commandId: requested.commandId, model: requested.model, allowedTools: requested.allowedTools,
      maxOutputTokens: requested.maxOutputTokens, maxModelAttempts: requested.maxModelAttempts, deadlineAt: requested.deadlineAt,
      ...(output?.mode === 'final-step' ? { publication: { outputId: publicationId(requested.workspaceId, requested.runId),
        kind: (output.kind ?? 'document') as 'report' | 'document', title: output.title?.trim() || workflow!.metadata.name.trim(),
        ...(output.summary?.trim() ? { summary: output.summary.trim() } : {}), stepId: workflow!.metadata.steps.at(-1)!.id } } : {}),
      costPolicy: requested.costPolicy, context: context as unknown as DurableJson,
      ...(requested.approvalPrincipalId !== undefined ? { approvalPrincipalId: requested.approvalPrincipalId } : {}),
      authority: { adapter: context.steps ? 'pi-local-read-multi-1' : 'pi-local-read-1', stepCount: context.steps?.length ?? 1, completion: 'journal-only' },
      ...(context.steps ? { workflowSteps: context.steps.map(step => ({ id: step.id })) } : {}) };
    const snapshot = this.options.journal.admit(spec);
    const execution = this.resume(spec.runId, spec.workspaceId);
    void execution.catch(() => {});
    return { snapshot, execution };
  }

  /** Internal orchestration seam: children use this host's active parent claim and lifetime. */
  startChild(parentRunId: string, workspaceId: string, request: DurableChildRequest): Promise<DurableChildResult> {
    if (this.closing) return Promise.reject(new Error('durable-host-closing'));
    const claim = this.active.get(canonical([workspaceId, parentRunId]))?.claim;
    if (!claim) return Promise.reject(new Error('durable-child-active-parent-required'));
    const parent = this.options.journal.get(parentRunId, workspaceId);
    if (!parent.spec.approvalPrincipalId) return Promise.reject(new Error('durable-child-principal-required'));
    this.options.authorizeRun?.({ runId: parentRunId, workspaceId, approvalPrincipalId: parent.spec.approvalPrincipalId });
    return new DurableChildRunner({ journal: this.options.journal, runner: this }).start(claim, request);
  }

  isActive(runId: string, workspaceId: string): boolean { return this.active.has(canonical([workspaceId, runId])); }

  resume(runId: string, workspaceId: string): Promise<DurableRunSnapshot> {
    if (this.closing) return Promise.reject(new Error('durable-host-closing'));
    const key = canonical([workspaceId, runId]), prior = this.active.get(key);
    if (prior) return prior.promise;
    const entry: ActiveReadExecution = { promise: undefined! };
    this.active.set(key, entry);
    entry.promise = Promise.resolve().then(async () => {
      let previousPendingProgress: string | undefined;
      while (true) {
        entry.replayForSteering = false;
        const state = await this.execute(runId, workspaceId, entry);
        if (this.closing || !entry.replayForSteering || state.status !== 'running') return state;
        const progress = digest({ steering: state.steering ?? [], continuationRevision: state.continuationRevision ?? 0, modelAttempts: state.modelAttempts });
        if (progress === previousPendingProgress) throw new Error('durable-steering-replay-stalled');
        previousPendingProgress = progress;
      }
    }).finally(() => this.active.delete(key));
    return entry.promise;
  }

  async cancel(runId: string, workspaceId: string): Promise<void> {
    this.assertOpen();
    this.options.journal.cancel(runId, workspaceId);
    await this.active.get(canonical([workspaceId, runId]))?.backend?.abort('durable-run-cancelled');
  }

  async control(command: DurableControlCommand): Promise<DurableReadControlResult> {
    this.assertOpen();
    command = JSON.parse(canonical(command)) as DurableControlCommand;
    const receipt = Object.freeze(this.options.journal.command(command));
    const key = canonical([command.workspaceId, command.runId]);
    const previous = this.active.get(key);
    if (command.action === 'cancel') {
      return { receipt, execution: this.abortAfterCommit(receipt, previous?.backend, 'durable-run-cancelled') };
    }
    if (command.action !== 'resume') return { receipt };
    return { receipt, execution: this.resumeAfterDrain(receipt, previous?.promise) };
  }

  async decide(command: DurableDecisionCommand): Promise<DurableReadDecisionResult> {
    this.assertOpen();
    command = JSON.parse(canonical(command)) as DurableDecisionCommand;
    const receipt = Object.freeze(this.options.journal.decide(command));
    const previous = this.active.get(canonical([command.workspaceId, command.runId]));
    if (command.action === 'deny') {
      return { receipt, execution: this.abortAfterCommit(receipt, previous?.backend, 'durable-approval-denied') };
    }
    if (receipt.status !== 'running') return { receipt };
    return { receipt, execution: this.resumeAfterDrain(receipt, previous?.promise) };
  }

  async steer(command: DurableSteeringCommand): Promise<DurableReadSteeringResult> {
    this.assertOpen();
    command = JSON.parse(canonical(command)) as DurableSteeringCommand;
    const before = this.options.journal.get(command.runId, command.workspaceId);
    const receipt = Object.freeze(this.options.journal.steer(command));
    const previous = this.active.get(canonical([command.workspaceId, command.runId]));
    const current = this.options.journal.get(command.runId, command.workspaceId);
    if (current.status !== 'running' || current.controlRevision !== receipt.controlRevision || previous && before.status === 'running') return { receipt };
    return { receipt, execution: this.resumeAfterDrain(receipt, previous?.promise) };
  }

  private abortAfterCommit(receipt: Pick<DurableControlReceipt, 'runId' | 'workspaceId'>, backend: ReadBackend | undefined, reason: string): Promise<DurableRunSnapshot> | undefined {
    if (!backend) return undefined;
    // Shutdown is cooperative; the committed cancellation must be acknowledged even if it hangs or rejects.
    const execution = Promise.resolve().then(async () => {
      const current = this.options.journal.get(receipt.runId, receipt.workspaceId);
      if (current.status !== 'cancelled') return current;
      await backend.abort(reason);
      return this.options.journal.get(receipt.runId, receipt.workspaceId);
    });
    void execution.catch(() => { /* Keep failures observable without requiring receipt-only callers to await shutdown. */ });
    return this.trackBackground(execution);
  }

  private resumeAfterDrain(receipt: Pick<DurableControlReceipt, 'runId' | 'workspaceId' | 'controlRevision'>, previous?: Promise<DurableRunSnapshot>): Promise<DurableRunSnapshot> {
    const execution = (async () => {
      // A resumed owner must not race the still-draining model/tool response of the preceding claim.
      let previousFailure: unknown;
      let previouslyFailed = false;
      try { await previous; } catch (error) { previouslyFailed = true; previousFailure = error; }
      try {
        const current = this.options.journal.get(receipt.runId, receipt.workspaceId);
        if (this.closing || current.status !== 'running' || current.controlRevision !== receipt.controlRevision) return current;
        return await this.resume(receipt.runId, receipt.workspaceId);
      } catch (error) {
        if (previouslyFailed) throw new AggregateError([previousFailure, error], 'Durable resume failed after the previous execution failed', { cause: previousFailure });
        throw error;
      }
    })();
    void execution.catch(() => { /* The receipt can be observed alone; execution remains reject-observable to callers. */ });
    return this.trackBackground(execution);
  }

  private checkBinding(binding: DurableReadBinding, workspaceId: string, connectionSlug: string, model: string): void {
    if (binding.workspace.id !== workspaceId || binding.context.connection?.slug !== connectionSlug || binding.context.resolvedModel !== model) throw new Error('durable-read-binding-mismatch');
    bindingDigest(binding);
  }

  private async publishPending(state: DurableRunSnapshot, claim: DurableClaim, bridge: ReturnType<DurableJournal['bridge']>): Promise<DurableRunSnapshot> {
    const { journal } = this.options, { runId, workspaceId } = state.spec;
    if (state.publication?.status !== 'pending' || state.status !== 'running') return state;
    try {
      const frozen = frozenContext(state.spec), publication = state.spec.publication;
      if (!publication || !state.spec.approvalPrincipalId || !this.options.authorizePublication || !this.options.resolvePublicationWorkspace) throw new Error('durable-output-authorization-required');
      const current = await this.options.resolvePublicationWorkspace(workspaceId);
      if (current.id !== workspaceId || realpathSync(current.rootPath) !== frozen.workspaceRoot) throw new Error('durable-output-workspace-changed');
      this.options.authorizePublication({ workspaceId, approvalPrincipalId: state.spec.approvalPrincipalId });
      state = journal.get(runId, workspaceId);
      if (state.status !== 'running' || state.controlRevision !== claim.controlRevision) return state;
      const workflow = frozen.workflow as unknown as LoadedWorkflow;
      const result = (this.options.publishOutput ?? ensureDurableTextOutput)(frozen.workspaceRoot, {
        id: publication.outputId, workspaceId, workflowRunId: runId, workflowSlug: workflow.slug, stepId: publication.stepId,
        title: publication.title, ...(publication.summary ? { summary: publication.summary } : {}), kind: publication.kind,
        content: state.publication!.content, createdAt: new Date(state.spec.createdAt).toISOString(),
      });
      if (result.outputId !== publication.outputId) throw new Error('durable-output-identity-mismatch');
      await bridge.checkpoint({ kind: 'output-published', outputId: publication.outputId });
      try { this.options.onOutputPublished?.(workspaceId, publication.outputId); } catch { /* Observer failures cannot undo publication. */ }
      return journal.get(runId, workspaceId);
    } catch {
      const current = journal.get(runId, workspaceId);
      if (current.status === 'running' && current.controlRevision === claim.controlRevision) {
        journal.command({ runId, workspaceId, commandId: randomUUID(), expectedVersion: current.version, action: 'pause' });
      }
      return journal.get(runId, workspaceId);
    }
  }

  private async execute(runId: string, workspaceId: string, entry: ActiveReadExecution): Promise<DurableRunSnapshot> {
    const { journal } = this.options, initial = journal.get(runId, workspaceId);
    if (initial.status !== 'running') return initial;
    const claim = journal.claim(runId, workspaceId);
    entry.claim = claim;
    const journalBridge = journal.bridge(claim, initial.spec.approvalPrincipalId ? {
      authorizeTool: async request => {
        const frozen = frozenContext(initial.spec);
        const checkCurrent = async () => {
          this.options.authorizeRun?.({ runId, workspaceId, approvalPrincipalId: initial.spec.approvalPrincipalId! });
          const current = await this.options.resolveBinding(workspaceId, frozen.connectionSlug, initial.spec.model);
          this.options.authorizeRun?.({ runId, workspaceId, approvalPrincipalId: initial.spec.approvalPrincipalId! });
          this.checkBinding(current, workspaceId, frozen.connectionSlug, initial.spec.model);
          if (bindingDigest(current) !== frozen.bindingDigest) throw new Error('durable-authorization-blocked');
          permissionsConfigCache.invalidateDefaults();
          permissionsConfigCache.invalidateWorkspace(frozen.workspaceRoot);
          const policyTool = { read: 'Read', grep: 'Grep', find: 'Glob', ls: 'Glob' }[request.tool];
          if (!policyTool || !shouldAllowToolInMode(policyTool, request.input, 'safe', { permissionsContext: { workspaceRootPath: frozen.workspaceRoot, activeSourceSlugs: [] } }).allowed) throw new Error('durable-authorization-blocked');
        };
        await checkCurrent();
        if (!this.options.authorizeTool) throw new Error('durable-authorization-blocked');
        const authorization = await this.options.authorizeTool(request, { runId, workspaceId, approvalPrincipalId: initial.spec.approvalPrincipalId!, connectionSlug: frozen.connectionSlug, model: initial.spec.model, credentialIdentity: initial.spec.credentialIdentity, deadlineAt: initial.spec.deadlineAt });
        await checkCurrent();
        if (this.options.readPolicyRevision && this.options.readPolicyRevision(frozen.workspaceRoot) !== authorization.policyRevision) throw new Error('durable-authorization-blocked');
        return authorization;
      },
    } : undefined);
    const assertDispatch = () => {
      const state = journal.get(runId, workspaceId);
      if (state.controlRevision !== claim.controlRevision) throw new Error('durable-control-changed');
      if (state.status === 'paused') throw new Error('durable-run-paused');
      if (state.status === 'waiting-approval') throw new Error('durable-approval-required');
      if (state.status !== 'running' || Date.now() >= state.spec.deadlineAt) throw new Error('durable-read-dispatch-blocked');
    };
    const bridge: typeof journalBridge = { ...journalBridge, checkpoint: async request => {
      if (request.kind === 'output-published') throw new Error('durable-workflow-host-checkpoint-required');
      if (request.kind === 'model-start') {
        try {
          const frozen = frozenContext(initial.spec);
          if (initial.spec.approvalPrincipalId) this.options.authorizeRun?.({ runId, workspaceId, approvalPrincipalId: initial.spec.approvalPrincipalId });
          const current = await this.options.resolveBinding(workspaceId, frozen.connectionSlug, initial.spec.model);
          if (initial.spec.approvalPrincipalId) this.options.authorizeRun?.({ runId, workspaceId, approvalPrincipalId: initial.spec.approvalPrincipalId });
          this.checkBinding(current, workspaceId, frozen.connectionSlug, initial.spec.model);
          if (bindingDigest(current) !== frozen.bindingDigest) throw new Error('durable-read-binding-changed');
        } catch (error) {
          const state = journal.get(runId, workspaceId);
          if (state.status === 'running') journal.command({ runId, workspaceId, commandId: randomUUID(), expectedVersion: state.version, action: 'pause' });
          throw new Error('durable-authorization-blocked', { cause: error });
        }
        assertDispatch();
      }
      if (request.kind === 'complete') assertDispatch();
      if (request.kind === 'complete' && frozenContext(initial.spec).requireNonEmptyOutput) {
        const turns = journal.get(runId, workspaceId).turns;
        const message = turns[turns.length - 1]?.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
        if (!message?.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('').trim()) throw new Error('durable-read-empty-output');
      }
      return journalBridge.checkpoint(request);
    } };
    let failed = false;
    try {
      const spec = initial.spec, frozen = frozenContext(spec);
      if (spec.engine !== 'sqlite-v2-readonly-1' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spec.runId) || canonical(spec.authority) !== canonical({ adapter: frozen.steps ? 'pi-local-read-multi-1' : 'pi-local-read-1', stepCount: frozen.steps?.length ?? 1, completion: 'journal-only' })) throw new Error('unsupported-durable-read-authority');
      if (initial.publication?.status === 'pending') return await this.publishPending(initial, claim, journalBridge);
      const binding = JSON.parse(JSON.stringify(await this.options.resolveBinding(workspaceId, frozen.connectionSlug, spec.model))) as DurableReadBinding;
      this.checkBinding(binding, workspaceId, frozen.connectionSlug, spec.model);
      if (bindingDigest(binding) !== frozen.bindingDigest) throw new Error('durable-read-binding-changed');
      assertDispatch();
      const steps = frozen.steps ?? [{ id: '', prompt: frozen.prompt, systemPrompt: frozen.systemPrompt, requireNonEmptyOutput: frozen.requireNonEmptyOutput }];
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index]!;
        let state = journal.get(runId, workspaceId);
        if (frozen.steps && state.workflowSteps?.[index]?.endTurn !== undefined) continue;
        assertDispatch();
        const outputs = Object.fromEntries((state.workflowSteps ?? []).filter(record => record.endTurn !== undefined).map(record => [record.id, { output: record.output }]));
        const resolved = frozen.steps ? resolveTemplate(step.prompt, { steps: outputs }) : { output: step.prompt, warnings: [] };
        if (resolved.warnings.length) throw new Error('durable-workflow-template-unresolved');
        if (frozen.steps) await bridge.checkpoint({ kind: 'workflow-step-start', step: index, input: { prompt: resolved.output, systemPrompt: step.systemPrompt } });
        state = journal.get(runId, workspaceId);
        const offset = frozen.steps ? state.workflowSteps![index]!.startTurn : 0;
        const stepBridge: typeof bridge = !frozen.steps ? bridge : { ...bridge, checkpoint: async request => {
          if (request.kind === 'complete') {
            assertDispatch();
            if (step.requireNonEmptyOutput) {
              const message = journal.get(runId, workspaceId).turns.at(-1)?.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
              if (!message?.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('').trim()) throw new Error('durable-read-empty-output');
            }
            return bridge.checkpoint({ kind: 'workflow-step-complete', step: index });
          }
          if (request.kind === 'workflow-step-start' || request.kind === 'workflow-step-complete' || request.kind === 'output-published') throw new Error('durable-workflow-host-checkpoint-required');
          if (!Number.isSafeInteger(request.turn) || request.turn < (request.kind === 'turn-boundary' ? -1 : 0)) throw new Error('durable-invalid-turn');
          return bridge.checkpoint({ ...request, turn: request.turn + offset });
        } };
        entry.backend = await (this.options.createBackend ?? createDurableReadBackend)({ context: binding.context, hostRuntime: this.options.hostRuntime,
          coreConfig: { workspace: { ...binding.workspace, rootPath: frozen.workspaceRoot }, model: spec.model, customSystemPrompt: step.systemPrompt,
            thinkingLevel: 'off', isHeadless: true, skipConfigWatcher: true, agentSkillSlugs: [], modelFallback: { enabled: false },
            durableExecution: stepBridge, session: { id: spec.runId, workspaceRootPath: frozen.workspaceRoot,
              workingDirectory: frozen.workspaceRoot, sdkCwd: frozen.workspaceRoot, createdAt: spec.createdAt, lastUsedAt: spec.createdAt,
              model: spec.model, llmConnection: frozen.connectionSlug, permissionMode: 'safe', enabledSourceSlugs: [], hidden: true } } });
        assertDispatch();
        let streamError: Error | undefined;
        for await (const event of entry.backend.chat(resolved.output)) {
          if (event.type === 'error') streamError ??= new Error(event.message);
          if (event.type === 'typed_error') streamError ??= new Error(event.error.message);
          try { this.options.onEvent?.(runId, event); } catch { /* Observers cannot control execution. */ }
        }
        if (streamError) {
          let cancelled = false;
          try { cancelled = journal.get(runId, workspaceId).status === 'cancelled'; } catch { /* Retain original error. */ }
          if (!cancelled) throw streamError;
        }
        const finalState = journal.get(runId, workspaceId);
        if (finalState.status === 'running' && finalState.controlRevision === claim.controlRevision
          && finalState.publication?.status !== 'pending' && (!frozen.steps || finalState.workflowSteps?.[index]?.endTurn === undefined)) throw new Error('durable-read-missing-completion-checkpoint');
        entry.backend.destroy();
        entry.backend = undefined;
        if (finalState.status !== 'running' || finalState.controlRevision !== claim.controlRevision) return finalState;
      }
      return await this.publishPending(journal.get(runId, workspaceId), claim, journalBridge);
    } catch (error) {
      const pending = journal.get(runId, workspaceId);
      if (pending.publication?.status === 'pending') {
        if (pending.status === 'running' && pending.controlRevision === claim.controlRevision) {
          journal.command({ runId, workspaceId, commandId: randomUUID(), expectedVersion: pending.version, action: 'pause' });
        }
        return journal.get(runId, workspaceId);
      }
      if (error instanceof Error && error.message.includes('durable-steering-pending')) {
        const current = journal.get(runId, workspaceId);
        entry.replayForSteering = current.status === 'running';
        return current;
      }
      if (error instanceof Error && /durable-(?:run-paused|control-changed|approval-required|approval-expired|authorization-blocked)/.test(error.message)) {
        const current = journal.get(runId, workspaceId);
        if (current.status === 'paused' || current.status === 'cancelled' || current.status === 'waiting-approval' || current.controlRevision !== claim.controlRevision) return current;
      }
      failed = true;
      try { await bridge.fail('durable-read-execution-failed'); } catch { /* Preserve the original storage/execution failure. */ }
      throw error;
    } finally {
      let cleanupError: unknown;
      try { entry.backend?.destroy(); } catch (error) { cleanupError = error; }
      entry.backend = undefined;
      entry.claim = undefined;
      try { journal.release(claim); } catch (error) { cleanupError ??= error; }
      if (!failed && cleanupError !== undefined) throw cleanupError;
    }
  }
}

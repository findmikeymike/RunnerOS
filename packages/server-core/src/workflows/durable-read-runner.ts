import { realpathSync } from 'node:fs';
import type { AgentEvent, Workspace } from '@craft-agent/core/types';
import type { AgentBackend, BackendHostRuntimeContext, CoreBackendConfig } from '../../../shared/src/agent/backend/types.ts';
import type { ResolvedBackendContext } from '../../../shared/src/agent/backend/factory.ts';
import { canonical, digest, type DurableJournal, type DurableRunSnapshot, type DurableRunSpec } from '../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST, type DurableJson } from '../../../shared/src/protocol/durable-execution.ts';
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
  /** Certified by the host, never estimated from renderer input. */
  costPolicy: DurableRunSpec['costPolicy'];
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
}
interface FrozenReadContext {
  prompt: string; systemPrompt: string; connectionSlug: string; workspaceRoot: string; bindingDigest: string;
  requireNonEmptyOutput: boolean;
  workflow: DurableJson;
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

/** Single-step local read execution. Only journal checkpoints authorize success. */
export class DurableReadRunner {
  private readonly active = new Map<string, { backend?: ReadBackend; promise: Promise<DurableRunSnapshot> }>();
  constructor(private readonly options: DurableReadRunnerOptions) {}

  /** Existing workflow adapter: unsupported execution semantics fail before admission. */
  startWorkflow(workflow: LoadedWorkflow, input: Omit<DurableReadInput, 'prompt'> & { resolvedAgentSlug: string }): Promise<DurableRunSnapshot> {
    workflow = JSON.parse(JSON.stringify(workflow)) as LoadedWorkflow;
    const step = workflow.metadata.steps[0];
    if (workflow.parseWarnings?.length || workflow.metadata.trigger.type !== 'manual' || workflow.metadata.steps.length !== 1 || !step
      || workflow.metadata.outputs?.mode !== 'none' || workflow.metadata.trigger.inputs?.length
      || step.agent !== input.resolvedAgentSlug || step.taskModeId || step.outputSchema || step.timeout !== undefined
      || (step.retries ?? 0) !== 0 || (step.onFailure ?? 'stop') !== 'stop' || step.legacySkillReferences?.length
      || Object.keys(step).some(key => !['id', 'agent', 'input', 'description', 'retries', 'onFailure', 'completion', 'legacySkillReferences', 'legacySkillPromptHash'].includes(key))
      || /\{\{/.test(step.input) || Object.keys(step.completion ?? {}).some(key => key !== 'requireNonEmptyOutput')) {
      return Promise.reject(new Error('unsupported-durable-read-workflow'));
    }
    const { resolvedAgentSlug: _slug, ...rest } = input;
    return this.admit({ ...rest, prompt: step.input }, workflow);
  }

  start(input: DurableReadInput): Promise<DurableRunSnapshot> { return this.admit(input); }

  private async admit(input: DurableReadInput, workflow?: LoadedWorkflow): Promise<DurableRunSnapshot> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.runId) || !input.prompt.trim() || !input.systemPrompt.trim()) throw new Error('invalid-durable-read-input');
    const requested = JSON.parse(canonical(input)) as DurableReadInput;
    const binding = JSON.parse(JSON.stringify(await this.options.resolveBinding(requested.workspaceId, requested.connectionSlug, requested.model))) as DurableReadBinding;
    this.checkBinding(binding, requested.workspaceId, requested.connectionSlug, requested.model);
    const context: FrozenReadContext = { prompt: requested.prompt, systemPrompt: requested.systemPrompt,
      connectionSlug: requested.connectionSlug, workspaceRoot: realpathSync(binding.workspace.rootPath), bindingDigest: bindingDigest(binding),
      requireNonEmptyOutput: workflow?.metadata.steps[0]?.completion?.requireNonEmptyOutput !== false,
      workflow: workflow ? JSON.parse(JSON.stringify(workflow)) as DurableJson : null };
    let createdAt = Date.now();
    try { createdAt = this.options.journal.get(requested.runId, requested.workspaceId).spec.createdAt; }
    catch (error) { if (!(error instanceof Error) || error.message !== 'durable-run-not-found') throw error; }
    const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', runId: requested.runId, workspaceId: requested.workspaceId,
      credentialIdentity: binding.credentialIdentity, runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST },
      createdAt, commandId: requested.commandId, model: requested.model, allowedTools: requested.allowedTools,
      maxOutputTokens: requested.maxOutputTokens, maxModelAttempts: requested.maxModelAttempts, deadlineAt: requested.deadlineAt,
      costPolicy: requested.costPolicy, context: context as unknown as DurableJson,
      authority: { adapter: 'pi-local-read-1', stepCount: 1, completion: 'journal-only' } };
    this.options.journal.admit(spec);
    return this.resume(spec.runId, spec.workspaceId);
  }

  resume(runId: string, workspaceId: string): Promise<DurableRunSnapshot> {
    const key = canonical([workspaceId, runId]), prior = this.active.get(key);
    if (prior) return prior.promise;
    const entry: { backend?: ReadBackend; promise: Promise<DurableRunSnapshot> } = { promise: undefined! };
    this.active.set(key, entry);
    entry.promise = Promise.resolve().then(() => this.execute(runId, workspaceId, entry)).finally(() => this.active.delete(key));
    return entry.promise;
  }

  async cancel(runId: string, workspaceId: string): Promise<void> {
    this.options.journal.cancel(runId, workspaceId);
    await this.active.get(canonical([workspaceId, runId]))?.backend?.abort('durable-run-cancelled');
  }

  private checkBinding(binding: DurableReadBinding, workspaceId: string, connectionSlug: string, model: string): void {
    if (binding.workspace.id !== workspaceId || binding.context.connection?.slug !== connectionSlug || binding.context.resolvedModel !== model) throw new Error('durable-read-binding-mismatch');
    bindingDigest(binding);
  }

  private async execute(runId: string, workspaceId: string, entry: { backend?: ReadBackend }): Promise<DurableRunSnapshot> {
    const { journal } = this.options, initial = journal.get(runId, workspaceId);
    if (initial.status !== 'running') return initial;
    const claim = journal.claim(runId, workspaceId), journalBridge = journal.bridge(claim);
    const bridge: typeof journalBridge = { ...journalBridge, checkpoint: async request => {
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
      if (spec.engine !== 'sqlite-v2-readonly-1' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spec.runId) || canonical(spec.authority) !== canonical({ adapter: 'pi-local-read-1', stepCount: 1, completion: 'journal-only' })) throw new Error('unsupported-durable-read-authority');
      const binding = JSON.parse(JSON.stringify(await this.options.resolveBinding(workspaceId, frozen.connectionSlug, spec.model))) as DurableReadBinding;
      this.checkBinding(binding, workspaceId, frozen.connectionSlug, spec.model);
      if (bindingDigest(binding) !== frozen.bindingDigest) throw new Error('durable-read-binding-changed');
      if (journal.get(runId, workspaceId).status !== 'running' || Date.now() >= spec.deadlineAt) throw new Error('durable-read-dispatch-blocked');
      entry.backend = await (this.options.createBackend ?? createDurableReadBackend)({ context: binding.context, hostRuntime: this.options.hostRuntime,
        coreConfig: { workspace: { ...binding.workspace, rootPath: frozen.workspaceRoot }, model: spec.model, customSystemPrompt: frozen.systemPrompt,
          thinkingLevel: 'off', isHeadless: true, skipConfigWatcher: true, agentSkillSlugs: [], modelFallback: { enabled: false },
          durableExecution: bridge, session: { id: spec.runId, workspaceRootPath: frozen.workspaceRoot,
            workingDirectory: frozen.workspaceRoot, sdkCwd: frozen.workspaceRoot, createdAt: spec.createdAt, lastUsedAt: spec.createdAt,
            model: spec.model, llmConnection: frozen.connectionSlug, permissionMode: 'safe', enabledSourceSlugs: [], hidden: true } } });
      if (journal.get(runId, workspaceId).status !== 'running' || Date.now() >= spec.deadlineAt) throw new Error('durable-read-dispatch-blocked');
      let streamError: Error | undefined;
      for await (const event of entry.backend.chat(frozen.prompt)) {
        if (event.type === 'error') streamError ??= new Error(event.message);
        if (event.type === 'typed_error') streamError ??= new Error(event.error.message);
        try { this.options.onEvent?.(runId, event); } catch { /* Observers may reconnect; they cannot control execution. */ }
      }
      if (streamError) {
        let cancelled = false;
        try { cancelled = journal.get(runId, workspaceId).status === 'cancelled'; } catch { /* Retain the earlier stream failure if storage also fails. */ }
        if (!cancelled) throw streamError;
      }
      if (journal.get(runId, workspaceId).status === 'running') throw new Error('durable-read-missing-completion-checkpoint');
      return journal.get(runId, workspaceId);
    } catch (error) {
      failed = true;
      try { await bridge.fail('durable-read-execution-failed'); } catch { /* Preserve the original storage/execution failure. */ }
      throw error;
    } finally {
      let cleanupError: unknown;
      try { entry.backend?.destroy(); } catch (error) { cleanupError = error; }
      try { journal.release(claim); } catch (error) { cleanupError ??= error; }
      if (!failed && cleanupError !== undefined) throw cleanupError;
    }
  }
}

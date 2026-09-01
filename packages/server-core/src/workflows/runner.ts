/**
 * Workflows — runner state machine
 *
 * Walks a `LoadedWorkflow`'s steps sequentially. Each step spawns a real
 * Session via the injected `createSession` dep, sends the resolved prompt,
 * awaits the turn, then captures the last assistant message as the step
 * `output` (Phase 1 strategy — see `docs/workflows/02-runtime.md`).
 *
 * Run state is persisted via `@craft-agent/shared/workflows` after every
 * transition so a server crash leaves a coherent on-disk snapshot.
 *
 * Still out of scope for this runner:
 *   - `when` conditional execution
 *   - humanCheckpoint pause/resume
 *   - parallelGroup concurrency
 *   - schedule / webhook workflow triggers
 *
 * The runner mirrors the dependency-injection style of `SessionManager`:
 * the constructor takes a deps bundle, and the runner never imports the
 * real SessionManager. This keeps the unit under test trivially mockable
 * and lets the wire-up live in the bootstrap layer.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import {
  appendOutputSchemaInstruction,
  assertValidWorkflowRunId,
  attachAgentMessageReceipts,
  markRunningRunsInterrupted,
  normalizeWorkflowTriggerInputs,
  parseStructuredStepOutput,
  parseTriggerToolsetOverride,
  readRun,
  resolveEnabledToolsets,
  resolvePermissionMode,
  resolveTemplate,
  writeRun,
  type LoadedWorkflow,
  type PlatformToolsetConfig,
  type TriggerToolsetOverride,
  type WorkflowStep,
  type WorkflowRunSnapshot,
  type WorkflowRunStep,
  type WorkflowStepExecutionReceipt,
} from '@craft-agent/shared/workflows';
import { OutputService } from '../outputs/OutputService';
import type { OutputManifest } from '@craft-agent/shared/outputs';
import {
  assemblePrompt,
  scanForInjection,
  setEscalationNotifier,
  type EscalationNotification,
} from '@craft-agent/shared/agent';

/**
 * Runner-event wire format. The bootstrap layer fans these out to the
 * existing event bus (mirrors `agent-definitions.CHANGED` /
 * `workspaceContext.CHANGED`). Unit tests inject a no-op `emit`.
 */
export type WorkflowRunEvent =
  | { type: 'run.created'; run: WorkflowRunSnapshot }
  | { type: 'run.updated'; run: WorkflowRunSnapshot; detail?: WorkflowRunEventDetail }
  | { type: 'run.completed'; run: WorkflowRunSnapshot }
  | { type: 'outputs.updated'; workspaceId: string }
  /**
   * R7 / Plan 01-07: an escalation was created by the subconscious-mode
   * gate. The runner forwards these from `setEscalationNotifier` so
   * downstream observers (Electron IPC, automations event bus, tests)
   * can see paused runs without coupling to `@craft-agent/shared/agent`.
   */
  | { type: 'escalation.created'; workspaceId: string; escalation: EscalationNotification['escalation'] };

export type WorkflowRunEventDetail =
  | {
      kind: 'step.retrying';
      stepId: string;
      attempt: number;
      maxAttempts: number;
      error: { code: string; message: string };
      timeoutSeconds?: number;
    }
  | {
      kind: 'step.failed';
      stepId: string;
      attempts: number;
      onFailure: 'stop' | 'continue' | 'ask';
      error: { code: string; message: string };
      timeoutSeconds?: number;
    };

/**
 * Public surface the runner needs from its host. The real implementation
 * forwards each call to a `SessionManager` instance — see the bootstrap
 * wiring (added in the RPC step).
 */
export interface WorkflowRunnerDeps {
  /** Spawn a session with given options. Mirrors `SessionManager.createSession`. */
  createSession: (
    workspaceId: string,
    options: CreateSessionOptions,
  ) => Promise<{ id: string }>;
  /** Resolve a workflow step's agent slug into the real runtime session config. */
  resolveAgentSessionOptions?: (
    workspaceId: string,
    agentSlug: string,
    options?: { referenceMode?: 'strict' | 'lenient' },
  ) => Promise<Partial<CreateSessionOptions>>;
  /** Cheap preflight for step agent availability before a run is persisted. */
  preflightStepAgent?: (
    workspaceId: string,
    agentSlug: string,
  ) => Promise<void> | void;
  /**
   * Send a message and wait for the LLM turn to complete. Mirrors
   * `SessionManager.sendMessage` — that method already returns when the
   * turn ends.
   */
  sendMessage: (sessionId: string, prompt: string) => Promise<void>;
  /**
   * Read the last assistant message text from a session. Used as the
   * naive Phase 1 step output. Returns '' when there are no assistant
   * messages.
   */
  getLastAssistantText: (sessionId: string) => string;
  /** Count tool results recorded in a step session. Used for explicit completion gates. */
  getSessionToolUseCount?: (sessionId: string) => number;
  /** List concrete Output bundles created by a step session. */
  getSessionOutputs?: (workspaceId: string, sessionId: string) => OutputManifest[];
  /**
   * Hard-abort a running session. Wraps `SessionManager.forceAbort` /
   * the `UserStop` lifecycle hook (see `packages/shared/CLAUDE.md` for
   * the hard-abort vs. handoff-interrupt distinction).
   */
  abortSession: (sessionId: string) => Promise<void>;
  /** Delete a hidden step session after the run snapshot has captured its output. */
  deleteSession?: (sessionId: string) => Promise<void>;
  /** Resolve a workspace ID to its root path on disk. */
  getWorkspaceRootPath: (workspaceId: string) => string;
  /**
   * Optional per-platform toolset config (R5). When provided, the workflow
   * runner consults this in the precedence chain between the per-job override
   * and the workspace default. See `resolveEnabledToolsets` in
   * `@craft-agent/shared/workflows` for the chain.
   */
  getPlatformToolsetConfig?: (
    workspaceId: string,
  ) => PlatformToolsetConfig | undefined;
  /** Optional override for tests/hosts; default uses OutputService. */
  createDefaultWorkflowOutput?: (run: WorkflowRunSnapshot) => Promise<WorkflowRunSnapshot> | WorkflowRunSnapshot;
  /** Optional override for tests/hosts; default uses OutputService.markWorkflowOutputError. */
  markWorkflowOutputError?: (run: WorkflowRunSnapshot, err: unknown) => Promise<WorkflowRunSnapshot> | WorkflowRunSnapshot;
  /** Run host-owned completion side effects after the default Output is finalized. */
  postProcessSucceededRun?: (run: WorkflowRunSnapshot) => Promise<void> | void;
  /** Emit a runner event for renderer subscribers. No-op safe. */
  emit?: (event: WorkflowRunEvent) => void;
}

/** Internal bookkeeping for an in-flight run. */
interface ActiveRun {
  snapshot: WorkflowRunSnapshot;
  abort: AbortController;
  startIndex: number;
  /** Set to the active step's session id while a step is in flight. */
  currentSessionId?: string;
}

class StepAttemptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StepAttemptError';
  }
}

/**
 * Compose the concurrency key. Phase 1 allows at most one in-flight run
 * per (workspaceId, workflowSlug) pair.
 */
function concurrencyKey(workspaceId: string, workflowSlug: string): string {
  return `${workspaceId}::${workflowSlug}`;
}

const MAX_RECEIPT_CONTEXT_DOCS = 20;
const MAX_WORKFLOW_STEPS = 50;
const MAX_WORKFLOW_RETRIES = 3;
const DEFAULT_STEP_TIMEOUT_SECONDS = 20 * 60;
const MAX_STEP_TIMEOUT_SECONDS = 60 * 60;
const MAX_WORKFLOW_RUN_SECONDS = 2 * 60 * 60;
const RETRY_BACKOFF_BASE_MS = 1000;
const MAX_RETRY_BACKOFF_MS = 10_000;

function normalizeWorkflowPermissionMode(options: Partial<CreateSessionOptions>): Partial<CreateSessionOptions> {
  if (options.permissionMode !== 'ask') return options;
  return {
    ...options,
    permissionMode: 'safe',
    launchReceipt: options.launchReceipt
      ? {
          ...options.launchReceipt,
          config: {
            ...options.launchReceipt.config,
            permissionMode: 'safe',
          },
        }
      : options.launchReceipt,
  };
}

function effectiveRetryCount(retries: number | undefined): number {
  return Math.min(Math.max(retries ?? 0, 0), MAX_WORKFLOW_RETRIES);
}

function effectiveStepTimeoutSeconds(timeoutSeconds: number | undefined): number {
  return Math.min(timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS, MAX_STEP_TIMEOUT_SECONDS);
}

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BACKOFF_BASE_MS * (2 ** Math.max(attempt - 1, 0)), MAX_RETRY_BACKOFF_MS);
}

export class WorkflowRunner {
  private readonly active = new Map<string /* runId */, ActiveRun>();
  private readonly activeByKey = new Map<string /* concurrencyKey */, string /* runId */>();

  constructor(private readonly deps: WorkflowRunnerDeps) {
    // R7 / Plan 01-07: bridge the agent-layer escalation notifier into
    // this runner's event stream. The agent module is layered below the
    // automations event bus, so it can't reach upward — we wire it here
    // (the bootstrap layer for workflow runs) instead. Downstream
    // observers (Electron IPC, automations bus, tests) subscribe via
    // `deps.emit` and pick up `escalation.created` events alongside
    // `run.updated`. If no real notification infra is wired here yet,
    // this still gives tests a deterministic hook to assert pause/resume
    // without reaching into agent module internals.
    // TODO: wire into the cross-process automations event bus when that
    // surface lands so the UI gets toast-style escalation notifications.
    setEscalationNotifier((event) => {
      const workspaceId = this.active.get(event.escalation.workflowRunId)?.snapshot.workspaceId;
      if (!workspaceId) return;
      this.emitEvent({ type: 'escalation.created', workspaceId, escalation: event.escalation });
    });
  }

  /**
   * R5: resolve the effective `enabledSourceSlugs` for this run by consulting
   * the three-tier precedence chain (per-job override > per-platform > default).
   * Ported from Hermes `cron/scheduler.py:60-88` (MIT). Returns a new
   * `agentOptions` object with the resolved allow-list applied.
   *
   * Semantics:
   *   - Per-job override absent → keep the agent's default `enabledSourceSlugs`.
   *   - Per-job override `[]`   → deny all sources (explicit muzzle).
   *   - Per-job override list   → replace the agent's `enabledSourceSlugs`.
   *
   * Trigger inputs are parsed defensively — malformed overrides log a warning
   * and we fall through to the agent's default rather than crashing the run
   * (matches Hermes graceful-degradation at `cron/scheduler.py:87`).
   */
  private applyTriggerToolsetOverride(
    snapshot: WorkflowRunSnapshot,
    agentOptions: Partial<CreateSessionOptions>,
  ): Partial<CreateSessionOptions> {
    let perJobOverride: TriggerToolsetOverride = {};
    try {
      perJobOverride = parseTriggerToolsetOverride(snapshot.trigger.inputs);
    } catch (err) {
      // Malformed override → log + ignore. The run continues with the agent's
      // default toolset rather than failing on a parse error.
      // eslint-disable-next-line no-console
      console.warn(
        `[WorkflowRunner] malformed trigger toolset override on run ${snapshot.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return agentOptions;
    }

    // If neither the trigger nor any platform layer mentions slugs, leave the
    // agent's default toolset untouched (no behavioral change).
    const perPlatformConfig: PlatformToolsetConfig | undefined =
      this.deps.getPlatformToolsetConfig?.(snapshot.workspaceId);
    const platformHasSlugs =
      perPlatformConfig?.workflow?.enabled_source_slugs !== undefined ||
      perPlatformConfig?.cron?.enabled_source_slugs !== undefined;
    if (perJobOverride.enabled_source_slugs === undefined && !platformHasSlugs) {
      return agentOptions;
    }

    const resolved = resolveEnabledToolsets({
      perJobOverride,
      perPlatformConfig,
      // Workflow runs consult the "workflow" platform layer first; the "cron"
      // layer is the entry point for scheduled triggers in later plans.
      platformKey: 'workflow',
      defaultToolset: agentOptions.enabledSourceSlugs,
    });

    if (resolved === undefined) return agentOptions;

    return {
      ...agentOptions,
      enabledSourceSlugs: resolved,
    };
  }

  /**
   * R7 / Plan 01-07: resolve the subconscious-mode hint for this run.
   *
   * The hint is one of `"default" | "subconscious" | "yolo"`. Returned for
   * the receipt + so callers can fan it out to the agent-side
   * `gateWriteAttempt` evaluator. Does NOT mutate `CreateSessionOptions`
   * — that field is the per-workspace `safe|ask|allow-all` mode and
   * intentionally separate (see `agent/mode-types.ts` and the file-
   * header note in `shared/src/workflows/trigger-inputs.ts`).
   *
   * Precedence chain matches `applyTriggerToolsetOverride`:
   *   per-job override > per-platform > default ("default").
   */
  private resolveTriggerPermissionMode(
    snapshot: WorkflowRunSnapshot,
  ): 'default' | 'subconscious' | 'yolo' {
    let perJobOverride: TriggerToolsetOverride = {};
    try {
      perJobOverride = parseTriggerToolsetOverride(snapshot.trigger.inputs);
    } catch {
      // Malformed → fall through; resolver default is "default".
      return 'default';
    }
    return resolvePermissionMode({
      perJobOverride,
      perPlatformConfig: this.deps.getPlatformToolsetConfig?.(snapshot.workspaceId),
      platformKey: 'workflow',
    });
  }

  /**
   * Start a workflow run. Snapshots the workflow + persists initial state,
   * then walks steps in a fire-and-forget loop. Returns the snapshot in
   * `running` state — subscribers learn about progress via emitted events.
   *
   * Phase 1 concurrency: rejects if a run is already active for this
   * (workspaceId, workflowSlug) pair.
   */
  async start(input: {
    workflow: LoadedWorkflow;
    workspaceId: string;
    triggerInputs: Record<string, unknown>;
  }): Promise<WorkflowRunSnapshot> {
    const { workflow, workspaceId } = input;
    const triggerInputs = normalizeWorkflowTriggerInputs(workflow, input.triggerInputs);
    const key = concurrencyKey(workspaceId, workflow.slug);
    if (this.activeByKey.has(key)) {
      throw new Error(
        `Workflow "${workflow.slug}" already has an active run in workspace "${workspaceId}".`,
      );
    }
    this.assertStepBudget(workflow.metadata.steps);
    await this.preflightStepAgents(workspaceId, workflow.metadata.steps);

    const now = new Date().toISOString();
    const runId = randomUUID();

    const steps: WorkflowRunStep[] = workflow.metadata.steps.map((s) => ({
      id: s.id,
      state: 'queued',
      attempts: 0,
    }));

    const workflowSnapshot = this.cloneJson({ metadata: workflow.metadata, body: workflow.body });

    const snapshot: WorkflowRunSnapshot = {
      id: runId,
      workflowSlug: workflow.slug,
      workspaceId,
      state: 'running',
      trigger: { type: 'manual', inputs: triggerInputs, firedAt: now },
      workflowSnapshot,
      steps,
      createdAt: now,
      updatedAt: now,
    };

    const active: ActiveRun = { snapshot, abort: new AbortController(), startIndex: 0 };
    this.active.set(runId, active);
    this.activeByKey.set(key, runId);

    try {
      this.persist(active);
    } catch (err) {
      this.releaseActiveRun(active);
      throw err;
    }

    this.emitEvent({ type: 'run.created', run: this.cloneSnapshot(active.snapshot) });
    this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot) });

    // Fire-and-forget — caller awaits via emitted events, not this method's
    // resolution. runStepLoop handles its own crash finalization so active
    // concurrency slots cannot leak on an unexpected runner bug.
    void this.runStepLoop(active);

    return this.cloneSnapshot(active.snapshot);
  }

  /**
   * Mark persisted `running` runs as interrupted after process startup.
   * These runs have no in-memory ActiveRun and cannot safely continue.
   */
  recoverInterruptedRuns(
    workspaces: Array<{ id: string; rootPath?: string }>,
    reason = 'Workflow runner restarted before the run completed.',
  ): WorkflowRunSnapshot[] {
    const recovered: WorkflowRunSnapshot[] = [];
    for (const workspace of workspaces) {
      const root = workspace.rootPath ?? this.deps.getWorkspaceRootPath(workspace.id);
      for (const run of markRunningRunsInterrupted(root, reason)) {
        recovered.push(this.cloneSnapshot(run));
        this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(run) });
        this.emitEvent({ type: 'run.completed', run: this.cloneSnapshot(run) });
      }
    }
    return recovered;
  }

  /**
   * Create a new run from an existing run snapshot, beginning at `stepId`
   * or the first non-successful step. Successful step outputs before the
   * start point are copied so later templates resolve against prior work.
   */
  async rerunFromStep(input: {
    workspaceId: string;
    runId: string;
    stepId?: string;
  }): Promise<WorkflowRunSnapshot> {
    const root = this.deps.getWorkspaceRootPath(input.workspaceId);
    assertValidWorkflowRunId(input.runId);
    const original = readRun(root, input.runId);
    if (!original) throw new Error(`Workflow run not found: ${input.runId}`);
    if (original.workspaceId !== input.workspaceId) {
      throw new Error(`Workflow run "${input.runId}" does not belong to workspace "${input.workspaceId}".`);
    }

    const workflowSnapshot = this.cloneJson(original.workflowSnapshot);
    const startIndex = this.resolveRerunStartIndex(original, input.stepId);
    const startStep = workflowSnapshot.metadata.steps[startIndex]!;
    const key = concurrencyKey(input.workspaceId, original.workflowSlug);
    if (this.activeByKey.has(key)) {
      throw new Error(
        `Workflow "${original.workflowSlug}" already has an active run in workspace "${input.workspaceId}".`,
      );
    }
    this.assertStepBudget(workflowSnapshot.metadata.steps);
    await this.preflightStepAgents(input.workspaceId, workflowSnapshot.metadata.steps.slice(startIndex));

    const now = new Date().toISOString();
    const steps: WorkflowRunStep[] = workflowSnapshot.metadata.steps.map((step, index) => {
      const previous = original.steps[index];
      if (index < startIndex && previous?.state === 'succeeded') {
        return this.cloneJson(previous);
      }
      if (index < startIndex) {
        return {
          id: step.id,
          state: 'skipped',
          attempts: previous?.attempts ?? 0,
          error: {
            code: 'rerun-skipped-prior-step',
            message: `Step was before rerun start step "${startStep.id}" and had no successful output to copy.`,
          },
        };
      }
      return { id: step.id, state: 'queued', attempts: 0 };
    });

    const runId = randomUUID();
    const snapshot: WorkflowRunSnapshot = {
      id: runId,
      workflowSlug: original.workflowSlug,
      workspaceId: input.workspaceId,
      state: 'running',
      trigger: this.cloneJson(original.trigger),
      workflowSnapshot,
      steps,
      createdAt: now,
      updatedAt: now,
      resumeFromStepId: startStep.id,
      resumedFromRunId: original.id,
    };

    const active: ActiveRun = { snapshot, abort: new AbortController(), startIndex };
    this.active.set(snapshot.id, active);
    this.activeByKey.set(key, snapshot.id);

    try {
      this.persist(active);
    } catch (err) {
      this.releaseActiveRun(active);
      throw err;
    }

    writeRun(root, {
      ...original,
      resumedByRunId: runId,
      updatedAt: now,
    });

    this.emitEvent({ type: 'run.created', run: this.cloneSnapshot(active.snapshot) });
    this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot) });
    void this.runStepLoop(active);

    return this.cloneSnapshot(active.snapshot);
  }

  private async preflightStepAgents(workspaceId: string, steps: WorkflowStep[]): Promise<void> {
    if (!this.deps.preflightStepAgent) return;
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.agent)) continue;
      seen.add(step.agent);
      try {
        await this.deps.preflightStepAgent(workspaceId, step.agent);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Workflow step "${step.id}" references unavailable agent "${step.agent}": ${message}`);
      }
    }
  }

  private assertStepBudget(steps: WorkflowStep[]): void {
    if (steps.length > MAX_WORKFLOW_STEPS) {
      throw new Error(`Workflow has ${steps.length} steps; maximum supported is ${MAX_WORKFLOW_STEPS}.`);
    }
  }

  /**
   * Cancel a running workflow. Hard-aborts the active step's session if
   * one is in flight. Throws when the run is missing, not active, or already
   * terminal so callers can report the actual result.
   */
  async cancel(workspaceId: string, runId: string): Promise<WorkflowRunSnapshot> {
    assertValidWorkflowRunId(runId);
    const active = this.active.get(runId);
    if (!active) {
      const root = this.deps.getWorkspaceRootPath(workspaceId);
      const persisted = readRun(root, runId);
      if (!persisted) throw new Error(`Workflow run not found: ${runId}`);
      if (persisted.workspaceId !== workspaceId) {
        throw new Error(`Workflow run "${runId}" does not belong to workspace "${workspaceId}".`);
      }
      // Terminal-but-known is the cancel-after-finish race. Return the persisted
      // snapshot — caller's intent (run reaches terminal state) is already met.
      if (this.isTerminal(persisted.state)) return this.cloneSnapshot(persisted);
      // Not active in memory but also not terminal on disk → orphaned/inconsistent.
      throw new Error(`Workflow run "${runId}" is not active and cannot be cancelled.`);
    }
    if (active.snapshot.workspaceId !== workspaceId) {
      throw new Error(`Workflow run "${runId}" does not belong to workspace "${workspaceId}".`);
    }
    if (this.isTerminal(active.snapshot.state)) {
      return this.cloneSnapshot(active.snapshot);
    }

    active.abort.abort();
    active.snapshot.state = 'cancelled';
    active.snapshot.completedAt = new Date().toISOString();
    for (const step of active.snapshot.steps) {
      if (step.state === 'running') {
        step.state = 'failed';
        step.completedAt = new Date().toISOString();
        step.error = { code: 'cancelled', message: 'Workflow run was cancelled.' };
      }
    }
    this.touch(active);

    const sessionId = active.currentSessionId;
    if (sessionId) {
      try {
        await this.deps.abortSession(sessionId);
      } catch (err) {
        // Best-effort — the loop will still observe `signal.aborted`.
        // eslint-disable-next-line no-console
        console.error(`[WorkflowRunner] abortSession failed for ${sessionId}:`, err);
      }
    }

    return this.cloneSnapshot(active.snapshot);
  }

  /** Active in-memory runs for a workspace. Disk reads use run-storage helpers. */
  getActiveRuns(workspaceId: string): WorkflowRunSnapshot[] {
    const out: WorkflowRunSnapshot[] = [];
    for (const a of this.active.values()) {
      if (a.snapshot.workspaceId === workspaceId) out.push(this.cloneSnapshot(a.snapshot));
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Internal — step loop
  // --------------------------------------------------------------------------

  private async runStepLoop(active: ActiveRun): Promise<void> {
    try {
      await this.executeStepLoop(active);
    } catch (err) {
      this.failCrashedRun(active, err);
    }
  }

  private async executeStepLoop(active: ActiveRun): Promise<void> {
    const runStartedAt = active.snapshot.createdAt;
    const workflow = active.snapshot.workflowSnapshot;
    let failed = false;

    for (let i = active.startIndex; i < workflow.metadata.steps.length; i++) {
      if (active.abort.signal.aborted) break;

      const stepDef = workflow.metadata.steps[i]!;
      const stepRecord = active.snapshot.steps[i]!;
      if (this.hasRunTimedOut(active)) {
        const error = this.workflowRunTimeoutError();
        stepRecord.state = 'failed';
        stepRecord.completedAt = new Date().toISOString();
        stepRecord.error = error;
        this.touch(active, {
          kind: 'step.failed',
          stepId: stepDef.id,
          attempts: stepRecord.attempts,
          onFailure: stepDef.onFailure ?? 'stop',
          error,
        });
        failed = true;
        break;
      }

      // 1. Mark step `running`.
      stepRecord.state = 'running';
      stepRecord.startedAt = new Date().toISOString();
      stepRecord.attempts = 0;
      this.touch(active);

      // 2. Build templater context from completed steps.
      const stepsCtx: Record<string, { output: unknown }> = {};
      for (let j = 0; j < i; j++) {
        const prev = active.snapshot.steps[j]!;
        if (prev.state === 'succeeded') {
          stepsCtx[prev.id] = { output: prev.output };
        } else if (prev.state === 'failed') {
          const code = prev.error?.code ?? 'unknown-error';
          const message = prev.error?.message ?? 'No error detail was recorded.';
          stepsCtx[prev.id] = {
            output: `[Workflow lane unavailable: ${prev.id} failed (${code}). ${message}]`,
          };
        }
      }

      // 3. Resolve the step's input template.
      const resolved = resolveTemplate(stepDef.input, {
        trigger: active.snapshot.trigger.inputs,
        steps: stepsCtx,
        run: { id: active.snapshot.id, startedAt: runStartedAt },
      });
      if (resolved.warnings.length > 0) {
        for (const w of resolved.warnings) {
          // eslint-disable-next-line no-console
          console.warn(
            `[WorkflowRunner] template warning in run ${active.snapshot.id} step ${stepDef.id}: ${w}`,
          );
        }
      }

      const retryCount = effectiveRetryCount(stepDef.retries);
      const maxAttempts = retryCount + 1;
      const timeoutSeconds = effectiveStepTimeoutSeconds(stepDef.timeout);
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (active.abort.signal.aborted) break;
        stepRecord.attempts = attempt;
        stepRecord.error = undefined;
        stepRecord.output = undefined;
        stepRecord.completion = undefined;
        stepRecord.sessionId = undefined;
        stepRecord.executionReceipt = undefined;
        stepRecord.agentMessageReceipts = undefined;
        stepRecord.completedAt = undefined;
        this.touch(active);

        try {
          await this.executeStepAttempt(active, stepDef, resolved.output, timeoutSeconds);
          if (active.abort.signal.aborted) break;

          stepRecord.state = 'succeeded';
          stepRecord.completedAt = new Date().toISOString();
          active.currentSessionId = undefined;
          this.touch(active);
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err;
          active.currentSessionId = undefined;
          if (active.abort.signal.aborted) break;
          if (attempt < maxAttempts) {
            const error = this.stepError(err);
            stepRecord.error = error;
            this.touch(active, {
              kind: 'step.retrying',
              stepId: stepDef.id,
              attempt,
              maxAttempts,
              error,
              timeoutSeconds: error.code === 'timeout' ? timeoutSeconds : undefined,
            });
            await this.waitBeforeRetry(active, attempt);
            continue;
          }
        }
      }

      if (active.abort.signal.aborted) break;
      if (lastError !== undefined) {
        const onFailure = stepDef.onFailure ?? 'stop';
        const error = this.stepError(lastError);
        const failureError = onFailure === 'ask'
          ? {
              code: 'on-failure-ask-unsupported',
              message: '`onFailure: ask` requires a checkpoint UI and is not supported by this runner yet.',
            }
          : error;
        stepRecord.state = 'failed';
        stepRecord.completedAt = new Date().toISOString();
        stepRecord.error = failureError;
        this.touch(active, {
          kind: 'step.failed',
          stepId: stepDef.id,
          attempts: stepRecord.attempts,
          onFailure,
          error: failureError,
          timeoutSeconds: error.code === 'timeout' ? timeoutSeconds : undefined,
        });
        if (onFailure === 'continue') {
          continue;
        }
        failed = true;
        break;
      }
    }

    // Final state.
    if (active.abort.signal.aborted) {
      active.snapshot.state = 'cancelled';
    } else if (failed) {
      active.snapshot.state = 'failed';
    } else {
      active.snapshot.state = 'succeeded';
    }
    active.snapshot.completedAt = new Date().toISOString();
    this.touch(active);

    if (active.snapshot.state === 'succeeded') {
      await this.finalizeDefaultOutput(active);
      if (!active.snapshot.outputError) await this.finalizeRunPostProcessing(active);
    }

    // Release concurrency slot + active map entry.
    this.releaseActiveRun(active);

    this.emitEvent({ type: 'run.completed', run: this.cloneSnapshot(active.snapshot) });
  }

  // --------------------------------------------------------------------------
  // Internal — persistence + events
  // --------------------------------------------------------------------------

  private async executeStepAttempt(
    active: ActiveRun,
    stepDef: WorkflowStep,
    prompt: string,
    timeoutSeconds: number,
  ): Promise<void> {
    const workflow = active.snapshot.workflowSnapshot;
    const stepRecord = active.snapshot.steps.find((s) => s.id === stepDef.id);
    if (!stepRecord) throw new StepAttemptError('step-record-missing', `Missing run step record for "${stepDef.id}".`);

    const resolvedAgentOptions = await this.deps.resolveAgentSessionOptions?.(
      active.snapshot.workspaceId,
      stepDef.agent,
    ) ?? {};
    const agentOptionsWithMode = normalizeWorkflowPermissionMode(resolvedAgentOptions);
    // R5: Per-run toolset override (Hermes MIT — cron/scheduler.py:60-88,
    // cron/jobs.py:523/662). Trigger inputs may carry an `enabled_source_slugs`
    // override; if present, the agent's allow-list is replaced by the override
    // (NOT intersected — an override of [] is a deliberate deny-all signal,
    // not a fall-through to defaults). See packages/shared/src/workflows/trigger-inputs.ts
    // for the precedence and undefined-vs-empty-array semantics.
    const agentOptions = this.applyTriggerToolsetOverride(
      active.snapshot,
      agentOptionsWithMode,
    );
    // R7 / Plan 01-07: resolve the trigger-level subconscious-mode hint.
    // The actual escalate-on-write gate lives in the agent layer
    // (`@craft-agent/shared/agent#gateWriteAttempt`); the runner only
    // resolves the hint and records it on the receipt-adjacent metadata so
    // observers can see what mode each step ran under. The default mode
    // is `"default"` which is a no-op at the gate.
    const subconsciousMode = this.resolveTriggerPermissionMode(active.snapshot);
    if (subconsciousMode !== 'default') {
      // R7 / Plan 01-07: promote subconscious mode hint to typed fields on
      // CreateSessionOptions so the agent's PreToolUse pipeline can read it
      // directly. Workflow-run-id anchors any escalation row created to this
      // run so the UI can resume it. The legacy `__subconsciousMode` is kept
      // as a back-compat alias for any tests / debug observers that still
      // grep for it.
      (agentOptions as Partial<CreateSessionOptions>).subconsciousMode = subconsciousMode;
      (agentOptions as Partial<CreateSessionOptions>).workflowRunId = active.snapshot.id;
      (agentOptions as Partial<CreateSessionOptions> & { __subconsciousMode?: string }).__subconsciousMode =
        subconsciousMode;
    }
    const stepPrompt = this.buildStepPrompt(prompt, stepDef);
    stepRecord.executionReceipt = this.buildExecutionReceipt(stepDef, agentOptions, stepPrompt);
    this.touch(active);

    const session = await this.deps.createSession(active.snapshot.workspaceId, {
      ...agentOptions,
      name: `${workflow.metadata.name} · ${stepDef.id}`,
      spawnedFromAgent: {
        agentSlug: stepDef.agent,
        agentName: agentOptions.spawnedFromAgent?.agentName ?? stepDef.agent,
        timestamp: Date.now(),
      },
      launchReceipt: {
        ...agentOptions.launchReceipt,
        createdAt: Date.now(),
        origin: 'workflow',
        summary: `Workflow "${workflow.metadata.name}" step "${stepDef.id}".`,
        workflow: {
          runId: active.snapshot.id,
          slug: active.snapshot.workflowSlug,
          stepId: stepDef.id,
          maxAgentMessages: stepDef.completion?.maxAgentMessages,
        },
        config: agentOptions.launchReceipt?.config ?? {},
        injected: agentOptions.launchReceipt?.injected ?? {
          skills: agentOptions.agentSkillSlugs ?? [],
          sources: agentOptions.enabledSourceSlugs ?? [],
          contextDocs: [],
          systemPromptChars: agentOptions.customSystemPrompt?.length,
        },
      },
      hidden: true,
    });
    stepRecord.sessionId = session.id;
    active.currentSessionId = session.id;
    this.touch(active);

    try {
      if (active.abort.signal.aborted) return;

      // Workflow steps can auto-approve tools, so scan the fully assembled
      // prompt before dispatch. Keep scanner details server-side.
      const assembledForScan = assemblePrompt({ userPrompt: stepPrompt });
      const scan = scanForInjection(assembledForScan);
      if (scan.blocked) {
        console.warn(
          `[workflow-runner] prompt blocked by injection scanner — runId=${active.snapshot.id} stepId=${stepDef.id} pattern=${scan.pattern} reason=${scan.reason}`,
        );
        throw new StepAttemptError(
          'prompt-injection-blocked',
          'prompt rejected by safety scan',
        );
      }

      await this.sendMessageWithOptionalTimeout(active, session.id, stepPrompt, timeoutSeconds);

      if (active.abort.signal.aborted) return;

      const rawOutput = this.deps.getLastAssistantText(session.id);
      this.validateCompletion(active.snapshot.workspaceId, stepRecord, stepDef, session.id, rawOutput);
      if (!stepDef.outputSchema) {
        stepRecord.output = rawOutput;
        return;
      }

      const parsed = parseStructuredStepOutput(rawOutput, stepDef.outputSchema);
      if (!parsed.ok) {
        throw new StepAttemptError('invalid-structured-output', parsed.message);
      }
      stepRecord.output = parsed.value;
    } finally {
      active.currentSessionId = undefined;
      await this.deleteHiddenStepSession(session.id);
    }
  }

  private buildExecutionReceipt(
    stepDef: WorkflowStep,
    agentOptions: Partial<CreateSessionOptions>,
    prompt: string,
  ): WorkflowStepExecutionReceipt {
    const receipt = agentOptions.launchReceipt;
    const contextDocs = receipt?.injected.contextDocs ?? [];
    return {
      createdAt: new Date().toISOString(),
      agent: {
        slug: agentOptions.spawnedFromAgent?.agentSlug ?? receipt?.agent?.slug ?? stepDef.agent,
        name: agentOptions.spawnedFromAgent?.agentName ?? receipt?.agent?.name,
      },
      config: {
        model: agentOptions.model ?? receipt?.config.model,
        llmConnection: agentOptions.llmConnection ?? receipt?.config.llmConnection,
        permissionMode: agentOptions.permissionMode ?? receipt?.config.permissionMode,
        thinkingLevel: agentOptions.thinkingLevel ?? receipt?.config.thinkingLevel,
      },
      injected: {
        skills: receipt?.injected.skills ?? agentOptions.agentSkillSlugs ?? [],
        sources: receipt?.injected.sources ?? agentOptions.enabledSourceSlugs ?? [],
        contextDocs: {
          count: contextDocs.length,
          docs: contextDocs.slice(0, MAX_RECEIPT_CONTEXT_DOCS).map((doc) => ({ slug: doc.slug, name: doc.name })),
        },
        systemPromptChars: receipt?.injected.systemPromptChars ?? agentOptions.customSystemPrompt?.length,
      },
      prompt: {
        chars: prompt.length,
        sha256: createHash('sha256').update(prompt).digest('hex'),
      },
    };
  }

  private buildStepPrompt(prompt: string, stepDef: WorkflowStep): string {
    const completion = stepDef.completion ?? {};
    const lines = [
      'Workflow step completion contract:',
      '- Complete the requested work in this turn; do not merely acknowledge or say you can help.',
      '- If blocked, state the blocker clearly in the final answer.',
    ];
    if (completion.requireNonEmptyOutput !== false) {
      lines.push('- Final output must be non-empty.');
    }
    if (completion.minOutputChars !== undefined) {
      lines.push(`- Final output must be at least ${completion.minOutputChars} characters.`);
    }
    if (completion.requireToolUse) {
      lines.push('- You must use at least one available tool before the step can complete.');
    }
    if (completion.requiredOutput) {
      const title = completion.requiredOutput.title ? ` titled "${completion.requiredOutput.title}"` : '';
      const primary = completion.requiredOutput.requirePrimary ? ' with a readable primary asset' : '';
      lines.push(`- You must create one ${completion.requiredOutput.kind} Output${title}${primary}; text in the final answer does not substitute for it.`);
    }
    if (completion.maxAgentMessages !== undefined) {
      lines.push(`- You may delegate to at most ${completion.maxAgentMessages} agent${completion.maxAgentMessages === 1 ? '' : 's'} across this workflow step, including retries.`);
    }
    if (stepDef.outputSchema) {
      lines.push('- The final answer must satisfy the JSON schema below.');
    }

    const withCompletionContract = `${prompt.trimEnd()}\n\n---\n\n${lines.join('\n')}`;
    return stepDef.outputSchema
      ? appendOutputSchemaInstruction(withCompletionContract, stepDef.outputSchema)
      : withCompletionContract;
  }

  private validateCompletion(
    workspaceId: string,
    stepRecord: WorkflowRunStep,
    stepDef: WorkflowStep,
    sessionId: string,
    rawOutput: string,
  ): void {
    const completion = stepDef.completion ?? {};
    const outputChars = rawOutput.trim().length;
    const requireNonEmpty = completion.requireNonEmptyOutput !== false;
    const minOutputChars = completion.minOutputChars ?? (requireNonEmpty ? 1 : 0);
    const toolUseCount = this.deps.getSessionToolUseCount?.(sessionId);

    stepRecord.completion = {
      outputChars,
      ...(toolUseCount !== undefined ? { toolUseCount } : {}),
      satisfied: false,
    };

    if (outputChars < minOutputChars) {
      throw new StepAttemptError(
        'completion-output-too-short',
        `Step output was ${outputChars} characters; expected at least ${minOutputChars}.`,
      );
    }
    if (completion.requireToolUse && (toolUseCount ?? 0) < 1) {
      throw new StepAttemptError(
        'completion-tool-use-required',
        'Step completion requires at least one tool use, but none were recorded.',
      );
    }
    if (completion.requiredOutput) {
      if (!this.deps.getSessionOutputs) {
        throw new StepAttemptError(
          'completion-output-check-unavailable',
          'Step completion requires an Output check, but the workflow host did not provide one.',
        );
      }
      const required = completion.requiredOutput;
      const matchingOutput = this.deps.getSessionOutputs(workspaceId, sessionId)
        .find((output) => (
          output.origin.sessionId === sessionId
          && output.kind === required.kind
          && (required.title === undefined || output.title.trim() === required.title)
          && (!required.requirePrimary || Boolean(output.primary))
        ));
      if (!matchingOutput) {
        const title = required.title ? ` titled "${required.title}"` : '';
        throw new StepAttemptError(
          'completion-required-output-missing',
          `Step completion requires a ${required.kind} Output${title}${required.requirePrimary ? ' with a readable primary asset' : ''}.`,
        );
      }
    }

    stepRecord.completion.satisfied = true;
  }

  private async sendMessageWithOptionalTimeout(
    active: ActiveRun,
    sessionId: string,
    prompt: string,
    timeoutSeconds: number,
  ): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.deps.sendMessage(sessionId, prompt),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new StepAttemptError('timeout', `Step timed out after ${timeoutSeconds} seconds.`));
          }, timeoutSeconds * 1000);
        }),
      ]);
    } catch (err) {
      if (err instanceof StepAttemptError && err.code === 'timeout') {
        try {
          await this.deps.abortSession(sessionId);
        } catch (abortErr) {
          // eslint-disable-next-line no-console
          console.error(`[WorkflowRunner] abortSession failed after step timeout for ${sessionId}:`, abortErr);
        }
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async waitBeforeRetry(active: ActiveRun, attempt: number): Promise<void> {
    const delayMs = retryDelayMs(attempt);
    if (delayMs <= 0 || active.abort.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, delayMs);
      active.abort.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }

  private hasRunTimedOut(active: ActiveRun): boolean {
    return Date.now() - Date.parse(active.snapshot.createdAt) > MAX_WORKFLOW_RUN_SECONDS * 1000;
  }

  private workflowRunTimeoutError(): { code: string; message: string } {
    return {
      code: 'workflow-timeout',
      message: `Workflow exceeded the ${MAX_WORKFLOW_RUN_SECONDS} second run limit.`,
    };
  }

  private async deleteHiddenStepSession(sessionId: string): Promise<void> {
    if (!this.deps.deleteSession) return;
    try {
      await this.deps.deleteSession(sessionId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[WorkflowRunner] deleteSession failed for hidden step session ${sessionId}:`, err);
    }
  }

  private touch(active: ActiveRun, detail?: WorkflowRunEventDetail): void {
    active.snapshot.updatedAt = new Date().toISOString();
    this.persist(active);
    this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot), detail });
  }

  private persist(active: ActiveRun): void {
    const root = this.deps.getWorkspaceRootPath(active.snapshot.workspaceId);
    active.snapshot = this.adoptPersistedOutputState(root, active.snapshot);
    active.snapshot = attachAgentMessageReceipts(root, active.snapshot);
    writeRun(root, active.snapshot);
  }

  private adoptPersistedOutputState(root: string, snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
    const persisted = readRun(root, snapshot.id);
    if (!persisted || persisted.workspaceId !== snapshot.workspaceId) return snapshot;

    return {
      ...snapshot,
      outputIds: persisted.outputIds,
      finalOutputId: persisted.finalOutputId,
      outputError: persisted.outputError,
    };
  }

  private async finalizeDefaultOutput(active: ActiveRun): Promise<void> {
    if (active.snapshot.finalOutputId) return;
    try {
      const next = await this.createDefaultWorkflowOutput(active.snapshot);
      active.snapshot = this.cloneSnapshot(next);
      this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[WorkflowRunner] default output creation failed for run ${active.snapshot.id}:`, err);
      try {
        const next = await this.markWorkflowOutputError(active.snapshot, err);
        active.snapshot = this.cloneSnapshot(next);
        this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot) });
      } catch (markErr) {
        // eslint-disable-next-line no-console
        console.error(`[WorkflowRunner] failed to record output error for run ${active.snapshot.id}:`, markErr);
      }
    }
  }

  private async finalizeRunPostProcessing(active: ActiveRun): Promise<void> {
    if (!this.deps.postProcessSucceededRun) return;
    try {
      await this.deps.postProcessSucceededRun(this.cloneSnapshot(active.snapshot));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[WorkflowRunner] post-processing failed for run ${active.snapshot.id}:`, err);
      try {
        const next = await this.markWorkflowOutputError(active.snapshot, err);
        active.snapshot = this.cloneSnapshot(next);
        this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot) });
      } catch (markErr) {
        // eslint-disable-next-line no-console
        console.error(`[WorkflowRunner] failed to record post-processing error for run ${active.snapshot.id}:`, markErr);
      }
    }
  }

  private createDefaultWorkflowOutput(run: WorkflowRunSnapshot): Promise<WorkflowRunSnapshot> | WorkflowRunSnapshot {
    if (this.deps.createDefaultWorkflowOutput) return this.deps.createDefaultWorkflowOutput(run);
    const service = new OutputService({
      getWorkspaceRootPath: this.deps.getWorkspaceRootPath,
      emitOutputsUpdated: (workspaceId) => this.emitEvent({ type: 'outputs.updated', workspaceId }),
    });
    return service.createDefaultWorkflowOutput(run);
  }

  private markWorkflowOutputError(
    run: WorkflowRunSnapshot,
    err: unknown,
  ): Promise<WorkflowRunSnapshot> | WorkflowRunSnapshot {
    if (this.deps.markWorkflowOutputError) return this.deps.markWorkflowOutputError(run, err);
    const service = new OutputService({
      getWorkspaceRootPath: this.deps.getWorkspaceRootPath,
      emitOutputsUpdated: (workspaceId) => this.emitEvent({ type: 'outputs.updated', workspaceId }),
    });
    return service.markWorkflowOutputError(run, err);
  }

  private failCrashedRun(active: ActiveRun, err: unknown): void {
    try {
      // eslint-disable-next-line no-console
      console.error(`[WorkflowRunner] step loop crashed for run ${active.snapshot.id}:`, err);
      if (!this.isTerminal(active.snapshot.state)) {
        const now = new Date().toISOString();
        active.snapshot.state = active.abort.signal.aborted ? 'cancelled' : 'failed';
        active.snapshot.completedAt = now;
        active.snapshot.updatedAt = now;
        const running = active.snapshot.steps.find((s) => s.state === 'running');
        if (running) {
          running.state = 'failed';
          running.completedAt = now;
          running.error = {
            code: active.abort.signal.aborted ? 'cancelled' : 'runner-crashed',
            message: err instanceof Error ? err.message : String(err),
          };
        }
        this.persist(active);
        this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot) });
        this.emitEvent({ type: 'run.completed', run: this.cloneSnapshot(active.snapshot) });
      }
    } catch (persistErr) {
      // eslint-disable-next-line no-console
      console.error(
        `[WorkflowRunner] failed to persist crashed run ${active.snapshot.id}:`,
        persistErr,
      );
    } finally {
      this.releaseActiveRun(active);
    }
  }

  private releaseActiveRun(active: ActiveRun): void {
    const key = concurrencyKey(active.snapshot.workspaceId, active.snapshot.workflowSlug);
    if (this.activeByKey.get(key) === active.snapshot.id) this.activeByKey.delete(key);
    this.active.delete(active.snapshot.id);
  }

  private emitEvent(event: WorkflowRunEvent): void {
    try {
      this.deps.emit?.(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[WorkflowRunner] event handler failed for ${event.type}:`, err);
    }
  }

  private emit(event: WorkflowRunEvent): void {
    if (!this.deps.emit) return;
    try {
      this.deps.emit(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WorkflowRunner] emit threw:', err);
    }
  }

  private cloneSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
    // Defensive deep-ish clone via JSON. Snapshots only contain plain JSON
    // values by construction, so this is safe and fast at this size.
    return this.cloneJson(snapshot);
  }

  private cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private stepError(err: unknown): { code: string; message: string } {
    return {
      code: err instanceof StepAttemptError ? err.code : 'step-threw',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  private isTerminal(state: WorkflowRunSnapshot['state']): boolean {
    return state === 'succeeded' || state === 'failed' || state === 'cancelled';
  }

  private resolveRerunStartIndex(original: WorkflowRunSnapshot, stepId: string | undefined): number {
    if (stepId !== undefined) {
      const index = original.workflowSnapshot.metadata.steps.findIndex((step) => step.id === stepId);
      if (index === -1) throw new Error(`Workflow step not found in run snapshot: ${stepId}`);
      return index;
    }

    const resumeStepId = original.resumeFromStepId;
    if (resumeStepId) {
      const index = original.workflowSnapshot.metadata.steps.findIndex((step) => step.id === resumeStepId);
      if (index !== -1) return index;
    }

    const index = original.steps.findIndex((step) => step.state !== 'succeeded');
    if (index === -1) {
      throw new Error(`Workflow run "${original.id}" has no incomplete or failed step to rerun.`);
    }
    return index;
  }
}

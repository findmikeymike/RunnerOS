import { normalizeDurableTriggerInputs } from './durable-workflow-inputs';
import { randomUUID } from 'node:crypto';
import { canonical } from '../../../shared/src/durable-execution/index.ts';
import { listRuns } from '../../../shared/src/workflows/run-storage.ts';
import type { WorkflowStartInput } from './runner.ts';
import { supportsDurableReadWorkflow } from './durable-read-runner.ts';
import type { DurableWorkflowHost } from './durable-workflow-host.ts';
import { durableWorkflowOccurrenceIdentity } from './durable-workflow-occurrence.ts';
import type { DurableLocalSource } from './durable-workflow-sources.ts';

export interface DurableStartBundle { connectionSlug: string; model: string; systemPrompt: string; localSources?: DurableLocalSource[] }
export interface DurableWorkflowStartOptions {
  host: DurableWorkflowHost;
  /** Null means unsupported capabilities; an explicitly selected durable workflow must reject. */
  resolveBundle(workspaceId: string, agentSlug: string): Promise<DurableStartBundle | null>;
  getWorkspaceRootPath(workspaceId: string): string;
}

/** Sequential local reads from manual UI or persisted Scheduled Work attempts. */
export function createDurableWorkflowStart(options: DurableWorkflowStartOptions) {
  const pending = new Set<string>();
  return async (input: WorkflowStartInput) => {
    input = structuredClone(input);
    // All callers share this guard, even when they will use the legacy engine.
    if (await options.host.hasUnfinishedWorkflow(input.workspaceId, input.workflow.slug)) {
      throw new Error('This workflow has unfinished work. Open its saved run to continue or stop it.');
    }
    if (input.workflow.metadata.execution !== 'durable-local-read') return null;
    const scheduled = input.invocation === 'scheduled-work' && input.occurrence !== undefined && !input.actor;
    if ((!scheduled && (input.invocation !== 'manual-ui' || !input.actor || input.occurrence)) || input.runId) throw new Error('This durable read workflow requires a manual start or tracked schedule and supported sequential local-read steps.');
    const pinned = structuredClone(input);
    const { workspaceId, workflow, actor } = pinned;
    const key = canonical([workspaceId, workflow.slug]);
    if (pending.has(key)) throw new Error('This workflow is already starting.');
    pending.add(key);
    try {
      // Authenticate before resolving agent context or touching its local resources.
      const existing = scheduled
        ? [await options.host.getScheduledRun(workspaceId, pinned.occurrence!)].filter(run => run !== null)
        : await options.host.runs.list(workspaceId, actor!);
      if (scheduled && existing.length) return existing[0]!;
      if (!supportsDurableReadWorkflow(workflow)) throw new Error('This durable read workflow requires supported sequential local-read steps.');
      // Validate before bundle work, but pass the original scalar values onward so defaults
      // are applied exactly once when admission freezes the normalized inputs.
      normalizeDurableTriggerInputs(workflow, pinned.triggerInputs, pinned.untrustedTriggerInputs);
      const bundles = new Map<string, DurableStartBundle>();
      for (const step of workflow.metadata.steps) {
        if (bundles.has(step.agent)) continue;
        const resolved = await options.resolveBundle(workspaceId, step.agent);
        if (!resolved) throw new Error('This agent is not supported for durable local reads. It requires read-only permission, thinking off, supported workspace filesystem sources, and no skills or specialist tools.');
        bundles.set(step.agent, JSON.parse(canonical(resolved)) as DurableStartBundle);
      }
      const bundle = bundles.get(workflow.metadata.steps[0]!.agent)!;
      if ([...bundles.values()].some(candidate => candidate.connectionSlug !== bundle.connectionSlug || candidate.model !== bundle.model)) throw new Error('Durable read steps must use the same model and connection.');
      const legacy = listRuns(options.getWorkspaceRootPath(workspaceId));
      if (existing.some(run => run.workflowSlug === workflow.slug && !['succeeded', 'failed', 'cancelled'].includes(run.state))
        || legacy.some(run => run.workflowSlug === workflow.slug && run.state === 'running')) {
        throw new Error('This workflow has unfinished work. Open its saved run to continue or stop it.');
      }
      const runId = scheduled ? durableWorkflowOccurrenceIdentity(workspaceId, pinned.occurrence!).runId : randomUUID();
      const admission = {
        ...bundle, triggerInputs: pinned.triggerInputs, ...(pinned.untrustedTriggerInputs ? { untrustedTriggerInputs: pinned.untrustedTriggerInputs } : {}), workspaceId, runId, commandId: scheduled ? durableWorkflowOccurrenceIdentity(workspaceId, pinned.occurrence!).commandId : `manual-start:${runId}`,
        localSources: [...new Map([...bundles.values()].flatMap(candidate => candidate.localSources ?? []).map(source => [canonical(source), source])).values()],
        resolvedAgentSlug: workflow.metadata.steps[0]!.agent,
        ...(workflow.metadata.steps.length > 1 ? { resolvedSteps: workflow.metadata.steps.map(step => ({ id: step.id, agent: step.agent, systemPrompt: bundles.get(step.agent)!.systemPrompt })) } : {}),
        allowedTools: ['read', 'grep', 'find', 'ls'] as const, maxOutputTokens: 4096,
        maxModelAttempts: 8, deadlineAt: Date.now() + 10 * 60_000,
        costPolicy: { unit: 'model-requests' as const, maxTotalUnits: 8, maxUnitsPerAttempt: 1 },
      };
      if (scheduled) await options.host.admitWorkflowForScheduler(workflow, { ...admission, allowedTools: [...admission.allowedTools] }, pinned.occurrence!);
      else await options.host.admitWorkflowForActor(workflow, { ...admission, allowedTools: [...admission.allowedTools] }, actor!);
      // Admission is already committed. A read/transport failure must never create a legacy replacement.
      const saved = scheduled ? await options.host.getScheduledRun(workspaceId, pinned.occurrence!) : await options.host.runs.get(workspaceId, runId, actor!);
      if (!saved) throw new Error('The workflow was saved but its status is unavailable. Check Recent Runs.');
      return saved;
    } finally { pending.delete(key); }
  };
}

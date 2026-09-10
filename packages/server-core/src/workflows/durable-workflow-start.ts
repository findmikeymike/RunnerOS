import { randomUUID } from 'node:crypto';
import { canonical } from '../../../shared/src/durable-execution/index.ts';
import { listRuns } from '../../../shared/src/workflows/run-storage.ts';
import type { WorkflowStartInput } from './runner.ts';
import { supportsDurableReadWorkflow } from './durable-read-runner.ts';
import type { DurableWorkflowHost } from './durable-workflow-host.ts';

export interface DurableStartBundle { connectionSlug: string; model: string; systemPrompt: string }
export interface DurableWorkflowStartOptions {
  host: DurableWorkflowHost;
  /** Null means unsupported capabilities; an explicitly selected durable workflow must reject. */
  resolveBundle(workspaceId: string, agentSlug: string): Promise<DurableStartBundle | null>;
  getWorkspaceRootPath(workspaceId: string): string;
}

/** Manual, literal, single-step local reads only. Schedules and agent delegation stay on the existing runner. */
export function createDurableWorkflowStart(options: DurableWorkflowStartOptions) {
  const pending = new Set<string>();
  return async (input: WorkflowStartInput) => {
    input = JSON.parse(JSON.stringify(input)) as WorkflowStartInput;
    // All callers share this guard, even when they will use the legacy engine.
    if (await options.host.hasUnfinishedWorkflow(input.workspaceId, input.workflow.slug)) {
      throw new Error('This workflow has unfinished work. Open its saved run to continue or stop it.');
    }
    if (input.workflow.metadata.execution !== 'durable-local-read') return null;
    if (input.invocation !== 'manual-ui' || !input.actor || input.runId || input.untrustedTriggerInputs?.length
      || Object.keys(input.triggerInputs).length || !supportsDurableReadWorkflow(input.workflow)) throw new Error('This durable read workflow requires a manual start and a supported single local-read step.');
    const pinned = JSON.parse(canonical(input)) as WorkflowStartInput;
    const { workspaceId, workflow, actor } = pinned;
    const key = canonical([workspaceId, workflow.slug]);
    if (pending.has(key)) throw new Error('This workflow is already starting.');
    pending.add(key);
    try {
      // Authenticate before resolving agent context or touching its local resources.
      const existing = await options.host.runs.list(workspaceId, actor!);
      const bundle = await options.resolveBundle(workspaceId, workflow.metadata.steps[0]!.agent);
      if (!bundle) throw new Error('This agent is not supported for durable local reads. It requires read-only permission, thinking off, and no skills, connected sources or specialist tools.');
      const legacy = listRuns(options.getWorkspaceRootPath(workspaceId));
      if (existing.some(run => run.workflowSlug === workflow.slug && !['succeeded', 'failed', 'cancelled'].includes(run.state))
        || legacy.some(run => run.workflowSlug === workflow.slug && run.state === 'running')) {
        throw new Error('This workflow has unfinished work. Open its saved run to continue or stop it.');
      }
      const runId = randomUUID();
      await options.host.admitWorkflowForActor(workflow, {
        ...bundle, workspaceId, runId, commandId: `manual-start:${runId}`,
        resolvedAgentSlug: workflow.metadata.steps[0]!.agent,
        allowedTools: ['read', 'grep', 'find', 'ls'], maxOutputTokens: 4096,
        maxModelAttempts: 8, deadlineAt: Date.now() + 10 * 60_000,
        costPolicy: { unit: 'model-requests', maxTotalUnits: 8, maxUnitsPerAttempt: 1 },
      }, actor!);
      // Admission is already committed. A read/transport failure must never create a legacy replacement.
      const saved = await options.host.runs.get(workspaceId, runId, actor!);
      if (!saved) throw new Error('The workflow was saved but its status is unavailable. Check Recent Runs.');
      return saved;
    } finally { pending.delete(key); }
  };
}

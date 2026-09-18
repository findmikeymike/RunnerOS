import { durableWorkflowStartError } from './durable-workflow-eligibility';
import { getLlmConnections, getModelFallbackChain } from '@craft-agent/shared/config';
import { getCredentialManager } from '../../../shared/src/credentials/index';
import { resolveModelFallbackChain } from '../../../shared/src/config/model-fallback';
import type { ModelFallbackRole } from '../../../shared/src/config/llm-connections';
import { normalizeDurableTriggerInputs } from './durable-workflow-inputs';
import { randomUUID } from 'node:crypto';
import { canonical } from '../../../shared/src/durable-execution/index.ts';
import { listRuns } from '../../../shared/src/workflows/run-storage.ts';
import type { WorkflowStartInput } from './runner.ts';
import { supportsDurableReadWorkflow } from './durable-read-runner.ts';
import type { DurableWorkflowHost } from './durable-workflow-host.ts';
import { durableWorkflowOccurrenceIdentity } from './durable-workflow-occurrence.ts';
import type { DurableLocalSource } from './durable-workflow-sources.ts';

export interface DurableStartBundle { connectionSlug: string; model: string; systemPrompt: string; localSources?: DurableLocalSource[]; sourceToolSlugs?: string[] }
export interface DurableWorkflowStartOptions {
  host: DurableWorkflowHost;
  /** Null means unsupported capabilities; an explicitly selected durable workflow must reject. */
  resolveBundle(workspaceId: string, agentSlug: string, taskModeId?: string): Promise<DurableStartBundle | null>;
  getWorkspaceRootPath(workspaceId: string): string;
  resolveFallbackCandidates?: typeof resolveDurableFallbackCandidates;
}

/** Settings are read once; admission pins each surviving transport before any dispatch. */
export async function resolveDurableFallbackCandidates(primary: DurableStartBundle, role: ModelFallbackRole) {
  const credentials = getCredentialManager();
  const connections = await Promise.all(getLlmConnections().map(async connection => ({ ...connection,
    isAuthenticated: connection.authType === 'api_key' && !!connection.piAuthProvider
      && await credentials.hasLlmCredentials(connection.slug, connection.authType),
  })));
  return resolveModelFallbackChain({ primaryConnectionSlug: primary.connectionSlug, primaryModel: primary.model,
    role, connections, globalChain: getModelFallbackChain() }).candidates.map(({ connectionSlug, model }) => ({ connectionSlug, model }));
}

/** Sequential local reads from manual UI or persisted Scheduled Work attempts. */
export function createDurableWorkflowStart(options: DurableWorkflowStartOptions) {
  const pending = new Set<string>();
  return async (input: WorkflowStartInput) => {
    input = structuredClone(input);
    options.host.assertBackgroundFence(input.workspaceId, input.backgroundFence);
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
      for (const [stepIndex, step] of workflow.metadata.steps.entries()) {
        const bundleKey = canonical([step.agent, step.taskModeId ?? null]);
        if (bundles.has(bundleKey)) continue;
        let resolved: DurableStartBundle | null;
        try {
          resolved = await options.resolveBundle(workspaceId, step.agent, step.taskModeId);
        } catch (error) {
          throw durableWorkflowStartError(error, stepIndex + 1);
        }
        if (!resolved) throw durableWorkflowStartError(null, stepIndex + 1);
        bundles.set(bundleKey, JSON.parse(canonical(resolved)) as DurableStartBundle);
      }
      const bundle = bundles.get(canonical([workflow.metadata.steps[0]!.agent, workflow.metadata.steps[0]!.taskModeId ?? null]))!;
      const roleRouting = workflow.metadata.steps.some(step => step.modelRole !== undefined);
      if (!roleRouting && [...bundles.values()].some(candidate => candidate.connectionSlug !== bundle.connectionSlug || candidate.model !== bundle.model)) throw new Error('Durable read steps must use the same model and connection.');
      const legacy = listRuns(options.getWorkspaceRootPath(workspaceId));
      if (existing.some(run => run.workflowSlug === workflow.slug && !['succeeded', 'failed', 'cancelled'].includes(run.state))
        || legacy.some(run => run.workflowSlug === workflow.slug && run.state === 'running')) {
        throw new Error('This workflow has unfinished work. Open its saved run to continue or stop it.');
      }
      const runId = scheduled ? durableWorkflowOccurrenceIdentity(workspaceId, pinned.occurrence!).runId : randomUUID();
      const resolvedSteps = await Promise.all(workflow.metadata.steps.map(async step => {
        const selected = bundles.get(canonical([step.agent, step.taskModeId ?? null]))!;
        return { id: step.id, agent: step.agent, ...(step.taskModeId ? { taskModeId: step.taskModeId } : {}), systemPrompt: selected.systemPrompt, ...(selected.sourceToolSlugs?.length ? { sourceToolSlugs: selected.sourceToolSlugs } : {}),
          ...(roleRouting ? { modelPlan: { ...(step.modelRole ? { role: step.modelRole } : {}), candidates: [
            { connectionSlug: selected.connectionSlug, model: selected.model },
            ...(step.modelRole ? await (options.resolveFallbackCandidates ?? resolveDurableFallbackCandidates)(selected, step.modelRole) : []),
          ] } } : {}),
        };
      }));
      options.host.assertBackgroundFence(workspaceId, pinned.backgroundFence);
      const admission = {
        ...(pinned.backgroundFence !== undefined ? { backgroundFence: pinned.backgroundFence } : {}),
        ...bundle, triggerInputs: pinned.triggerInputs, ...(pinned.untrustedTriggerInputs ? { untrustedTriggerInputs: pinned.untrustedTriggerInputs } : {}), workspaceId, runId, commandId: scheduled ? durableWorkflowOccurrenceIdentity(workspaceId, pinned.occurrence!).commandId : `manual-start:${runId}`,
        sourceToolSlugs: [...new Set([...bundles.values()].flatMap(candidate => candidate.sourceToolSlugs ?? []))].sort(),
        localSources: [...new Map([...bundles.values()].flatMap(candidate => candidate.localSources ?? []).map(source => [canonical(source), source])).values()],
        resolvedAgentSlug: workflow.metadata.steps[0]!.agent,
        ...(workflow.metadata.steps[0]!.taskModeId ? { resolvedTaskModeId: workflow.metadata.steps[0]!.taskModeId } : {}),
        ...(workflow.metadata.steps.length > 1 || roleRouting ? { resolvedSteps } : {}),
        ...(workflow.metadata.webReadUrls ? { webReadUrls: [...workflow.metadata.webReadUrls] } : {}),
        ...(workflow.metadata.webReadRedirects !== undefined ? { webReadRedirects: workflow.metadata.webReadRedirects } : {}),
        allowedTools: ['read', 'grep', 'find', 'ls', ...(workflow.metadata.webReadUrls ? ['web_fetch' as const] : [])] as const, maxOutputTokens: 4096,
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

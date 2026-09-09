import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Workspace } from '@craft-agent/core/types';
import { getWorkspaces } from '@craft-agent/shared/config';
import { assertTeamPermission } from '@craft-agent/shared/workspaces';
import { loadGlobalWorkflow, readActivatedWorkflows, readRun, writeRun, type WorkflowRunSnapshot, type LoadedWorkflow } from '@craft-agent/shared/workflows';
import { createOutputBundle, readOutput, resolveOutputAssetPath } from '@craft-agent/shared/outputs';
import { scheduledWorkDefinitionDigest, SCHEDULED_WORK_CONTEXT_SLUG, parseScheduledWorkDocResult } from '@craft-agent/shared/scheduled-work';
import { loadContextDoc } from '@craft-agent/shared/workspace-context';
import type { PendingQueuedWork } from '@craft-agent/shared/automations';
import {
  SIGNAL_CONTRACT, validateSignalTrackConfig, normalizeSignalVideoLinks, signalWorkflowFor, selectSignalScanVideos,
  finalizeSignalCoverage, canFinalizeSignalNoChange, buildSignalReportMetadata,
  type SignalChannel, type SignalTrack, type SignalMode, type SignalTrackConfig, type SignalState, type SignalQueueResult, type SignalEvidenceReceipt, type SignalSourceCoverage, type SignalVideoMetadata,
} from '@craft-agent/shared/shared-intel';
import { queueAutomationWork } from '../scheduled-work/AutomationWorkQueue';
import { LocalSignalProvider, type SignalProvider, type SignalTranscript } from './SignalProvider';
import { hash, readSignals, writeSignals, readEvidence, saveEvidence, withSignalsLock, SignalStorageLimitError, type SignalRequest, type SignalStore } from './storage';
import { resolveSignalHqWorkspace } from './scope';
import { SIGNAL_WEBSITE_SOURCES, type SignalWebsitePacket as CollectedWebsitePacket } from './website-collector';

const WEBSITE_SOURCES = SIGNAL_WEBSITE_SOURCES;
// Optional service-owned journal fields keep pre-recovery requests readable.
interface CollectionRequest extends SignalRequest {
  discovery?: Array<{ sourceId: string; videos: SignalVideoMetadata[]; coverage: SignalSourceCoverage }>;
  collectionRetryRunId?: string;
}
type CollectionStore = Omit<SignalStore, 'requests'> & { requests: CollectionRequest[] };
export interface SignalStartInput { track: SignalTrack; mode: SignalMode; idempotencyKey: string; links?: string[] }
export interface SignalServiceDeps {
  workspaces?: () => Workspace[];
  provider?: SignalProvider;
  permission?: (root: string, action: 'records.write' | 'automation.external.execute') => void;
  workflow?: (slug: string) => LoadedWorkflow | null;
  queue?: typeof queueAutomationWork;
  wake?: (workspace: Workspace) => void;
  changed?: (workspaceId: string) => void;
  reportPublished?: (workspace: Workspace) => void;
  now?: () => string;
  preparationTimeoutMs?: number;
  admitRetry?: (original: WorkflowRunSnapshot, retry: WorkflowRunSnapshot, orderIds: string[]) => Promise<void>;
}

/** New-contract orchestration only. Legacy Signals context and approvals are untouched. */
export class SignalService {
  private readonly provider: SignalProvider;
  private readonly admissions = new Set<string>();
  constructor(private readonly deps: SignalServiceDeps = {}) { this.provider = deps.provider ?? new LocalSignalProvider(); }
  private now() { return this.deps.now?.() ?? new Date().toISOString(); }
  private scope(id: string) { return resolveSignalHqWorkspace(id, this.deps.workspaces?.() ?? getWorkspaces()); }
  private permission(workspace: Workspace, action: 'records.write' | 'automation.external.execute') {
    (this.deps.permission ?? assertTeamPermission)(workspace.rootPath, action);
  }
  private state(workspace: Workspace): CollectionStore { return readSignals(workspace.rootPath, workspace.id) as CollectionStore; }
  private save(workspace: Workspace, state: SignalStore) {
    writeSignals(workspace.rootPath, state);
    try { this.deps.changed?.(workspace.id); }
    catch (error) { console.warn('[signals] Failed to notify observers after journal commit:', error); }
  }
  private view(state: SignalStore): SignalState {
    return { hqWorkspaceId: state.hqWorkspaceId, tracks: state.tracks, runs: state.requests.map(({ runId, track, mode, status, workflowRunId, orderIds, outputId, createdAt, updatedAt, error }) => ({ runId, track, mode, status, workflowRunId, orderIds, outputId, createdAt, updatedAt, error })).reverse() };
  }
  async getState(workspaceId: string): Promise<SignalState> {
    const workspace = this.scope(workspaceId);
    await this.reconcile(workspace.id);
    const state = this.state(workspace);
    return { ...this.view(state), ...(state.tracks.industry.revision === 'initial' ? { legacyIndustry: { requiresReview: true as const, configBody: loadContextDoc(workspace.rootPath, 'artist-intel-config')?.body ?? null } } : {}) };
  }
  async resolveChannel(workspaceId: string, url: string): Promise<SignalChannel> {
    const workspace = this.scope(workspaceId); this.permission(workspace, 'records.write');
    if (typeof url !== 'string' || url.length > 2048) throw new Error('Invalid YouTube channel.');
    this.permission(workspace, 'automation.external.execute');
    return this.provider.resolveChannel(url, workspace.rootPath, randomUUID());
  }
  async saveConfig(workspaceId: string, track: SignalTrack, config: SignalTrackConfig, expectedRevision: string): Promise<SignalState> {
    const workspace = this.scope(workspaceId); this.permission(workspace, 'records.write');
    const parsed = validateSignalTrackConfig({ ...config, enabled: track === 'your-world' && config.sources?.length === 0 ? false : config.enabled });
    if (parsed.track !== track) throw new Error('Signals track mismatch.');
    const previous = this.state(workspace).tracks[track];
    if (previous.revision !== expectedRevision) throw new Error('Signals settings changed. Reload before saving.');
    const sources: SignalChannel[] = [];
    for (const source of parsed.sources) {
      const known = previous.sources.some(item => item.channelId === source.channelId && item.url === source.url);
      if (known || source.url === `https://www.youtube.com/channel/${source.channelId}`) { sources.push(source); continue; }
      this.permission(workspace, 'automation.external.execute');
      const resolved = await this.provider.resolveChannel(source.url, workspace.rootPath, randomUUID());
      if (resolved.channelId !== source.channelId) throw new Error('Channel identity changed. Resolve the channel again.');
      sources.push({ ...source, url: resolved.url, channelId: resolved.channelId });
    }
    return withSignalsLock(workspace.rootPath, async () => {
      const state = this.state(workspace);
      if (state.tracks[track].revision !== expectedRevision) throw new Error('Signals settings changed. Reload before saving.');
      state.tracks[track] = validateSignalTrackConfig({ ...parsed, sources, revision: randomUUID(), updatedAt: this.now() });
      this.save(workspace, state);
      return this.view(state);
    });
  }
  async start(workspaceId: string, input: SignalStartInput): Promise<SignalQueueResult> {
    return this.enqueue(workspaceId, input);
  }
  async queueScheduled(workspaceId: string, pending: PendingQueuedWork): Promise<SignalQueueResult> {
    const execution = pending.action.execution;
    if (execution.type !== 'workflow-run') throw new Error('Signals schedule must execute a workflow.');
    const inputs = execution.triggerInputs ?? {};
    const workspace = this.scope(workspaceId);
    const track = inputs.track as SignalTrack;
    if (track !== 'industry' && track !== 'your-world') throw new Error('Invalid Signals track.');
    const config = this.state(workspace).tracks[track];
    if (!config.enabled || config.cadence !== 'weekly') throw new Error('This Signals weekly track is disabled.');
    return this.enqueue(workspaceId, { track, mode: 'scan', idempotencyKey: `schedule:${pending.matcherId}:${pending.eventKey ?? pending.eventTimestamp}` }, pending);
  }
  private async enqueue(workspaceId: string, input: SignalStartInput, scheduled?: PendingQueuedWork): Promise<SignalQueueResult> {
    const workspace = this.scope(workspaceId); this.permission(workspace, 'automation.external.execute');
    await this.reconcile(workspace.id);
    if (!['industry', 'your-world'].includes(input.track) || !['scan', 'links'].includes(input.mode)
      || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 240) throw new Error('Invalid Signals request.');
    const links = input.mode === 'links' ? normalizeSignalVideoLinks(input.links ?? []) : undefined;
    if (links && !links.ok) throw new Error(links.errors.map(error => error.message).join(' ').slice(0, 400));
    const ids = links?.ok ? links.videos.map(video => video.videoId) : [];
    const requestHash = hash({ track: input.track, mode: input.mode, ids });
    return withSignalsLock(workspace.rootPath, async () => {
      const state = this.state(workspace);
      const previous = state.requests.find(request => request.idempotencyKey === input.idempotencyKey);
      if (previous && previous.requestHash !== requestHash) throw new Error('Signals request key was reused with different inputs.');
      const active = previous ?? (input.mode === 'scan' ? state.requests.find(request => request.track === input.track && request.mode === 'scan' && ['queued', 'running'].includes(request.status)) : undefined);
      if (active?.orderIds.length) return { hqWorkspaceId: workspace.id, runId: active.runId, orderIds: active.orderIds, reused: true };
      const config = validateSignalTrackConfig(state.tracks[input.track]);
      if (input.mode === 'scan' && input.track === 'your-world' && !config.sources.length) throw new Error('Add a Your World channel before scanning.');
      const workflow = (this.deps.workflow ?? loadGlobalWorkflow)(signalWorkflowFor(input.track, input.mode));
      if (!workflow || !workflow.metadata.trigger?.inputs?.some(field => field.name === 'signalContract')) throw new Error('Review and activate the new Signals workflow before running this track.');
      if (input.track === 'industry' && input.mode === 'scan') {
        const legacy = parseScheduledWorkDocResult(loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspace.id);
        if (legacy.ok && legacy.work.items.some(order => !order.deletedAt && ['scheduled', 'running', 'waiting', 'needs-approval'].includes(order.status)
          && order.execution.type === 'workflow-run' && order.execution.workflowSlug === 'weekly-signal-scan')) throw new Error('Existing Industry scan work is pending. Finish or cancel it before starting the new track.');
      }
      const workflowDigest = scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body });
      const now = this.now();
      const runId = active?.runId ?? randomUUID();
      const request: SignalRequest = active ?? {
        runId, track: input.track, mode: input.mode, status: 'queued', orderIds: [], createdAt: now, updatedAt: now,
        idempotencyKey: input.idempotencyKey, requestHash, config: structuredClone(config), workflowDigest,
        identity: { version: 1, hqWorkspaceId: workspace.id, track: input.track, mode: input.mode, runId, workflowRunId: randomUUID(), configRevision: config.revision, requestedVideoIds: ids },
        selected: [], coverage: [], packets: [], websites: [],
      };
      if (!active) state.requests.push(request);
      this.save(workspace, state); // Journal before queue: retries recover a crash after queue publication.
      const triggerInputs = { signalContract: SIGNAL_CONTRACT, signalRequestId: runId, signalPacket: '{}', track: input.track, mode: input.mode, artist_name: workspace.name };
      const action = scheduled ? { ...scheduled.action, execution: { ...scheduled.action.execution, triggerInputs } } : {
        type: 'queue-work' as const, title: `${input.track === 'industry' ? 'Industry' : 'Your World'} ${input.mode === 'scan' ? 'scan' : 'video review'}`,
        ownerScope: 'hq' as const, calendarVisibility: 'hidden' as const, intentId: `signals:${input.track}:${input.mode}:${runId}`,
        execution: { type: 'workflow-run' as const, workflowSlug: workflow.slug, workflowDigest, triggerInputs },
      };
      const pending = scheduled ? { ...scheduled, action, configuredAction: scheduled.configuredAction ?? scheduled.action } : {
        matcherId: `signals-${input.track}`, automationName: action.title, event: 'SchedulerTick' as const,
        eventTimestamp: Date.parse(request.createdAt), eventKey: runId, action, configuredAction: action,
      };
      const queued = await (this.deps.queue ?? queueAutomationWork)(workspace.id, workspace.rootPath, pending as PendingQueuedWork);
      if (!queued.orderIds.length) throw new Error('Signals queue admission was refused.');
      request.orderIds = queued.orderIds; this.save(workspace, state);
      this.deps.wake?.(workspace);
      return { hqWorkspaceId: workspace.id, runId, orderIds: queued.orderIds, reused: Boolean(active) };
    });
  }

  /** Single host admission boundary, including failures before/after collection. */
  async startAdmitted(workspaceId: string, orderId: string, workflowSlug: string, workflowDigest: string,
    triggerInputs: Record<string, unknown>, start: (workflow: LoadedWorkflow, request: SignalRequest) => Promise<{ id: string }>): Promise<{ runId: string }> {
    const workspace = this.scope(workspaceId);
    const requestId = String(triggerInputs.signalRequestId ?? '');
    const request = this.state(workspace).requests.find(item => item.runId === requestId);
    if (!request || !request.orderIds.includes(orderId) || request.workflowDigest !== workflowDigest
      || workflowSlug !== signalWorkflowFor(request.track, request.mode)) throw new Error('Signals admission provenance is invalid.');
    this.admissions.add(requestId);
    try {
      const workflow = (this.deps.workflow ?? loadGlobalWorkflow)(workflowSlug);
      if (!readActivatedWorkflows(workspace.rootPath).active.includes(workflowSlug) || !workflow
        || scheduledWorkDefinitionDigest({ metadata: workflow.metadata, body: workflow.body }) !== workflowDigest) throw new Error('Signals workflow changed or is inactive.');
      if (request.status === 'failed' && !readRun(workspace.rootPath, request.workflowRunId ?? request.identity.workflowRunId)) {
        const orders = parseScheduledWorkDocResult(loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspace.id);
        if (!orders.ok || !orders.work.items.some(order => order.id === orderId && ['scheduled', 'running'].includes(order.status))) throw new Error('Signals work must be explicitly retried in Active work.');
        await withSignalsLock(workspace.rootPath, async () => {
          const state = this.state(workspace); const saved = state.requests.find(item => item.runId === requestId)!;
          saved.status = 'queued'; saved.error = undefined;
          if (this.needsCollectionRecovery(saved)) saved.collectionComplete = false;
          this.save(workspace, state);
        });
      }
      const prepared = await this.prepare(workspace.id, requestId, orderId, workflowDigest);
      const existing = readRun(workspace.rootPath, prepared.workflowRunId ?? prepared.identity.workflowRunId);
      if (existing) return { runId: existing.id };
      const run = await start(workflow, prepared);
      if (run.id !== prepared.identity.workflowRunId) throw new Error('Signals workflow start identity mismatch.');
      return { runId: run.id };
    } catch (error) {
      await withSignalsLock(workspace.rootPath, async () => {
        const state = this.state(workspace); const saved = state.requests.find(item => item.runId === requestId)!;
        if (['queued', 'running'].includes(saved.status)) {
          saved.status = 'failed'; saved.error = error instanceof SignalStorageLimitError ? error.message : 'Signals workflow could not start. Review Active work and retry.';
          saved.updatedAt = this.now(); this.save(workspace, state);
        }
      });
      if (error instanceof SignalStorageLimitError) throw error;
      throw new Error('Signals workflow could not start. Review Active work and retry.');
    } finally { this.admissions.delete(requestId); }
  }

  /** Only the runner's persisted, reciprocal rerun relationship authorizes a new attempt. */
  async authorizeRetry(original: WorkflowRunSnapshot, retry: WorkflowRunSnapshot, signal?: AbortSignal): Promise<WorkflowRunSnapshot | void> {
    if (original.trigger.inputs.signalContract !== SIGNAL_CONTRACT) return;
    const workspace = this.scope(original.workspaceId);
    return withSignalsLock(`${workspace.rootPath}:retry:${retry.id}`, async () => {
      signal?.throwIfAborted();
      await this.associateRetry(original, retry);
      const request = this.state(workspace).requests.find(item => item.runId === original.trigger.inputs.signalRequestId)!;
      if (request.collectionRetryRunId !== retry.id) return;
      const prepared = await this.prepare(workspace.id, request.runId, request.orderIds[0]!, request.workflowDigest, signal);
      signal?.throwIfAborted();
      const saved = readRun(workspace.rootPath, retry.id);
      if (!saved || !['running', 'interrupted'].includes(saved.state)) throw new Error('Signals retry was cancelled or stopped during collection.');
      const signalPacket = this.packetInput(prepared);
      if (saved.trigger.inputs.signalPacket === signalPacket) return saved;
      const refreshed: WorkflowRunSnapshot = { ...saved,
        trigger: { ...saved.trigger, inputs: { ...saved.trigger.inputs, signalPacket } },
        steps: saved.workflowSnapshot.metadata.steps.map(step => ({ id: step.id, state: 'queued', attempts: 0 })),
        resumeFromStepId: saved.workflowSnapshot.metadata.steps[0]?.id,
      };
      writeRun(workspace.rootPath, refreshed);
      return refreshed;
    });
  }

  private async associateRetry(original: WorkflowRunSnapshot, retry: WorkflowRunSnapshot, lineage = new Set<string>()): Promise<void> {
    if (original.trigger.inputs.signalContract !== SIGNAL_CONTRACT) return;
    if (lineage.has(original.id) || lineage.size >= 64) throw new Error('Signals retry provenance is invalid.');
    lineage.add(original.id);
    const workspace = this.scope(original.workspaceId); this.permission(workspace, 'automation.external.execute');
    const current = this.state(workspace).requests.find(item => item.runId === original.trigger.inputs.signalRequestId);
    if (current && !current.refusedAttempts?.some(attempt => attempt.runId === original.id)
      && original.resumedFromRunId && (current.workflowRunId ?? current.identity.workflowRunId) !== original.id
      && current.workflowRunId !== retry.id) {
      const prior = readRun(workspace.rootPath, original.resumedFromRunId);
      // Several hosts may have crashed before admission. Repair only persisted,
      // reciprocal edges through the normal gates, never collect for old attempts.
      if (prior?.resumedByRunId === original.id) await this.associateRetry(prior, original, lineage);
    }
    await withSignalsLock(workspace.rootPath, async () => {
      const state = this.state(workspace);
      const request = state.requests.find(item => item.runId === original.trigger.inputs.signalRequestId);
      const savedOriginal = readRun(workspace.rootPath, original.id);
      const savedRetry = readRun(workspace.rootPath, retry.id);
      const alreadyAssociated = request?.workflowRunId === retry.id && request.attempts?.some(attempt => attempt.fromRunId === original.id && attempt.runId === retry.id);
      const refreshedTrigger = alreadyAssociated && request.collectionRetryRunId === retry.id && request.collectionComplete && savedRetry
        && savedRetry.trigger.inputs.signalPacket === this.packetInput(request)
        && hash({ ...savedRetry.trigger, inputs: { ...savedRetry.trigger.inputs, signalPacket: original.trigger.inputs.signalPacket } }) === hash(original.trigger);
      const refusedLineage = request && this.validRefusedLineage(workspace.rootPath, request, original);
      if (!request || (!request.collectionComplete && !request.collectionRetryRunId) || ((request.workflowRunId ?? request.identity.workflowRunId) !== original.id && !alreadyAssociated && !refusedLineage)
        || (!['failed', 'interrupted'].includes(original.state) && !original.outputError)
        || !savedOriginal || !savedRetry || savedOriginal.state !== original.state || hash(savedOriginal.trigger) !== hash(original.trigger)
        || savedOriginal.resumedByRunId !== retry.id || savedRetry.resumedFromRunId !== original.id
        || !['running', 'interrupted'].includes(savedRetry.state) || retry.workspaceId !== workspace.id || retry.workflowSlug !== signalWorkflowFor(request.track, request.mode)
        || (!refreshedTrigger && hash(savedRetry.trigger) !== hash(retry.trigger)) || hash(savedRetry.workflowSnapshot) !== hash(retry.workflowSnapshot)
        || hash(retry.workflowSnapshot) !== hash(original.workflowSnapshot)
        || (hash(retry.trigger) !== hash(original.trigger) && !(refreshedTrigger && hash(retry.trigger) === hash(savedRetry.trigger)))
        || scheduledWorkDefinitionDigest(original.workflowSnapshot) !== request.workflowDigest) throw new Error('Signals retry provenance is invalid.');
      for (const packet of request.packets) readEvidence(workspace.rootPath, packet.contentHash);
      for (const packet of request.websites) readEvidence(workspace.rootPath, packet.contentHash);
      if (alreadyAssociated) return;
      if (!this.deps.admitRetry) throw new Error('Signals retry requires tracked background admission.');
      try { await this.deps.admitRetry(original, retry, request.orderIds); }
      catch (error) {
        // Authorized identity, but no session was admitted. Keep this edge separate
        // from the active attempt so retrying its visible failed run is recoverable.
        if (!request.refusedAttempts?.some(attempt => attempt.runId === retry.id)) {
          request.refusedAttempts = [...(request.refusedAttempts ?? []), { fromRunId: original.id, runId: retry.id }];
          this.save(workspace, state);
        }
        throw error;
      }
      request.attempts = [...(request.attempts ?? []), { fromRunId: original.id, runId: retry.id }];
      request.workflowRunId = retry.id; request.status = 'running'; request.error = undefined;
      if (this.needsCollectionRecovery(request) || original.trigger.inputs.signalPacket !== this.packetInput(request)) {
        request.collectionComplete = false; request.collectionRetryRunId = retry.id;
      }
      request.outputId = undefined; request.outputHash = undefined; request.reportMetadataHash = undefined; request.updatedAt = this.now();
      this.save(workspace, state);
    });
  }

  private validRefusedLineage(root: string, request: SignalRequest, original: WorkflowRunSnapshot): boolean {
    const activeId = request.workflowRunId ?? request.identity.workflowRunId;
    let child = original;
    const seen = new Set<string>();
    while (child.id !== activeId) {
      if (seen.has(child.id) || seen.size >= 64 || !['failed', 'interrupted'].includes(child.state)) return false;
      seen.add(child.id);
      const edge = request.refusedAttempts?.find(attempt => attempt.runId === child.id);
      if (!edge || child.resumedFromRunId !== edge.fromRunId) return false;
      const parent = readRun(root, edge.fromRunId);
      if (!parent || parent.resumedByRunId !== child.id || parent.workspaceId !== original.workspaceId || parent.workflowSlug !== original.workflowSlug
        || hash(parent.trigger) !== hash(original.trigger) || hash(parent.workflowSnapshot) !== hash(original.workflowSnapshot)
        || hash(child.trigger) !== hash(original.trigger) || hash(child.workflowSnapshot) !== hash(original.workflowSnapshot)) return false;
      child = parent;
    }
    return seen.size > 0;
  }

  private needsCollectionRecovery(request: SignalRequest): boolean {
    const expected = request.mode === 'links' ? request.identity.requestedVideoIds
      : [...request.config.sources.map(source => source.channelId), ...(request.track === 'industry' ? WEBSITE_SOURCES.map((_, i) => `web:${i}`) : [])];
    return !request.collectionComplete || expected.some(id => !request.coverage.some(source => source.sourceId === id && source.status !== 'unavailable'))
      || request.selected.some(video => !request.packets.some(packet => packet.metadata.videoId === video.videoId));
  }

  /** Invoked only from the admitted Scheduled Work workflow start callback. */
  async prepare(workspaceId: string, requestId: string, orderId: string, workflowDigest: string, signal?: AbortSignal): Promise<SignalRequest> {
    const workspace = this.scope(workspaceId); this.permission(workspace, 'automation.external.execute');
    return withSignalsLock(`${workspace.rootPath}:collection:${requestId}`, async () => {
      let failureMessage = 'Signals preparation failed or was cancelled. Retry the scan.';
      let attemptRunId: string | undefined;
      const controller = new AbortController();
      const cancel = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timeout = setTimeout(() => controller.abort(new Error('Signals collection timed out.')), this.deps.preparationTimeoutMs ?? 300_000);
      const poll = setInterval(() => {
        const orders = parseScheduledWorkDocResult(loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspace.id);
        if (orders.ok && orders.work.items.some(order => order.id === orderId && order.status === 'canceled')) controller.abort(new Error('Signals work was cancelled.'));
      }, 500);
      const collect = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
        const abort = () => reject(new Error('Signals collection timed out or was cancelled.'));
        controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) abort();
        operation.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      });
      try {
      let state = this.state(workspace);
      let request = state.requests.find(item => item.runId === requestId);
      if (!request || !request.orderIds.includes(orderId) || request.workflowDigest !== workflowDigest || !['queued', 'running'].includes(request.status)) throw new Error('Signals request provenance does not match this work order.');
      attemptRunId = request.workflowRunId ?? request.identity.workflowRunId;
      controller.signal.throwIfAborted();
      if (request.collectionComplete) return request;
      const saveRequest = async () => withSignalsLock(workspace.rootPath, async () => {
        const current = this.state(workspace);
        const index = current.requests.findIndex(item => item.runId === requestId);
        const saved = current.requests[index];
        if (!saved || saved.status === 'cancelled' || (saved.workflowRunId ?? saved.identity.workflowRunId) !== request!.workflowRunId) throw new Error('Signals request cancelled or superseded.');
        current.requests[index] = request!; this.save(workspace, current);
      });
      request.status = 'running'; request.workflowRunId ??= request.identity.workflowRunId; request.updatedAt = this.now();
      await saveRequest();
      const setCoverage = (coverage: SignalSourceCoverage) => {
        request!.coverage = [...request!.coverage.filter(item => item.sourceId !== coverage.sourceId), coverage];
      };
      request.discovery ??= [];
      const sourceIds = request.mode === 'links' ? request.identity.requestedVideoIds : request.config.sources.map(source => source.channelId);
      for (const sourceId of sourceIds) {
        controller.signal.throwIfAborted();
        let discovery = request.discovery.find(item => item.sourceId === sourceId);
        if (!discovery) {
          const prior = request.coverage.find(item => item.sourceId === sourceId);
          const videos = request.selected.filter(video => (request!.mode === 'links' ? video.videoId : video.channelId) === sourceId);
          // Older journals have no separate discovery receipt. Never refetch their
          // valid metadata merely because a later transcript was unavailable.
          if (prior && (prior.status !== 'unavailable' || videos.length)) {
            discovery = { sourceId, videos, coverage: { ...prior, status: prior.status === 'unavailable' ? 'incomplete' : prior.status } };
          } else try {
            if (request.mode === 'links') {
              const video = await collect(this.provider.video(sourceId, controller.signal, workspace.rootPath, request.workflowRunId ?? request.identity.workflowRunId));
              discovery = { sourceId, videos: [video], coverage: { sourceId, status: 'checked', checkedAt: this.now(), candidateVideoIds: [sourceId] } };
            } else {
              const result = await collect(this.provider.recent(sourceId, controller.signal, workspace.rootPath, request.workflowRunId ?? request.identity.workflowRunId));
              const cutoff = Date.parse(request.createdAt) - request.config.sinceDays * 86400000;
              const complete = result.complete || result.videos.some(video => Date.parse(video.publishedAt) < cutoff);
              discovery = { sourceId, videos: result.videos, coverage: { sourceId, status: complete ? 'checked' : 'incomplete', checkedAt: this.now(),
                candidateVideoIds: result.videos.filter(video => Date.parse(video.publishedAt) >= cutoff && Date.parse(video.publishedAt) <= Date.parse(request!.createdAt)).map(video => video.videoId) } };
            }
          } catch {
            setCoverage({ sourceId, status: 'unavailable', checkedAt: this.now(), candidateVideoIds: request.mode === 'links' ? [sourceId] : [], message: 'YouTube metadata is unavailable. Check metadata access and retry.' });
          }
          if (discovery) request.discovery.push(discovery);
        }
        if (discovery) setCoverage(structuredClone(discovery.coverage));
        // Save each source before awaiting another: interrupted discovery resumes
        // missing sources without losing successful metadata or refetching it.
        await saveRequest();
      }
      const videos = request.discovery.flatMap(item => item.videos);
      if (request.mode === 'links') {
        request.selected = request.identity.requestedVideoIds.flatMap(id => videos.find(video => video.videoId === id) ?? []);
      } else {
        const selection = selectSignalScanVideos({ hqWorkspaceId: workspace.id, track: request.track, config: request.config, videos, ledger: state.ledger, sourceCoverage: request.coverage, now: request.createdAt });
        // Recovery can fill missing sources, but cannot evict an already selected
        // video or replace evidence captured by the original attempt.
        for (const video of selection.selected) {
          if (request.selected.length < 20 && !request.selected.some(item => item.videoId === video.videoId)
            && request.selected.filter(item => item.channelId === video.channelId).length < request.config.maxPerChannel) request.selected.push(video);
        }
        request.identity.requestedVideoIds = request.selected.map(video => video.videoId);
        const accounted = new Set([...request.identity.requestedVideoIds, ...state.ledger.filter(item => item.track === request!.track).map(item => item.videoId)]);
        for (const source of request.coverage) if (source.candidateVideoIds.some(id => !accounted.has(id))) source.status = 'incomplete';
      }
      await saveRequest();
      for (const video of request.selected) {
        controller.signal.throwIfAborted();
        const existing = request.packets.find(packet => packet.metadata.videoId === video.videoId);
        if (existing && existing.contentHash === hash(existing.transcript ?? readEvidence(workspace.rootPath, existing.contentHash))) {
          if (existing.excludedFromSynthesis) {
            const source = request.coverage.find(item => item.sourceId === (request!.mode === 'links' ? video.videoId : video.channelId));
            if (source) { source.status = 'incomplete'; source.message = 'A whole video remains omitted because it exceeds this run\'s context budget.'; }
          }
          continue;
        }
        try {
          const transcript = await collect(this.provider.transcript(workspace.rootPath, video.videoId, controller.signal, request.workflowRunId ?? request.identity.workflowRunId));
          if (transcript.videoId !== video.videoId || !transcript.segments.length) throw new Error('Invalid evidence identity');
          const packet = { id: `video:${video.videoId}`, metadata: video, transcript, contentHash: hash(transcript), excludedFromSynthesis: false };
          request.packets.push(packet);
          // Keep whole transcripts only. Reserve room for Industry's other lanes.
          if (this.packetInput(request, false).length > (request.track === 'industry' && request.mode === 'scan' ? 300_000 : 450_000)) {
            packet.excludedFromSynthesis = true;
            const source = request.coverage.find(item => item.sourceId === (request!.mode === 'links' ? video.videoId : video.channelId));
            if (source) { source.status = 'incomplete'; source.message = 'A whole video was omitted because its full evidence exceeds this run\'s context budget. It remains eligible for a later scan.'; }
          }
        } catch {
          const source = request.coverage.find(item => item.sourceId === (request!.mode === 'links' ? video.videoId : video.channelId));
          if (source) source.status = 'unavailable';
        }
        await saveRequest();
      }
      if (request.track === 'industry' && request.mode === 'scan') {
        for (const url of WEBSITE_SOURCES) {
          controller.signal.throwIfAborted();
          const previous = request.websites.find(packet => packet.url === url);
          if (previous) {
            const content = previous.content ?? readEvidence<CollectedWebsitePacket>(workspace.rootPath, previous.contentHash);
            if (content.status !== 'unavailable' || content.items.length) continue;
          }
          try {
            if (!this.provider.website) throw new Error('Website collector unavailable');
            const content = await collect(this.provider.website(url, { sinceDays: request.config.sinceDays, now: request.createdAt }, controller.signal));
            const id = `web:${WEBSITE_SOURCES.indexOf(url)}`;
            const packet = { id, url, content, contentHash: hash(content), checkedAt: content.checkedAt, excludedFromSynthesis: false };
            request.websites = [...request.websites.filter(item => item.url !== url), packet];
            packet.excludedFromSynthesis = this.packetInput(request, false).length > 450_000;
            setCoverage({ sourceId: id, status: packet.excludedFromSynthesis ? 'incomplete' : content.status, checkedAt: content.checkedAt, candidateVideoIds: [],
              message: packet.excludedFromSynthesis ? 'Source omitted whole because the run context budget is full.' : content.message,
              reportableFindingCount: content.status === 'checked' && !content.items.length && !packet.excludedFromSynthesis ? 0 : undefined });
          } catch { setCoverage({ sourceId: `web:${WEBSITE_SOURCES.indexOf(url)}`, status: 'unavailable', checkedAt: this.now(), candidateVideoIds: [] }); }
          await saveRequest();
        }
      }
      controller.signal.throwIfAborted();
      if (request.packets.length && request.packets.every(packet => packet.excludedFromSynthesis) && !request.websites.length) {
        failureMessage = 'Full video evidence exceeds the Signals context budget. Choose shorter videos.';
        throw new Error(failureMessage);
      }
      request.collectionComplete = true; await saveRequest();
      return request;
      } catch (error) {
        if (error instanceof SignalStorageLimitError) failureMessage = error.message;
        await withSignalsLock(workspace.rootPath, async () => {
          const current = this.state(workspace);
          const saved = current.requests.find(item => item.runId === requestId);
          if (saved && saved.orderIds.includes(orderId) && saved.workflowDigest === workflowDigest && ['queued', 'running'].includes(saved.status)
            && (!attemptRunId || (saved.workflowRunId ?? saved.identity.workflowRunId) === attemptRunId)) {
            saved.status = 'failed'; saved.error = failureMessage; saved.updatedAt = this.now();
            this.save(workspace, current);
          }
        });
        throw new Error(failureMessage);
      } finally { clearTimeout(timeout); clearInterval(poll); signal?.removeEventListener('abort', cancel); controller.abort(); }
    });
  }
  packetInput(request: SignalRequest, enforceLimit = true): string {
    const root = this.scope(request.identity.hqWorkspaceId).rootPath;
    const videos = request.packets.filter(packet => !packet.excludedFromSynthesis).map(packet => {
      const transcript = packet.transcript ?? readEvidence<SignalTranscript>(root, packet.contentHash);
      return { id: packet.id, metadata: packet.metadata, contentHash: packet.contentHash, transcript, truncated: false };
    });
    const websites = request.websites.filter(packet => !packet.excludedFromSynthesis).map(packet => ({ id: packet.id, contentHash: packet.contentHash,
      ...(packet.content ?? readEvidence<CollectedWebsitePacket>(root, packet.contentHash)) }));
    const channelInterests = request.config.sources.filter(source => source.notes?.trim())
      .map(source => ({ channelId: source.channelId, notes: source.notes!.trim() }));
    const serialized = JSON.stringify({ identity: request.identity, coverage: request.coverage, videos, websites, channelInterests });
    if (enforceLimit && serialized.length > 450_000) throw new Error('Signals evidence is too large for one synthesis. Use fewer channels or videos.');
    return serialized;
  }
  async complete(run: WorkflowRunSnapshot, signal: AbortSignal): Promise<boolean> {
    if (run.trigger.inputs.signalContract !== SIGNAL_CONTRACT) return false;
    const workspace = this.scope(run.workspaceId);
    return withSignalsLock(workspace.rootPath, async () => {
      signal.throwIfAborted();
      const state = this.state(workspace);
      const request = state.requests.find(item => item.runId === run.trigger.inputs.signalRequestId);
      if (!request || (request.workflowRunId ?? request.identity.workflowRunId) !== run.id || !request.collectionComplete || run.workflowSlug !== signalWorkflowFor(request.track, request.mode)) throw new Error('Signals finalization provenance is invalid.');
      const previousReport = `${request.status}:${request.reportMetadataHash ?? ''}`;
      const identity = { ...request.identity, workflowRunId: run.id };
      for (const packet of request.packets) readEvidence(workspace.rootPath, packet.contentHash);
      for (const packet of request.websites) readEvidence(workspace.rootPath, packet.contentHash);
      if (request.status === 'cancelled' || run.state === 'cancelled' || run.state === 'failed') throw new Error('Unsuccessful Signals runs cannot finalize coverage.');
      const step = run.steps.find(item => item.id === 'synthesize');
      const raw = step?.output;
      const { parseSignalSynthesis } = await import('@craft-agent/shared/shared-intel');
      const sources = [...request.packets.filter(packet => !packet.excludedFromSynthesis).map(packet => ({ sourceId: packet.id, sourceUrl: packet.metadata.sourceUrl, videoId: packet.metadata.videoId, sourcePublishedAt: packet.metadata.publishedAt })),
        ...request.websites.filter(packet => !packet.excludedFromSynthesis).flatMap(packet => readEvidence<CollectedWebsitePacket>(workspace.rootPath, packet.contentHash).items.map(item => ({ sourceId: item.id, sourceUrl: item.url, sourcePublishedAt: item.publishedAt })))];
      const result = parseSignalSynthesis(typeof raw === 'string' ? JSON.parse(raw) : raw, { identity, sources });
      if (result.coverage.unresolvedVideoIds.length) result.warnings.push(`Videos without a validated synthesis outcome: ${result.coverage.unresolvedVideoIds.join(', ')}.`);
      const completePacket = (packet: SignalRequest['packets'][number]) => !packet.excludedFromSynthesis;
      const included = new Set(result.coverage.includedVideoIds.filter(id => request.packets.some(packet => packet.metadata.videoId === id && completePacket(packet))));
      const fullyExamined = (packet: SignalRequest['packets'][number]) => result.coverage.examinedNoFindingVideoIds.includes(packet.metadata.videoId) && completePacket(packet);
      const evidence: SignalEvidenceReceipt[] = request.packets.map(packet => ({ version: 1, hqWorkspaceId: workspace.id, track: request.track, runId: request.runId,
        sourceId: request.mode === 'links' ? packet.metadata.videoId : packet.metadata.channelId, videoId: packet.metadata.videoId,
        packetId: packet.id, contentHash: packet.contentHash, checkedAt: this.now(), sourcePublishedAt: packet.metadata.publishedAt,
        status: included.has(packet.metadata.videoId) ? 'finding' : fullyExamined(packet) ? 'examined-no-finding' : 'unavailable' }));
      for (const packet of request.websites) evidence.push({ version: 1, hqWorkspaceId: workspace.id, track: request.track, runId: request.runId, sourceId: packet.id,
        packetId: packet.id, contentHash: packet.contentHash, checkedAt: packet.checkedAt,
        status: packet.excludedFromSynthesis ? 'unavailable' : result.findings.some(finding => readEvidence<CollectedWebsitePacket>(workspace.rootPath, packet.contentHash).items.some(item => finding.sourceRefs.includes(item.id))) ? 'finding' : result.outcome === 'no-change' ? 'examined-no-finding' : 'unavailable' });
      const proof = { identity, expectedSourceIds: request.mode === 'links' ? request.identity.requestedVideoIds : [...request.config.sources.map(source => source.channelId), ...(request.track === 'industry' ? WEBSITE_SOURCES.map((_, i) => `web:${i}`) : [])],
        coveredVideoIds: state.ledger.filter(entry => entry.track === request.track).map(entry => entry.videoId),
        sourceCoverage: request.coverage, evidence, coverageIncomplete: result.indexingStatus === 'failed' || result.coverage.unresolvedVideoIds.length > 0 || request.coverage.some(item => item.status !== 'checked'), cancelled: signal.aborted };
      if (result.outcome === 'no-change' && !canFinalizeSignalNoChange(proof)) throw new Error('Incomplete or unavailable Signals evidence cannot complete as no-change.');
      let publishedReport;
      if (result.outcome === 'report') {
        const outputId = request.outputId ?? (run.id === request.identity.workflowRunId ? request.runId : run.id);
        const existing = readOutput(workspace.rootPath, outputId);
        if (existing && (existing.origin.workflowRunId !== run.id || existing.workspaceId !== workspace.id)) throw new Error('Signals output identity collision.');
        const output = existing ?? createOutputBundle(workspace.rootPath, { id: outputId, workspaceId: workspace.id, kind: 'report', status: 'published',
          title: `${request.track === 'industry' ? 'Industry' : 'Your World'} ${request.mode === 'links' ? 'Video Review' : 'Signal Brief'}`,
          origin: { source: 'workflow', workflowSlug: run.workflowSlug, workflowRunId: run.id, stepId: 'synthesize', sessionId: step?.sessionId },
          content: result.markdown, contentMimeType: 'text/markdown', tags: ['signals-v1', `signal-track:${request.track}`, `signal-mode:${request.mode}`] });
        const path = output.primary && resolveOutputAssetPath(workspace.rootPath, output.id, output.primary.path);
        if (!path || (await readFile(path, 'utf8')) !== result.markdown) throw new Error('Signals final report revision changed.');
        signal.throwIfAborted();
        const persisted = readRun(workspace.rootPath, run.id);
        if (!persisted || persisted.state === 'cancelled' || persisted.state === 'failed') throw new Error('Signals workflow is no longer publishable.');
        writeRun(workspace.rootPath, { ...persisted, finalOutputId: output.id, outputIds: [...new Set([...(persisted.outputIds ?? []), output.id])], outputError: undefined });
        request.outputId = output.id; request.outputHash = hash(result.markdown);
        publishedReport = { outputId: output.id, workflowRunId: run.id, finalOutputId: output.id, published: true, readable: true, contentHash: request.outputHash, includedVideoIds: [...included] };
      }
      // The runner calls this once before publishing terminal success, and
      // reconciliation calls it again after success. Coverage waits for that.
      if (run.state !== 'succeeded') { this.save(workspace, state); return true; }
      if (publishedReport) {
        const output = readOutput(workspace.rootPath, publishedReport.outputId)!;
        const persisted = readRun(workspace.rootPath, run.id)!;
        const metadata = buildSignalReportMetadata({ identity, synthesis: result, sources,
          coverageStatus: proof.coverageIncomplete ? 'partial' : 'complete',
          report: { ...publishedReport, workspaceId: workspace.id, workflowSlug: run.workflowSlug,
            stepId: 'synthesize', status: output.status, runState: persisted.state,
            finalOutputId: persisted.finalOutputId ?? '', createdAt: output.createdAt } });
        const metadataHash = hash(metadata);
        saveEvidence(workspace.rootPath, metadataHash, metadata);
        request.reportMetadataHash = metadataHash;
      }
      state.ledger = finalizeSignalCoverage({ ...proof, ledger: state.ledger, outcome: result.outcome, publishedReport, finalizedAt: this.now() });
      request.status = result.outcome === 'report' && proof.coverageIncomplete ? 'partial' : result.outcome;
      request.examinedVideoIds = result.examinedVideoIds; request.updatedAt = this.now();
      if (request.mode === 'scan' && request.outputId) state.latestScan[request.track] = request.outputId;
      this.save(workspace, state);
      if (['report', 'partial'].includes(request.status) && request.reportMetadataHash
        && previousReport !== `${request.status}:${request.reportMetadataHash}`) {
        try { this.deps.reportPublished?.(workspace); }
        catch (error) { console.warn('[signals] Failed to refresh manager after report publication:', error); }
      }
      return true;
    });
  }
  async reconcile(workspaceId: string): Promise<void> {
    const workspace = this.scope(workspaceId);
    await withSignalsLock(workspace.rootPath, async () => {
      const state = this.state(workspace);
      const orders = parseScheduledWorkDocResult(loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspace.id);
      let changed = false;
      for (const request of state.requests) {
        if (!['queued', 'running'].includes(request.status) || this.admissions.has(request.runId)) continue;
        const matches = orders.ok ? orders.work.items.filter(order => !order.deletedAt && order.execution.type === 'workflow-run'
          && order.execution.workflowSlug === signalWorkflowFor(request.track, request.mode)
          && order.execution.workflowDigest === request.workflowDigest
          && order.execution.triggerInputs.signalContract === SIGNAL_CONTRACT
          && order.execution.triggerInputs.signalRequestId === request.runId) : [];
        if (!request.orderIds.length && matches.length === 1) { request.orderIds = [matches[0]!.id]; changed = true; }
        const order = matches.find(item => request.orderIds.includes(item.id));
        const run = readRun(workspace.rootPath, request.workflowRunId ?? request.identity.workflowRunId);
        if (!run && (!order || order.status === 'needs-attention' || order.status === 'canceled'
          || (order.status === 'running' && request.status === 'running'))) {
          request.status = order?.status === 'canceled' ? 'cancelled' : 'failed';
          request.error = 'Signals admission was interrupted. Review Active work and retry.';
          request.updatedAt = this.now(); changed = true;
        }
      }
      if (changed) this.save(workspace, state);
    });
    const requests = this.state(workspace).requests;
    for (const request of requests) {
      // Reads reconcile published state only. Retry admission and paid recovery
      // belong to the runner's explicit authorizeRetry lifecycle callback.
      if (!['running', 'queued'].includes(request.status)) continue;
      const run = readRun(workspace.rootPath, request.workflowRunId ?? request.identity.workflowRunId);
      if (!['running', 'queued'].includes(this.state(workspace).requests.find(item => item.runId === request.runId)!.status)) continue;
      if (run?.state === 'succeeded' && !run.outputError) {
        if (!await this.completeEmpty(run, new AbortController().signal)) await this.complete(run, new AbortController().signal);
      }
      else if (run && (run.outputError || ['failed', 'cancelled', 'interrupted'].includes(run.state))) await withSignalsLock(workspace.rootPath, async () => {
        const state = this.state(workspace); const saved = state.requests.find(item => item.runId === request.runId)!;
        saved.status = run.state === 'cancelled' ? 'cancelled' : 'failed'; saved.error = run.outputError ? 'Signals finalization needs a retry.'
          : saved.coverage.some(source => source.sourceId.startsWith('UC') && source.status === 'unavailable')
            ? 'YouTube source evidence is unavailable. Check YouTube or Monid access and retry.' : 'Signals research did not finish. Review Active work and retry.';
        saved.updatedAt = this.now(); this.save(workspace, state);
      });
      else if (!run && request.orderIds.length) {
        const orders = parseScheduledWorkDocResult(loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspace.id);
        const terminal = orders.ok ? orders.work.items.find(order => request.orderIds.includes(order.id) && ['canceled', 'needs-attention'].includes(order.status)) : undefined;
        if (terminal) await withSignalsLock(workspace.rootPath, async () => {
          const state = this.state(workspace); const saved = state.requests.find(item => item.runId === request.runId)!;
          saved.status = terminal.status === 'canceled' ? 'cancelled' : 'failed'; saved.updatedAt = this.now(); this.save(workspace, state);
        });
      }
    }
  }
  async completeEmpty(run: WorkflowRunSnapshot, signal: AbortSignal): Promise<boolean> {
    if (['signals-industry-scan', 'weekly-world-scan', 'signal-video-review'].includes(run.workflowSlug) && run.trigger.inputs.signalContract !== SIGNAL_CONTRACT) throw new Error('New Signals workflows must be started through Signals tracked work.');
    if (run.trigger.inputs.signalContract !== SIGNAL_CONTRACT) return false;
    const workspace = this.scope(run.workspaceId);
    return withSignalsLock(workspace.rootPath, async () => {
      const state = this.state(workspace);
      const request = state.requests.find(item => item.runId === run.trigger.inputs.signalRequestId);
      if (!request || (request.workflowRunId ?? request.identity.workflowRunId) !== run.id || !request.collectionComplete || request.status === 'cancelled') throw new Error('Signals execution provenance is invalid.');
      if (request.packets.some(packet => !packet.excludedFromSynthesis) || request.websites.some(packet => !packet.excludedFromSynthesis && readEvidence<CollectedWebsitePacket>(workspace.rootPath, packet.contentHash).items.length)) return false;
      const sourceCoverage = request.coverage.map(source => ({ ...source, reportableFindingCount: source.status === 'checked' ? 0 : undefined }));
      const proof = { identity: { ...request.identity, workflowRunId: run.id }, expectedSourceIds: [...request.config.sources.map(source => source.channelId), ...(request.track === 'industry' ? WEBSITE_SOURCES.map((_, i) => `web:${i}`) : [])], sourceCoverage,
        coveredVideoIds: state.ledger.filter(entry => entry.track === request.track).map(entry => entry.videoId), evidence: [],
        coverageIncomplete: request.coverage.some(source => source.status !== 'checked'), cancelled: signal.aborted };
      if (request.mode !== 'scan' || !canFinalizeSignalNoChange(proof)) throw new Error('Signals sources were unavailable or incompletely checked.');
      signal.throwIfAborted();
      if (run.state === 'succeeded') { request.status = 'no-change'; request.updatedAt = this.now(); this.save(workspace, state); }
      return true;
    });
  }
}

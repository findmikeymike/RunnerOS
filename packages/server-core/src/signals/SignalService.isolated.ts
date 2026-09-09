import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Workspace } from '@craft-agent/core/types';
import * as workflows from '@craft-agent/shared/workflows';
import { createSignalContractWorkflow, type WorkflowRunSnapshot } from '@craft-agent/shared/workflows';
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import { parseScheduledWorkDocResult, SCHEDULED_WORK_CONTEXT_SLUG, scheduledWorkMetadata, serializeScheduledWorkBody, type ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work';
import { readOutput } from '@craft-agent/shared/outputs';
import { hash, readEvidence, readSignals, writeSignals, type SignalRequest } from './storage';
import { resolveSignalHqWorkspace } from './scope';
import { LocalSignalProvider, type SignalProvider } from './SignalProvider';
import { WorkflowRunner, type WorkflowRunEvent } from '../workflows/runner';
import { ScheduledWorkRunner } from '../scheduled-work/ScheduledWorkRunner';
import { withWorkspaceContextLock } from '../scheduled-work/workspace-context-lock';
import { createCampaignJobRun } from '@craft-agent/shared/campaign-calendar';
import type { SignalReportMetadata } from '@craft-agent/shared/shared-intel';
import { SIGNAL_WEBSITE_SOURCES, type SignalWebsitePacket } from './website-collector';

const definitions = [createSignalContractWorkflow('your-world', 'scan'), createSignalContractWorkflow('industry', 'scan'), createSignalContractWorkflow('your-world', 'links')];
const loaded = (slug: string) => { const value = definitions.find(item => item.slug === slug); return value ? { ...value, path: '/fixture/WORKFLOW.md', source: 'global' as const } : null; };
mock.module('@craft-agent/shared/workflows', () => ({ ...workflows, loadGlobalWorkflow: loaded, readActivatedWorkflows: () => ({ version: 1, active: definitions.map(item => item.slug) }) }));
const { SignalService } = await import('./SignalService');
const roots: string[] = [];
const now = '2026-09-07T12:00:00.000Z';
const channelId = 'UC' + 'a'.repeat(22);
const channel2 = 'UC' + 'b'.repeat(22);
const videoId = 'abcdefghijk';
const metadata = { videoId, channelId, title: 'Useful research', publishedAt: now, sourceUrl: `https://www.youtube.com/watch?v=${videoId}` };
let root: string;
let workspace: Workspace;
let provider: SignalProvider;
let permission: ReturnType<typeof mock>;
let service: InstanceType<typeof SignalService>;
let trackedRunner: ScheduledWorkRunner;
let externalBusy: boolean;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'signals-service-')); roots.push(root);
  workspace = { id: 'hq', name: 'Artist', rootPath: root, artistWorkspaceScope: 'hq', createdAt: Date.now() } as Workspace;
  provider = { resolveChannel: mock(async () => { throw new Error('offline'); }), recent: mock(async () => ({ videos: [metadata], complete: true })), video: mock(async () => metadata), transcript: mock(async () => ({ videoId, provider: 'fixture', segments: [{ start: 0, end: 10, text: 'Useful finding.' }] })) };
  permission = mock(() => {});
  externalBusy = false;
  trackedRunner = new ScheduledWorkRunner({ canRunBackgroundWork: () => true, hasExternalBackgroundWork: () => externalBusy,
    withLock: withWorkspaceContextLock, executeAgentTask: async () => {}, startWorkflow: async () => { throw new Error('unexpected automatic start'); },
    readWorkflowRun: workflows.readRun, listOutputManifests: () => [], now: () => new Date(now) });
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now, preparationTimeoutMs: 1000,
    admitRetry: (original, retry, ids) => trackedRunner.admitSignalWorkflowRetry(root, original, retry, ids) });
});
afterAll(() => { for (const path of roots) rmSync(path, { recursive: true, force: true }); });
async function configure(second = false) {
  const current = (await service.getState('hq')).tracks['your-world'];
  return service.saveConfig('hq', 'your-world', { ...current, enabled: true, sources: [channelId, ...(second ? [channel2] : [])].map(id => ({ channelId: id, url: `https://www.youtube.com/channel/${id}`, name: id, priority: 'medium' })) }, current.revision);
}
async function prepared(second = false) {
  await configure(second);
  const queued = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'request' });
  const request = readSignals(root, 'hq').requests[0]!;
  return service.prepare('hq', queued.runId, queued.orderIds[0]!, request.workflowDigest);
}
function run(request: SignalRequest, output: unknown, state: WorkflowRunSnapshot['state'] = 'succeeded'): WorkflowRunSnapshot {
  const workflow = loaded(request.mode === 'links' ? 'signal-video-review' : request.track === 'industry' ? 'signals-industry-scan' : 'weekly-world-scan')!;
  return { id: request.identity.workflowRunId, workflowSlug: workflow.slug, workspaceId: 'hq', state,
    trigger: { type: 'manual', inputs: { signalContract: 'signals-v1', signalRequestId: request.runId, signalPacket: service.packetInput(request), track: request.track, mode: request.mode, artist_name: 'Artist' }, firedAt: now },
    workflowSnapshot: { metadata: workflow.metadata, body: workflow.body }, createdAt: now, updatedAt: now,
    steps: [{ id: 'synthesize', state: 'succeeded', attempts: 1, output }] };
}
const finding = { id: 'finding', title: 'Useful', excerpt: 'Useful finding.', topics: ['music'], sourceRefs: [`video:${videoId}`], temporalKind: 'unknown' };
const report = (findings: unknown[] = [finding]) => ({ version: 1, outcome: 'report', markdown: '# Brief\nUseful finding.', examinedVideoIds: [videoId], findings, ideas: [] });
const empty = { version: 1, outcome: 'no-change', markdown: '', examinedVideoIds: [videoId], findings: [], ideas: [] };

test('GET is read-only and offline canonical settings support pause, notes and removal', async () => {
  await service.getState('hq'); expect(permission).toHaveBeenCalledTimes(0);
  const state = await configure();
  const config = state.tracks['your-world'];
  const paused = await service.saveConfig('hq', 'your-world', { ...config, enabled: false, sources: config.sources.map(source => ({ ...source, notes: 'offline edit' })) }, config.revision);
  await service.saveConfig('hq', 'your-world', { ...paused.tracks['your-world'], sources: [] }, paused.tracks['your-world'].revision);
  expect(provider.resolveChannel).toHaveBeenCalledTimes(0);
  await expect(service.saveConfig('hq', 'your-world', config, config.revision)).rejects.toThrow('changed');
});
test('real queue persists admitted order with internal inputs, deduplicates and snapshots config', async () => {
  const state = await configure();
  const input = { track: 'your-world' as const, mode: 'scan' as const, idempotencyKey: 'same' };
  const [a, b] = await Promise.all([service.start('hq', input), service.start('hq', input)]);
  expect(a.orderIds).toEqual(b.orderIds);
  const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'hq');
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('Missing real queue');
  expect(parsed.work.items).toHaveLength(1);
  expect(parsed.work.items[0]!.status).toBe('scheduled');
  const execution = parsed.work.items[0]!.execution;
  expect(execution.type).toBe('workflow-run');
  if (execution.type === 'workflow-run') expect(execution.triggerInputs?.signalPacket).toBe('{}');
  await service.saveConfig('hq', 'your-world', { ...state.tracks['your-world'], sources: [] }, state.tracks['your-world'].revision);
  expect(readSignals(root, 'hq').requests[0]!.config.sources).toHaveLength(1);
});
test('packet bodies are external, immutable, reusable and corruption is rejected', async () => {
  const request = await prepared();
  const journal = readFileSync(join(root, 'signals/state.json'), 'utf8');
  expect(journal).not.toContain('Useful finding.');
  expect(journal).not.toContain('"segments"');
  expect(JSON.parse(service.packetInput(readSignals(root, 'hq').requests[0]!)).videos[0].transcript.segments[0].text).toBe('Useful finding.');
  await service.prepare('hq', request.runId, request.orderIds[0]!, request.workflowDigest);
  expect(provider.transcript).toHaveBeenCalledTimes(1);
  writeFileSync(join(root, 'signals/packets', `${request.packets[0]!.contentHash}.json`), '{}');
  expect(() => readEvidence(root, request.packets[0]!.contentHash)).toThrow('corrupt');
});
test('synthesis receives frozen channel interests without inventing artist beliefs', async () => {
  const initial = (await configure()).tracks['your-world'];
  await service.saveConfig('hq', 'your-world', { ...initial, sources: initial.sources.map(source => ({ ...source, notes: 'Architecture and public spaces' })) }, initial.revision);
  const queued = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'interests' });
  const stored = readSignals(root, 'hq').requests[0]!;
  const current = (await service.getState('hq')).tracks['your-world'];
  await service.saveConfig('hq', 'your-world', { ...current, sources: current.sources.map(source => ({ ...source, notes: 'Changed later' })) }, current.revision);
  const prepared = await service.prepare('hq', queued.runId, queued.orderIds[0]!, stored.workflowDigest);
  expect(JSON.parse(service.packetInput(prepared)).channelInterests).toEqual([{ channelId, notes: 'Architecture and public spaces' }]);
});
test('deadline bounds preparation and releases active request for retry', async () => {
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now, preparationTimeoutMs: 20 });
  provider.recent = mock(async () => new Promise<never>(() => {}));
  await configure();
  const queued = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'timeout' });
  const request = readSignals(root, 'hq').requests[0]!;
  await expect(service.prepare('hq', queued.runId, queued.orderIds[0]!, request.workflowDigest)).rejects.toThrow('preparation failed');
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('failed');
  const retry = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'retry' });
  expect(retry.runId).not.toBe(queued.runId);
});
test('wrong work-order provenance fails before provider calls', async () => {
  await configure();
  const queued = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'identity' });
  await expect(service.prepare('hq', queued.runId, 'invented', 'invented')).rejects.toThrow();
  expect(provider.recent).toHaveBeenCalledTimes(0);
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('queued');
});
test('parser index failure preserves readable report without inventing no-finding coverage', async () => {
  const request = await prepared();
  const snapshot = run(request, report([{ ...finding, excerpt: 'Missing excerpt' }]));
  workflows.writeRun(root, snapshot);
  await service.complete(snapshot, new AbortController().signal);
  const state = readSignals(root, 'hq');
  expect(state.ledger).toHaveLength(0);
  expect(state.requests[0]!.status).toBe('partial');
  expect(readOutput(root, state.requests[0]!.outputId!)).not.toBeNull();
  const saved = readEvidence<SignalReportMetadata>(root, state.requests[0]!.reportMetadataHash!);
  expect(saved.indexingStatus).toBe('failed');
  expect(saved.coverageStatus).toBe('partial');
  expect(saved.findings).toEqual([]);
});
test('final metadata is published only after success and recovers identically after interruption', async () => {
  const request = await prepared();
  const snapshot = run(request, report(), 'running');
  workflows.writeRun(root, snapshot);
  await service.complete(snapshot, new AbortController().signal);
  expect(readSignals(root, 'hq').requests[0]!.reportMetadataHash).toBeUndefined();
  const finished = { ...workflows.readRun(root, snapshot.id)!, state: 'succeeded' as const };
  workflows.writeRun(root, finished);
  await service.complete(finished, new AbortController().signal);
  const finalized = readSignals(root, 'hq').requests[0]!;
  const saved = readEvidence<SignalReportMetadata>(root, finalized.reportMetadataHash!);
  expect(saved.identity).toEqual({ ...request.identity, workflowRunId: snapshot.id });
  expect(saved.outputId).toBe(finalized.outputId!);
  expect(saved.contentHash).toBe(finalized.outputHash!);
  expect(saved.sources[0]?.sourcePublishedAt).toBe(now);
  expect(saved.findings[0]?.excerpt).toBe('Useful finding.');
  const interrupted = readSignals(root, 'hq');
  delete interrupted.requests[0]!.reportMetadataHash;
  writeSignals(root, interrupted);
  await service.complete(workflows.readRun(root, snapshot.id)!, new AbortController().signal);
  expect(readSignals(root, 'hq').requests[0]!.reportMetadataHash).toBe(finalized.reportMetadataHash);
  expect(readSignals(root, 'hq').ledger).toHaveLength(1);
});
test('parser valid inclusion survives separate invalid index without becoming no-finding', async () => {
  const request = await prepared();
  const snapshot = run(request, report([finding, { ...finding, id: 'invalid', excerpt: 'Missing' }]));
  workflows.writeRun(root, snapshot);
  await service.complete(snapshot, new AbortController().signal);
  expect(readSignals(root, 'hq').ledger.map(entry => entry.outcome)).toEqual(['included']);
});
test('long transcripts are supplied whole and can advance coverage', async () => {
  provider.transcript = mock(async () => ({ videoId, provider: 'fixture', segments: [{ start: 0, end: 500, text: 'x'.repeat(13_000) }] }));
  const request = await prepared();
  const packet = JSON.parse(service.packetInput(request));
  expect(packet.videos[0].truncated).toBe(false);
  expect(packet.videos[0].transcript.segments[0].text.length).toBe(13_000);
  const snapshot = run(request, report()); workflows.writeRun(root, snapshot);
  await service.complete(snapshot, new AbortController().signal);
  expect(readSignals(root, 'hq').ledger.map(entry => entry.outcome)).toEqual(['included']);
});

test('over-budget videos are omitted whole and stay retryable', async () => {
  const largeId = 'largevideo1';
  provider.recent = mock(async id => ({ videos: [{ ...metadata, channelId: id, videoId: id === channelId ? videoId : largeId, sourceUrl: `https://www.youtube.com/watch?v=${id === channelId ? videoId : largeId}` }], complete: true }));
  provider.transcript = mock(async (_root, id) => ({ videoId: id, provider: 'fixture', segments: [{ start: 0, end: 500, text: 'x'.repeat(260_000) }] }));
  const request = await prepared(true);
  const packet = JSON.parse(service.packetInput(request));
  expect(packet.videos.map((item: { metadata: { videoId: string } }) => item.metadata.videoId)).toEqual([videoId]);
  expect(request.packets.find(item => item.metadata.videoId === largeId)?.excludedFromSynthesis).toBe(true);
  const snapshot = run(request, report()); workflows.writeRun(root, snapshot);
  await service.complete(snapshot, new AbortController().signal);
  expect(readSignals(root, 'hq').ledger.map(entry => entry.videoId)).toEqual([videoId]);
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('partial');
  const next = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'next-budget-window' });
  const nextSaved = readSignals(root, 'hq').requests.find(item => item.runId === next.runId)!;
  const nextPrepared = await service.prepare('hq', next.runId, next.orderIds[0]!, nextSaved.workflowDigest);
  expect(JSON.parse(service.packetInput(nextPrepared)).videos.map((item: { metadata: { videoId: string } }) => item.metadata.videoId)).toEqual([largeId]);
});

test('single over-budget link fails clearly without partial transcript synthesis', async () => {
  provider.transcript = mock(async () => ({ videoId, provider: 'fixture', segments: [{ start: 0, end: 500, text: 'x'.repeat(460_000) }] }));
  const queued = await service.start('hq', { track: 'your-world', mode: 'links', links: [metadata.sourceUrl], idempotencyKey: 'huge-link' });
  const request = readSignals(root, 'hq').requests[0]!;
  await expect(service.prepare('hq', request.runId, queued.orderIds[0]!, request.workflowDigest)).rejects.toThrow('context budget');
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('failed');
  expect(readSignals(root, 'hq').ledger).toHaveLength(0);
});

test('changed workflow admission fails before collection and does not coalesce new scans', async () => {
  await configure();
  const queued = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'changed' });
  const request = readSignals(root, 'hq').requests[0]!;
  const changed = new SignalService({ workspaces: () => [workspace], provider, permission, workflow: slug => ({ ...loaded(slug)!, body: 'changed' }) });
  await expect(changed.startAdmitted('hq', request.orderIds[0]!, 'weekly-world-scan', request.workflowDigest, { signalRequestId: request.runId }, async () => { throw new Error('must not start'); })).rejects.toThrow('could not start');
  expect(provider.recent).toHaveBeenCalledTimes(0);
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('failed');
  expect((await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'fresh' })).runId).not.toBe(queued.runId);
});

test('real runner missing-agent preflight after prepare releases admission', async () => {
  await configure();
  await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'missing-agent' });
  const request = readSignals(root, 'hq').requests[0]!;
  const runner = new WorkflowRunner({ createSession: async () => ({ id: 'unused' }), sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {}, getWorkspaceRootPath: () => root,
    preflightStepAgent: () => { throw new Error('missing agent'); } });
  await expect(service.startAdmitted('hq', request.orderIds[0]!, 'weekly-world-scan', request.workflowDigest, { signalRequestId: request.runId }, (workflow, saved) => runner.start({ workflow, workspaceId: 'hq', runId: saved.identity.workflowRunId, triggerInputs: { signalContract: 'signals-v1', signalRequestId: saved.runId, track: saved.track, mode: saved.mode, artist_name: 'Artist', signalPacket: service.packetInput(saved) } }))).rejects.toThrow('could not start');
  expect(provider.transcript).toHaveBeenCalledTimes(1);
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('failed');
});

test('restart repairs queue publication before orderIds journal commit', async () => {
  await configure();
  const queued = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'crash' });
  const state = readSignals(root, 'hq'); state.requests[0]!.orderIds = []; writeSignals(root, state);
  const restarted = new SignalService({ workspaces: () => [workspace], provider, permission });
  await restarted.reconcile('hq');
  expect(readSignals(root, 'hq').requests[0]!.orderIds).toEqual(queued.orderIds);
  expect((await restarted.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'crash' })).reused).toBe(true);
});

function orderStatus(status: ScheduledWorkOrder['status']) {
  const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'hq');
  if (!parsed.ok) throw new Error('Missing order');
  upsertContextDoc(root, { slug: SCHEDULED_WORK_CONTEXT_SLUG, metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody({ ...parsed.work, items: parsed.work.items.map(order => ({ ...order, status })) }) });
}
function trackRun(snapshot: WorkflowRunSnapshot) {
  const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'hq');
  if (!parsed.ok) throw new Error('Missing order');
  upsertContextDoc(root, { slug: SCHEDULED_WORK_CONTEXT_SLUG, metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody({ ...parsed.work,
    items: parsed.work.items.map(order => ({ ...order, status: 'needs-attention', runs: [{ ...createCampaignJobRun({ jobId: order.id, status: 'failed', startedAt: now }), workflowRunId: snapshot.id }] })) }) });
}
function persistRetry(original: WorkflowRunSnapshot): WorkflowRunSnapshot {
  const retry: WorkflowRunSnapshot = { ...original, id: randomUUID(), state: 'running', resumedFromRunId: original.id,
    resumedByRunId: undefined, steps: original.workflowSnapshot.metadata.steps.map(step => ({ id: step.id, state: 'queued', attempts: 0 })) };
  workflows.writeRun(root, { ...original, resumedByRunId: retry.id });
  workflows.writeRun(root, retry);
  return retry;
}
for (const status of ['running', 'needs-attention'] as const) test(`restart releases prepared ${status} work without a WorkflowRun`, async () => {
  const request = await prepared(); orderStatus(status);
  const restarted = new SignalService({ workspaces: () => [workspace], provider, permission });
  await restarted.reconcile('hq');
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('failed');
  expect((await restarted.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'new-after-restart' })).runId).not.toBe(request.runId);
});
test('approval/setup attention is preserved rather than treated as failed admission', async () => {
  await configure(); await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'approval' });
  orderStatus('needs-approval'); await service.reconcile('hq');
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('queued');
});
test('explicit tracked-order retry reuses prepared evidence after start failure', async () => {
  const request = await prepared();
  await expect(service.startAdmitted('hq', request.orderIds[0]!, 'weekly-world-scan', request.workflowDigest, { signalRequestId: request.runId }, async () => { throw new Error('missing agent'); })).rejects.toThrow();
  orderStatus('needs-attention');
  await expect(service.startAdmitted('hq', request.orderIds[0]!, 'weekly-world-scan', request.workflowDigest, { signalRequestId: request.runId }, async () => ({ id: request.identity.workflowRunId }))).rejects.toThrow();
  orderStatus('scheduled');
  const result = await service.startAdmitted('hq', request.orderIds[0]!, 'weekly-world-scan', request.workflowDigest, { signalRequestId: request.runId }, async () => ({ id: request.identity.workflowRunId }));
  expect(result.runId).toBe(request.identity.workflowRunId);
  expect(provider.transcript).toHaveBeenCalledTimes(1);
});

for (const mode of ['scan', 'links'] as const) for (const failure of ['unavailable', 'timeout'] as const) {
  test(`${mode} tracked retry recovers ${failure} discovery without refetching successful metadata`, async () => {
    const secondId = '01234567890';
    const calls: string[] = [];
    let restored = false;
    const discover = async (id: string) => {
      calls.push(id);
      if (!restored && (id === channel2 || id === secondId)) {
        if (failure === 'timeout') return new Promise<never>(() => {});
        throw new Error('Metadata access unavailable');
      }
      return id === channel2 || id === secondId ? { ...metadata, videoId: secondId, channelId: channel2, sourceUrl: `https://www.youtube.com/watch?v=${secondId}` } : metadata;
    };
    provider.recent = mock(async id => ({ videos: [await discover(id)], complete: true }));
    provider.video = mock(discover);
    provider.transcript = mock(async (_root, id) => ({ videoId: id, provider: 'fixture', segments: [{ start: 0, end: 1, text: 'Useful finding.' }] }));
    service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now, preparationTimeoutMs: 40 });
    await configure(true);
    const queued = await service.start('hq', { track: 'your-world', mode, idempotencyKey: 'recover', links: [metadata.sourceUrl, `https://youtu.be/${secondId}`] });
    const original = readSignals(root, 'hq').requests[0]!;
    const slug = mode === 'links' ? 'signal-video-review' : 'weekly-world-scan';
    await expect(service.startAdmitted('hq', queued.orderIds[0]!, slug, original.workflowDigest, { signalRequestId: queued.runId }, async () => { throw new Error('Stop before workflow creation'); })).rejects.toThrow();
    const captured = readSignals(root, 'hq').requests[0]!.packets.map(packet => packet.contentHash);
    restored = true;
    const current = readSignals(root, 'hq').tracks['your-world'];
    await service.saveConfig('hq', 'your-world', { ...current, sources: [] }, current.revision);
    service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => '2026-09-15T12:00:00.000Z' });
    orderStatus('scheduled');
    const start = mock(async (_workflow: unknown, request: SignalRequest) => ({ id: request.identity.workflowRunId }));
    await service.startAdmitted('hq', queued.orderIds[0]!, slug, original.workflowDigest, { signalRequestId: queued.runId }, start);
    const saved = readSignals(root, 'hq').requests[0]!;
    expect(saved.config).toEqual(original.config); expect(saved.createdAt).toBe(original.createdAt);
    expect(saved.identity.workflowRunId).toBe(original.identity.workflowRunId);
    expect(saved.identity.requestedVideoIds.sort()).toEqual([videoId, secondId].sort());
    expect(saved.coverage).toHaveLength(2); expect(saved.coverage.every(item => item.status === 'checked')).toBe(true);
    expect(saved.packets).toHaveLength(2); expect(saved.packets.map(packet => packet.contentHash)).toEqual(expect.arrayContaining(captured));
    expect(calls).toEqual(mode === 'scan' ? [channelId, channel2, channel2] : [videoId, secondId, secondId]);
    expect(provider.transcript).toHaveBeenCalledTimes(2); expect(start).toHaveBeenCalledTimes(1);
    await service.prepare('hq', saved.runId, saved.orderIds[0]!, saved.workflowDigest);
    expect(calls).toHaveLength(3); expect(provider.transcript).toHaveBeenCalledTimes(2);
  });
}

for (const failure of ['throws', 'unavailable-packet'] as const) test(`Industry recovery replaces only ${failure} website receipt`, async () => {
  let restored = false;
  const websiteCalls: string[] = [];
  const unavailableUrl = SIGNAL_WEBSITE_SOURCES[0];
  provider.website = async url => {
    websiteCalls.push(url);
    if (url === unavailableUrl && !restored && failure === 'throws') throw new Error('offline');
    return { version: 1, sourceUrl: url, checkedAt: now, windowStart: '2026-09-01T12:00:00.000Z', windowEnd: now,
      status: url === unavailableUrl && !restored ? 'unavailable' : url === SIGNAL_WEBSITE_SOURCES[1] ? 'incomplete' : 'checked', items: [], truncated: false } satisfies SignalWebsitePacket;
  };
  const queued = await service.start('hq', { track: 'industry', mode: 'scan', idempotencyKey: 'web-recovery' });
  const original = readSignals(root, 'hq').requests[0]!;
  await expect(service.startAdmitted('hq', queued.orderIds[0]!, 'signals-industry-scan', original.workflowDigest, { signalRequestId: queued.runId }, async () => { throw new Error('Start failed'); })).rejects.toThrow();
  const captured = readSignals(root, 'hq').requests[0]!.websites.filter(packet => packet.url !== unavailableUrl).map(packet => packet.contentHash);
  restored = true; orderStatus('scheduled');
  await service.startAdmitted('hq', queued.orderIds[0]!, 'signals-industry-scan', original.workflowDigest, { signalRequestId: queued.runId }, async (_workflow, request) => ({ id: request.identity.workflowRunId }));
  const saved = readSignals(root, 'hq').requests[0]!;
  expect(websiteCalls).toEqual([...SIGNAL_WEBSITE_SOURCES, unavailableUrl]);
  expect(saved.coverage).toHaveLength(7); expect(saved.websites).toHaveLength(7);
  expect(saved.websites.map(packet => packet.contentHash)).toEqual(expect.arrayContaining(captured));
  expect(saved.coverage.find(source => source.sourceId === 'web:0')!.status).toBe('checked');
  expect(saved.coverage.find(source => source.sourceId === 'web:1')!.status).toBe('incomplete');
});

for (const explicitEmpty of [false, true]) test(`synthesis ${explicitEmpty ? 'explicitly examines' : 'omits'} a collected video in final coverage`, async () => {
  const secondId = '01234567890';
  provider.recent = mock(async id => ({ videos: [{ ...metadata, channelId: id, videoId: id === channelId ? videoId : secondId, sourceUrl: `https://www.youtube.com/watch?v=${id === channelId ? videoId : secondId}` }], complete: true }));
  provider.transcript = mock(async (_root, id) => ({ videoId: id, provider: 'fixture', segments: [{ start: 0, end: 1, text: 'Useful finding.' }] }));
  const request = await prepared(true);
  const snapshot = run(request, { ...report(), ...(explicitEmpty ? { examinedVideoIds: [videoId, secondId], noFindingVideoIds: [secondId] } : {}) });
  workflows.writeRun(root, snapshot); await service.complete(snapshot, new AbortController().signal);
  const saved = readSignals(root, 'hq').requests[0]!;
  const reportMetadata = readEvidence<SignalReportMetadata>(root, saved.reportMetadataHash!);
  expect(saved.status).toBe(explicitEmpty ? 'report' : 'partial');
  expect(reportMetadata.coverageStatus).toBe(explicitEmpty ? 'complete' : 'partial');
  expect(reportMetadata.warnings.join(' ')).toBe(explicitEmpty ? '' : `Videos without a validated synthesis outcome: ${secondId}.`);
  expect(readSignals(root, 'hq').ledger).toHaveLength(explicitEmpty ? 2 : 1);
});

for (const mode of ['scan', 'links'] as const) for (const failedPhase of ['metadata', 'transcript'] as const) {
  test(`actual ${mode} workflow retry refreshes ${failedPhase} evidence and restarts analysis once`, async () => {
    const secondId = '01234567890';
    let restored = false;
    const discover = async (id: string) => {
      if (!restored && failedPhase === 'metadata' && (id === channel2 || id === secondId)) throw new Error('Metadata access unavailable');
      return id === channel2 || id === secondId ? { ...metadata, videoId: secondId, channelId: channel2, sourceUrl: `https://www.youtube.com/watch?v=${secondId}` } : metadata;
    };
    provider.recent = mock(async id => ({ videos: [await discover(id)], complete: true }));
    provider.video = mock(discover);
    provider.transcript = mock(async (_root, id) => {
      if (!restored && failedPhase === 'transcript' && id === secondId) throw new Error('Transcript unavailable');
      return { videoId: id, provider: 'fixture', segments: [{ start: 0, end: 1, text: `Evidence for ${id}` }] };
    });
    await configure(true);
    const queued = await service.start('hq', { track: 'your-world', mode, idempotencyKey: 'workflow-recovery', links: [metadata.sourceUrl, `https://youtu.be/${secondId}`] });
    const pending = readSignals(root, 'hq').requests[0]!;
    const request = await service.prepare('hq', queued.runId, queued.orderIds[0]!, pending.workflowDigest);
    const original = run(request, undefined, 'failed');
    original.steps = [{ id: 'youtube-intel', state: 'succeeded', attempts: 1, output: 'Old partial analysis' }, { id: 'synthesize', state: 'failed', attempts: 1 }];
    workflows.writeRun(root, original); trackRun(original);
    const capturedHash = request.packets[0]!.contentHash;
    restored = true;
    const events: WorkflowRunEvent[] = [];
    const prompts: string[] = [];
    const runner = new WorkflowRunner({
      // Production supplies this resolver for the contract's explicit task modes.
      resolveAgentSessionOptions: async (_workspaceId, agentSlug, options) => {
        if (agentSlug === 'youtube-intelligence-agent') expect(options?.taskModeId).toBe('weekly-intelligence');
        return {};
      },
      createSession: async () => ({ id: randomUUID() }),
      sendMessage: async (_id, prompt) => { prompts.push(prompt); },
      getLastAssistantText: () => prompts.length === 1 ? 'Fresh analysis of both videos' : JSON.stringify({ ...report(), examinedVideoIds: [videoId, secondId], noFindingVideoIds: [secondId] }),
      getSessionToolUseCount: () => 0, abortSession: async () => {}, getWorkspaceRootPath: () => root,
      authorizeRerun: (old, next, signal) => service.authorizeRetry(old, next, signal),
      completeWithoutSteps: (snapshot, signal) => service.completeEmpty(snapshot, signal),
      postProcessSucceededRun: async (snapshot, signal) => { await service.complete(snapshot, signal); }, emit: event => events.push(event) });
    const retry = await runner.rerunFromStep({ workspaceId: 'hq', runId: original.id, stepId: 'synthesize' });
    for (let i = 0; i < 100 && !events.some(event => event.type === 'run.completed'); i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain(`Evidence for ${secondId}`);
    expect(prompts[1]).toContain('Fresh analysis of both videos');
    expect(events.find(event => event.type === 'run.completed')?.run.state).toBe('succeeded');
    await service.reconcile('hq');
    const saved = readSignals(root, 'hq').requests[0]!;
    expect(saved.status).toBe('report'); expect(saved.config).toEqual(request.config);
    expect(saved.identity.workflowRunId).toBe(request.identity.workflowRunId);
    expect(saved.packets.some(packet => packet.contentHash === capturedHash)).toBe(true);
    expect(saved.attempts).toEqual([{ fromRunId: original.id, runId: retry.id }]);
    expect(workflows.readRun(root, original.id)!.trigger).toEqual(original.trigger);
    expect(workflows.readRun(root, original.id)!.steps).toEqual(original.steps);
    expect(mode === 'scan' ? provider.recent : provider.video).toHaveBeenCalledTimes(failedPhase === 'metadata' ? 3 : 2);
    expect(provider.transcript).toHaveBeenCalledTimes(failedPhase === 'transcript' ? 3 : 2);
    expect(provider.transcript).toHaveBeenLastCalledWith(root, secondId, expect.any(AbortSignal), retry.id);
    if (failedPhase === 'metadata') expect(mode === 'scan' ? provider.recent : provider.video)
      .toHaveBeenLastCalledWith(mode === 'scan' ? channel2 : secondId, expect.any(AbortSignal), root, retry.id);
    expect(saved.coverage).toHaveLength(2); expect(saved.coverage.every(item => item.status === 'checked')).toBe(true);
  });
}

test('recovered retry admission is idempotent and rejects altered trigger inputs', async () => {
  let restored = false;
  provider.recent = mock(async () => {
    if (!restored) throw new Error('Metadata access unavailable');
    return { videos: [metadata], complete: true };
  });
  const request = await prepared();
  const original = run(request, undefined, 'failed'); workflows.writeRun(root, original); trackRun(original);
  const retry = persistRetry(original); restored = true;
  const [first, second] = await Promise.all([service.authorizeRetry(original, retry), service.authorizeRetry(original, retry)]);
  expect(first?.trigger.inputs.signalPacket).toContain(videoId);
  expect(second).toEqual(first);
  expect(provider.recent).toHaveBeenCalledTimes(2); expect(provider.transcript).toHaveBeenCalledTimes(1);
  expect(readSignals(root, 'hq').requests[0]!.attempts).toHaveLength(1);
  const work = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'hq');
  if (!work.ok) throw new Error('Missing work');
  expect(work.work.items[0]!.runs).toHaveLength(2);
  await expect(service.authorizeRetry(original, { ...retry, trigger: { ...retry.trigger, inputs: { ...retry.trigger.inputs, artist_name: 'tampered' } } })).rejects.toThrow('provenance');
  expect(provider.recent).toHaveBeenCalledTimes(2);
});

test('cancelled collection recovery preserves valid evidence and resumes through a new admitted attempt', async () => {
  let phase: 'initial' | 'cancel' | 'recover' = 'initial';
  let reached!: () => void;
  const collecting = new Promise<void>(resolve => { reached = resolve; });
  const secondId = '01234567890';
  provider.recent = mock(async id => ({ videos: [{ ...metadata, channelId: id, videoId: id === channelId ? videoId : secondId, sourceUrl: `https://www.youtube.com/watch?v=${id === channelId ? videoId : secondId}` }], complete: true }));
  provider.transcript = mock(async (_root, id) => {
    if (id === secondId && phase === 'initial') throw new Error('Transcript unavailable');
    if (id === secondId && phase === 'cancel') { reached(); return new Promise<never>(() => {}); }
    return { videoId: id, provider: 'fixture', segments: [{ start: 0, end: 1, text: 'Useful finding.' }] };
  });
  const request = await prepared(true);
  const original = run(request, undefined, 'failed'); workflows.writeRun(root, original); trackRun(original);
  const retry = persistRetry(original); phase = 'cancel';
  const controller = new AbortController();
  const pending = service.authorizeRetry(original, retry, controller.signal);
  const rejected = expect(pending).rejects.toThrow('preparation failed');
  await collecting; controller.abort(); await rejected;
  const cancelled = readSignals(root, 'hq').requests[0]!;
  expect(cancelled.collectionComplete).toBe(false); expect(cancelled.packets).toHaveLength(1);
  expect(cancelled.packets[0]!.contentHash).toBe(request.packets[0]!.contentHash);
  expect(readSignals(root, 'hq').ledger).toHaveLength(0);
  const interrupted = { ...workflows.readRun(root, retry.id)!, state: 'interrupted' as const };
  workflows.writeRun(root, interrupted);
  const next = persistRetry(interrupted); phase = 'recover';
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now,
    admitRetry: (old, fresh, ids) => trackedRunner.admitSignalWorkflowRetry(root, old, fresh, ids) });
  const refreshed = await service.authorizeRetry(interrupted, next);
  expect(refreshed?.trigger.inputs.signalPacket).toContain(secondId);
  expect(readSignals(root, 'hq').requests[0]!.packets).toHaveLength(2);
  expect(provider.recent).toHaveBeenCalledTimes(2);
  expect(provider.transcript).toHaveBeenCalledTimes(4);
});

test('retry after a pre-admission crash collects only for the current attempt', async () => {
  let restored = false;
  provider.recent = mock(async () => {
    if (!restored) throw new Error('Metadata unavailable');
    return { videos: [metadata], complete: true };
  });
  const request = await prepared();
  const original = run(request, undefined, 'failed'); workflows.writeRun(root, original); trackRun(original);
  const crashed = { ...persistRetry(original), state: 'interrupted' as const };
  workflows.writeRun(root, crashed);
  const next = persistRetry(crashed); restored = true;
  const refreshed = await service.authorizeRetry(crashed, next);
  expect(refreshed?.trigger.inputs.signalPacket).toContain(videoId);
  expect(workflows.readRun(root, crashed.id)!.trigger).toEqual(crashed.trigger);
  expect(provider.recent).toHaveBeenCalledTimes(2);
  expect(provider.transcript).toHaveBeenCalledTimes(1);
  expect(readSignals(root, 'hq').requests[0]!.workflowRunId).toBe(next.id);
});

for (const phase of ['metadata', 'transcript'] as const) test(`status reads never recover paid ${phase}; explicit runner retry does`, async () => {
  let restored = false;
  provider.recent = mock(async () => {
    if (!restored && phase === 'metadata') throw new Error('Metadata unavailable');
    return { videos: [metadata], complete: true };
  });
  provider.transcript = mock(async () => {
    if (!restored && phase === 'transcript') throw new Error('Transcript unavailable');
    return { videoId, provider: 'fixture', segments: [{ start: 0, end: 10, text: 'Useful finding.' }] };
  });
  const request = await prepared();
  const original = run(request, undefined, 'failed');
  original.steps = [{ id: 'youtube-intel', state: 'succeeded', attempts: 1, output: 'Old analysis' }, { id: 'synthesize', state: 'failed', attempts: 1 }];
  workflows.writeRun(root, original); trackRun(original);
  let orphan = persistRetry(original);
  const admitRetry = mock((old: WorkflowRunSnapshot, next: WorkflowRunSnapshot, ids: string[]) => trackedRunner.admitSignalWorkflowRetry(root, old, next, ids));
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now, admitRetry });
  restored = true; permission.mockClear();
  const events: WorkflowRunEvent[] = [];
  const runner = new WorkflowRunner({
    // Production supplies this resolver for the contract's explicit task modes.
    resolveAgentSessionOptions: async (_workspaceId, agentSlug, options) => {
      if (agentSlug === 'youtube-intelligence-agent') expect(options?.taskModeId).toBe('weekly-intelligence');
      return {};
    },
    createSession: async () => ({ id: randomUUID() }), sendMessage: async () => {},
    getLastAssistantText: () => JSON.stringify(report()), abortSession: async () => {}, getWorkspaceRootPath: () => root,
    authorizeRerun: async (old, next, signal) => {
      const refreshed = await service.authorizeRetry(old, next, signal);
      expect(await service.authorizeRetry(old, next, signal)).toEqual(refreshed);
      return refreshed;
    },
    completeWithoutSteps: (snapshot, signal) => service.completeEmpty(snapshot, signal),
    postProcessSucceededRun: async (snapshot, signal) => { await service.complete(snapshot, signal); }, emit: event => events.push(event) });
  for (const restarted of [false, true]) {
    if (restarted) {
      expect(runner.recoverInterruptedRuns([{ id: 'hq', rootPath: root }]).map(run => run.id)).toContain(orphan.id);
      expect(workflows.readRun(root, orphan.id)!.state).toBe('interrupted');
    }
    await service.getState('hq'); await service.getState('hq'); await service.reconcile('hq');
    expect(provider.recent).toHaveBeenCalledTimes(1);
    expect(provider.transcript).toHaveBeenCalledTimes(phase === 'metadata' ? 0 : 1);
    expect(admitRetry).toHaveBeenCalledTimes(0);
    expect(permission).toHaveBeenCalledTimes(0);
    const saved = readSignals(root, 'hq').requests[0]!;
    expect(saved.workflowRunId ?? saved.identity.workflowRunId).toBe(original.id);
    expect(saved.attempts ?? []).toHaveLength(0);
    expect(workflows.readRun(root, orphan.id)!.trigger).toEqual(orphan.trigger);
  }
  // A second host can also crash before its retry admission callback runs.
  orphan = persistRetry(workflows.readRun(root, orphan.id)!);
  expect(runner.recoverInterruptedRuns([{ id: 'hq', rootPath: root }]).map(run => run.id)).toContain(orphan.id);
  await service.getState('hq');
  expect(admitRetry).toHaveBeenCalledTimes(0);
  events.length = 0;
  const retry = await runner.rerunFromStep({ workspaceId: 'hq', runId: orphan.id, stepId: 'synthesize' });
  for (let i = 0; i < 100 && !events.some(event => event.type === 'run.completed'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(events.find(event => event.type === 'run.completed')?.run.state).toBe('succeeded');
  expect(provider.recent).toHaveBeenCalledTimes(phase === 'metadata' ? 2 : 1);
  expect(provider.transcript).toHaveBeenCalledTimes(phase === 'metadata' ? 1 : 2);
  expect(provider.transcript).toHaveBeenLastCalledWith(root, videoId, expect.any(AbortSignal), retry.id);
  expect(readSignals(root, 'hq').requests[0]!.workflowRunId).toBe(retry.id);
  await service.getState('hq');
  expect(provider.transcript).toHaveBeenCalledTimes(phase === 'metadata' ? 1 : 2);
});

for (const tamper of ['trigger', 'reciprocal', 'too-long'] as const) test(`restart retry lineage rejects ${tamper} before admission or collection`, async () => {
  const request = await prepared();
  const original = run(request, undefined, 'failed'); workflows.writeRun(root, original); trackRun(original);
  let previous = original;
  for (let index = 0; index < (tamper === 'too-long' ? 65 : 2); index++) {
    previous = { ...persistRetry(previous), state: 'interrupted' };
    workflows.writeRun(root, previous);
  }
  const retry = persistRetry(previous);
  const first = workflows.readRun(root, workflows.readRun(root, original.id)!.resumedByRunId!)!;
  if (tamper === 'trigger') workflows.writeRun(root, { ...first, trigger: { ...first.trigger, inputs: { ...first.trigger.inputs, artist_name: 'altered' } } });
  if (tamper === 'reciprocal') workflows.writeRun(root, { ...workflows.readRun(root, original.id)!, resumedByRunId: randomUUID() });
  const admitRetry = mock(async () => {});
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now, admitRetry });
  await expect(service.authorizeRetry(previous, retry)).rejects.toThrow('provenance');
  expect(admitRetry).toHaveBeenCalledTimes(0);
  expect(provider.recent).toHaveBeenCalledTimes(1);
  expect(provider.transcript).toHaveBeenCalledTimes(1);
  expect(readSignals(root, 'hq').requests[0]!.workflowRunId ?? request.identity.workflowRunId).toBe(original.id);
});

test('provider entry points receive the HQ root and deliberate host attempt scope', async () => {
  const scopes: Array<string | undefined> = [];
  provider.resolveChannel = mock(async (_url: string, _root?: string, scope?: string) => {
    scopes.push(scope);
    return { channelId, url: `https://www.youtube.com/channel/${channelId}`, name: 'Fixture', priority: 'medium' as const };
  });
  await service.resolveChannel('hq', '@fixture');
  const initial = readSignals(root, 'hq').tracks['your-world'];
  await service.saveConfig('hq', 'your-world', { ...initial, sources: [{ channelId, url: 'https://www.youtube.com/@fixture', name: 'Fixture', priority: 'medium' }] }, initial.revision);
  expect(provider.resolveChannel).toHaveBeenNthCalledWith(1, '@fixture', root, expect.stringMatching(/^[a-f0-9-]{36}$/));
  expect(provider.resolveChannel).toHaveBeenNthCalledWith(2, 'https://www.youtube.com/@fixture', root, expect.stringMatching(/^[a-f0-9-]{36}$/));
  expect(scopes[0]).not.toBe(scopes[1]);
  const queued = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'scoped' });
  const request = readSignals(root, 'hq').requests[0]!;
  await service.prepare('hq', queued.runId, queued.orderIds[0]!, request.workflowDigest);
  expect(provider.recent).toHaveBeenCalledWith(channelId, expect.any(AbortSignal), root, request.identity.workflowRunId);
  expect(provider.transcript).toHaveBeenCalledWith(root, videoId, expect.any(AbortSignal), request.identity.workflowRunId);
  const links = await service.start('hq', { track: 'your-world', mode: 'links', idempotencyKey: 'scoped-links', links: [metadata.sourceUrl] });
  const linkRequest = readSignals(root, 'hq').requests.find(item => item.runId === links.runId)!;
  await service.prepare('hq', links.runId, links.orderIds[0]!, linkRequest.workflowDigest);
  expect(provider.video).toHaveBeenCalledWith(videoId, expect.any(AbortSignal), root, linkRequest.identity.workflowRunId);
  expect(provider.transcript).toHaveBeenCalledWith(root, videoId, expect.any(AbortSignal), linkRequest.identity.workflowRunId);
});

test('channel resolution requires external execution permission but canonical offline edits do not', async () => {
  await configure();
  permission.mockImplementation((_root: string, action: string) => {
    if (action === 'automation.external.execute') throw new Error('External execution denied');
  });
  await expect(service.resolveChannel('hq', '@fixture')).rejects.toThrow('External execution denied');
  const current = readSignals(root, 'hq').tracks['your-world'];
  await expect(service.saveConfig('hq', 'your-world', { ...current, sources: [{ ...current.sources[0]!, url: 'https://www.youtube.com/@fixture' }] }, current.revision)).rejects.toThrow('External execution denied');
  expect(provider.resolveChannel).toHaveBeenCalledTimes(0);
  await service.saveConfig('hq', 'your-world', { ...current, enabled: false, sources: current.sources.map(source => ({ ...source, notes: 'Offline edit' })) }, current.revision);
  expect(readSignals(root, 'hq').tracks['your-world'].sources[0]!.notes).toBe('Offline edit');
});

test('superseded collection cannot overwrite or fail the newer attempt', async () => {
  await configure();
  const queued = await service.start('hq', { track: 'your-world', mode: 'scan', idempotencyKey: 'superseded' });
  const request = readSignals(root, 'hq').requests[0]!;
  const nextId = randomUUID();
  provider.transcript = mock(async () => {
    const state = readSignals(root, 'hq'); state.requests[0]!.workflowRunId = nextId; state.requests[0]!.status = 'running'; writeSignals(root, state);
    return { videoId, provider: 'fixture', segments: [{ start: 0, end: 1, text: 'Old attempt evidence' }] };
  });
  await expect(service.prepare('hq', request.runId, queued.orderIds[0]!, request.workflowDigest)).rejects.toThrow();
  const saved = readSignals(root, 'hq').requests[0]!;
  expect(saved.workflowRunId).toBe(nextId); expect(saved.status).toBe('running');
  expect(saved.error).toBeUndefined(); expect(saved.packets).toHaveLength(0);
});

test('pre-recovery journal retains valid metadata and packets without provider rediscovery', async () => {
  const request = await prepared();
  const journal = JSON.parse(readFileSync(join(root, 'signals/state.json'), 'utf8'));
  delete journal.requests[0].discovery;
  journal.requests[0].status = 'failed'; journal.requests[0].coverage[0].status = 'unavailable';
  writeFileSync(join(root, 'signals/state.json'), JSON.stringify(journal));
  orderStatus('scheduled');
  await service.startAdmitted('hq', request.orderIds[0]!, 'weekly-world-scan', request.workflowDigest, { signalRequestId: request.runId }, async (_workflow, prepared) => ({ id: prepared.identity.workflowRunId }));
  const saved = readSignals(root, 'hq').requests[0]!;
  expect(provider.recent).toHaveBeenCalledTimes(1); expect(provider.transcript).toHaveBeenCalledTimes(1);
  expect(saved.packets[0]!.contentHash).toBe(request.packets[0]!.contentHash);
  expect(saved.coverage[0]!.status).toBe('incomplete');
});

for (const originalState of ['failed', 'interrupted', 'retry-crash', 'projection-crash'] as const) test(`actual rerunFromStep authorizes ${originalState} synthesis without recollection`, async () => {
  const request = await prepared();
  const crash = originalState === 'retry-crash' || originalState === 'projection-crash';
  let original = run(request, undefined, crash ? 'failed' : originalState);
  original.steps = [{ id: 'youtube-intel', state: 'succeeded', attempts: 1, output: 'Useful finding.' }, { id: 'synthesize', state: crash ? 'interrupted' : originalState, attempts: 1 }];
  trackRun(original);
  if (crash) {
    const crashId = randomUUID();
    workflows.writeRun(root, { ...original, resumedByRunId: crashId });
    original = { ...original, id: crashId, state: 'interrupted', resumedFromRunId: original.id };
  }
  workflows.writeRun(root, original);
  if (originalState === 'projection-crash') { trackRun(original); orderStatus('running'); }
  const events: WorkflowRunEvent[] = [];
  let laneOccupied = false;
  let trackedAttempt: string | undefined;
  const runner = new WorkflowRunner({ createSession: async () => {
    laneOccupied = await trackedRunner.isBackgroundLaneOccupied(root, 'hq');
    const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'hq');
    if (parsed.ok) { expect(parsed.work.items[0]!.status).toBe('running'); trackedAttempt = parsed.work.items[0]!.runs.at(-1)?.workflowRunId; }
    return { id: 'retry-session' };
  }, sendMessage: async () => {}, getLastAssistantText: () => JSON.stringify(report()), getSessionToolUseCount: () => 0, abortSession: async () => {}, getWorkspaceRootPath: () => root,
    authorizeRerun: (old, next) => service.authorizeRetry(old, next), completeWithoutSteps: (snapshot, signal) => service.completeEmpty(snapshot, signal),
    postProcessSucceededRun: async (snapshot, signal) => { await service.complete(snapshot, signal); }, emit: event => { events.push(event); } });
  const retry = await runner.rerunFromStep({ workspaceId: 'hq', runId: original.id, stepId: 'synthesize' });
  for (let i = 0; i < 100 && !events.some(event => event.type === 'run.completed'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(events.find(event => event.type === 'run.completed')?.run.state).toBe('succeeded');
  expect(laneOccupied).toBe(true); expect(trackedAttempt).toBe(retry.id);
  await service.reconcile('hq');
  const saved = readSignals(root, 'hq').requests[0]!;
  expect(saved.workflowRunId).toBe(retry.id);
  expect(saved.identity.workflowRunId).toBe(request.identity.workflowRunId);
  expect(saved.attempts?.at(-1)).toEqual({ fromRunId: original.id, runId: retry.id });
  expect(saved.attempts).toHaveLength(crash ? 2 : 1);
  expect(saved.status).toBe('report');
  const metadata = readEvidence<SignalReportMetadata>(root, saved.reportMetadataHash!);
  expect(metadata.identity.workflowRunId).toBe(retry.id);
  expect(metadata.outputId).toBe(saved.outputId!);
  expect(provider.transcript).toHaveBeenCalledTimes(1);
  expect(provider.recent).toHaveBeenCalledTimes(1);
  await expect(service.completeEmpty({ ...retry, id: '00000000-0000-4000-8000-000000000000' }, new AbortController().signal)).rejects.toThrow('provenance');
});

for (const blocked of ['lane', 'approval', 'digest'] as const) test(`actual generic retry respects tracked ${blocked} admission gate`, async () => {
  const request = await prepared();
  const original = run(request, undefined, 'failed');
  original.steps = [{ id: 'youtube-intel', state: 'succeeded', attempts: 1, output: 'analysis' }, { id: 'synthesize', state: 'failed', attempts: 1 }];
  workflows.writeRun(root, original); trackRun(original);
  if (blocked === 'lane') externalBusy = true;
  if (blocked === 'approval') orderStatus('needs-approval');
  const definition = definitions.find(item => item.slug === original.workflowSlug)!;
  const body = definition.body;
  if (blocked === 'digest') definition.body += '\nChanged after approval';
  const createSession = mock(async () => ({ id: 'must-not-start' }));
  const runner = new WorkflowRunner({ createSession, sendMessage: async () => {}, getLastAssistantText: () => '', abortSession: async () => {}, getWorkspaceRootPath: () => root,
    authorizeRerun: (old, next) => service.authorizeRetry(old, next), completeWithoutSteps: (snapshot, signal) => service.completeEmpty(snapshot, signal) });
  try {
    await expect(runner.rerunFromStep({ workspaceId: 'hq', runId: original.id, stepId: 'synthesize' })).rejects.toThrow();
    expect(createSession).toHaveBeenCalledTimes(0);
    expect(readSignals(root, 'hq').requests[0]!.workflowRunId).toBe(original.id);
  } finally { definition.body = body; }
});

for (const tamper of [undefined, 'refusal-crash', 'trigger', 'snapshot', 'reciprocal', 'journal'] as const) test(`retry after repeated lane refusals: ${tamper ?? 'restart success'}`, async () => {
  const request = await prepared();
  const original = run(request, undefined, 'failed');
  original.steps = [{ id: 'youtube-intel', state: 'succeeded', attempts: 1, output: 'analysis' }, { id: 'synthesize', state: 'failed', attempts: 1 }];
  workflows.writeRun(root, original); trackRun(original);
  const events: WorkflowRunEvent[] = [];
  const createSession = mock(async () => ({ id: 'admitted-final' }));
  const runner = new WorkflowRunner({ createSession, sendMessage: async () => {}, getLastAssistantText: () => JSON.stringify(report()), abortSession: async () => {}, getWorkspaceRootPath: () => root,
    authorizeRerun: (old, next) => service.authorizeRetry(old, next), completeWithoutSteps: (snapshot, signal) => service.completeEmpty(snapshot, signal),
    postProcessSucceededRun: async (snapshot, signal) => { await service.complete(snapshot, signal); }, emit: event => events.push(event) });
  externalBusy = true;
  let refused = original;
  for (let index = 0; index < 3; index++) {
    await expect(runner.rerunFromStep({ workspaceId: 'hq', runId: refused.id, stepId: 'synthesize' })).rejects.toThrow('background lane');
    refused = workflows.readRun(root, workflows.readRun(root, refused.id)!.resumedByRunId!)!;
    expect(refused.state).toBe('failed');
    expect(readSignals(root, 'hq').requests[0]!.workflowRunId).toBe(original.id);
  }
  expect(createSession).toHaveBeenCalledTimes(0);
  expect(readSignals(root, 'hq').requests[0]!.refusedAttempts).toHaveLength(3);
  externalBusy = false;
  if (tamper === 'refusal-crash') workflows.writeRun(root, { ...refused, state: 'interrupted' });
  if (tamper === 'trigger') workflows.writeRun(root, { ...refused, trigger: { ...refused.trigger, inputs: { ...refused.trigger.inputs, artist_name: 'altered' } } });
  if (tamper === 'snapshot') workflows.writeRun(root, { ...refused, workflowSnapshot: { ...refused.workflowSnapshot, body: 'altered' } });
  if (tamper === 'reciprocal') { const parent = workflows.readRun(root, refused.resumedFromRunId!)!; workflows.writeRun(root, { ...parent, resumedByRunId: randomUUID() }); }
  if (tamper === 'journal') { const state = readSignals(root, 'hq'); state.requests[0]!.refusedAttempts = []; writeSignals(root, state); }
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now,
    admitRetry: (old, next, ids) => trackedRunner.admitSignalWorkflowRetry(root, old, next, ids) });
  await service.reconcile('hq');
  expect(readSignals(root, 'hq').requests[0]!.workflowRunId).toBe(original.id);
  if (tamper && tamper !== 'refusal-crash') {
    await expect(runner.rerunFromStep({ workspaceId: 'hq', runId: refused.id, stepId: 'synthesize' })).rejects.toThrow('provenance');
    expect(createSession).toHaveBeenCalledTimes(0);
  } else {
    const final = await runner.rerunFromStep({ workspaceId: 'hq', runId: refused.id, stepId: 'synthesize' });
    for (let index = 0; index < 100 && !events.some(event => event.type === 'run.completed'); index++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(events.find(event => event.type === 'run.completed')?.run.state).toBe('succeeded');
    expect(createSession).toHaveBeenCalledTimes(1);
    const state = readSignals(root, 'hq'); expect(state.requests[0]!.workflowRunId).toBe(final.id);
    expect(state.requests[0]!.attempts).toEqual([{ fromRunId: refused.id, runId: final.id }]);
    const work = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, 'hq');
    if (!work.ok) throw new Error('Missing tracked work');
    expect(work.work.items[0]!.runs).toHaveLength(2);
    expect(work.work.items[0]!.runs.at(-1)?.workflowRunId).toBe(final.id);
    expect(provider.transcript).toHaveBeenCalledTimes(1);
  }
});
for (const covered of [false, true]) test(`parser to completion accepts mixed new and ${covered ? 'covered' : 'empty'} channels`, async () => {
  const oldId = 'oldvideo123';
  provider.recent = mock(async id => ({ videos: id === channelId ? [metadata] : covered ? [{ ...metadata, videoId: oldId, channelId: channel2, sourceUrl: `https://www.youtube.com/watch?v=${oldId}` }] : [], complete: true }));
  if (covered) {
    const state = readSignals(root, 'hq');
    state.ledger.push({ hqWorkspaceId: 'hq', track: 'your-world', videoId: oldId, runId: 'previous', outcome: 'examined-no-finding', finalizedAt: now, evidencePacketId: 'old' });
    writeSignals(root, state);
  }
  const request = await prepared(true);
  const snapshot = run(request, empty); workflows.writeRun(root, snapshot);
  await service.complete(snapshot, new AbortController().signal);
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('no-change');
  expect(readSignals(root, 'hq').ledger.some(entry => entry.videoId === videoId && entry.outcome === 'examined-no-finding')).toBe(true);
});
test('empty fast path waits for persisted success and cancellation does not finalize', async () => {
  provider.recent = mock(async () => ({ videos: [], complete: true }));
  const request = await prepared();
  const snapshot = run(request, undefined, 'running'); workflows.writeRun(root, snapshot);
  expect(await service.completeEmpty(snapshot, new AbortController().signal)).toBe(true);
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('running');
  workflows.writeRun(root, { ...snapshot, state: 'cancelled' });
  await service.reconcile('hq');
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('cancelled');
});
test('HQ resolution never chooses the first of multiple HQs', () => {
  const campaign = { ...workspace, id: 'campaign', artistWorkspaceScope: 'campaign' as const };
  expect(resolveSignalHqWorkspace('campaign', [workspace, campaign]).id).toBe('hq');
  expect(() => resolveSignalHqWorkspace('campaign', [workspace, campaign, { ...workspace, id: 'other' }])).toThrow('unambiguous');
});

for (const fresh of [false, true]) test(`production website adapter to Industry lifecycle: ${fresh ? 'dated finding' : 'quiet window'}`, async () => {
  const adapter = new LocalSignalProvider({ fetch: async url => {
    const origin = new URL(url).origin;
    return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><link>${origin}</link>${fresh ? `<item><title>Useful finding</title><link>${origin}/new-story</link><pubDate>Sun, 06 Sep 2026 12:00:00 GMT</pubDate><description>Useful finding.</description></item>` : ''}<item><title>Old</title><link>${origin}/old-story</link><pubDate>Sat, 01 Aug 2026 12:00:00 GMT</pubDate><description>Old information.</description></item></channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } });
  } });
  provider.website = adapter.website.bind(adapter);
  const queued = await service.start('hq', { track: 'industry', mode: 'scan', idempotencyKey: 'industry' });
  const saved = readSignals(root, 'hq').requests[0]!;
  const request = await service.prepare('hq', queued.runId, queued.orderIds[0]!, saved.workflowDigest);
  const packet = JSON.parse(service.packetInput(request));
  expect(packet.websites).toHaveLength(7);
  expect(packet.websites.every((site: { status: string }) => site.status === 'checked')).toBe(true);
  if (!fresh) {
    const snapshot = run(request, undefined); workflows.writeRun(root, snapshot);
    expect(await service.completeEmpty(snapshot, new AbortController().signal)).toBe(true);
    expect(readSignals(root, 'hq').requests[0]!.status).toBe('no-change');
    expect(readSignals(root, 'hq').requests[0]!.outputId).toBeUndefined();
  } else {
    const item = packet.websites[0].items[0];
    expect(item.publishedAt).toBe('2026-09-06T12:00:00.000Z');
    expect(item.url).toBe('https://artists.spotify.com/new-story');
    expect(item.text).not.toContain('<');
    const snapshot = run(request, { ...report([{ ...finding, sourceRefs: [item.id] }]), examinedVideoIds: [] }); workflows.writeRun(root, snapshot);
    await service.complete(snapshot, new AbortController().signal);
    expect(readSignals(root, 'hq').requests[0]!.status).toBe('report');
  }
  expect(provider.recent).toHaveBeenCalledTimes(0);
});

test('YouTube Help fixture reaches synthesis without invented dates and remains partial', async () => {
  const helpUrl = 'https://support.google.com/youtube/answer/9072033?hl=en';
  const html = readFileSync(join(import.meta.dir, 'fixtures/youtube-creator-updates.html'), 'utf8');
  const adapter = new LocalSignalProvider({ fetch: async url => url === helpUrl
    ? new Response(html, { headers: { 'content-type': 'text/html' } })
    : new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><link>${new URL(url).origin}</link><item><title>Old</title><link>${new URL(url).origin}/old</link><pubDate>Sat, 01 Aug 2026 12:00:00 GMT</pubDate><description>Old information.</description></item></channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } }) });
  provider.website = adapter.website.bind(adapter);
  const queued = await service.start('hq', { track: 'industry', mode: 'scan', idempotencyKey: 'youtube-help' });
  const saved = readSignals(root, 'hq').requests[0]!;
  const request = await service.prepare('hq', queued.runId, queued.orderIds[0]!, saved.workflowDigest);
  const packet = JSON.parse(service.packetInput(request));
  const help = packet.websites.find((site: { sourceUrl: string }) => site.sourceUrl === helpUrl);
  expect(help.status).toBe('incomplete'); expect(help.items.length).toBeGreaterThan(0);
  const item = help.items[0];
  expect(item.publishedAt).toBeUndefined(); expect(item.publicationLabel).toBeTruthy();
  expect(item.url).toBe(helpUrl);
  expect(item.text).toContain('Creators');
  const noChange = run(request, { ...empty, examinedVideoIds: [] }); workflows.writeRun(root, noChange);
  await expect(service.complete(noChange, new AbortController().signal)).rejects.toThrow('no-change');
  const excerpt = item.text.slice(0, 300);
  const snapshot = run(request, { ...report([{ ...finding, excerpt, sourceRefs: [item.id] }]), markdown: `# Brief\n${excerpt}`, examinedVideoIds: [] });
  workflows.writeRun(root, snapshot);
  await service.complete(snapshot, new AbortController().signal);
  const state = readSignals(root, 'hq');
  expect(state.requests[0]!.status).toBe('partial');
  expect(state.requests[0]!.outputId).toBeTruthy();
  expect(state.ledger).toHaveLength(0);
});

test('manager publication callback sees saved terminal metadata once, never preparation or ordinary reads', async () => {
  const published = mock((ws: Workspace) => {
    const saved = readSignals(ws.rootPath, ws.id).requests[0]!;
    expect(saved.status).toBe('report');
    expect(saved.reportMetadataHash).toMatch(/^[a-f0-9]{64}$/);
  });
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now, reportPublished: published });
  const request = await prepared();
  expect(published).not.toHaveBeenCalled();
  const snapshot = run(request, report(), 'running'); workflows.writeRun(root, snapshot);
  await service.complete(snapshot, new AbortController().signal);
  expect(published).not.toHaveBeenCalled();
  const succeeded = { ...workflows.readRun(root, snapshot.id)!, state: 'succeeded' as const }; workflows.writeRun(root, succeeded);
  await service.complete(succeeded, new AbortController().signal);
  expect(published).toHaveBeenCalledTimes(1);
  await service.complete(succeeded, new AbortController().signal);
  await service.getState('hq');
  expect(published).toHaveBeenCalledTimes(1);
});

test('manager observer failure does not fail completed report publication', async () => {
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now,
    reportPublished: () => { throw new Error('observer unavailable'); } });
  const request = await prepared();
  const snapshot = run(request, report()); workflows.writeRun(root, snapshot);
  await expect(service.complete(snapshot, new AbortController().signal)).resolves.toBe(true);
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('report');
});


test('ordinary observer failure preserves terminal report publication and manager refresh', async () => {
  const published = mock(() => {});
  const request = await prepared();
  service = new SignalService({ workspaces: () => [workspace], provider, permission, now: () => now,
    changed: () => { throw new Error('output observer disconnected'); }, reportPublished: published });
  const snapshot = run(request, report()); workflows.writeRun(root, snapshot);
  await expect(service.complete(snapshot, new AbortController().signal)).resolves.toBe(true);
  expect(published).toHaveBeenCalledTimes(1);
  expect(readSignals(root, 'hq').requests[0]!.status).toBe('report');
});

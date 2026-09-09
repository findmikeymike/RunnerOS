import { collectManagerSignals } from './signals';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Workspace } from '@craft-agent/core/types';
import { createOutputBundle, getOutputDir } from '@craft-agent/shared/outputs';
import { createSignalContractWorkflow, writeRun, type WorkflowRunSnapshot } from '@craft-agent/shared/workflows';
import type { SignalReportMetadata, SignalTrack, SignalMode, SignalEntryReference } from '@craft-agent/shared/shared-intel';
import { hash, readSignals, writeSignals, saveEvidence, type SignalRequest } from '../signals/storage';

const now = Date.parse('2026-09-07T12:00:00Z');
let root: string;
let hq: Workspace;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'signal-reader-'));
  hq = { id: 'hq', name: 'HQ', rootPath: join(root, 'hq'), artistWorkspaceScope: 'hq', createdAt: now } as Workspace;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function publish(options: { track?: SignalTrack; mode?: SignalMode; title?: string; age?: number; sourceAge?: number | null; temporalKind?: 'evergreen' | 'time-sensitive' | 'unknown'; count?: number } = {}) {
  const track = options.track ?? 'your-world'; const mode = options.mode ?? 'scan';
  const date = new Date(now - (options.age ?? 0) * 86400_000).toISOString();
  const state = readSignals(hq.rootPath, hq.id);
  const runId = randomUUID(); const requestId = randomUUID();
  const workflow = createSignalContractWorkflow(track, mode);
  const identity = { version: 1 as const, hqWorkspaceId: hq.id, track, mode, runId: requestId, workflowRunId: runId, configRevision: 'initial', requestedVideoIds: mode === 'links' ? ['abcdefghijk'] : [] };
  const source = { sourceId: 'website:abc', sourceUrl: 'https://example.com/research', ...(options.sourceAge === null ? {} : { sourcePublishedAt: new Date(now - (options.sourceAge ?? 1) * 86400_000).toISOString() }) };
  const finding = { id: 'finding', title: options.title ?? 'Astronomy discovery', excerpt: 'A telescope observed distant stars.', topics: ['astronomy'], sourceRefs: [source.sourceId], temporalKind: options.temporalKind ?? 'evergreen' as const };
  const ideas = Array.from({ length: options.count ?? 1 }, (_, i) => ({ ...finding, id: `idea-${i}`, title: `${options.title ?? 'Astronomy'} angle ${i}`, excerpt: `Discuss distant stars from your own perspective ${i}.`, supportingFindingIds: ['finding'], suggestedWorkerRoles: ['content-genius'] }));
  const markdown = `# Research\n${finding.excerpt}\n${ideas.map(idea => idea.excerpt).join('\n')}`;
  const output = createOutputBundle(hq.rootPath, { workspaceId: hq.id, kind: 'report', status: 'published', title: 'Renamed report', createdAt: date,
    origin: { source: 'workflow', workflowSlug: workflow.slug, workflowRunId: runId, stepId: 'synthesize' }, content: markdown });
  const run: WorkflowRunSnapshot = { id: runId, workflowSlug: workflow.slug, workspaceId: hq.id, state: 'succeeded', finalOutputId: output.id,
    trigger: { type: 'manual', inputs: { signalContract: 'signals-v1', signalRequestId: requestId, track, mode }, firedAt: date },
    workflowSnapshot: { metadata: workflow.metadata, body: workflow.body }, createdAt: date, updatedAt: date, steps: [] };
  const metadata: SignalReportMetadata = { version: 1, identity, outputId: output.id, contentHash: hash(markdown), createdAt: date, coverageStatus: 'complete', sources: [source], findings: [finding], ideas, warnings: [], indexingStatus: 'ready' };
  const request: SignalRequest = { runId: requestId, track, mode, status: 'report', workflowRunId: runId, orderIds: [], outputId: output.id, createdAt: date, updatedAt: date, identity, config: state.tracks[track],
    idempotencyKey: requestId, requestHash: hash(requestId), workflowDigest: 'fixture', coverage: [], selected: [], packets: [], websites: [], collectionComplete: true, outputHash: hash(markdown) };
  state.requests.push(request);
  const persist = () => { request.reportMetadataHash = hash(metadata); saveEvidence(hq.rootPath, request.reportMetadataHash, metadata); writeSignals(hq.rootPath, state); writeRun(hq.rootPath, run); };
  persist();
  const reference: SignalEntryReference = { hqWorkspaceId: hq.id, outputId: output.id, contentHash: metadata.contentHash, entryId: 'idea-0' };
  return { state, request, metadata, output, run, reference, persist, path: join(getOutputDir(hq.rootPath, output.id), output.primary!.path) };
}

test('collects literal findings from both tracks within the three-finding budget without changing files', () => {
  publish({ track: 'industry' }); publish({ track: 'your-world' }); publish({ track: 'industry', title: 'Other finding' });
  const before = readFileSync(join(hq.rootPath, 'signals/state.json'), 'utf8');
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.findings).toHaveLength(3);
  expect(result.findings.map(finding => finding.track).slice(0, 2)).toEqual(['industry', 'your-world']);
  expect(result.findings.every(finding => finding.excerpt === 'A telescope observed distant stars.')).toBe(true);
  expect(result.findings.every(finding => !('confidence' in finding))).toBe(true);
  expect(readFileSync(join(hq.rootPath, 'signals/state.json'), 'utf8')).toBe(before);
});

test('fresh reports cannot launder stale or future time-sensitive evidence', () => {
  publish({ track: 'industry', temporalKind: 'time-sensitive', sourceAge: 40 });
  publish({ temporalKind: 'time-sensitive', sourceAge: -1 });
  expect(collectManagerSignals(hq.rootPath, hq.id, new Date(now)).findings).toHaveLength(0);
});

test('old reports are excluded even if their findings are evergreen', () => {
  publish({ age: 31 });
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.findings).toHaveLength(0);
  expect(result.sourceHealth.find(health => health.source === 'signals-your-world')?.status).toBe('stale');
});

test('changed report bytes and failed metadata indexing produce unknown health, not false empty success', () => {
  const changed = publish({ track: 'industry' });
  writeFileSync(changed.path, 'Tampered research');
  const unindexed = publish(); unindexed.metadata.indexingStatus = 'failed'; unindexed.persist();
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.findings).toHaveLength(0);
  expect(result.sourceHealth.every(health => health.status === 'unavailable')).toBe(true);
});

test('partial reports retain their coverage label', () => {
  const partial = publish(); partial.metadata.coverageStatus = 'partial'; partial.request.status = 'partial'; partial.persist();
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.findings[0]?.coverageStatus).toBe('partial');
  expect(result.sourceHealth.find(health => health.source === 'signals-your-world')?.status).toBe('partial');
});

test('reads at most three report candidates per track', () => {
  publish({ age: 4 });
  for (const age of [1, 2, 3]) {
    const broken = publish({ age }); writeFileSync(broken.path, 'broken');
  }
  expect(collectManagerSignals(hq.rootPath, hq.id, new Date(now)).findings).toHaveLength(0);
});

test('missing or malformed journals do not break HQ', () => {
  expect(collectManagerSignals(hq.rootPath, hq.id, new Date(now)).findings).toHaveLength(0);
  publish(); writeFileSync(join(hq.rootPath, 'signals/state.json'), '{');
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.sourceHealth.every(health => health.status === 'unavailable')).toBe(true);
});


test('normal bounded history does not manufacture partial coverage', () => {
  for (const age of [1, 2, 3, 4]) publish({ age });
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.sourceHealth.find(health => health.source === 'signals-your-world')?.status).toBe('fresh');
});

test('an empty finding index is unavailable because reports require validated findings', () => {
  const report = publish({ count: 0 }); report.metadata.findings = []; report.persist();
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.findings).toHaveLength(0);
  expect(result.sourceHealth.find(health => health.source === 'signals-your-world')).toMatchObject({ status: 'unavailable' });
});

test('unconfigured, in-progress, and no-change tracks explain their different empty states', () => {
  expect(collectManagerSignals(hq.rootPath, hq.id, new Date(now)).sourceHealth[0]?.message).toContain('not been configured');
  const report = publish(); report.request.status = 'running'; report.persist();
  expect(collectManagerSignals(hq.rootPath, hq.id, new Date(now)).sourceHealth[1]?.message).toContain('still in progress');
  report.request.status = 'no-change'; report.persist();
  expect(collectManagerSignals(hq.rootPath, hq.id, new Date(now)).sourceHealth[1]?.message).toContain('does not renew older findings');
});


test('excluded old partial coverage does not degrade a current complete finding', () => {
  const older = publish({ age: 31 }); older.metadata.coverageStatus = 'partial'; older.request.status = 'partial'; older.persist();
  publish();
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.coverageStatus).toBe('complete');
  expect(result.sourceHealth.find(health => health.source === 'signals-your-world')?.status).toBe('fresh');
});


test('a full fresh report avoids validating unrelated older reports', () => {
  const older = publish({ age: 2 }); writeFileSync(older.path, 'damaged old report');
  const latest = publish();
  latest.metadata.findings = [0, 1, 2].map(index => ({ ...latest.metadata.findings[0]!, id: `finding-${index}` }));
  latest.metadata.ideas = [];
  latest.persist();
  const result = collectManagerSignals(hq.rootPath, hq.id, new Date(now));
  expect(result.findings).toHaveLength(3);
  expect(result.sourceHealth.find(health => health.source === 'signals-your-world')?.status).toBe('fresh');
});

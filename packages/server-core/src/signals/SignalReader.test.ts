import { afterEach, beforeEach, expect, test, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Workspace } from '@craft-agent/core/types';
import { createOutputBundle, deleteOutput, getOutputDir } from '@craft-agent/shared/outputs';
import { createSignalContractWorkflow, writeRun, type WorkflowRunSnapshot } from '@craft-agent/shared/workflows';
import type { SignalReportMetadata, SignalTrack, SignalMode, SignalEntryReference } from '@craft-agent/shared/shared-intel';
import { SIGNAL_RETRIEVAL_WORKERS } from '@craft-agent/shared/shared-intel';
import { hash, readSignals, writeSignals, saveEvidence, type SignalRequest } from './storage';
import { SignalReader } from './SignalReader';

const now = Date.parse('2026-09-07T12:00:00Z');
let root: string;
let hq: Workspace;
let campaign: Workspace;
let workspaces: Workspace[];
let permission: ReturnType<typeof mock<(root: string) => void>>;
let reader: SignalReader;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'signal-reader-'));
  hq = { id: 'hq', name: 'HQ', rootPath: join(root, 'hq'), artistWorkspaceScope: 'hq', createdAt: now } as Workspace;
  campaign = { ...hq, id: 'campaign', rootPath: join(root, 'campaign'), artistWorkspaceScope: 'campaign' };
  workspaces = [hq, campaign]; permission = mock(() => {});
  reader = new SignalReader({ workspaces: () => workspaces, permission, now: () => now });
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

test('selected report ideas and exact reference use saved support, not renderer text', async () => {
  const f = publish({ mode: 'links' });
  const before = readFileSync(join(hq.rootPath, 'signals/state.json'), 'utf8');
  const listed = await reader.listIdeas('campaign', f.output.id);
  expect(listed.ok).toBe(true); expect(listed.entries).toHaveLength(1);
  expect(listed.entries[0]!.reference).toEqual(f.reference);
  expect(listed.entries[0]!.supportingFindings![0]!.excerpt).toBe(f.metadata.findings[0]!.excerpt);
  expect(await reader.resolveReference('campaign', f.reference)).toEqual(listed);
  expect(permission.mock.calls.map(call => call[0])).toContain(hq.rootPath);
  expect(permission.mock.calls.map(call => call[0])).toContain(campaign.rootPath);
  expect(readFileSync(join(hq.rootPath, 'signals/state.json'), 'utf8')).toBe(before);
});
test('same reader sees new reports and excludes edits and deletions immediately', async () => {
  expect((await reader.find('hq')).entries).toEqual([]);
  const f = publish(); expect((await reader.find('hq')).entries.length).toBeGreaterThan(0);
  writeFileSync(f.path, 'changed');
  expect((await reader.resolveReference('hq', f.reference)).ok).toBe(false);
  expect((await reader.find('hq')).entries).toEqual([]);
  deleteOutput(hq.rootPath, f.output.id);
  expect((await reader.listIdeas('hq', f.output.id)).ok).toBe(false);
});
test('refuses ambiguous/no HQ, remote and cross-HQ exact references', async () => {
  const f = publish();
  workspaces.push({ ...hq, id: 'other' });
  expect((await reader.listIdeas('campaign', f.output.id)).ok).toBe(false);
  expect((await reader.listIdeas('hq', f.output.id)).ok).toBe(true);
  expect((await reader.resolveReference('hq', { ...f.reference, hqWorkspaceId: 'other' })).ok).toBe(false);
  workspaces = [campaign]; expect((await reader.find('campaign')).ok).toBe(false);
  workspaces = [{ ...hq, remoteServer: { url: 'https://invalid' } } as Workspace];
  expect((await reader.find('hq')).ok).toBe(false);
});
test('permission denial precedes reads and is redacted', async () => {
  permission.mockImplementation(() => { throw new Error('private credentials /path'); });
  const result = await reader.find('hq'); expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('private');
});
for (const broken of ['attempt', 'run', 'final', 'status', 'metadata', 'index', 'hash', 'excerpt', 'bound', 'topic', 'support'] as const) test(`excludes invalid ${broken} proof`, async () => {
  const f = publish();
  if (broken === 'attempt') f.request.workflowRunId = randomUUID();
  if (broken === 'run') f.run.state = 'failed';
  if (broken === 'final') f.run.finalOutputId = randomUUID();
  if (broken === 'status') f.request.status = 'running';
  if (broken === 'metadata') f.metadata.identity = { ...f.metadata.identity, hqWorkspaceId: 'other' };
  if (broken === 'index') f.metadata.indexingStatus = 'failed';
  if (broken === 'hash') f.metadata.contentHash = hash('different');
  if (broken === 'excerpt') f.metadata.ideas[0]!.excerpt = 'not saved';
  if (broken === 'bound') f.metadata.findings[0]!.excerpt = 'x'.repeat(601);
  if (broken === 'topic') f.metadata.ideas[0]!.topics = Array(9).fill('topic');
  if (broken === 'support') f.metadata.ideas[0]!.supportingFindingIds = ['missing'];
  f.persist();
  expect((await reader.resolveReference('hq', f.reference)).ok).toBe(false);
});
test('bounded output and malformed inputs never produce unbounded tool context', async () => {
  const f = publish({ count: 5 });
  const result = await reader.listIdeas('hq', f.output.id);
  expect(result.entries.length).toBeLessThanOrEqual(5); expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
  expect((await reader.find('hq', { query: 'x'.repeat(501) })).ok).toBe(false);
  expect((await reader.resolveReference('hq', { ...f.reference, contentHash: '' })).ok).toBe(false);
});
test('old evergreen is explicit; old source is not refreshed into timely news', async () => {
  const old = publish({ age: 80 });
  expect((await reader.find('hq', { query: 'astronomy' })).entries).toHaveLength(0);
  expect((await reader.find('hq', { query: 'astronomy', freshness: 'evergreen' })).entries.length).toBeGreaterThan(0);
  expect((await reader.resolveReference('hq', old.reference)).ok).toBe(true);
  const dated = publish({ temporalKind: 'time-sensitive', sourceAge: 80 });
  expect((await reader.find('hq', { query: 'astronomy' })).entries).toHaveLength(0);
  expect((await reader.resolveReference('hq', dated.reference)).ok).toBe(true);
});
test('unknown source dates stay unknown; broad non-music browse defaults to Your World', async () => {
  publish({ track: 'industry' }); publish({ sourceAge: null, temporalKind: 'unknown' });
  const result = await reader.find('hq', { query: 'ideas for non-music content' });
  expect(result.mode).toBe('browse'); expect(result.entries.length).toBeGreaterThan(0);
  expect(result.entries.every(entry => entry.track === 'your-world' && entry.temporalKind === 'unknown' && !entry.sources[0]!.sourcePublishedAt)).toBe(true);
});
test('rejects corrupt sidecar and symlink escape without exposing their contents', async () => {
  const f = publish();
  const external = join(root, 'private.txt'); writeFileSync(external, 'private report'); rmSync(f.path); symlinkSync(external, f.path);
  expect((await reader.listIdeas('hq', f.output.id)).ok).toBe(false);
  writeFileSync(join(hq.rootPath, 'signals/packets', `${f.request.reportMetadataHash}.json`), 'private malformed');
  expect((await reader.listIdeas('hq', f.output.id)).ok).toBe(false);
});
test('all seven active worker identities can retrieve through the session host entrypoint', async () => {
  const f = publish(); let active: readonly string[] = SIGNAL_RETRIEVAL_WORKERS;
  const workerReader = new SignalReader({ workspaces: () => workspaces, permission, now: () => now, activeAgents: () => active });
  for (const slug of SIGNAL_RETRIEVAL_WORKERS) {
    const result = await workerReader.findForWorker('campaign', slug, { reference: f.reference });
    expect(result.ok).toBe(true); expect(result.entries[0]!.reference).toEqual(f.reference);
  }
  active = [];
  expect((await workerReader.findForWorker('campaign', 'content-genius', {})).ok).toBe(false);
  active = ['scroll-stopper', 'artist-manager'];
  expect((await workerReader.findForWorker('campaign', 'scroll-stopper', {})).ok).toBe(false);
  expect((await workerReader.findForWorker('campaign', 'artist-manager', {})).ok).toBe(false);
  expect((await workerReader.findForWorker('campaign', undefined, {})).ok).toBe(false);
});
test('topical match wins over recency and explicit older report references remain available', async () => {
  publish({ title: 'Astronomy', age: 0 });
  const relevant = publish({ title: 'Astronomy telescope', age: 20 });
  const result = await reader.find('hq', { query: 'astronomy telescope', kind: 'idea' });
  expect(result.entries[0]!.reference.outputId).toBe(relevant.output.id);
});
test('recent time-sensitive ranking uses source date, then report date, after topical score', async () => {
  const oldSource = publish({ temporalKind: 'time-sensitive', age: 0, sourceAge: 20 });
  const newSource = publish({ temporalKind: 'time-sensitive', age: 3, sourceAge: 4 });
  const tiedSource = publish({ temporalKind: 'time-sensitive', age: 2, sourceAge: 4 });
  const result = await reader.find('hq', { query: 'astronomy', freshness: 'recent', kind: 'idea' });
  expect(result.entries.map(entry => entry.reference.outputId)).toEqual([tiedSource.output.id, newSource.output.id, oldSource.output.id]);
  const topical = publish({ title: 'Astronomy telescope', temporalKind: 'time-sensitive', age: 10, sourceAge: 25 });
  expect((await reader.find('hq', { query: 'astronomy telescope', kind: 'idea' })).entries[0]!.reference.outputId).toBe(topical.output.id);
});
test('verified event date takes priority over publication date without changing evergreen ranking', async () => {
  const olderEvent = publish({ temporalKind: 'time-sensitive', age: 0, sourceAge: 1 });
  olderEvent.metadata.sources[0]!.eventDate = '2026-08-18';
  olderEvent.metadata.findings[0]!.eventDate = olderEvent.metadata.ideas[0]!.eventDate = '2026-08-18'; olderEvent.persist();
  const newerEvent = publish({ temporalKind: 'time-sensitive', age: 3, sourceAge: 4 });
  newerEvent.metadata.sources[0]!.eventDate = '2026-09-03';
  newerEvent.metadata.findings[0]!.eventDate = newerEvent.metadata.ideas[0]!.eventDate = '2026-09-03'; newerEvent.persist();
  expect((await reader.find('hq', { query: 'astronomy', kind: 'idea' })).entries[0]!.reference.outputId).toBe(newerEvent.output.id);
  const evergreenNewReport = publish({ age: 0, sourceAge: 100 });
  publish({ age: 3, sourceAge: 4 });
  expect((await reader.find('hq', { query: 'astronomy', freshness: 'evergreen', kind: 'idea' })).entries[0]!.reference.outputId).toBe(evergreenNewReport.output.id);
});
test('browse diversifies reports instead of taking every angle from the latest scan', async () => {
  const first = publish({ count: 5 }); const second = publish({ age: 1 });
  const result = await reader.find('hq', { kind: 'idea' });
  expect(new Set(result.entries.map(entry => entry.reference.outputId))).toEqual(new Set([first.output.id, second.output.id]));
});
test('rejects over-limit finding and idea arrays without returning a partial unvalidated index', async () => {
  const f = publish({ count: 6 });
  expect((await reader.listIdeas('hq', f.output.id)).ok).toBe(false);
  f.metadata.ideas = f.metadata.ideas.slice(0, 1);
  f.metadata.findings = Array.from({ length: 13 }, (_, index) => ({ ...f.metadata.findings[0]!, id: `finding-${index}` }));
  f.persist();
  expect((await reader.listIdeas('hq', f.output.id)).ok).toBe(false);
});
test('oversized primary and credential-bearing source URL fail closed', async () => {
  const f = publish(); f.metadata.sources[0]!.sourceUrl = 'https://user:private@example.com/research'; f.persist();
  expect((await reader.listIdeas('hq', f.output.id)).ok).toBe(false);
  f.metadata.sources[0]!.sourceUrl = 'https://example.com/research'; f.persist();
  writeFileSync(f.path, 'x'.repeat(400_001));
  expect((await reader.listIdeas('hq', f.output.id)).ok).toBe(false);
});

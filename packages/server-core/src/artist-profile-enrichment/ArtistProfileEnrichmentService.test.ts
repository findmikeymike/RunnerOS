import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actualConfig from '@craft-agent/shared/config';
import { ARTIST_CAREER_RESEARCH_CONTEXT_SLUG, artistProfileDoc } from '@craft-agent/shared/artist-context';
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import { createWorkspaceAtPath } from '@craft-agent/shared/workspaces';
import type { DeepResearchRunSnapshot } from '@craft-agent/shared/deep-research';

let workspace: { id: string; name: string; rootPath: string; artistWorkspaceScope: 'hq' } | null = null;
mock.module('@craft-agent/shared/config', () => ({
  ...actualConfig,
  getWorkspaceByNameOrId: (id: string) => workspace?.id === id ? workspace : null,
}));

const { ArtistProfileEnrichmentService } = await import('./ArtistProfileEnrichmentService');
const roots: string[] = [];
const spotifyId = '1234567890123456789012';

class FakeRunner {
  listener?: (event: { type: 'run.completed'; run: DeepResearchRunSnapshot }) => void;
  prepared?: DeepResearchRunSnapshot;
  preparedHost?: Record<string, any>;
  beginCalls = 0;
  cancelCalls = 0;
  interruptCalls = 0;
  failCancel = false;
  subscribe(listener: typeof this.listener) { this.listener = listener; return () => { this.listener = undefined; }; }
  prepare(workspaceId: string, input: Record<string, unknown>, host: Record<string, any>): DeepResearchRunSnapshot {
    this.preparedHost = host;
    this.prepared = {
      schemaVersion: 1, id: host.runId, workspaceId, title: String(input.title), topic: String(input.topic), state: 'created',
      planPolicy: 'auto', purpose: host.purpose, owner: host.owner, executionContract: host.executionContract,
      sourceReadiness: { requested: [], usable: ['fixture'], missing: [], unusable: [] },
      plan: { id: 'plan', title: 'plan', objective: 'test', policy: 'auto', depth: 'standard', reportFormat: 'brief',
        loopBudget: { depth: 'standard', maxSearchRounds: 3, maxPagesToOpen: 10, minFollowUpRounds: 1 }, sourceProfiles: [],
        steps: [], requiredSourceSlugs: [], assumptions: [], riskNotes: [], createdAt: new Date().toISOString() },
      steps: [], events: [], outputSchema: host.outputSchema, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as DeepResearchRunSnapshot;
    return structuredClone(this.prepared);
  }
  begin() { this.beginCalls += 1; return this.prepared!; }
  async cancel() {
    this.cancelCalls += 1;
    if (this.failCancel) throw new Error('fixture cancel persistence failure');
    const cancelled = { ...this.prepared!, state: 'cancelled' as const };
    this.listener?.({ type: 'run.completed', run: cancelled });
    return cancelled;
  }
  async interruptActiveRunsForShutdown() { this.interruptCalls += 1; return []; }
  completeWithState(state: DeepResearchRunSnapshot['state']) {
    this.listener?.({ type: 'run.completed', run: { ...this.prepared!, state } });
  }
  complete(output: unknown, anchor = 'https://artist.example/', supportExcerpt = 'Artist won the North Star Award in 2025.') {
    const receipt = { id: 'receipt-1', toolUseId: 'tool-1', toolName: 'fixture-read', kind: 'page-read' as const, status: 'succeeded' as const,
      requestUrl: anchor, responseUrl: anchor, resultSha256: 'a'.repeat(64), resultChars: 100, supportExcerpt, observedAt: new Date().toISOString() };
    this.listener?.({ type: 'run.completed', run: { ...this.prepared!, state: 'succeeded', structuredOutput: output, steps: [{ id: 'research', kind: 'research', title: 'Research', state: 'succeeded', toolReceipts: [receipt] }] } });
  }
}

function candidate(text = 'Artist won the North Star Award in 2025.') {
  return { identityMatch: { artistName: 'Artist', matchedAnchor: 'https://artist.example/' }, gaps: [], findings: [{
    category: 'achievement', subjectKey: 'north-star-award-2025', predicate: 'achieved', text, eventDate: '2025', attribution: 'documented',
    evidence: [{ receiptId: 'receipt-1', url: 'https://artist.example/', title: 'Official biography', support: 'Artist won the North Star Award in 2025.' }],
  }] };
}

function candidateFor(artistName: string, anchor: string) {
  const support = `${artistName} won the North Star Award in 2025.`;
  return { identityMatch: { artistName, matchedAnchor: anchor }, gaps: [], findings: [{
    category: 'achievement', subjectKey: 'north-star-award-2025', predicate: 'achieved', text: support, eventDate: '2025', attribution: 'documented',
    evidence: [{ receiptId: 'receipt-1', url: anchor, title: 'Official biography', support }],
  }] };
}

beforeEach(() => {
  const rootPath = mkdtempSync(join(tmpdir(), 'artist-enrichment-service-'));
  roots.push(rootPath);
  process.env.CRAFT_CONFIG_DIR = join(rootPath, 'private-config');
  workspace = { id: 'hq-1', name: 'Artist HQ', rootPath, artistWorkspaceScope: 'hq' };
  createWorkspaceAtPath(rootPath, 'Artist HQ');
  const profile = artistProfileDoc.normalize({ artistName: 'Artist', spotifyProfile: spotifyId });
  upsertContextDoc(rootPath, { slug: artistProfileDoc.slug, metadata: artistProfileDoc.metadata(), body: artistProfileDoc.serialize(profile) });
});

afterEach(() => { workspace = null; while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('ArtistProfileEnrichmentService', () => {
  test('deduplicates starts, publishes only fetched receipt-backed facts, and preserves user correction', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    let view = await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    view = await service.start('hq-1', { requestId: 'request_1234', expectedIdentityKey: view.identity!.key });
    const duplicate = await service.start('hq-1', { requestId: 'request_1234', expectedIdentityKey: view.identity!.key });
    expect(duplicate.run?.id).toBe(view.run?.id);
    expect(runner.beginCalls).toBe(1);
    expect(runner.preparedHost?.publicWebSourcesOnly).toBe(true);
    runner.complete(candidate());
    await Bun.sleep(20);
    view = service.get('hq-1');
    expect(view.findings).toHaveLength(1);
    expect(view.run?.state).toBe('succeeded');
    view = await service.correct('hq-1', { claimKey: view.findings[0]!.claimKey, expectedRevision: view.revision, text: 'I won the North Star Artist Award in 2025.' });
    expect(view.findings[0]?.correctedByUser).toBe(true);
    expect(view.findings[0]?.text).toContain('Artist Award');
    service.dispose();
  });

  test('requires an explicit clear before identity replacement and fences the cleared run', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    let view = await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    await service.start('hq-1', { requestId: 'request_5678', expectedIdentityKey: view.identity!.key });
    const late = structuredClone(runner.prepared!);
    const profileBefore = loadContextDoc(workspace!.rootPath, artistProfileDoc.slug)?.body;

    await expect(service.updateSeeds('hq-1', service.get('hq-1').revision, {
      officialUrl: 'different.example', artistName: 'Different Artist', spotifyProfile: 'abcdefghijklmnopqrstuv',
    })).rejects.toThrow('CLEAR_RESEARCH_REQUIRED');

    view = await service.clear('hq-1', service.get('hq-1').revision);
    await service.waitForPendingEvents();
    expect(view.identity).toBeNull();
    expect(service.get('hq-1').revision).toBe(view.revision);
    expect(loadContextDoc(workspace!.rootPath, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG)?.body).toContain('Career research was explicitly cleared');
    expect(loadContextDoc(workspace!.rootPath, artistProfileDoc.slug)?.body).toBe(profileBefore);
    expect(runner.cancelCalls).toBe(1);

    runner.listener?.({ type: 'run.completed', run: { ...late, state: 'succeeded', structuredOutput: candidate(), steps: [] } });
    expect(service.get('hq-1').findings).toHaveLength(0);
    view = await service.updateSeeds('hq-1', view.revision, { officialUrl: 'different.example', artistName: 'Different Artist', spotifyProfile: 'abcdefghijklmnopqrstuv' });
    expect(view.identity?.artistName).toBe('Different Artist');
    expect(loadContextDoc(workspace!.rootPath, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG)?.body).toContain('Earlier career research was explicitly cleared');
    await service.start('hq-1', { requestId: 'request_empty_replacement', expectedIdentityKey: view.identity!.key });
    runner.complete({ identityMatch: { artistName: 'Different Artist', matchedAnchor: 'https://different.example/' }, findings: [], gaps: [] }, 'https://different.example/', 'Different Artist official biography.');
    await service.waitForPendingEvents();
    expect(loadContextDoc(workspace!.rootPath, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG)?.body).toContain('Earlier career research was explicitly cleared');
    await service.start('hq-1', { requestId: 'request_replacement', expectedIdentityKey: view.identity!.key });
    runner.complete(candidateFor('Different Artist', 'https://different.example/'), 'https://different.example/', 'Different Artist won the North Star Award in 2025.');
    await service.waitForPendingEvents();
    expect(loadContextDoc(workspace!.rootPath, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG)?.body).not.toContain('Earlier career research was explicitly cleared');
    service.dispose();
  });

  test('does not clear the context when active research cannot be durably stopped', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    const setup = await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    const active = await service.start('hq-1', { requestId: 'request_clear_failure', expectedIdentityKey: setup.identity!.key });
    runner.failCancel = true;

    await expect(service.clear('hq-1', active.revision)).rejects.toThrow('CLEAR_STOP_FAILED');
    expect(service.get('hq-1').identity?.artistName).toBe('Artist');
    expect(loadContextDoc(workspace!.rootPath, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG)).not.toBeNull();
    service.dispose();
  });

  test('preserves a malformed live record and requires explicit clear before reseeding', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    const setup = await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    const recordPath = join(workspace!.rootPath, 'records', 'artist-career-research', 'current.json');
    const malformed = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
    delete malformed.identity;
    writeFileSync(recordPath, `${JSON.stringify(malformed, null, 2)}\n`, 'utf8');
    const originalMalformedBytes = readFileSync(recordPath, 'utf8');

    const recovery = service.get('hq-1');
    expect(recovery.revision).toBe(setup.revision);
    expect(recovery.recoveryError).toContain('preserved');
    expect(loadContextDoc(workspace!.rootPath, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG)?.body).toContain('could not be read safely');
    await expect(service.updateSeeds('hq-1', recovery.revision, { officialUrl: 'different.example', artistName: 'Different Artist' }))
      .rejects.toThrow('CAREER_RESEARCH_INVALID');
    expect(readFileSync(recordPath, 'utf8')).toBe(originalMalformedBytes);

    const cleared = await service.clear('hq-1', recovery.revision, recovery.recoveryToken);
    expect(cleared.identity).toBeNull();
    const reseeded = await service.updateSeeds('hq-1', cleared.revision, { officialUrl: 'different.example', artistName: 'Different Artist' });
    expect(reseeded.identity?.artistName).toBe('Different Artist');
    service.dispose();
  });

  test('preserves invalid JSON and supports explicit privacy-scrub recovery', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    const recordPath = join(workspace!.rootPath, 'records', 'artist-career-research', 'current.json');
    const invalidJson = '{"artistName":"private unfinished value"';
    writeFileSync(recordPath, invalidJson, 'utf8');

    const recovery = service.get('hq-1');
    expect(recovery.revision).toBe(0);
    expect(recovery.recoveryError).toContain('preserved');
    await expect(service.updateSeeds('hq-1', 0, { officialUrl: 'different.example', artistName: 'Different Artist' }))
      .rejects.toThrow('CAREER_RESEARCH_INVALID');
    expect(readFileSync(recordPath, 'utf8')).toBe(invalidJson);

    const cleared = await service.clear('hq-1', recovery.revision, recovery.recoveryToken);
    expect(cleared.revision).toBe(1);
    expect(readFileSync(recordPath, 'utf8')).not.toContain('private unfinished value');
    const reseeded = await service.updateSeeds('hq-1', cleared.revision, { officialUrl: 'different.example', artistName: 'Different Artist' });
    expect(reseeded.identity?.artistName).toBe('Different Artist');
    service.dispose();
  });

  test('does not clear a different malformed record than the user reviewed', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    const recordPath = join(workspace!.rootPath, 'records', 'artist-career-research', 'current.json');
    writeFileSync(recordPath, '{"broken":"record-a"', 'utf8');
    const reviewed = service.get('hq-1');
    writeFileSync(recordPath, '{"different":"record-b"', 'utf8');
    const replacementBytes = readFileSync(recordPath, 'utf8');

    await expect(service.clear('hq-1', reviewed.revision, reviewed.recoveryToken)).rejects.toThrow('CAREER_RESEARCH_CONFLICT');
    expect(readFileSync(recordPath, 'utf8')).toBe(replacementBytes);
    service.dispose();
  });

  test('drains startup recovery events before the service is exposed', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    const setup = await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    await service.start('hq-1', { requestId: 'request_recovery', expectedIdentityKey: setup.identity!.key });
    runner.completeWithState('interrupted');
    await service.waitForPendingEvents();
    expect(service.get('hq-1').run?.state).toBe('interrupted');
    service.dispose();
  });

  test('reports event persistence failures instead of silently draining them', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    (service as unknown as { handleRunnerEvent: () => Promise<void> }).handleRunnerEvent = async () => { throw new Error('fixture persistence failure'); };
    runner.completeWithState('interrupted');
    await expect(service.waitForPendingEvents()).rejects.toThrow('artist research event');
    service.dispose();
  });

  test('withholds a claim when the fetched excerpt does not support it', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    const setup = await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    await service.start('hq-1', { requestId: 'request_unsupported', expectedIdentityKey: setup.identity!.key });
    runner.complete({ identityMatch: { artistName: 'Artist', matchedAnchor: 'https://artist.example/' }, gaps: [], findings: [{
      category: 'achievement', subjectKey: 'grammy-award', predicate: 'achieved', text: 'Artist won a Grammy Award.', attribution: 'documented',
      evidence: [{ receiptId: 'receipt-1', url: 'https://artist.example/', title: 'Official biography', support: 'Artist released an independent debut.' }],
    }] }, 'https://artist.example/', 'Artist released an independent debut.');
    await service.waitForPendingEvents();
    const view = service.get('hq-1');
    expect(view.findings).toHaveLength(0);
    expect(view.gaps).toContain('1 unsupported or mismatched finding(s) were withheld.');
    service.dispose();
  });

  test('keeps cancellation final when a successful result arrives late', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    const setup = await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    const active = await service.start('hq-1', { requestId: 'request_cancelled', expectedIdentityKey: setup.identity!.key });
    const cancelled = await service.cancel('hq-1', active.run!.id, active.run!.attempt);
    runner.complete(candidate());
    await service.waitForPendingEvents();
    const view = service.get('hq-1');
    expect(view.run?.state).toBe('cancelled');
    expect(view.revision).toBe(cancelled.revision);
    expect(view.findings).toHaveLength(0);
    service.dispose();
  });
});

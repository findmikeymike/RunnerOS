import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actualConfig from '@craft-agent/shared/config';
import { artistProfileDoc } from '@craft-agent/shared/artist-context';
import { upsertContextDoc } from '@craft-agent/shared/workspace-context';
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
  beginCalls = 0;
  cancelCalls = 0;
  subscribe(listener: typeof this.listener) { this.listener = listener; return () => { this.listener = undefined; }; }
  prepare(workspaceId: string, input: Record<string, unknown>, host: Record<string, any>): DeepResearchRunSnapshot {
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
  async cancel() { this.cancelCalls += 1; return this.prepared!; }
  complete(output: unknown, anchor = 'https://artist.example/') {
    const receipt = { id: 'receipt-1', toolUseId: 'tool-1', toolName: 'fixture-read', kind: 'page-read' as const, status: 'succeeded' as const,
      requestUrl: anchor, responseUrl: anchor, resultSha256: 'a'.repeat(64), resultChars: 100, supportExcerpt: 'Artist won the North Star Award in 2025.', observedAt: new Date().toISOString() };
    this.listener?.({ type: 'run.completed', run: { ...this.prepared!, state: 'succeeded', structuredOutput: output, steps: [{ id: 'research', kind: 'research', title: 'Research', state: 'succeeded', toolReceipts: [receipt] }] } });
  }
}

function candidate(text = 'Artist won the North Star Award in 2025.') {
  return { identityMatch: { artistName: 'Artist', matchedAnchor: 'https://artist.example/' }, gaps: [], findings: [{
    category: 'achievement', subjectKey: 'north-star-award-2025', predicate: 'achieved', text, eventDate: '2025', attribution: 'documented',
    evidence: [{ receiptId: 'receipt-1', url: 'https://artist.example/', title: 'Official biography', support: 'Artist won the North Star Award in 2025.' }],
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

  test('withholds invented receipts and fences a late result after identity switch', async () => {
    const runner = new FakeRunner();
    const service = new ArtistProfileEnrichmentService(runner as never);
    let view = await service.updateSeeds('hq-1', 0, { officialUrl: 'artist.example', artistName: 'Artist' });
    await service.start('hq-1', { requestId: 'request_5678', expectedIdentityKey: view.identity!.key });
    const late = structuredClone(runner.prepared!);
    view = await service.updateSeeds('hq-1', service.get('hq-1').revision, { officialUrl: 'different.example', artistName: 'Different Artist' });
    runner.listener?.({ type: 'run.completed', run: { ...late, state: 'succeeded', structuredOutput: candidate(), steps: [] } });
    await Bun.sleep(20);
    expect(service.get('hq-1').identity?.artistName).toBe('Different Artist');
    expect(service.get('hq-1').findings).toHaveLength(0);
    service.dispose();
  });
});

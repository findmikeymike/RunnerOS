import { describe, expect, test } from 'bun:test';
import { buildSignalReportMetadata, parseSignalSynthesis, signalTemporalMetadata, validateSignalReportProvenance, type SignalReportProvenance, type SignalSynthesisContext } from './signal-report.ts';
import { finalizeSignalCoverage, selectSignalScanVideos } from './signal-selection.ts';
import type { SignalEvidenceReceipt } from './signal-contracts.ts';

const context: SignalSynthesisContext = {
  identity: { version: 1, hqWorkspaceId: 'hq', track: 'your-world', mode: 'scan', runId: 'r1', workflowRunId: 'w1', configRevision: 'rev1', requestedVideoIds: ['dQw4w9WgXcQ'] },
  sources: [{ sourceId: 'video-1', videoId: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ', sourcePublishedAt: '2026-09-01T00:00:00Z' }],
};
const finding = { id: 'f1', title: 'A source finding', excerpt: 'This discovery raises an interesting question.', topics: ['culture'], sourceRefs: ['video-1'], temporalKind: 'unknown' as const };
function envelope() {
  return { version: 1, outcome: 'report', markdown: '# Your World\n\n' + finding.excerpt, examinedVideoIds: ['dQw4w9WgXcQ'], findings: [{ ...finding }], ideas: [] as unknown[] };
}
function provenance(): SignalReportProvenance {
  return { outputId: 'output-1', finalOutputId: 'output-1', workflowRunId: 'w1', workflowSlug: 'weekly-world-scan', workspaceId: 'hq', stepId: 'synthesize', status: 'published', runState: 'succeeded', readable: true, contentHash: 'sha256-content', createdAt: '2026-09-07T12:00:00Z' };
}

describe('host-scoped Signal report contract', () => {
  test('validates one-pass prose/index and never invents host identity from model output', () => {
    const parsed = parseSignalSynthesis(envelope(), context);
    expect(parsed.findings).toEqual([finding]);
    expect(parsed.indexingStatus).toBe('ready');
    const metadata = buildSignalReportMetadata({ identity: context.identity, report: provenance(), synthesis: parsed, sources: context.sources, coverageStatus: 'complete' });
    expect(metadata.identity).toEqual(context.identity);
    expect(metadata.createdAt).toBe(provenance().createdAt);
    expect(metadata.sources[0]?.sourcePublishedAt).toBe('2026-09-01T00:00:00Z');
    expect(() => parseSignalSynthesis({ ...envelope(), track: 'industry' }, context)).toThrow();
    expect(() => parseSignalSynthesis({ ...envelope(), examinedVideoIds: ['9bZkp7q19f0'] }, context)).toThrow();
    expect(() => parseSignalSynthesis({ ...envelope(), findings: [{ ...finding, sourceRefs: ['unknown'] }] }, context)).toThrow();
  });
  test('does not index excerpts absent from report, duplicate IDs or excessive entries', () => {
    const absent = parseSignalSynthesis({ ...envelope(), markdown: '# Other report' }, context);
    expect(absent.indexingStatus).toBe('failed');
    expect(absent.findings).toEqual([]);
    expect(absent.markdown).toBe('# Other report');
    expect(parseSignalSynthesis({ ...envelope(), findings: [finding, finding] }, context).indexingStatus).toBe('failed');
    expect(() => parseSignalSynthesis({ ...envelope(), findings: Array.from({ length: 13 }, () => finding) }, context)).toThrow();
  });
  test('core source validation cannot be bypassed by a simultaneous index-shape error', () => {
    for (const shape of [{ title: '' }, { topics: 'not-an-array' }, { excerpt: '' }, { temporalKind: 'bogus' }, { id: '' }]) {
      for (const sourceRefs of [undefined, null, [], ['invented-source'], ['video-1', 'invented-source'], [9], ['video-1', 'video-1']]) {
        expect(() => parseSignalSynthesis({ ...envelope(), findings: [{ ...finding, ...shape, sourceRefs }] }, context)).toThrow();
      }
    }
    for (const invalid of [null, 'not a finding', {}, []]) {
      expect(() => parseSignalSynthesis({ ...envelope(), findings: [invalid] }, context)).toThrow();
    }
    expect(parseSignalSynthesis({ ...envelope(), findings: [{ ...finding, title: '' }] }, context).indexingStatus).toBe('failed');
  });
  test('index failure cannot turn useful or unresolved videos into permanent empty coverage', () => {
    const source2 = { ...context.sources[0]!, sourceId: 'video-2', videoId: '9bZkp7q19f0', sourceUrl: 'https://youtu.be/9bZkp7q19f0' };
    const extended = { identity: { ...context.identity, requestedVideoIds: ['dQw4w9WgXcQ', '9bZkp7q19f0'] }, sources: [...context.sources, source2] };
    const result = parseSignalSynthesis({ ...envelope(), examinedVideoIds: extended.identity.requestedVideoIds,
      findings: [finding, { ...finding, id: 'f2', sourceRefs: ['video-2'], excerpt: 'This excerpt is not in the report.' }] }, extended);
    expect(result.indexingStatus).toBe('failed');
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ includedVideoIds: ['dQw4w9WgXcQ'], examinedNoFindingVideoIds: [], unresolvedVideoIds: ['9bZkp7q19f0'] });
    const channelId = 'UC' + '1'.repeat(22);
    const evidence: SignalEvidenceReceipt[] = extended.sources.map(source => ({ version: 1, hqWorkspaceId: 'hq', track: 'your-world', runId: 'r1',
      sourceId: channelId, videoId: source.videoId, packetId: source.sourceId, contentHash: 'verified-packet-hash', checkedAt: provenance().createdAt,
      status: result.coverage.includedVideoIds.includes(source.videoId!) ? 'finding' : result.coverage.examinedNoFindingVideoIds.includes(source.videoId!) ? 'examined-no-finding' : 'unavailable' }));
    const sourceCoverage = [{ sourceId: channelId, status: 'checked' as const, checkedAt: provenance().createdAt, candidateVideoIds: extended.identity.requestedVideoIds }];
    const ledger = finalizeSignalCoverage({ identity: extended.identity, expectedSourceIds: [channelId], sourceCoverage, evidence, coverageIncomplete: false, cancelled: false,
      ledger: [], outcome: 'report', finalizedAt: provenance().createdAt,
      publishedReport: { ...provenance(), published: true, includedVideoIds: result.coverage.includedVideoIds } });
    expect(ledger.map(entry => [entry.videoId, entry.outcome])).toEqual([['dQw4w9WgXcQ', 'included']]);
    const next = selectSignalScanVideos({ hqWorkspaceId: 'hq', track: 'your-world', now: provenance().createdAt,
      config: { version: 1, track: 'your-world', enabled: false, cadence: 'manual', sinceDays: 7, maxPerChannel: 3, revision: 'rev1', updatedAt: provenance().createdAt,
        sources: [{ channelId, url: 'https://youtube.com/channel/' + channelId, name: 'Source', priority: 'medium' }] },
      videos: extended.sources.map(source => ({ videoId: source.videoId!, channelId, publishedAt: source.sourcePublishedAt!, sourceUrl: source.sourceUrl, title: 'Video' })), ledger, sourceCoverage });
    expect(next.selected.map(video => video.videoId)).toEqual(['9bZkp7q19f0']);
  });
  test('examined is not empty; explicit emptiness must be examined and cannot contradict any finding', () => {
    const source2 = { ...context.sources[0]!, sourceId: 'video-2', videoId: '9bZkp7q19f0', sourceUrl: 'https://youtu.be/9bZkp7q19f0' };
    const extended = { identity: { ...context.identity, requestedVideoIds: ['dQw4w9WgXcQ', '9bZkp7q19f0'] }, sources: [...context.sources, source2] };
    const input = { ...envelope(), examinedVideoIds: extended.identity.requestedVideoIds };
    expect(parseSignalSynthesis(input, extended).coverage.unresolvedVideoIds).toEqual(['9bZkp7q19f0']);
    expect(parseSignalSynthesis({ ...input, noFindingVideoIds: ['9bZkp7q19f0'] }, extended).coverage.examinedNoFindingVideoIds).toEqual(['9bZkp7q19f0']);
    expect(() => parseSignalSynthesis({ ...input, noFindingVideoIds: ['dQw4w9WgXcQ'] }, extended)).toThrow();
    expect(() => parseSignalSynthesis({ ...input, findings: [{ ...finding, title: '' }], noFindingVideoIds: ['dQw4w9WgXcQ'] }, extended)).toThrow();
    expect(() => parseSignalSynthesis({ ...envelope(), noFindingVideoIds: ['9bZkp7q19f0'] }, extended)).toThrow();
    expect(() => parseSignalSynthesis({ ...input, noFindingVideoIds: ['9bZkp7q19f0', '9bZkp7q19f0'] }, extended)).toThrow();
    const empty = parseSignalSynthesis({ version: 1, outcome: 'no-change', markdown: '', examinedVideoIds: ['dQw4w9WgXcQ'], findings: [], ideas: [] }, context);
    expect(empty.coverage).toEqual({ includedVideoIds: [], examinedNoFindingVideoIds: ['dQw4w9WgXcQ'], unresolvedVideoIds: [] });
  });
  test('omits invalid optional ideas with warning and allows zero ideas', () => {
    const idea = { ...finding, id: 'i1', supportingFindingIds: ['f1'], suggestedWorkerRoles: ['content-genius'] };
    expect(parseSignalSynthesis({ ...envelope(), ideas: [idea] }, context).ideas).toHaveLength(1);
    const result = parseSignalSynthesis({ ...envelope(), ideas: [{ ...idea, supportingFindingIds: ['bad'] }] }, context);
    expect(result.ideas).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.indexingStatus).toBe('ready');
  });
  test('no-change response is only a proposal, cannot carry fabricated prose or findings', () => {
    expect(parseSignalSynthesis({ version: 1, outcome: 'no-change', markdown: '', examinedVideoIds: [], findings: [], ideas: [] }, context).outcome).toBe('no-change');
    expect(() => parseSignalSynthesis({ ...envelope(), outcome: 'no-change' }, context)).toThrow();
    expect(() => parseSignalSynthesis({ ...envelope(), findings: [] }, context)).toThrow();
  });
  test('report provenance ignores titles but requires exact host scope/run/final step', () => {
    expect(() => validateSignalReportProvenance(context.identity, provenance())).not.toThrow();
    for (const patch of [{ workspaceId: 'other-hq' }, { finalOutputId: 'other' }, { workflowRunId: 'other' },
      { workflowSlug: 'weekly-signal-scan' }, { stepId: 'youtube-intel' }, { status: 'draft' }, { runState: 'running' }, { readable: false }]) {
      expect(() => validateSignalReportProvenance(context.identity, { ...provenance(), ...patch })).toThrow();
    }
  });
  test('report/video freshness never manufactures event freshness; evergreen is retained', () => {
    const result = parseSignalSynthesis({ ...envelope(), findings: [{ ...finding, eventDate: '2026-09-07' }] }, context);
    expect(result.findings[0]?.eventDate).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(signalTemporalMetadata(finding, context.sources)).toEqual({ temporalKind: 'unknown', sourcePublishedAt: ['2026-09-01T00:00:00Z'] });
    const old = { ...context, sources: [{ ...context.sources[0]!, eventDate: '1990-01-01' }] };
    const evergreen = { ...finding, temporalKind: 'evergreen' as const, eventDate: '1990-01-01' };
    expect(signalTemporalMetadata(evergreen, old.sources).eventDate).toBe('1990-01-01');
    expect(parseSignalSynthesis({ ...envelope(), findings: [evergreen] }, old).findings[0]?.temporalKind).toBe('evergreen');
  });
});

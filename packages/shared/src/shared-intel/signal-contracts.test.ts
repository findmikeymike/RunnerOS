import { describe, expect, test } from 'bun:test';
import {
  normalizeSignalChannelUrl, normalizeSignalVideoLinks, normalizeSignalVideoUrl, validateSignalTrackConfig,
  validateSignalRunIdentity, signalCoverageKey, type SignalTrackConfig, type SignalRunIdentity,
  type SignalVideoMetadata, type SignalLedgerEntry, type SignalEvidenceReceipt,
} from './signal-contracts.ts';
import { canFinalizeSignalNoChange, finalizeSignalCoverage, planSignalEvidenceRetry, selectSignalScanVideos, type SignalCompletionProof } from './signal-selection.ts';

const now = '2026-09-07T12:00:00Z';
const channel = (n: number) => 'UC' + String(n).padStart(22, '0');
const videoId = (n: number) => String(n).padStart(11, '0');
function config(): SignalTrackConfig {
  return { version: 1, track: 'your-world', enabled: false, cadence: 'manual', sinceDays: 7, maxPerChannel: 3, revision: 'rev-1', updatedAt: now,
    sources: [1, 2].map(n => ({ channelId: channel(n), url: 'https://www.youtube.com/channel/' + channel(n), name: 'Channel ' + n, priority: 'medium' })) };
}
function video(n: number, ch = 1, publishedAt = '2026-09-06T12:00:00Z'): SignalVideoMetadata {
  return { videoId: videoId(n), channelId: channel(ch), publishedAt, sourceUrl: 'https://youtu.be/' + videoId(n), title: 'Video ' + n };
}
function identity(): SignalRunIdentity {
  return { version: 1, hqWorkspaceId: 'hq-1', track: 'your-world', mode: 'scan', runId: 'r1', workflowRunId: 'w1', configRevision: 'rev-1', requestedVideoIds: [videoId(1)] };
}
function evidence(): SignalEvidenceReceipt {
  return { version: 1, hqWorkspaceId: 'hq-1', track: 'your-world', runId: 'r1', sourceId: channel(1), videoId: videoId(1), packetId: 'p1', contentHash: 'sha256-proof', status: 'examined-no-finding', checkedAt: now };
}
function proof(): SignalCompletionProof {
  return { identity: identity(), expectedSourceIds: [channel(1)], sourceCoverage: [{ sourceId: channel(1), status: 'checked', checkedAt: now, candidateVideoIds: [videoId(1)] }], evidence: [evidence()], coverageIncomplete: false, cancelled: false };
}
function covered(n: number): SignalLedgerEntry {
  return { hqWorkspaceId: 'hq-1', track: 'your-world', videoId: videoId(n), runId: 'old', outcome: 'included', finalizedAt: now, outputId: 'old-report', evidencePacketId: 'old-packet' };
}

describe('Signal URL and track contracts', () => {
  test('canonicalizes supported video forms and retains evidence timestamps', () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=tracking&t=1m30s', 'https://youtu.be/dQw4w9WgXcQ?t=90', 'https://m.youtube.com/shorts/dQw4w9WgXcQ?start=90', 'https://youtube.com/live/dQw4w9WgXcQ#t=90']) {
      expect(normalizeSignalVideoUrl(url)).toEqual({ videoId: 'dQw4w9WgXcQ', canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', timestampSeconds: 90 });
    }
  });
  test('rejects invalid hosts, channel URLs, playlists, credentials and ambiguous IDs', () => {
    for (const url of ['https://youtube.com.evil/watch?v=dQw4w9WgXcQ', 'https://youtube.com/@artist', 'https://youtube.com/playlist?list=PL123', 'https://evil@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:444/watch?v=dQw4w9WgXcQ', 'https://youtu.be/tooshort', 'https://youtube.com/watch?v=dQw4w9WgXcQ&v=9bZkp7q19f0', 'https://youtu.be/dQw4w9WgXcQ?t=invalid', 'file:///watch?v=dQw4w9WgXcQ']) expect(normalizeSignalVideoUrl(url)).toBeNull();
  });
  test('deduplicates aliases, rejects mixed bad batches and never expands playlists', () => {
    expect(normalizeSignalVideoLinks(['https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ?t=30'])).toEqual({ ok: true, videos: [{ videoId: 'dQw4w9WgXcQ', canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', timestampSeconds: 30 }] });
    expect(normalizeSignalVideoLinks(['https://youtu.be/dQw4w9WgXcQ', 'bad']).ok).toBe(false);
    expect(normalizeSignalVideoLinks([]).ok).toBe(false);
    expect(normalizeSignalVideoLinks(Array.from({ length: 11 }, (_, n) => video(n).sourceUrl)).ok).toBe(false);
  });
  test('channel syntax normalization leaves canonical resolution to the host', () => {
    expect(normalizeSignalChannelUrl('https://youtube.com/@Artist/videos?si=x')).toBe('https://www.youtube.com/@Artist');
    expect(normalizeSignalChannelUrl('https://youtube.com/user/Artist/')).toBe('https://www.youtube.com/user/Artist');
    expect(normalizeSignalChannelUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(normalizeSignalChannelUrl('https://evil.example/@Artist')).toBeNull();
  });
  test('rejects oversized configs, aliases sharing one canonical ID and cross-track snapshots', () => {
    expect(validateSignalTrackConfig(config())).toEqual(config());
    expect(() => validateSignalTrackConfig({ ...config(), sources: [config().sources[0], { ...config().sources[0], url: 'https://youtube.com/@alias' }] })).toThrow();
    expect(() => validateSignalTrackConfig({ ...config(), sources: Array.from({ length: 21 }, (_, n) => ({ ...config().sources[0], channelId: channel(n) })) })).toThrow();
    for (const patch of [{ sinceDays: 15 }, { maxPerChannel: 4 }, { enabled: true, sources: [] }]) expect(() => validateSignalTrackConfig({ ...config(), ...patch })).toThrow();
    expect(() => validateSignalRunIdentity({ ...identity(), mode: 'links', requestedVideoIds: [] })).toThrow();
    expect(signalCoverageKey('hq-1', 'industry', videoId(1))).not.toBe(signalCoverageKey('hq-1', 'your-world', videoId(1)));
  });
});

describe('bounded unseen Signal selection', () => {
  function selection(videos: SignalVideoMetadata[], ledger: SignalLedgerEntry[] = []) {
    return { hqWorkspaceId: 'hq-1', track: 'your-world' as const, config: config(), videos, ledger, now,
      sourceCoverage: config().sources.map(source => ({ sourceId: source.channelId, status: 'checked' as const, checkedAt: now, candidateVideoIds: videos.filter(v => v.channelId === source.channelId).map(v => v.videoId) })) };
  }
  test('a covered newest upload cannot hide another unseen upload', () => {
    const result = selectSignalScanVideos(selection([video(1, 1, now), video(2)], [covered(1)]));
    expect(result.selected.map(v => v.videoId)).toEqual([videoId(2)]);
    expect(result.coverageIncomplete).toBe(false);
  });
  test('uses fair rounds, priority, least recent scan and stable channel ties', () => {
    const input = selection([video(1), video(2), video(3, 2), video(4, 2)]);
    input.config.sources[1]!.priority = 'high';
    expect(selectSignalScanVideos({ ...input, maxVideos: 3 }).selected.map(v => v.videoId)).toEqual([videoId(3), videoId(1), videoId(4)]);
    input.config.sources[1]!.priority = 'medium';
    input.config.sources[0]!.lastScannedAt = now;
    expect(selectSignalScanVideos({ ...input, maxVideos: 1 }).selected[0]?.channelId).toBe(channel(2));
  });
  test('capped and unavailable sources remain incomplete; old videos are not covered', () => {
    const input = selection([video(1), video(2), video(3, 1, '2020-01-01T00:00:00Z')]);
    const result = selectSignalScanVideos({ ...input, maxVideos: 1 });
    expect(result.omittedVideoIds).toEqual([videoId(2)]);
    expect(result.coverageIncomplete).toBe(true);
    expect(selectSignalScanVideos({ ...input, sourceCoverage: [] }).coverageIncomplete).toBe(true);
    expect(selectSignalScanVideos({ ...input, sourceCoverage: input.sourceCoverage.map(source => ({ ...source, candidateVideoIds: [videoId(99)] })) }).coverageIncomplete).toBe(true);
    expect(input.ledger).toEqual([]);
  });
  test('coverage is isolated across HQs/tracks and conflicting provider identity fails', () => {
    const input = selection([video(1)], [{ ...covered(1), track: 'industry' }, { ...covered(1), hqWorkspaceId: 'hq-2' }]);
    expect(selectSignalScanVideos(input).selected).toHaveLength(1);
    expect(() => selectSignalScanVideos({ ...input, videos: [video(1), video(1, 2)] })).toThrow();
    expect(() => selectSignalScanVideos({ ...input, track: 'industry' })).toThrow();
  });
});

describe('Signal lifecycle proofs', () => {
  test('no-change requires complete accessible sources and all candidates accounted for', () => {
    expect(canFinalizeSignalNoChange(proof())).toBe(true);
    for (const patch of [{ evidence: [] }, { sourceCoverage: [] }, { coverageIncomplete: true }, { cancelled: true },
      { sourceCoverage: [{ ...proof().sourceCoverage[0]!, status: 'unavailable' as const }] },
      { sourceCoverage: [{ ...proof().sourceCoverage[0]!, candidateVideoIds: [videoId(2)] }] }]) expect(canFinalizeSignalNoChange({ ...proof(), ...patch })).toBe(false);
    const empty = { ...proof(), identity: { ...identity(), requestedVideoIds: [] }, evidence: [], sourceCoverage: [{ ...proof().sourceCoverage[0]!, candidateVideoIds: [], reportableFindingCount: 0 }] };
    expect(canFinalizeSignalNoChange(empty)).toBe(true);
    expect(canFinalizeSignalNoChange({ ...empty, sourceCoverage: [{ ...empty.sourceCoverage[0]!, reportableFindingCount: undefined }] })).toBe(true);
    expect(canFinalizeSignalNoChange({ ...empty, expectedSourceIds: ['web:0'], sourceCoverage: [{ sourceId: 'web:0', status: 'checked', checkedAt: now, candidateVideoIds: [] }] })).toBe(false);
  });
  test('mixed checked empty or already-covered channels finalize without fabricated packets', () => {
    for (const candidates of [[], [videoId(2)]]) {
      const mixed: SignalCompletionProof = {
        ...proof(), expectedSourceIds: [channel(1), channel(2)], coveredVideoIds: candidates,
        sourceCoverage: [...proof().sourceCoverage, { sourceId: channel(2), status: 'checked', checkedAt: now, candidateVideoIds: candidates }],
      };
      expect(canFinalizeSignalNoChange(mixed)).toBe(true);
      const ledger = finalizeSignalCoverage({ ...mixed, ledger: candidates.map(() => covered(2)), outcome: 'no-change', finalizedAt: now });
      expect(ledger.find(entry => entry.videoId === videoId(1))?.outcome).toBe('examined-no-finding');
      for (const status of ['incomplete', 'unavailable'] as const) {
        expect(canFinalizeSignalNoChange({ ...mixed, sourceCoverage: [mixed.sourceCoverage[0]!, { ...mixed.sourceCoverage[1]!, status }] })).toBe(false);
      }
      expect(canFinalizeSignalNoChange({ ...mixed, sourceCoverage: [mixed.sourceCoverage[0]!, { ...mixed.sourceCoverage[1]!, reportableFindingCount: 1 }] })).toBe(false);
    }
    expect(canFinalizeSignalNoChange({ ...proof(), expectedSourceIds: [channel(1), channel(2)], sourceCoverage: [...proof().sourceCoverage,
      { sourceId: channel(2), status: 'checked', checkedAt: now, candidateVideoIds: [videoId(2)] }] })).toBe(false);
  });
  test('host-authoritative examined-no-finding finalizes idempotently without Output', () => {
    const input = { ...proof(), ledger: [], outcome: 'no-change' as const, finalizedAt: now };
    const result = finalizeSignalCoverage(input);
    expect(result[0]?.outcome).toBe('examined-no-finding');
    expect(result[0]?.outputId).toBeUndefined();
    expect(finalizeSignalCoverage({ ...input, ledger: result })).toEqual(result);
  });
  test('failed synthesis, cancellation, or unreadable/wrong final cannot advance coverage', () => {
    const input = { ...proof(), evidence: [{ ...evidence(), status: 'finding' as const }], ledger: [], outcome: 'report' as const, finalizedAt: now };
    expect(() => finalizeSignalCoverage(input)).toThrow();
    const publishedReport = { outputId: 'o1', finalOutputId: 'o1', workflowRunId: 'w1', published: true, readable: true, contentHash: 'hash', includedVideoIds: [videoId(1)] };
    expect(finalizeSignalCoverage({ ...input, publishedReport })[0]?.outcome).toBe('included');
    for (const patch of [{ readable: false }, { finalOutputId: 'o2' }, { workflowRunId: 'wrong' }]) expect(() => finalizeSignalCoverage({ ...input, publishedReport: { ...publishedReport, ...patch } })).toThrow();
    expect(() => finalizeSignalCoverage({ ...input, publishedReport, cancelled: true })).toThrow();
  });
  test('one-off reviews never mark recurring coverage; retries reuse verified durable packets', () => {
    expect(finalizeSignalCoverage({ ...proof(), identity: { ...identity(), mode: 'links' }, ledger: [], outcome: 'no-change', finalizedAt: now })).toEqual([]);
    expect(planSignalEvidenceRetry(identity(), [evidence()], ['p1'])).toEqual({ reusePacketIds: ['p1'], fetchVideoIds: [] });
    expect(planSignalEvidenceRetry(identity(), [evidence()], [])).toEqual({ reusePacketIds: [], fetchVideoIds: [videoId(1)] });
    expect(planSignalEvidenceRetry(identity(), [{ ...evidence(), status: 'unavailable' }], ['p1']).fetchVideoIds).toEqual([videoId(1)]);
    expect(() => planSignalEvidenceRetry(identity(), [{ ...evidence(), hqWorkspaceId: 'hq-2' }], ['p1'])).toThrow();
  });
});

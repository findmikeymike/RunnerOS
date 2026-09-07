import {
  SIGNAL_VIDEO_ID, SIGNAL_CHANNEL_ID, normalizeSignalVideoUrl, signalCoverageKey, validateSignalRunIdentity, validateSignalTrackConfig,
  type SignalEvidenceReceipt, type SignalLedgerEntry, type SignalRunIdentity,
  type SignalSourceCoverage, type SignalTrack, type SignalTrackConfig, type SignalVideoMetadata,
} from './signal-contracts.ts';

export interface SignalScanSelection {
  selected: SignalVideoMetadata[];
  omittedVideoIds: string[];
  coverageIncomplete: boolean;
}

/** Provider metadata must include a completeness receipt for every saved channel. */
export function selectSignalScanVideos(input: {
  hqWorkspaceId: string; track: SignalTrack; config: SignalTrackConfig;
  videos: readonly SignalVideoMetadata[]; ledger: readonly SignalLedgerEntry[];
  sourceCoverage: readonly SignalSourceCoverage[]; now: string; maxVideos?: number;
}): SignalScanSelection {
  const config = validateSignalTrackConfig(input.config);
  if (!input.hqWorkspaceId.trim() || input.track !== config.track) throw new Error('Signal selection scope mismatch');
  const now = Date.parse(input.now);
  const cap = input.maxVideos ?? 20;
  if (!Number.isFinite(now) || !Number.isInteger(cap) || cap < 1 || cap > 20) throw new Error('Invalid Signal selection bounds');
  if (input.videos.length > 2000) throw new Error('Discovery metadata exceeds bounded selection input');
  const covered = new Set(input.ledger.map(entry => signalCoverageKey(entry.hqWorkspaceId, entry.track, entry.videoId)));
  const channels = new Map(config.sources.map(source => [source.channelId, source]));
  const cutoff = now - config.sinceDays * 86_400_000;
  const candidates = new Map<string, SignalVideoMetadata>();
  for (const video of input.videos) {
    const source = normalizeSignalVideoUrl(video.sourceUrl);
    const publishedAt = Date.parse(video.publishedAt);
    if (!channels.has(video.channelId) || !SIGNAL_VIDEO_ID.test(video.videoId)
      || source?.videoId !== video.videoId || !Number.isFinite(publishedAt)) throw new Error('Invalid provider video metadata');
    const previous = candidates.get(video.videoId);
    if (previous && (previous.channelId !== video.channelId || previous.publishedAt !== video.publishedAt)) throw new Error('Conflicting provider video identity');
    if (publishedAt < cutoff || publishedAt > now || covered.has(signalCoverageKey(input.hqWorkspaceId, input.track, video.videoId))) continue;
    candidates.set(video.videoId, { ...video, sourceUrl: source.canonicalUrl });
  }
  const priority = { high: 0, medium: 1, low: 2 };
  const ordered = [...config.sources].sort((a, b) => priority[a.priority] - priority[b.priority]
    || Date.parse(a.lastScannedAt ?? '1970-01-01T00:00:00Z') - Date.parse(b.lastScannedAt ?? '1970-01-01T00:00:00Z')
    || a.channelId.localeCompare(b.channelId));
  const queues = ordered.map(channel => [...candidates.values()].filter(video => video.channelId === channel.channelId)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.videoId.localeCompare(b.videoId)));
  const selected: SignalVideoMetadata[] = [];
  // Fair rounds prevent a prolific high-priority channel consuming the whole cap.
  for (let round = 0; round < config.maxPerChannel && selected.length < cap; round++) {
    for (const queue of queues) {
      const video = queue[round];
      if (video && selected.length < cap) selected.push(video);
    }
  }
  const selectedIds = new Set(selected.map(video => video.videoId));
  const omittedVideoIds = [...candidates.keys()].filter(id => !selectedIds.has(id)).sort();
  const incompleteSource = config.sources.some(source => {
    const receipts = input.sourceCoverage.filter(receipt => receipt.sourceId === source.channelId);
    return receipts.length !== 1 || receipts[0]!.status !== 'checked'
      || !Number.isFinite(Date.parse(receipts[0]!.checkedAt))
      || receipts[0]!.candidateVideoIds.some(id => !input.videos.some(video => video.videoId === id && video.channelId === source.channelId)
        && !covered.has(signalCoverageKey(input.hqWorkspaceId, input.track, id)));
  });
  return { selected, omittedVideoIds, coverageIncomplete: incompleteSource || omittedVideoIds.length > 0 };
}

function scopedEvidence(identity: SignalRunIdentity, evidence: readonly SignalEvidenceReceipt[]): void {
  const seen = new Set<string>();
  for (const receipt of evidence) {
    if (receipt.version !== 1 || receipt.hqWorkspaceId !== identity.hqWorkspaceId || receipt.track !== identity.track
      || receipt.runId !== identity.runId || !receipt.packetId.trim() || !receipt.contentHash.trim()
      || !receipt.sourceId.trim() || !Number.isFinite(Date.parse(receipt.checkedAt))
      || (receipt.videoId && !identity.requestedVideoIds.includes(receipt.videoId))) throw new Error('Evidence receipt does not match the host request');
    const key = receipt.videoId ? `video:${receipt.videoId}` : `source:${receipt.sourceId}`;
    if (seen.has(key)) throw new Error('Duplicate evidence receipt');
    seen.add(key);
  }
}

export interface SignalCompletionProof {
  identity: SignalRunIdentity;
  expectedSourceIds: readonly string[];
  sourceCoverage: readonly SignalSourceCoverage[];
  evidence: readonly SignalEvidenceReceipt[];
  coverageIncomplete: boolean;
  cancelled: boolean;
  /** Host extracts these from the same HQ/track ledger, not from an agent packet. */
  coveredVideoIds?: readonly string[];
}

/** A missing Output alone is NEVER proof of successful no-change. */
export function canFinalizeSignalNoChange(proof: SignalCompletionProof): boolean {
  try { validateSignalRunIdentity(proof.identity); scopedEvidence(proof.identity, proof.evidence); } catch { return false; }
  if (proof.cancelled || proof.coverageIncomplete || !proof.expectedSourceIds.length
    || new Set(proof.expectedSourceIds).size !== proof.expectedSourceIds.length) return false;
  if (proof.sourceCoverage.length !== proof.expectedSourceIds.length) return false;
  for (const sourceId of proof.expectedSourceIds) {
    const receipts = proof.sourceCoverage.filter(receipt => receipt.sourceId === sourceId);
    if (receipts.length !== 1 || receipts[0]!.status !== 'checked' || !Number.isFinite(Date.parse(receipts[0]!.checkedAt))) return false;
    const source = receipts[0]!;
    if (source.reportableFindingCount !== undefined && source.reportableFindingCount !== 0) return false;
    if (source.candidateVideoIds.some(id => !proof.identity.requestedVideoIds.includes(id) && !proof.coveredVideoIds?.includes(id))) return false;
    // A fully checked YouTube channel with no remaining eligible candidates has
    // no transcript packet by design. This does not apply to arbitrary websites.
    const emptyChannel = proof.identity.mode === 'scan' && SIGNAL_CHANNEL_ID.test(sourceId)
      && source.candidateVideoIds.every(id => proof.coveredVideoIds?.includes(id));
    if (source.reportableFindingCount !== 0 && !emptyChannel
      && !proof.evidence.some(receipt => receipt.sourceId === sourceId && receipt.status === 'examined-no-finding')) return false;
  }
  if (proof.evidence.some(receipt => !proof.expectedSourceIds.includes(receipt.sourceId) || receipt.status !== 'examined-no-finding')) return false;
  return proof.identity.requestedVideoIds.every(id => proof.evidence.some(receipt => receipt.videoId === id && receipt.status === 'examined-no-finding'));
}

export interface SignalPublishedReportProof {
  outputId: string; workflowRunId: string; finalOutputId: string;
  published: boolean; readable: boolean; contentHash: string;
  includedVideoIds: readonly string[];
}

/** Call under the host's existing lock only AFTER durable packet/report validation. */
export function finalizeSignalCoverage(input: SignalCompletionProof & {
  ledger: readonly SignalLedgerEntry[]; outcome: 'report' | 'no-change';
  publishedReport?: SignalPublishedReportProof; finalizedAt: string;
}): SignalLedgerEntry[] {
  validateSignalRunIdentity(input.identity);
  scopedEvidence(input.identity, input.evidence);
  if (input.evidence.some(receipt => !input.expectedSourceIds.includes(receipt.sourceId))) throw new Error('Evidence is outside the requested sources');
  if (!Number.isFinite(Date.parse(input.finalizedAt))) throw new Error('Invalid coverage finalization time');
  if (input.cancelled) throw new Error('Cancelled runs cannot finalize coverage');
  if (input.outcome === 'no-change' && !canFinalizeSignalNoChange(input)) throw new Error('No-change requires complete authoritative empty results');
  const report = input.publishedReport;
  if (input.outcome === 'report' && (!report?.published || !report.readable || !report.contentHash.trim()
    || !report.outputId.trim() || report.finalOutputId !== report.outputId
    || report.workflowRunId !== input.identity.workflowRunId)) throw new Error('Coverage requires the durable readable final report');
  if (input.outcome === 'report') {
    for (const id of report!.includedVideoIds) {
      if (!input.identity.requestedVideoIds.includes(id) || !input.evidence.some(receipt => receipt.videoId === id && receipt.status === 'finding')) throw new Error('Report claims a video without validated finding evidence');
    }
  }
  // Deliberate link reviews never mutate recurring coverage, even for the same video.
  if (input.identity.mode === 'links') return [...input.ledger];
  const ledger = new Map(input.ledger.map(entry => [signalCoverageKey(entry.hqWorkspaceId, entry.track, entry.videoId), { ...entry }]));
  for (const receipt of input.evidence) {
    if (!receipt.videoId || receipt.status === 'unavailable') continue;
    if (receipt.status === 'finding' && (input.outcome !== 'report' || !report!.includedVideoIds.includes(receipt.videoId))) continue;
    const key = signalCoverageKey(input.identity.hqWorkspaceId, input.identity.track, receipt.videoId);
    if (ledger.has(key)) continue;
    ledger.set(key, {
      hqWorkspaceId: input.identity.hqWorkspaceId, track: input.identity.track, videoId: receipt.videoId,
      runId: input.identity.runId, evidencePacketId: receipt.packetId,
      outcome: receipt.status === 'finding' ? 'included' : 'examined-no-finding', finalizedAt: input.finalizedAt,
      ...(input.outcome === 'report' ? { outputId: report!.outputId } : {}),
    });
  }
  return [...ledger.values()];
}

/** The host verifies packet existence/hash before supplying reusablePacketIds. */
export function planSignalEvidenceRetry(identity: SignalRunIdentity, evidence: readonly SignalEvidenceReceipt[], reusablePacketIds: readonly string[]): {
  reusePacketIds: string[]; fetchVideoIds: string[];
} {
  validateSignalRunIdentity(identity);
  scopedEvidence(identity, evidence);
  const reusable = new Set(reusablePacketIds);
  const reuse = evidence.filter(receipt => receipt.status !== 'unavailable' && reusable.has(receipt.packetId));
  return {
    reusePacketIds: [...new Set(reuse.map(receipt => receipt.packetId))],
    fetchVideoIds: identity.requestedVideoIds.filter(id => !reuse.some(receipt => receipt.videoId === id)),
  };
}

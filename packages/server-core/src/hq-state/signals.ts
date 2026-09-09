import type { ManagerSignalFinding, ManagerSignalsSnapshot, ManagerSourceHealth } from '@craft-agent/shared/hq-state';
import type { SignalRetrievedEntry, SignalTrack } from '@craft-agent/shared/shared-intel';
import { readSignals } from '../signals/storage';
import { readValidatedSignalEntries } from '../signals/validated-report-reader';

const TRACKS: SignalTrack[] = ['industry', 'your-world'];
const MAX_REPORTS_PER_TRACK = 3;
const FRESHNESS_MS = 30 * 86400_000;

/** Small local projection of validated literal findings. No recovery, provider calls, or writes. */
export function collectManagerSignals(rootPath: string, workspaceId: string, now = new Date()): ManagerSignalsSnapshot {
  const sourceHealth: ManagerSourceHealth[] = [];
  const byTrack = new Map<SignalTrack, ManagerSignalFinding[]>();
  const timestamp = now.getTime();
  const cutoff = timestamp - FRESHNESS_MS;
  let journal: ReturnType<typeof readSignals>;
  try {
    journal = readSignals(rootPath, workspaceId);
    if (journal.requests.some(request => !request || typeof request !== 'object'
      || !TRACKS.includes(request.track) || typeof request.status !== 'string'
      || typeof request.createdAt !== 'string' || !Number.isFinite(Date.parse(request.createdAt)))) throw new Error('Malformed journal');
  } catch {
    return { findings: [], sourceHealth: TRACKS.map(track => ({ source: `signals-${track}`, status: 'unavailable', message: 'Saved Signals research could not be read; findings are unknown.' })) };
  }

  for (const track of TRACKS) {
    const reports = journal.requests.filter(request => request.track === track && ['report', 'partial'].includes(request.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const candidates = reports.slice(0, MAX_REPORTS_PER_TRACK);
    let failed = false;
    let partial = false;
    const ranked: SignalRetrievedEntry[] = [];
    for (const request of candidates) {
      if (ranked.length >= 3) break;
      try {
        if (!request.outputId) throw new Error('Missing report');
        const entries = readValidatedSignalEntries({ id: workspaceId, rootPath }, request.outputId, journal);
        for (const entry of entries) {
          if (entry.kind !== 'finding' || entry.track !== track) continue;
          const reportDate = Date.parse(entry.createdAt);
          if (!Number.isFinite(reportDate) || reportDate < cutoff || reportDate > timestamp) continue;
          const dates = entry.sources.flatMap(source => source.sourcePublishedAt ? [Date.parse(source.sourcePublishedAt)] : []);
          const date = entry.eventDate ? Date.parse(entry.eventDate) : dates.length ? Math.max(...dates) : 0;
          if (entry.temporalKind === 'time-sensitive' && (!Number.isFinite(date) || !date || date < cutoff || date > timestamp)) continue;
          ranked.push(entry);
        }
      } catch { failed = true; }
    }
    ranked.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const seen = new Set<string>();
    byTrack.set(track, ranked.filter(entry => {
      const key = `${entry.reference.outputId}:${entry.id}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 3).map(entry => ({
      title: entry.title.slice(0, 160), excerpt: entry.excerpt.slice(0, 600), track: entry.track,
      createdAt: entry.createdAt, coverageStatus: entry.coverageStatus, reference: entry.reference,
    })));
    partial = byTrack.get(track)!.some(finding => finding.coverageStatus === 'partial');
    const latest = journal.requests.filter(request => request.track === track).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const config = journal.tracks?.[track];
    const stateMessage = latest?.status === 'no-change' ? 'The latest scan recorded no change; this does not renew older findings.'
      : latest && ['queued', 'running', 'preparing', 'scheduled'].includes(latest.status) ? 'Signals research is still in progress.'
        : latest && ['failed', 'cancelled'].includes(latest.status) ? 'The latest Signals request did not complete.'
          : config?.revision === 'initial' && !latest ? 'Signals has not been configured.'
            : config?.enabled === false ? 'Scheduled Signals scans are disabled; saved research remains available.' : undefined;
    const healthy = ranked.length > 0;
    const evidenceMessage = failed ? 'Some saved reports could not be validated; findings may be unavailable.'
      : !reports.length ? 'No completed research report is available.'
        : !healthy ? 'No validated findings remain within the 30-day freshness window.'
          : partial ? 'Included research has partial source coverage.' : undefined;
    sourceHealth.push({ source: `signals-${track}`,
      status: failed ? 'unavailable' : !reports.length ? 'unavailable' : !healthy ? 'stale' : partial ? 'partial' : 'fresh',
      observedAt: candidates[0]?.createdAt,
      message: [stateMessage, evidenceMessage].filter(Boolean).join(' ') || undefined,
    });
  }
  // Give both tracks a slot before using the remaining space for another finding.
  const findings: ManagerSignalFinding[] = [];
  for (let index = 0; findings.length < 3 && index < 3; index++) {
    for (const track of TRACKS) {
      const finding = byTrack.get(track)?.[index];
      if (finding && findings.length < 3) findings.push(finding);
    }
  }
  for (const health of sourceHealth) {
    if (health.status !== 'partial') continue;
    const track = health.source.slice('signals-'.length);
    if (!findings.some(finding => finding.track === track && finding.coverageStatus === 'partial')) {
      health.status = 'fresh';
      health.message = health.message?.replace('Included research has partial source coverage.', '').trim() || undefined;
    }
  }
  return { findings, sourceHealth };
}

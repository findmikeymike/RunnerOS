import type { Workspace } from '@craft-agent/core/types';
import { getWorkspaces } from '@craft-agent/shared/config';
import { isAgentAllowedInArtistWorkspace, loadActivatedAgents } from '@craft-agent/shared/agent-definitions';
import { evaluateTeamPermission } from '@craft-agent/shared/workspaces';
import { findSignalIdeasSchema, signalEntryReferenceSchema, SIGNAL_RETRIEVAL_LIMITS, SIGNAL_RETRIEVAL_WORKERS,
  type FindSignalIdeasInput, type SignalEntryReference, type SignalLookupResult, type SignalRetrievedEntry } from '@craft-agent/shared/shared-intel';
import { readSignals } from './storage';
import { readValidatedSignalEntries } from './validated-report-reader';
import { resolveSignalHqWorkspace } from './scope';

export interface SignalReaderDeps {
  workspaces?: () => Workspace[];
  permission?: (root: string) => void;
  now?: () => number;
  activeAgents?: (root: string) => readonly string[];
}
const unavailable = (mode: SignalLookupResult['mode']): SignalLookupResult => ({ ok: false, mode, entries: [], unavailable: true, error: 'Signals research is unavailable or has changed. Reload the source report.' });
const stopwords = new Set(['the', 'and', 'for', 'with', 'from', 'ideas', 'idea', 'content', 'non', 'music', 'some', 'give', 'about', 'please', 'make', 'recent', 'new']);
function terms(value: string): string[] { return [...new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 2 && !stopwords.has(term)))]; }

/** Live read-only lookup. No reconciliation, publication, network, or paid generation. */
export class SignalReader {
  constructor(private readonly deps: SignalReaderDeps = {}) {}
  async findForWorker(workspaceId: string, slug: string | undefined, input: FindSignalIdeasInput): Promise<SignalLookupResult> {
    try {
      const workspace = (this.deps.workspaces ?? getWorkspaces)().find(item => item.id === workspaceId);
      if (!workspace || workspace.remoteServer || !slug || !(SIGNAL_RETRIEVAL_WORKERS as readonly string[]).includes(slug)
        || !isAgentAllowedInArtistWorkspace(slug, workspace.artistWorkspaceScope)
        || !(this.deps.activeAgents ?? (root => loadActivatedAgents(root).map(agent => agent.slug)))(workspace.rootPath).includes(slug)) throw new Error();
      return await this.find(workspaceId, input);
    } catch { return unavailable('search'); }
  }
  private scope(workspaceId: string): Workspace {
    const all = (this.deps.workspaces ?? getWorkspaces)();
    const requested = all.find(item => item.id === workspaceId);
    const hq = resolveSignalHqWorkspace(workspaceId, all);
    // Ideation requires editor/owner chat access in both scopes. Ordinary viewer
    // report reading is unchanged; this neither checks paid permission nor writes.
    const permission = this.deps.permission ?? ((root: string) => { if (!evaluateTeamPermission(root, 'agent.chat').allowed) throw new Error(); });
    permission(requested!.rootPath);
    if (requested!.id !== hq.id) permission(hq.rootPath);
    return hq;
  }
  private bounded(entries: SignalRetrievedEntry[], mode: SignalLookupResult['mode'], failed = false): SignalLookupResult {
    const result: SignalLookupResult = { ok: true, mode, entries: [], ...(failed ? { unavailable: true as const } : {}) };
    for (const candidate of entries) {
      if (result.entries.length === SIGNAL_RETRIEVAL_LIMITS.entries) break;
      const entry = this.compact(candidate, mode);
      if (!entry) { result.unavailable = true; continue; }
      if (JSON.stringify({ ...result, entries: [...result.entries, entry] }).length <= SIGNAL_RETRIEVAL_LIMITS.characters) result.entries.push(entry);
      else result.unavailable = true;
    }
    // Adding the unavailable flag must also respect the envelope budget.
    while (JSON.stringify(result).length > SIGNAL_RETRIEVAL_LIMITS.characters) result.entries.pop();
    return result;
  }
  private compact(entry: SignalRetrievedEntry, mode: SignalLookupResult['mode']): SignalRetrievedEntry | null {
    // Reserve the unavailable flag too, so later omissions cannot evict this entry.
    const fits = (candidate: SignalRetrievedEntry) => JSON.stringify({ ok: true, mode, entries: [candidate], unavailable: true }).length <= SIGNAL_RETRIEVAL_LIMITS.characters;
    if (fits(entry)) return entry;
    if (entry.kind !== 'idea' || !entry.supportingFindings?.length) return null;
    const abbreviate = (limit: number) => entry.supportingFindings!.map(finding => {
      if (finding.excerpt.length <= limit) return finding;
      const prefix = finding.excerpt.slice(0, limit);
      const boundary = prefix.lastIndexOf(' ');
      return { ...finding, excerpt: (boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd(), excerptTruncated: true as const };
    });
    for (const limit of [300, 160, 80, 40]) {
      const candidate = { ...entry, supportingFindings: abbreviate(limit) };
      if (fits(candidate)) return candidate;
    }
    // Keep a complete source cover for the exact angle. Never drop citations
    // from a retained finding or substitute a different finding's provenance.
    const uncovered = new Set(entry.sourceRefs);
    const support: NonNullable<SignalRetrievedEntry['supportingFindings']> = [];
    const remaining = abbreviate(40);
    while (uncovered.size) {
      remaining.sort((a, b) => b.sourceRefs.filter(ref => uncovered.has(ref)).length - a.sourceRefs.filter(ref => uncovered.has(ref)).length
        || JSON.stringify(a).length - JSON.stringify(b).length || a.id.localeCompare(b.id));
      const next = remaining.shift();
      if (!next || !next.sourceRefs.some(ref => uncovered.has(ref))) return null;
      support.push(next);
      next.sourceRefs.forEach(ref => uncovered.delete(ref));
    }
    const candidate = { ...entry, supportingFindings: support, supportingFindingsOmitted: entry.supportingFindings.length - support.length };
    // If source identity alone cannot fit, fail closed rather than return a naked angle.
    return fits(candidate) ? candidate : null;
  }
  async listIdeas(workspaceId: string, outputId: string): Promise<SignalLookupResult> {
    try {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(outputId)) throw new Error();
      const result = this.bounded(readValidatedSignalEntries(this.scope(workspaceId), outputId).filter(entry => entry.kind === 'idea'), 'reference');
      return result;
    } catch { return unavailable('reference'); }
  }
  async resolveReference(workspaceId: string, reference: SignalEntryReference): Promise<SignalLookupResult> {
    if (!signalEntryReferenceSchema.safeParse(reference).success) return unavailable('reference');
    const result = await this.find(workspaceId, { reference });
    if (result.entries.length !== 1) return unavailable('reference');
    return result;
  }
  async find(workspaceId: string, input: FindSignalIdeasInput = {}): Promise<SignalLookupResult> {
    let mode: SignalLookupResult['mode'] = 'search';
    try {
      const args = findSignalIdeasSchema.parse(input);
      const query = terms(args.query ?? '');
      mode = args.reference ? 'reference' : query.length ? 'search' : 'browse';
      const hq = this.scope(workspaceId);
      if (args.reference && args.reference.hqWorkspaceId !== hq.id) throw new Error();
      const journal = readSignals(hq.rootPath, hq.id);
      const candidates = args.reference ? [args.reference.outputId] : [...new Set(journal.requests
        .filter(item => item.outputId && ['report', 'partial'].includes(item.status) && (!args.track || item.track === args.track))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => item.outputId!))];
      let failed = candidates.length > SIGNAL_RETRIEVAL_LIMITS.reports;
      const ranked: Array<{ entry: SignalRetrievedEntry; score: number; date: number; reportDate: number }> = [];
      const now = (this.deps.now ?? Date.now)(); const cutoff = now - 30 * 86400_000;
      for (const id of candidates.slice(0, SIGNAL_RETRIEVAL_LIMITS.reports)) {
        let entries: SignalRetrievedEntry[];
        try { entries = readValidatedSignalEntries(hq, id, journal); } catch { failed = true; continue; }
        for (const entry of entries) {
          if (args.kind && entry.kind !== args.kind || args.track && entry.track !== args.track) continue;
          if (args.reference && (entry.reference.contentHash !== args.reference.contentHash || args.reference.entryId && entry.id !== args.reference.entryId)) continue;
          const sourceDates = entry.sources.flatMap(source => source.sourcePublishedAt ? [Date.parse(source.sourcePublishedAt)] : []);
          const date = entry.eventDate ? Date.parse(entry.eventDate) : sourceDates.length ? Math.max(...sourceDates) : 0;
          if (!args.reference) {
            if (args.freshness === 'evergreen') { if (entry.temporalKind !== 'evergreen') continue; }
            else {
              if (Date.parse(entry.createdAt) < cutoff || Date.parse(entry.createdAt) > now) continue;
              if (entry.temporalKind === 'time-sensitive' && (!date || date < cutoff || date > now)) continue;
            }
            if (mode === 'browse' && !args.track && entry.track !== 'your-world') continue;
          }
          const words = new Set(terms(`${entry.title} ${entry.topics.join(' ')} ${entry.excerpt}`));
          const score = query.filter(term => words.has(term)).length;
          if (mode === 'search' && !score) continue;
          const reportDate = Date.parse(entry.createdAt);
          const rankDate = !args.reference && args.freshness !== 'evergreen' && entry.temporalKind === 'time-sensitive' ? date : reportDate;
          ranked.push({ entry, score, date: rankDate, reportDate });
        }
      }
      ranked.sort((a, b) => b.score - a.score || b.date - a.date || b.reportDate - a.reportDate || a.entry.id.localeCompare(b.entry.id));
      // Round-robin report/topic groups for a broad inspiration browse.
      if (mode === 'browse') {
        const seen = new Set<string>();
        ranked.sort((a, b) => Number(a.entry.kind === 'finding') - Number(b.entry.kind === 'finding'));
        const first = ranked.filter(item => { const key = `${item.entry.reference.outputId}:${item.entry.topics[0] ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
        const chosen = new Set(first);
        return this.bounded([...first, ...ranked.filter(item => !chosen.has(item))].map(item => item.entry), mode, failed);
      }
      const result = this.bounded(ranked.map(item => item.entry), mode, failed);
      return args.reference && !result.entries.length ? unavailable(mode) : result;
    } catch { return unavailable(mode); }
  }
}

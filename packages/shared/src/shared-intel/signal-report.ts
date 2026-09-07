import { z } from 'zod';
import { normalizeSignalVideoUrl, signalWorkflowFor, validateSignalRunIdentity, type SignalRunIdentity, type SignalTemporalKind } from './signal-contracts.ts';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
const entrySchema = z.object({
  id, title: z.string().trim().min(1).max(200), excerpt: z.string().trim().min(1).max(600),
  topics: z.array(z.string().trim().min(1).max(80)).max(8),
  sourceRefs: z.array(id).min(1).max(20), temporalKind: z.enum(['time-sensitive', 'evergreen', 'unknown']),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type SignalFinding = z.infer<typeof entrySchema>;
const ideaSchema = entrySchema.extend({
  supportingFindingIds: z.array(id).min(1).max(12),
  suggestedWorkerRoles: z.array(z.string().trim().min(1).max(80)).max(7).optional(),
}).strict();
export type SignalIdea = z.infer<typeof ideaSchema>;
export interface SignalReportSource {
  sourceId: string; sourceUrl: string; videoId?: string;
  sourcePublishedAt?: string; eventDate?: string; timestampSeconds?: number;
}
export interface SignalSynthesisContext { identity: SignalRunIdentity; sources: readonly SignalReportSource[] }
export interface SignalVideoCoverageOutcomes {
  includedVideoIds: string[];
  examinedNoFindingVideoIds: string[];
  unresolvedVideoIds: string[];
}
export interface SignalSynthesisResult {
  version: 1; outcome: 'report' | 'no-change'; markdown: string; examinedVideoIds: string[];
  findings: SignalFinding[]; ideas: SignalIdea[]; warnings: string[]; indexingStatus: 'ready' | 'failed';
  /** Independent of index availability. Merely examined never implies empty. */
  coverage: SignalVideoCoverageOutcomes;
}

const envelopeSchema = z.object({
  version: z.literal(1), outcome: z.enum(['report', 'no-change']), markdown: z.string().max(100_000),
  examinedVideoIds: z.array(z.string()).max(20), findings: z.array(z.unknown()).max(12), ideas: z.array(z.unknown()).max(5),
  noFindingVideoIds: z.array(z.string()).max(20).optional(),
}).strict();

/** Engine validates the envelope; host validation below checks evidence and excerpts. */
export const SIGNAL_SYNTHESIS_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['version', 'outcome', 'markdown', 'examinedVideoIds', 'findings', 'ideas'],
  properties: {
    version: { type: 'integer', const: 1 }, outcome: { type: 'string', enum: ['report', 'no-change'] },
    markdown: { type: 'string', maxLength: 100_000 },
    examinedVideoIds: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' } },
    noFindingVideoIds: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' } },
    findings: { type: 'array', maxItems: 12, items: { type: 'object' } },
    ideas: { type: 'array', maxItems: 5, items: { type: 'object' } },
  },
} as const;

function validEventDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Model prose may describe evidence, but cannot supply identity or source timestamps. */
export function parseSignalSynthesis(value: unknown, context: SignalSynthesisContext): SignalSynthesisResult {
  const identity = validateSignalRunIdentity(context.identity);
  const input = envelopeSchema.parse(value);
  const sources = new Map(context.sources.map(source => [source.sourceId, source]));
  if (sources.size !== context.sources.length) throw new Error('Duplicate host source IDs');
  for (const source of context.sources) {
    let url: URL;
    try { url = new URL(source.sourceUrl); } catch { throw new Error('Invalid host source URL'); }
    if (!id.safeParse(source.sourceId).success || !['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || (source.sourcePublishedAt && !Number.isFinite(Date.parse(source.sourcePublishedAt)))
      || (source.eventDate && !validEventDate(source.eventDate))) throw new Error('Invalid host source provenance');
    if (source.videoId && (!identity.requestedVideoIds.includes(source.videoId)
      || normalizeSignalVideoUrl(source.sourceUrl)?.videoId !== source.videoId)) throw new Error('Source is outside the requested videos');
  }
  if (new Set(input.examinedVideoIds).size !== input.examinedVideoIds.length
    || input.examinedVideoIds.some(video => !identity.requestedVideoIds.includes(video)
      || !context.sources.some(source => source.videoId === video))) throw new Error('Synthesis claims an unvalidated video');
  if (new Set(input.noFindingVideoIds).size !== (input.noFindingVideoIds?.length ?? 0)
    || input.noFindingVideoIds?.some(video => !input.examinedVideoIds.includes(video))) throw new Error('No-finding claims require distinct examined videos');
  if (input.outcome === 'no-change' && (input.markdown.trim() || input.findings.length || input.ideas.length)) throw new Error('No-change cannot manufacture a report');
  if (input.outcome === 'report' && (!input.markdown.trim() || !input.findings.length)) throw new Error('Report requires useful findings');
  const warnings: string[] = [];
  const ids = new Set<string>();
  let indexingStatus: 'ready' | 'failed' = 'ready';
  function validateEntry<T extends SignalFinding>(entry: T): T {
    if (ids.has(entry.id)) throw new Error(`Duplicate entry ID: ${entry.id}`);
    if (new Set(entry.sourceRefs).size !== entry.sourceRefs.length || entry.sourceRefs.some(ref => !sources.has(ref))) throw new Error(`Unknown or duplicate source reference: ${entry.id}`);
    if (!input.markdown.includes(entry.excerpt)) throw new Error(`Excerpt absent from report: ${entry.id}`);
    if (entry.eventDate && (!validEventDate(entry.eventDate) || !entry.sourceRefs.some(ref => sources.get(ref)?.eventDate === entry.eventDate))) {
      warnings.push(`Unverified event date omitted: ${entry.id}`);
      delete entry.eventDate;
    }
    ids.add(entry.id);
    return entry;
  }
  const findings: SignalFinding[] = [];
  const claimedFindingVideos = new Set<string>();
  for (const value of input.findings) {
    // Provenance is mandatory even when unrelated presentation/index fields fail.
    const core = z.object({ sourceRefs: z.array(id).min(1).max(20) }).parse(value);
    if (new Set(core.sourceRefs).size !== core.sourceRefs.length || core.sourceRefs.some(ref => !sources.has(ref))) throw new Error('Unknown or duplicate finding source');
    for (const ref of core.sourceRefs) {
      const videoId = sources.get(ref)?.videoId;
      if (videoId) {
        if (!input.examinedVideoIds.includes(videoId)) throw new Error('Finding references an unexamined video');
        claimedFindingVideos.add(videoId);
      }
    }
    const parsed = entrySchema.strict().safeParse(value);
    if (!parsed.success) { warnings.push('Finding index shape invalid'); indexingStatus = 'failed'; continue; }
    try { findings.push(validateEntry(parsed.data)); }
    catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); indexingStatus = 'failed'; }
  }
  const included = new Set(findings.flatMap(finding => finding.sourceRefs.flatMap(ref => sources.get(ref)?.videoId ? [sources.get(ref)!.videoId!] : [])));
  const noFinding = new Set(input.outcome === 'no-change' ? input.examinedVideoIds : input.noFindingVideoIds ?? []);
  if ([...noFinding].some(video => claimedFindingVideos.has(video))) throw new Error('Video cannot have both a finding and an empty result');
  const coverage: SignalVideoCoverageOutcomes = {
    includedVideoIds: identity.requestedVideoIds.filter(video => included.has(video)),
    examinedNoFindingVideoIds: identity.requestedVideoIds.filter(video => noFinding.has(video)),
    unresolvedVideoIds: identity.requestedVideoIds.filter(video => !included.has(video) && !noFinding.has(video)),
  };
  const findingIds = new Set(findings.map(finding => finding.id));
  const ideas: SignalIdea[] = [];
  for (const value of input.ideas) {
    const parsed = ideaSchema.safeParse(value);
    if (!parsed.success) { warnings.push('Invalid optional idea omitted'); continue; }
    try {
      if (parsed.data.supportingFindingIds.some(ref => !findingIds.has(ref))) throw new Error(`Idea has no supporting finding: ${parsed.data.id}`);
      const supportedSources = new Set(findings.filter(finding => parsed.data.supportingFindingIds.includes(finding.id)).flatMap(finding => finding.sourceRefs));
      if (parsed.data.sourceRefs.some(ref => !supportedSources.has(ref))) throw new Error(`Idea source is not supported by its findings: ${parsed.data.id}`);
      ideas.push(validateEntry(parsed.data));
    } catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); }
  }
  return { ...input, findings: indexingStatus === 'failed' ? [] : findings,
    ideas: indexingStatus === 'failed' ? [] : ideas, warnings, indexingStatus, coverage };
}

export interface SignalReportProvenance {
  outputId: string; finalOutputId: string; workflowRunId: string; workflowSlug: string;
  workspaceId: string; stepId: string; status: string; runState: string; readable: boolean;
  contentHash: string; createdAt: string;
}
export function validateSignalReportProvenance(identity: SignalRunIdentity, report: SignalReportProvenance): void {
  validateSignalRunIdentity(identity);
  if (!report.outputId.trim() || report.outputId !== report.finalOutputId || report.workflowRunId !== identity.workflowRunId
    || report.workspaceId !== identity.hqWorkspaceId || report.workflowSlug !== signalWorkflowFor(identity.track, identity.mode)
    || report.stepId !== 'synthesize' || report.status !== 'published' || report.runState !== 'succeeded'
    || !report.readable || !report.contentHash.trim() || !Number.isFinite(Date.parse(report.createdAt))) throw new Error('Invalid final Signal report provenance');
}

export interface SignalReportMetadata {
  version: 1; identity: SignalRunIdentity; outputId: string; contentHash: string; createdAt: string;
  coverageStatus: 'complete' | 'partial'; sources: SignalReportSource[];
  findings: SignalFinding[]; ideas: SignalIdea[]; warnings: string[]; indexingStatus: 'ready' | 'failed';
}
export function buildSignalReportMetadata(input: {
  identity: SignalRunIdentity; report: SignalReportProvenance; synthesis: SignalSynthesisResult;
  sources: readonly SignalReportSource[]; coverageStatus: 'complete' | 'partial';
}): SignalReportMetadata {
  validateSignalReportProvenance(input.identity, input.report);
  if (input.synthesis.outcome !== 'report') throw new Error('No-change has no report metadata');
  return structuredClone({
    version: 1, identity: input.identity, outputId: input.report.outputId, contentHash: input.report.contentHash,
    createdAt: input.report.createdAt, coverageStatus: input.coverageStatus, sources: [...input.sources],
    findings: input.synthesis.findings, ideas: input.synthesis.ideas, warnings: input.synthesis.warnings, indexingStatus: input.synthesis.indexingStatus,
  });
}

/** Report creation and video publication never imply the underlying event is recent. */
export function signalTemporalMetadata(entry: Pick<SignalFinding, 'temporalKind' | 'eventDate' | 'sourceRefs'>, sources: readonly SignalReportSource[]): {
  temporalKind: SignalTemporalKind; sourcePublishedAt: string[]; eventDate?: string;
} {
  const matching = sources.filter(source => entry.sourceRefs.includes(source.sourceId));
  const verifiedEventDate = entry.eventDate && validEventDate(entry.eventDate) && matching.some(source => source.eventDate === entry.eventDate) ? entry.eventDate : undefined;
  return {
    temporalKind: entry.temporalKind, sourcePublishedAt: [...new Set(matching.flatMap(source => source.sourcePublishedAt ? [source.sourcePublishedAt] : []))].sort(),
    ...(verifiedEventDate ? { eventDate: verifiedEventDate } : {}),
  };
}

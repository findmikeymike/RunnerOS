import { z } from 'zod';
import type { SignalFinding, SignalIdea, SignalReportSource } from './signal-report.ts';
import type { SignalMode, SignalTrack } from './signal-contracts.ts';

export const SIGNAL_RETRIEVAL_LIMITS = { entries: 5, characters: 4000, query: 500, reports: 200 } as const;
export const SIGNAL_RETRIEVAL_WORKERS = ['content-genius', 'x-editorial', 'world-builder', 'branding-agent', 'community-agent', 'concierge', 'content-director'] as const;
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const signalEntryReferenceSchema = z.object({
  hqWorkspaceId: identifier, outputId: identifier, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  entryId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/),
}).strict();
export type SignalEntryReference = z.infer<typeof signalEntryReferenceSchema>;
export const findSignalIdeasSchema = z.object({
  query: z.string().trim().max(SIGNAL_RETRIEVAL_LIMITS.query).optional(),
  track: z.enum(['industry', 'your-world']).optional(),
  freshness: z.enum(['recent', 'evergreen']).optional(),
  kind: z.enum(['finding', 'idea']).optional(),
  reference: signalEntryReferenceSchema.extend({ entryId: signalEntryReferenceSchema.shape.entryId.optional() }).optional(),
}).strict();
export type FindSignalIdeasInput = z.infer<typeof findSignalIdeasSchema>;
export interface SignalRetrievedEntry extends SignalFinding {
  reference: SignalEntryReference;
  kind: 'finding' | 'idea'; track: SignalTrack; mode: SignalMode;
  workflowRunId: string; createdAt: string; coverageStatus: 'complete' | 'partial';
  sources: SignalReportSource[];
  supportingFindingIds?: string[];
  supportingFindings?: (Pick<SignalFinding, 'id' | 'excerpt' | 'sourceRefs'> & { excerptTruncated?: true })[];
  supportingFindingsOmitted?: number;
  suggestedWorkerRoles?: SignalIdea['suggestedWorkerRoles'];
}
export interface SignalLookupResult {
  ok: boolean; mode: 'search' | 'browse' | 'reference'; entries: SignalRetrievedEntry[];
  unavailable?: true; error?: string;
}

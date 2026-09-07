import { isDeepStrictEqual } from 'node:util';
import type { OutputManifest } from '@craft-agent/shared/outputs';
import { isFinalSignalReport, SIGNAL_CONTRACT, signalWorkflowFor, validateSignalRunIdentity, type SignalReportMetadata } from '@craft-agent/shared/shared-intel';
import type { WorkflowRunSnapshot } from '@craft-agent/shared/workflows';
import { hash, readEvidence, readSignals, type SignalStore } from './storage';

export type SignalFinalReportRun = Pick<WorkflowRunSnapshot, 'id' | 'workspaceId' | 'workflowSlug' | 'state' | 'finalOutputId'>
  & Partial<Pick<WorkflowRunSnapshot, 'trigger'>>;

export class SignalFinalReportError extends Error {
  constructor(readonly code: 'REPORT_NOT_FINAL' | 'REPORT_CHANGED' = 'REPORT_NOT_FINAL') {
    super(code === 'REPORT_CHANGED' ? 'The Signals report changed. Reload the report before playing audio.' : 'Signals report validation is unavailable. Reload the report and try again.');
  }
}

/** Read-only host proof for new-contract reports. Call before opening the primary asset.
 * Callers retain responsibility for local workspace access and safe asset resolution.
 */
export function validateSignalFinalReport(root: string, workspaceId: string, output: OutputManifest, run: SignalFinalReportRun, journal?: SignalStore): SignalReportMetadata {
  try {
    if (!isFinalSignalReport(output) || output.workspaceId !== workspaceId
      || run.workspaceId !== workspaceId || run.id !== output.origin.workflowRunId
      || run.state !== 'succeeded' || run.finalOutputId !== output.id
      || run.workflowSlug !== output.origin.workflowSlug) throw new Error();
    // A lookup can validate several reports against one freshly read journal.
    const state = journal ?? readSignals(root, workspaceId);
    if (state.version !== 1 || state.hqWorkspaceId !== workspaceId) throw new Error();
    const matches = state.requests.filter(request => request.outputId === output.id);
    if (matches.length !== 1) throw new Error();
    const request = matches[0]!;
    const frozen = validateSignalRunIdentity(request.identity);
    const currentRunId = request.workflowRunId ?? frozen.workflowRunId;
    const inputs = run.trigger?.inputs;
    if (!['report', 'partial'].includes(request.status) || !request.collectionComplete
      || request.runId !== frozen.runId || frozen.hqWorkspaceId !== workspaceId
      || request.track !== frozen.track || request.mode !== frozen.mode
      || request.config.track !== frozen.track || request.config.revision !== frozen.configRevision
      || currentRunId !== run.id || run.workflowSlug !== signalWorkflowFor(frozen.track, frozen.mode)
      || (currentRunId !== frozen.workflowRunId && !request.attempts?.some(attempt => attempt.runId === currentRunId))
      || inputs?.signalContract !== SIGNAL_CONTRACT || inputs.signalRequestId !== request.runId
      || inputs.track !== frozen.track || inputs.mode !== frozen.mode
      || !request.outputHash || !/^[a-f0-9]{64}$/.test(request.outputHash)
      || !request.reportMetadataHash) throw new Error();
    const metadata = readEvidence<SignalReportMetadata>(root, request.reportMetadataHash);
    const identity = validateSignalRunIdentity(metadata.identity);
    if (metadata.version !== 1 || !isDeepStrictEqual(identity, { ...frozen, workflowRunId: currentRunId })
      || metadata.outputId !== output.id || metadata.contentHash !== request.outputHash
      || metadata.createdAt !== output.createdAt || !Number.isFinite(Date.parse(metadata.createdAt))
      || !['complete', 'partial'].includes(metadata.coverageStatus)
      || !['ready', 'failed'].includes(metadata.indexingStatus)
      || !Array.isArray(metadata.sources) || !Array.isArray(metadata.findings)
      || !Array.isArray(metadata.ideas) || !Array.isArray(metadata.warnings)) throw new Error();
    return metadata;
  } catch { throw new SignalFinalReportError(); }
}

/** Compare the actual saved primary bytes, never renderer text or a title. */
export function validateSignalFinalReportContent(metadata: SignalReportMetadata, markdown: string): void {
  if (hash(markdown) !== metadata.contentHash) throw new SignalFinalReportError('REPORT_CHANGED');
}

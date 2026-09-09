import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import type { Workspace } from '@craft-agent/core/types';
import { assertOutputAssetPath, readOutput } from '@craft-agent/shared/outputs';
import { readRun } from '@craft-agent/shared/workflows';
import { parseSignalSynthesis, type SignalRetrievedEntry } from '@craft-agent/shared/shared-intel';
import type { SignalStore } from './storage';
import { validateSignalFinalReport, validateSignalFinalReportContent } from './final-report';

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../');
}
function readPrimary(root: string, outputId: string, assetPath: string): string {
  const path = assertOutputAssetPath(root, outputId, assetPath);
  if (!within(realpathSync(root), realpathSync(path))) throw new Error();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 400_000) throw new Error();
    const bytes = Buffer.alloc(400_001);
    let size = 0;
    while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, null); if (!n) break; size += n; }
    if (size > 400_000) throw new Error();
    return bytes.subarray(0, size).toString('utf8');
  } finally { closeSync(fd); }
}

/** Validated local report entries shared with the bounded HQ collector. Never writes or calls providers. */
export function readValidatedSignalEntries(hq: Pick<Workspace, 'id' | 'rootPath'>, outputId: string, journal?: SignalStore): SignalRetrievedEntry[] {
  const output = readOutput(hq.rootPath, outputId);
  if (!output || !output.primary || !output.origin.workflowRunId) throw new Error();
  const run = readRun(hq.rootPath, output.origin.workflowRunId);
  if (!run) throw new Error();
  const metadata = validateSignalFinalReport(hq.rootPath, hq.id, output, run, journal);
  if (metadata.indexingStatus !== 'ready') throw new Error();
  const markdown = readPrimary(hq.rootPath, output.id, output.primary.path);
  validateSignalFinalReportContent(metadata, markdown);
  // Reuse the synthesis validator to check bounds, source references, supporting
  // findings and literal excerpt membership; never regenerate metadata.
  const parsed = parseSignalSynthesis({ version: 1, outcome: 'report', markdown,
    examinedVideoIds: [...new Set(metadata.sources.flatMap(source => source.videoId ? [source.videoId] : []))],
    findings: metadata.findings, ideas: metadata.ideas }, { identity: metadata.identity, sources: metadata.sources });
  if (parsed.indexingStatus !== 'ready' || parsed.warnings.length || parsed.ideas.length !== metadata.ideas.length) throw new Error();
  return [...parsed.findings.map(entry => ({ entry, kind: 'finding' as const })), ...parsed.ideas.map(entry => ({ entry, kind: 'idea' as const }))].map(({ entry, kind }) => {
    const supportingFindings = 'supportingFindingIds' in entry
      ? parsed.findings.filter(finding => (entry.supportingFindingIds as string[]).includes(finding.id)).map(({ id, excerpt, sourceRefs }) => ({ id, excerpt, sourceRefs })) : [];
    const sourceRefs = new Set([...entry.sourceRefs, ...supportingFindings.flatMap(finding => finding.sourceRefs)]);
    return {
      ...entry, kind, reference: { hqWorkspaceId: hq.id, outputId, contentHash: metadata.contentHash, entryId: entry.id },
      track: metadata.identity.track, mode: metadata.identity.mode, workflowRunId: run.id,
      createdAt: metadata.createdAt, coverageStatus: metadata.coverageStatus,
      sources: metadata.sources.filter(source => sourceRefs.has(source.sourceId)),
      ...(kind === 'idea' ? { supportingFindings } : {}),
    };
  });
}


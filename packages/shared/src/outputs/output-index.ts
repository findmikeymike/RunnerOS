import type { OutputManifest } from './types.ts';
import { VISUAL_BOARD_TAG } from '../visual-board/index.ts';

export const OUTPUT_INDEX_CONTEXT_SLUG = 'output-index';
export const OUTPUT_INDEX_MAX_PENDING = 8;
export const OUTPUT_INDEX_MAX_RECENT = 10;

function byUpdatedDesc(a: OutputManifest, b: OutputManifest): number {
  return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
}

function contextLabel(output: OutputManifest): string {
  if (output.context?.scope === 'campaign') return `campaign:${output.context.campaignId}`;
  return 'hq';
}

function originLabel(output: OutputManifest): string {
  return output.origin.agentName
    ?? output.origin.agentSlug
    ?? output.origin.workflowName
    ?? output.origin.workflowSlug
    ?? output.origin.source;
}

function lineFor(output: OutputManifest): string {
  return `- ${output.title} | ${output.kind} | ${originLabel(output)} | ${contextLabel(output)} | id:${output.id}`;
}

export function buildOutputIndexBody(outputs: OutputManifest[]): string {
  const active = outputs
    .filter((output) => output.status !== 'failed' && output.status !== 'cancelled')
    .filter((output) => !output.tags?.includes(VISUAL_BOARD_TAG))
    .sort(byUpdatedDesc);
  const pending = active
    .filter((output) => output.approval?.state === 'pending')
    .slice(0, OUTPUT_INDEX_MAX_PENDING);
  const recent = active
    .filter((output) => output.approval?.state !== 'pending')
    .slice(0, OUTPUT_INDEX_MAX_RECENT);

  const pendingLines = pending.length > 0 ? pending.map(lineFor).join('\n') : '- None';
  const recentLines = recent.length > 0 ? recent.map(lineFor).join('\n') : '- None';

  return [
    '# Output Index',
    '',
    'Generated summary of Work Products. Use IDs when referring to exact outputs.',
    '',
    '## Needs Approval',
    pendingLines,
    '',
    '## Recent Work',
    recentLines,
  ].join('\n');
}

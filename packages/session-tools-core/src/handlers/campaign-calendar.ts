import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface CampaignCalendarWriteToolInput {
  campaignId?: string;
  operation: 'create' | 'update' | 'cancel';
  explanation: string;
  requiresUserConfirmation?: boolean;
  item: {
    id?: string;
    date?: string;
    time?: string;
    timezone?: string;
    title?: string;
    notes?: string;
    kind?: 'manual' | 'deadline' | 'approval' | 'scheduled-job';
    status?: 'draft' | 'scheduled' | 'needs-approval' | 'running' | 'done' | 'failed' | 'missed' | 'canceled';
    personIds?: string[];
    assetRefs?: Array<{ assetId: string; label?: string; kind?: string }>;
    finalRefs?: Array<{ outputId: string; slot?: string; assetId?: string; label?: string }>;
    outputRefs?: Array<{ outputId: string; title?: string; kind?: string }>;
    accountSetId?: string;
    socialProfileRefs?: Array<{ platform: string; profileId?: string; label?: string }>;
    job?: {
      runAt: string;
      timezone?: string;
      actionType: 'post-asset' | 'run-workflow' | 'ask-agent' | 'generate-content' | 'outreach-batch' | 'review' | 'custom-prompt';
      payload?: Record<string, unknown>;
      approvalPolicy?: 'none' | 'approval-before-run' | 'approval-before-external-action' | 'preapproved-exact-payload';
      maxAttempts?: number;
    };
  };
}

export interface CampaignCalendarWriteResult {
  ok: boolean;
  operation?: CampaignCalendarWriteToolInput['operation'];
  itemId?: string;
  title?: string;
  status?: string;
  error?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SECRET_PAYLOAD_RE = /token|secret|password|cookie|bearer|2fa|two[-_\s]?factor/i;

export async function handleCampaignCalendarWrite(
  ctx: SessionToolContext,
  args: CampaignCalendarWriteToolInput,
): Promise<ToolResult> {
  if (!ctx.campaignCalendarWrite) {
    return errorResponse('campaign_calendar_write is not available in this context.');
  }
  if (!args || typeof args !== 'object') return errorResponse('Input is required.');
  if (!['create', 'update', 'cancel'].includes(args.operation)) {
    return errorResponse('operation must be create, update, or cancel.');
  }
  if (!args.explanation?.trim()) return errorResponse('explanation is required.');
  if (!args.item || typeof args.item !== 'object') return errorResponse('item is required.');

  if (args.operation === 'create') {
    if (!args.item.date || !DATE_RE.test(args.item.date)) return errorResponse('create requires item.date as YYYY-MM-DD.');
    if (!args.item.title?.trim()) return errorResponse('create requires item.title.');
  } else if (!args.item.id?.trim()) {
    return errorResponse(`${args.operation} requires item.id.`);
  }

  if (args.item.job) {
    if (!args.item.job.runAt || Number.isNaN(Date.parse(args.item.job.runAt))) {
      return errorResponse('item.job.runAt must be a valid ISO timestamp.');
    }
    if (!args.item.job.actionType) return errorResponse('item.job.actionType is required.');
    const unsafePayloadPath = findUnsafePayloadPath(args.item.job.payload ?? {});
    if (unsafePayloadPath) {
      return errorResponse(`item.job.payload contains sensitive material at ${unsafePayloadPath}. Store credentials in Settings/Secrets, not Campaign Calendar.`);
    }
  }

  try {
    const result = await ctx.campaignCalendarWrite(args);
    if (!result.ok) return errorResponse(result.error ?? 'Failed to write campaign calendar item.');
    return successResponse(
      `Campaign calendar ${result.operation ?? args.operation}: ${result.title ?? result.itemId}. Status: ${result.status ?? 'scheduled'}.`,
    );
  } catch (err) {
    return errorResponse(`Failed to write campaign calendar item: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function findUnsafePayloadPath(value: unknown, path = 'payload'): string | undefined {
  if (typeof value === 'string') {
    return SECRET_PAYLOAD_RE.test(value) ? path : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findUnsafePayloadPath(value[index], `${path}[${index}]`);
      if (match) return match;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (SECRET_PAYLOAD_RE.test(key)) return childPath;
    const match = findUnsafePayloadPath(child, childPath);
    if (match) return match;
  }
  return undefined;
}

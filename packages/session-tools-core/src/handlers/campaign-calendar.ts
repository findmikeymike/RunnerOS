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
    releaseKitRefs?: Array<{ itemId: string; sha256: string; label?: string }>;
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
    return errorResponse('Runnable work must use Artist Manager schedule_work so it joins the tracked background queue. Use campaign_calendar_write only for reminders, deadlines, and other non-running calendar items.');
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

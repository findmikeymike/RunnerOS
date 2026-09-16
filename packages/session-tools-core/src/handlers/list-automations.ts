import { buildSessionResultLink } from '../result-links.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { ListAutomationsInput } from './automation-maintenance-types.ts';

export async function handleListAutomations(ctx: SessionToolContext, args: ListAutomationsInput): Promise<ToolResult> {
  if (!ctx.listAutomations) return errorResponse('Automation maintenance is available only to Builder.');
  if (Object.keys(args).some(key => key !== 'limit')) return errorResponse('Only limit is supported; this tool uses the current workspace.');
  const limit = args.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return errorResponse('limit must be a whole number from 1 to 50.');
  try {
    const result = await ctx.listAutomations({ limit });
    return result.ok ? successResponse(JSON.stringify({ ...result, automations: result.automations.map(automation => ({ ...automation, url: buildSessionResultLink(ctx, 'automation', automation.automationId) })) })) : errorResponse(result.error);
  } catch (error) { return errorResponse(`Could not list automations: ${error instanceof Error ? error.message : String(error)}`); }
}

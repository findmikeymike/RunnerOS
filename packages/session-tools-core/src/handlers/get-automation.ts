import { buildSessionResultLink } from '../result-links.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { GetAutomationInput } from './automation-maintenance-types.ts';

export async function handleGetAutomation(ctx: SessionToolContext, args: GetAutomationInput): Promise<ToolResult> {
  if (!ctx.getAutomation) return errorResponse('Automation maintenance is available only to Builder.');
  if (Object.keys(args).some(key => key !== 'automationId') || typeof args.automationId !== 'string' || !args.automationId.trim()) return errorResponse('Provide one automationId in the current workspace.');
  try {
    const result = await ctx.getAutomation(args);
    return result.ok ? successResponse(JSON.stringify({ ...result, automation: { ...result.automation, url: buildSessionResultLink(ctx, 'automation', result.automation.automationId) } })) : errorResponse(result.error);
  } catch (error) { return errorResponse(`Could not read automation: ${error instanceof Error ? error.message : String(error)}`); }
}

import { buildSessionResultLink } from '../result-links.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { UpdateAutomationInput } from './automation-maintenance-types.ts';

export async function handleUpdateAutomation(ctx: SessionToolContext, args: UpdateAutomationInput): Promise<ToolResult> {
  if (!ctx.updateAutomation) return errorResponse('Automation maintenance is available only to Builder.');
  if (Object.keys(args).some(key => !['automationId', 'expectedRevision', 'intent', 'patch'].includes(key))) return errorResponse('Unsupported update fields; updates use the current workspace and the same automation ID.');
  if (![args.automationId, args.expectedRevision, args.intent].every(value => typeof value === 'string' && value.trim())) return errorResponse('automationId, expectedRevision, and the approved change intent are required.');
  if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch)) return errorResponse('patch must be an allowlisted change object.');
  const keys = Object.keys(args.patch);
  if (!keys.length || keys.some(key => !['name', 'description', 'enabled', 'trigger', 'execution'].includes(key))) return errorResponse('patch supports only name, description, enabled, trigger, and typed execution.');
  if (args.patch.name !== undefined && (typeof args.patch.name !== 'string' || !args.patch.name.trim())) return errorResponse('name must be a nonempty string.');
  if (args.patch.description !== undefined && typeof args.patch.description !== 'string') return errorResponse('description must be a string.');
  if (args.patch.enabled !== undefined && typeof args.patch.enabled !== 'boolean') return errorResponse('enabled must be true or false.');
  try {
    const result = await ctx.updateAutomation(args);
    return result.ok ? successResponse(JSON.stringify({ ...result, automation: { ...result.automation, url: buildSessionResultLink(ctx, 'automation', result.automation.automationId) } })) : errorResponse(result.error);
  } catch (error) { return errorResponse(`Could not update automation: ${error instanceof Error ? error.message : String(error)}`); }
}

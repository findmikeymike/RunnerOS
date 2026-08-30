import type { ManageGoalRunInput, ManageGoalRunResult } from '@craft-agent/shared/scheduled-work';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export type ManageGoalRunToolInput = ManageGoalRunInput;
export type ManageGoalRunToolResult = ManageGoalRunResult;

export async function handleManageGoalRun(ctx: SessionToolContext, args: ManageGoalRunToolInput): Promise<ToolResult> {
  if (!ctx.manageGoalRun) return errorResponse('manage_goal_run is only available to HNIC.');
  if (!args.runId?.trim() || !args.expectedUpdatedAt?.trim() || !args.explanation?.trim()) {
    return errorResponse('runId, expectedUpdatedAt, and explanation are required.');
  }
  if (args.requiresUserConfirmation) return errorResponse('Get explicit user confirmation before changing a Goal run.');
  if (!['rearm', 'pause', 'cancel'].includes(args.operation)) return errorResponse('operation must be rearm, pause, or cancel.');
  if (args.maxRounds !== undefined && (!Number.isInteger(args.maxRounds) || args.maxRounds < 2 || args.maxRounds > 8)) {
    return errorResponse('maxRounds must be an integer from 2 through 8.');
  }
  try {
    const result = await ctx.manageGoalRun(args);
    return successResponse(`Goal run ${args.operation === 'rearm' ? 'resumed' : `${args.operation}d`}: ${result.coordinator.title}.`);
  } catch (error) {
    return errorResponse(`Failed to manage Goal run: ${error instanceof Error ? error.message : String(error)}`);
  }
}

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface CreateGoalToolInput {
  objective: string;
  doneWhen?: string;
  maxRounds?: number;
  tokenBudget?: number;
}

export interface UpdateGoalToolInput {
  goalId: string;
  revision: number;
  status: 'complete' | 'blocked';
  summary: string;
  evidence?: string[];
}

export async function handleGetGoal(ctx: SessionToolContext): Promise<ToolResult> {
  if (!ctx.getChatGoal) return errorResponse('get_goal is not available in this context.');
  const goal = ctx.getChatGoal();
  return successResponse(goal ? JSON.stringify(goal, null, 2) : 'No Goal exists in this chat.');
}

export async function handleCreateGoal(
  ctx: SessionToolContext,
  input: CreateGoalToolInput,
): Promise<ToolResult> {
  if (!ctx.proposeChatGoal) return errorResponse('create_goal is not available in this context.');
  try {
    const result = await ctx.proposeChatGoal(input);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to propose Goal.');
  }
}

export async function handleUpdateGoal(
  ctx: SessionToolContext,
  input: UpdateGoalToolInput,
): Promise<ToolResult> {
  if (!ctx.requestChatGoalUpdate) return errorResponse('update_goal is not available in this context.');
  try {
    const result = await ctx.requestChatGoalUpdate(input);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to update Goal.');
  }
}

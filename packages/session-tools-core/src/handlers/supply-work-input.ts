import type { SupplyScheduledWorkInputResult } from '@craft-agent/shared/scheduled-work';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface SupplyWorkInputToolInput {
  orderId: string;
  requestId: string;
  expectedUpdatedAt?: string;
  values: Record<string, unknown>;
}

export type SupplyWorkInputToolResult = SupplyScheduledWorkInputResult;

export async function handleSupplyWorkInput(
  ctx: SessionToolContext,
  args: SupplyWorkInputToolInput,
): Promise<ToolResult> {
  if (!ctx.supplyWorkInput) return errorResponse('supply_work_input is available only to Artist Manager.');
  if (!args.orderId?.trim() || !args.requestId?.trim()) {
    return errorResponse('orderId and requestId are required.');
  }
  if (!args.values || typeof args.values !== 'object' || Array.isArray(args.values)) {
    return errorResponse('values must be an object containing every requested input.');
  }
  try {
    const result = await ctx.supplyWorkInput(args);
    return successResponse(`Inputs supplied for tracked work: ${result.order.title}. It is now ${result.order.status}.`);
  } catch (error) {
    return errorResponse(`Failed to supply tracked-work inputs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

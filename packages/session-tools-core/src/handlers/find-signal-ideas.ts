import { findSignalIdeasSchema, SIGNAL_RETRIEVAL_LIMITS, type FindSignalIdeasInput } from '@craft-agent/shared/shared-intel';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export async function handleFindSignalIdeas(ctx: SessionToolContext, input: FindSignalIdeasInput): Promise<ToolResult> {
  try {
    const args = findSignalIdeasSchema.parse(input);
    if (!ctx.findSignalIdeas) return errorResponse('Signals research is unavailable in this session.');
    const result = await ctx.findSignalIdeas(args);
    const body = JSON.stringify(result);
    if (body.length > SIGNAL_RETRIEVAL_LIMITS.characters || result.entries.length > SIGNAL_RETRIEVAL_LIMITS.entries) throw new Error();
    return result.ok ? successResponse(body) : errorResponse(body);
  } catch { return errorResponse('Signals research is unavailable. Try a narrower request or reload the source report.'); }
}

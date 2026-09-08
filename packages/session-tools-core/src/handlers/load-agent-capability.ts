import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface LoadAgentCapabilityInput {
  skillSlug: string;
  reason: string;
}

export interface LoadAgentCapabilityResult {
  skillSlug: string;
  instructions: string;
  alreadyLoaded?: boolean;
}

/** The host validates scope and records delivery; this handler never reads or enables a skill itself. */
export async function handleLoadAgentCapability(
  ctx: SessionToolContext,
  input: LoadAgentCapabilityInput,
): Promise<ToolResult> {
  if (!ctx.loadAgentCapability) {
    return errorResponse('load_agent_capability is not available in this context.');
  }
  const skillSlug = input.skillSlug?.trim();
  const reason = input.reason?.trim();
  if (!skillSlug || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(skillSlug)) {
    return errorResponse('skillSlug must be a valid skill slug.');
  }
  if (!reason || reason.length > 1000) {
    return errorResponse('reason must explain why this conversation needs the adjacent capability, in 1000 characters or fewer.');
  }
  try {
    const result = await ctx.loadAgentCapability({ skillSlug, reason });
    if (result.skillSlug !== skillSlug || !result.instructions.trim()) {
      return errorResponse('The host did not deliver the requested capability instructions.');
    }
    return successResponse([
      `${result.alreadyLoaded ? 'Already loaded' : 'Loaded'} capability: ${result.skillSlug}`,
      '',
      result.instructions,
    ].join('\n'));
  } catch (error) {
    return errorResponse(`Cannot load capability: ${error instanceof Error ? error.message : String(error)}`);
  }
}

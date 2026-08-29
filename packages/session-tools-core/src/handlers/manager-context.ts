import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface GetManagerBriefInput { knownRevision?: string }
export interface GetArtistContextInput {
  topic: 'profile' | 'month-plan' | 'growth' | 'intel' | 'calendar' | 'network' | 'community' | 'vault';
  month?: string;
  query?: string;
  limit?: number;
}
export interface GetCampaignContextInput {
  select: 'focus' | 'next-future' | 'latest-past' | 'primary' | 'by-id';
  campaignId?: string;
  include?: Array<'brief' | 'readiness' | 'calendar' | 'work' | 'assets' | 'outputs'>;
  limit?: number;
}
export interface ListWorkspaceContextInput { query?: string; limit?: number }
export interface GetWorkspaceContextInput { slug: string; maxChars?: number }

export type ManagerContextToolResult = { ok: boolean; error?: string; [key: string]: unknown };

async function invoke(
  callback: ((input: never) => Promise<ManagerContextToolResult>) | undefined,
  input: unknown,
  unavailable: string,
): Promise<ToolResult> {
  if (!callback) return errorResponse(unavailable);
  try {
    const result = await callback(input as never);
    const body = JSON.stringify(result, null, 2);
    return result.ok ? successResponse(body) : errorResponse(body);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export function handleGetManagerBrief(ctx: SessionToolContext, input: GetManagerBriefInput): Promise<ToolResult> {
  return invoke(ctx.getManagerBrief, input, 'get_manager_brief is only available to HNIC.');
}

export function handleGetArtistContext(ctx: SessionToolContext, input: GetArtistContextInput): Promise<ToolResult> {
  return invoke(ctx.getArtistContext, input, 'get_artist_context is only available to HNIC.');
}

export function handleGetCampaignContext(ctx: SessionToolContext, input: GetCampaignContextInput): Promise<ToolResult> {
  return invoke(ctx.getCampaignContext, input, 'get_campaign_context is only available to HNIC.');
}

export function handleListWorkspaceContext(ctx: SessionToolContext, input: ListWorkspaceContextInput): Promise<ToolResult> {
  return invoke(ctx.listWorkspaceContext, input, 'list_workspace_context is not available in this context.');
}

export function handleGetWorkspaceContext(ctx: SessionToolContext, input: GetWorkspaceContextInput): Promise<ToolResult> {
  return invoke(ctx.getWorkspaceContext, input, 'get_workspace_context is not available in this context.');
}

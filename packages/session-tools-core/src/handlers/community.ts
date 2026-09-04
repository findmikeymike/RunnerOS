import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface CommunityListContactsInput {
  segment?: string;
  tag?: string;
  consent?: string;
  city?: string;
  query?: string;
  limit?: number;
  forPersonalEmail?: boolean;
}

export type CommunityStatsInput = Record<string, never>;

export interface CommunityDraftEmailInput {
  title: string;
  subject: string;
  bodyMarkdown: string;
  segmentIds: string[];
  purpose?: 'announcement' | 'newsletter' | 'personal-outreach' | 'transactional';
}

export interface CommunityRequestSendInput { jobId: string }
export interface CommunityJobStatusInput { jobId: string }
export interface CommunityTagContactsInput {
  contactIds: string[];
  addTags?: string[];
  removeTags?: string[];
}

export type CommunityToolResult = { ok: boolean; error?: string; [key: string]: unknown };

const NO_COMMUNITY = 'Community tools are only available in an Artist HQ workspace.';

async function invoke(
  callback: ((input: never) => Promise<CommunityToolResult>) | undefined,
  input: unknown,
): Promise<ToolResult> {
  if (!callback) return errorResponse(NO_COMMUNITY);
  try {
    const result = await callback(input as never);
    const body = JSON.stringify(result, null, 2);
    return result.ok ? successResponse(body) : errorResponse(body);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

export function handleCommunityListContacts(ctx: SessionToolContext, input: CommunityListContactsInput): Promise<ToolResult> {
  return invoke(ctx.communityListContacts, input);
}

export function handleCommunityStats(ctx: SessionToolContext, input: CommunityStatsInput): Promise<ToolResult> {
  return invoke(ctx.communityStats, input);
}

export function handleCommunityDraftEmail(ctx: SessionToolContext, input: CommunityDraftEmailInput): Promise<ToolResult> {
  return invoke(ctx.communityDraftEmail, input);
}

export function handleCommunityRequestSend(ctx: SessionToolContext, input: CommunityRequestSendInput): Promise<ToolResult> {
  return invoke(ctx.communityRequestSend, input);
}

export function handleCommunityJobStatus(ctx: SessionToolContext, input: CommunityJobStatusInput): Promise<ToolResult> {
  return invoke(ctx.communityJobStatus, input);
}

export function handleCommunityTagContacts(ctx: SessionToolContext, input: CommunityTagContactsInput): Promise<ToolResult> {
  return invoke(ctx.communityTagContacts, input);
}
